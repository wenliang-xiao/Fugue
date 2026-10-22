// MultiBackendAdapter 生产版：实现 BackendPort，聚合多个 harness backend，内部路由。
// 对应 ADR-0002、REQ-005。
import { defineBackendAdapter } from 'qwen-audio-agent/backend-adapter-sdk'
import type { BackendEvent, BackendPort, BackendTask } from '../types/qwen-audio-agent/backend-adapter-sdk'
import { createRouter, type Router } from './routing'

function clean(value: unknown): string {
  return String(value || '').trim()
}

export interface MultiBackendAdapterOptions {
  router?: Router
  defaultBackend?: string
  rules?: Array<{ backendId: string; match: Record<string, unknown> }>
}

export class MultiBackendAdapter implements BackendPort {
  readonly backends: Record<string, BackendPort>
  readonly router: Router
  /** gatewayTaskId -> backendId，仅保留"进行中"任务；终态即清理，防泄漏 */
  taskMap = new Map<string, string>()
  listeners = new Set<(event: BackendEvent) => void>()
  _unsubscribers = new Map<string, () => void>()
  ready = false
  closed = false

  constructor(backends: Record<string, BackendPort>, options: MultiBackendAdapterOptions = {}) {
    if (!backends || typeof backends !== 'object' || Object.keys(backends).length === 0) {
      throw new TypeError('MultiBackendAdapter requires at least one backend')
    }
    this.backends = backends
    this.router = options.router
      || createRouter({
        defaultBackend: options.defaultBackend,
        rules: options.rules,
      })
  }

  _backendIdFor(task: BackendTask): string {
    const id = this.router(task)
    if (!this.backends[id]) {
      throw new Error(`Unknown backend: ${id}`)
    }
    return id
  }

  _backendFor(task: BackendTask): BackendPort {
    return this.backends[this._backendIdFor(task)]
  }

  describe(): Record<string, unknown> {
    const sub = Object.values(this.backends).map(b => b.describe?.() || {}) as Array<Record<string, unknown>>
    return {
      label: 'MultiBackendAdapter',
      protocol: 'multi',
      capabilities: {
        delegation: true,
        permissions: sub.some(d => (d.capabilities as Record<string, unknown> | undefined)?.permissions === true),
        backends: Object.keys(this.backends),
      },
    }
  }

  async start(): Promise<{ ok: boolean }> {
    this.ready = true
    const results = await Promise.all(
      Object.values(this.backends).map(b => b.start()),
    )
    return { ok: results.every(r => (r as { ok?: boolean })?.ok !== false) }
  }

  async health(): Promise<{ ok: boolean }> {
    // qwen-audio-agent 在 health() 时懒启动 backend（不会显式调 start()）
    if (!this.ready && !this.closed) {
      await this.start()
    }
    const results = await Promise.all(
      Object.values(this.backends).map(b => b.health()),
    )
    return { ok: this.ready && !this.closed && results.every(r => (r as { ok?: boolean })?.ok !== false) }
  }

  status(taskId?: string, context: unknown = {}): Record<string, unknown> {
    if (!clean(taskId)) {
      return {
        ok: this.ready && !this.closed,
        status: this.ready && !this.closed ? 'ready' : 'stopped',
        protocol: 'multi',
        backends: Object.keys(this.backends),
      }
    }
    const backendId = this.taskMap.get(taskId!)
    if (!backendId) return { taskId, state: 'not_found', activity: [] }
    return this.backends[backendId].status(taskId, context) as Record<string, unknown>
  }

  async submit(work: BackendTask, context: unknown = {}): Promise<unknown> {
    if (!this.ready && !this.closed) await this.start() // 懒启动（与 health 一致）
    const backendId = this._backendIdFor(work)
    const id = clean(work?.id)
    // 只在首次提交时登记 taskMap；重复 submit（任务已在进行）不覆盖，避免误删 hold 记录
    const isNew = Boolean(id) && !this.taskMap.has(id)
    if (isNew) this.taskMap.set(id, backendId)
    try {
      const outcome = await this.backends[backendId].submit(work, context)
      // submit resolve 即同步完成（hold 语义下会一直 pending，不会走到这里）
      if (id) this.taskMap.delete(id)
      return outcome
    } catch (error) {
      // 仅当本次是"新任务"时清理；重复 submit 失败不影响原 hold 任务的记录
      if (isNew && id) this.taskMap.delete(id)
      throw error
    }
  }

  async cancel(taskId: string, context: unknown = {}): Promise<unknown> {
    const backendId = this.taskMap.get(taskId)
    if (!backendId) return { taskId, state: 'not_found' }
    const result = await this.backends[backendId].cancel(taskId, context)
    if ((result as { state?: string })?.state === 'cancelled' || (result as { state?: string })?.state === 'not_found') {
      this.taskMap.delete(taskId)
    }
    return result
  }

  async respondAuthorization(
    taskId: string,
    authorizationId: string,
    decision: string,
    context: unknown = {},
  ): Promise<unknown> {
    const backendId = this.taskMap.get(taskId)
    if (!backendId) throw new Error('Authorization does not belong to an active task')
    return this.backends[backendId].respondAuthorization(
      taskId, authorizationId, decision, context,
    )
  }

  async respondInput(
    taskId: string,
    inputRequestId: string,
    response: unknown = {},
    context: unknown = {},
  ): Promise<unknown> {
    const backendId = this.taskMap.get(taskId)
    if (!backendId) throw new Error('Input request does not belong to an active task')
    return this.backends[backendId].respondInput(
      taskId, inputRequestId, response, context,
    )
  }

  subscribe(listener: (event: BackendEvent) => void): () => void {
    if (typeof listener !== 'function') {
      throw new TypeError('Backend event listener must be a function')
    }
    this.listeners.add(listener)
    for (const [id, backend] of Object.entries(this.backends)) {
      if (!this._unsubscribers.has(id)) {
        this._unsubscribers.set(id, backend.subscribe(event => {
          for (const l of this.listeners) {
            try {
              l(event)
            } catch {
              // observer failure 不中断
            }
          }
        }))
      }
    }
    return () => this.listeners.delete(listener)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.ready = false
    for (const id of Object.keys(this.backends)) {
      const unsub = this._unsubscribers.get(id)
      if (unsub) unsub()
    }
    this._unsubscribers.clear()
    this.listeners.clear()
    this.taskMap.clear()
    await Promise.allSettled(Object.values(this.backends).map(b => b.close()))
  }
}

export function createMultiBackendAdapter(
  backends: Record<string, BackendPort>,
  options: MultiBackendAdapterOptions = {},
): BackendPort {
  return defineBackendAdapter(new MultiBackendAdapter(backends, options), {
    name: 'MultiBackendAdapter',
  })
}

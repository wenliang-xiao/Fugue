// MultiBackendAdapter PoC：实现 BackendPort，聚合多个 harness backend，内部路由。
// 目标：验证"多 backend 可以封装在 BackendPort 后面"，通过上游一致性套件。
// 对应 ADR-0002。
import { defineBackendAdapter } from '/Users/wenlix/project/qwen-audio-agent/server/src/backend/backend-adapter-sdk.mjs'

function clean(value) {
  return String(value || '').trim()
}

export class MultiBackendAdapter {
  constructor(backends, { defaultBackend, router } = {}) {
    if (!backends || typeof backends !== 'object' || Object.keys(backends).length === 0) {
      throw new TypeError('MultiBackendAdapter requires at least one backend')
    }
    this.backends = backends
    this.defaultBackend = defaultBackend || Object.keys(backends)[0]
    this.router = router
      || ((task) => clean(task?.routing?.backendId) || this.defaultBackend)
    // gatewayTaskId -> backendId，在 submit 路由确定时记录，hold 期间 cancel 依赖它
    this.taskMap = new Map()
    this.listeners = new Set()
    this._unsubscribers = new Map() // backendId -> unsubscribe
    this.ready = false
    this.closed = false
  }

  _backendIdFor(task) {
    const id = this.router(task)
    if (!this.backends[id]) {
      throw new Error(`Unknown backend: ${id}`)
    }
    return id
  }

  _backendFor(task) {
    return this.backends[this._backendIdFor(task)]
  }

  describe() {
    return {
      label: 'MultiBackendAdapter',
      protocol: 'multi',
      capabilities: {
        delegation: true,
        permissions: false,
        backends: Object.keys(this.backends),
      },
    }
  }

  async start() {
    this.ready = true
    const results = await Promise.all(
      Object.values(this.backends).map(b => b.start()),
    )
    return { ok: results.every(r => r?.ok !== false) }
  }

  async health() {
    const results = await Promise.all(
      Object.values(this.backends).map(b => b.health()),
    )
    return { ok: this.ready && !this.closed && results.every(r => r?.ok !== false) }
  }

  status(taskId, context = {}) {
    if (!clean(taskId)) {
      return {
        ok: this.ready && !this.closed,
        status: this.ready && !this.closed ? 'ready' : 'stopped',
        protocol: 'multi',
        backends: Object.keys(this.backends),
      }
    }
    const backendId = this.taskMap.get(taskId)
    if (!backendId) return { taskId, state: 'not_found', activity: [] }
    return this.backends[backendId].status(taskId, context)
  }

  async submit(work, context = {}) {
    const backendId = this._backendIdFor(work)
    if (clean(work?.id)) this.taskMap.set(work.id, backendId)
    return this.backends[backendId].submit(work, context)
  }

  async cancel(taskId, context = {}) {
    const backendId = this.taskMap.get(taskId)
    if (!backendId) return { taskId, state: 'not_found' }
    return this.backends[backendId].cancel(taskId, context)
  }

  async respondAuthorization(taskId, authorizationId, decision, context = {}) {
    const backendId = this.taskMap.get(taskId)
    if (!backendId) throw new Error('Authorization does not belong to an active task')
    return this.backends[backendId].respondAuthorization(
      taskId, authorizationId, decision, context,
    )
  }

  async respondInput(taskId, inputRequestId, response = {}, context = {}) {
    const backendId = this.taskMap.get(taskId)
    if (!backendId) throw new Error('Input request does not belong to an active task')
    return this.backends[backendId].respondInput(
      taskId, inputRequestId, response, context,
    )
  }

  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Backend event listener must be a function')
    }
    this.listeners.add(listener)
    // 聚合所有子 backend 的事件，统一转发（子 backend 的 taskId 已是 gateway taskId）
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

  async close() {
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

// 用上游 SDK 的 defineBackendAdapter 做组合时校验（10 个方法齐全）
export function createMultiBackendAdapter(backends, options = {}) {
  return defineBackendAdapter(new MultiBackendAdapter(backends, options), {
    name: 'MultiBackendAdapter',
  })
}

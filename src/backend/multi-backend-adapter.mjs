// MultiBackendAdapter 生产版：实现 BackendPort，聚合多个 harness backend，内部路由。
// 对应 ADR-0002、REQ-005。
// 依赖：qwen-audio-agent 的 backend-adapter-sdk（发布后改为 `qwen-audio-agent/backend-adapter-sdk`）。
import { defineBackendAdapter } from '/Users/wenlix/project/qwen-audio-agent/server/src/backend/backend-adapter-sdk.mjs'
import { createRouter } from './routing.mjs'

function clean(value) {
  return String(value || '').trim()
}

export class MultiBackendAdapter {
  /**
   * @param {Record<string, BackendPort>} backends backend id -> BackendPort 实例
   * @param {object} [options]
   * @param {Function} [options.router] 路由函数 (task) => backendId；不传则用 defaultBackend/rules
   * @param {string} [options.defaultBackend] 默认 backend id
   * @param {Array} [options.rules] 路由规则（见 routing.mjs）
   */
  constructor(backends, options = {}) {
    if (!backends || typeof backends !== 'object' || Object.keys(backends).length === 0) {
      throw new TypeError('MultiBackendAdapter requires at least one backend')
    }
    this.backends = backends
    this.router = options.router
      || createRouter({
        defaultBackend: options.defaultBackend,
        rules: options.rules,
      })
    // gatewayTaskId -> backendId，仅保留"进行中"任务；终态即清理，防泄漏
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
    const sub = Object.values(this.backends).map(b => b.describe?.() || {})
    return {
      label: 'MultiBackendAdapter',
      protocol: 'multi',
      capabilities: {
        delegation: true,
        permissions: sub.some(d => d.capabilities?.permissions === true),
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
      // 仅当本次是“新任务”时清理；重复 submit 失败不影响原 hold 任务的记录
      if (isNew && id) this.taskMap.delete(id)
      throw error
    }
  }

  async cancel(taskId, context = {}) {
    const backendId = this.taskMap.get(taskId)
    if (!backendId) return { taskId, state: 'not_found' }
    const result = await this.backends[backendId].cancel(taskId, context)
    if (result?.state === 'cancelled' || result?.state === 'not_found') {
      this.taskMap.delete(taskId)
    }
    return result
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

export function createMultiBackendAdapter(backends, options = {}) {
  return defineBackendAdapter(new MultiBackendAdapter(backends, options), {
    name: 'MultiBackendAdapter',
  })
}

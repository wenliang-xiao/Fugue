// 测试替身：完整实现 BackendPort 的 Mock backend，支持 hold 与 owner 隔离。
import { BackendEventType, backendEvent } from 'qwen-audio-agent/backend-adapter-sdk'

function clean(value) {
  return String(value || '').trim()
}

export class MockBackend {
  constructor({ id = 'mock', hold = false } = {}) {
    this.id = id
    this.hold = hold
    this.ready = false
    this.closed = false
    this.active = new Map()
    this.listeners = new Set()
    this._startedResolvers = []
  }

  describe() {
    return {
      label: `MockBackend(${this.id})`,
      protocol: 'mock',
      capabilities: { delegation: true, permissions: false },
    }
  }

  async start() {
    this.ready = true
    return { ok: true }
  }

  async health() {
    return { ok: this.ready && !this.closed }
  }

  status(taskId, { ownerId } = {}) {
    if (!clean(taskId)) {
      return {
        ok: this.ready && !this.closed,
        status: this.ready && !this.closed ? 'ready' : 'stopped',
        protocol: 'mock',
      }
    }
    const rec = this.active.get(taskId)
    if (!rec || (ownerId && clean(ownerId) !== rec.ownerId)) {
      return { taskId, state: 'not_found', activity: [] }
    }
    return { taskId, state: 'working', activity: [] }
  }

  async submit(work, _context = {}) {
    const instruction = clean(work?.instruction || work?.objective || work?.message)
    if (!clean(work?.id) || !clean(work?.ownerId) || !instruction) {
      throw new Error('requires task id, owner and input')
    }
    if (this.active.has(work.id)) {
      throw new Error(`Task ${work.id} already active`)
    }
    this.publish(backendEvent(BackendEventType.ACTIVITY, {
      taskId: work.id,
      ownerId: work.ownerId,
      activity: { id: `act-${work.id}`, kind: 'status', status: 'running' },
    }))

    if (this.hold) {
      return new Promise((resolve, reject) => {
        this.active.set(work.id, { ownerId: work.ownerId, resolve, reject })
        for (const r of this._startedResolvers.splice(0)) r()
      })
    }
    return { content: `MockBackend(${this.id}) completed`, artifacts: [] }
  }

  async cancel(taskId, { ownerId } = {}) {
    const rec = this.active.get(taskId)
    if (!rec) return { taskId, state: 'not_found' }
    if (ownerId && clean(ownerId) !== rec.ownerId) {
      throw new Error('Cannot cancel task owned by another user')
    }
    this.active.delete(taskId)
    rec.reject(new Error(`Task ${taskId} was cancelled`))
    return { taskId, state: 'cancelled' }
  }

  async respondAuthorization() {
    throw new Error('MockBackend does not support authorization')
  }

  async respondInput() {
    throw new Error('MockBackend does not support input')
  }

  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Backend event listener must be a function')
    }
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async close() {
    if (this.closed) return
    this.closed = true
    this.active.clear()
    this.listeners.clear()
    this.ready = false
  }

  publish(event) {
    for (const l of this.listeners) {
      try {
        l(event)
      } catch {
        // observer failure 不中断
      }
    }
  }

  waitStarted() {
    return new Promise(resolve => this._startedResolvers.push(resolve))
  }
}

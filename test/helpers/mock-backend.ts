// 测试替身：完整实现 BackendPort 的 Mock backend，支持 hold 与 owner 隔离。
import { BackendEventType, backendEvent } from 'qwen-audio-agent/backend-adapter-sdk'
import type { BackendEvent, BackendPort, BackendTask } from '../../src/types/qwen-audio-agent/backend-adapter-sdk'

function clean(value: unknown): string {
  return String(value || '').trim()
}

interface ActiveRecord {
  ownerId: string
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

export class MockBackend implements BackendPort {
  readonly id: string
  readonly hold: boolean
  ready = false
  closed = false
  active = new Map<string, ActiveRecord>()
  listeners = new Set<(event: BackendEvent) => void>()
  _startedResolvers: Array<() => void> = []

  constructor(options: { id?: string; hold?: boolean } = {}) {
    const { id = 'mock', hold = false } = options
    this.id = id
    this.hold = hold
  }

  describe(): Record<string, unknown> {
    return {
      label: `MockBackend(${this.id})`,
      protocol: 'mock',
      capabilities: { delegation: true, permissions: false },
    }
  }

  async start(): Promise<{ ok: boolean }> {
    this.ready = true
    return { ok: true }
  }

  async health(): Promise<{ ok: boolean }> {
    return { ok: this.ready && !this.closed }
  }

  status(taskId?: string, context: { ownerId?: string } = {}): Record<string, unknown> {
    if (!clean(taskId)) {
      return {
        ok: this.ready && !this.closed,
        status: this.ready && !this.closed ? 'ready' : 'stopped',
        protocol: 'mock',
      }
    }
    const rec = this.active.get(taskId!)
    if (!rec || (context.ownerId && clean(context.ownerId) !== rec.ownerId)) {
      return { taskId, state: 'not_found', activity: [] }
    }
    return { taskId, state: 'working', activity: [] }
  }

  async submit(work: BackendTask): Promise<unknown> {
    const id = clean(work?.id)
    const ownerId = clean(work?.ownerId)
    const instruction = clean(work?.instruction || work?.objective || work?.message)
    if (!id || !ownerId || !instruction) {
      throw new Error('requires task id, owner and input')
    }
    if (this.active.has(id)) {
      throw new Error(`Task ${id} already active`)
    }
    this.publish(backendEvent(BackendEventType.ACTIVITY, {
      taskId: id,
      ownerId,
      activity: { id: `act-${id}`, kind: 'status', status: 'running' },
    }))

    if (this.hold) {
      return new Promise((resolve, reject) => {
        this.active.set(id, { ownerId, resolve, reject })
        for (const r of this._startedResolvers.splice(0)) r()
      })
    }
    return { content: `MockBackend(${this.id}) completed`, artifacts: [] }
  }

  async cancel(taskId: string, context: { ownerId?: string } = {}): Promise<unknown> {
    const rec = this.active.get(taskId)
    if (!rec) return { taskId, state: 'not_found' }
    if (context.ownerId && clean(context.ownerId) !== rec.ownerId) {
      throw new Error('Cannot cancel task owned by another user')
    }
    this.active.delete(taskId)
    rec.reject(new Error(`Task ${taskId} was cancelled`))
    return { taskId, state: 'cancelled' }
  }

  async respondAuthorization(): Promise<never> {
    throw new Error('MockBackend does not support authorization')
  }

  async respondInput(): Promise<never> {
    throw new Error('MockBackend does not support input')
  }

  subscribe(listener: (event: BackendEvent) => void): () => void {
    if (typeof listener !== 'function') {
      throw new TypeError('Backend event listener must be a function')
    }
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.active.clear()
    this.listeners.clear()
    this.ready = false
  }

  publish(event: BackendEvent): void {
    for (const l of this.listeners) {
      try {
        l(event)
      } catch {
        // observer failure 不中断
      }
    }
  }

  waitStarted(): Promise<void> {
    return new Promise(resolve => this._startedResolvers.push(resolve))
  }
}

// TaskWorld 的本地内存实现（world-local）。
// 对齐 durable-harness 的 world-local：内存交付，进程死 → 下次 start 时靠 listActiveRuns + re-send 恢复。
// 文件持久化（真正跨进程）在切片 5 的 world-postgres / 持久化后端实现。
import type { ActiveRun, TaskEvent, TaskWorld } from './world'

/** 创建本地内存 TaskWorld。单测与开发用。 */
export function createLocalWorld(): TaskWorld {
  const logs = new Map<string, TaskEvent[]>()
  const statuses = new Map<string, ActiveRun['status']>()
  const queueHandlers = new Set<(runId: string, payload?: unknown) => Promise<void>>()
  const streams = new Map<string, Set<(event: unknown) => void>>()

  const world: TaskWorld = {
    async append(runId, event) {
      const list = logs.get(runId) ?? []
      list.push(event)
      logs.set(runId, list)
    },

    async read(runId, after = 0) {
      const list = logs.get(runId) ?? []
      const events = list.slice(after)
      return { events, offset: list.length }
    },

    async listActiveRuns() {
      const runs: ActiveRun[] = []
      for (const [runId, status] of statuses) {
        if (status === 'pending' || status === 'running') {
          runs.push({ runId, status })
        }
      }
      return runs
    },

    async setRunStatus(runId, status) {
      statuses.set(runId, status)
      // 同时写状态事件到日志，让 fold 和 index 一致
      const eventType = {
        pending: 'run_created', running: 'run_started', completed: 'run_completed',
        failed: 'run_failed', cancelled: 'run_cancelled',
      }[status]
      if (eventType) {
        const list = logs.get(runId) ?? []
        list.push({ type: eventType, at: Date.now() })
        logs.set(runId, list)
      }
    },

    async send(runId, payload) {
      // 本地队列：异步投递给所有 handler（模拟队列重投递）。
      // 进程死后 handler 消失，run 留在 statuses 里，由 listActiveRuns + re-send 恢复。
      for (const handler of [...queueHandlers]) {
        await Promise.resolve().then(() => handler(runId, payload))
      }
    },

    onMessage(handler) {
      queueHandlers.add(handler)
      return () => queueHandlers.delete(handler)
    },

    publish(runId, event) {
      for (const listener of [...(streams.get(runId) ?? [])]) {
        listener(event)
      }
    },

    subscribe(runId, listener) {
      const set = streams.get(runId) ?? new Set()
      set.add(listener)
      streams.set(runId, set)
      return () => set.delete(listener)
    },
  }

  return world
}

// TaskWorld 的本地文件实现（world-file）：个人助手的真实持久化形态。
// 对齐 durable-harness 的 world-local：本地 JSONL 文件 + 进程内队列 + 重启扫描恢复。
// 每 run 一个 `<dir>/<runId>.jsonl`，`<dir>/index.json` 存 run 状态索引。
// 跨进程可恢复：进程崩溃后，新进程读同一目录从文件恢复。
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ActiveRun, TaskEvent, TaskWorld } from './world'

function loadIndex(dir: string): Map<string, ActiveRun['status']> {
  const file = join(dir, 'index.json')
  if (!existsSync(file)) return new Map()
  try {
    const data = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, ActiveRun['status']>
    return new Map(Object.entries(data))
  } catch {
    return new Map()
  }
}

function saveIndex(dir: string, index: Map<string, ActiveRun['status']>): void {
  writeFileSync(join(dir, 'index.json'), JSON.stringify(Object.fromEntries(index), null, 2))
}

/** 创建本地文件 TaskWorld。跨进程：多个进程指向同一 dir 即可共享持久化日志。 */
export function createFileWorld(dir: string): TaskWorld {
  mkdirSync(dir, { recursive: true })

  const index = loadIndex(dir)
  const queueHandlers = new Set<(runId: string, payload?: unknown) => Promise<void>>()
  const streams = new Map<string, Set<(event: unknown) => void>>()

  const fileOf = (runId: string): string => join(dir, `${runId}.jsonl`)

  const world: TaskWorld = {
    async append(runId, event) {
      appendFileSync(fileOf(runId), `${JSON.stringify(event)}\n`, { encoding: 'utf8' })
    },

    async read(runId, after = 0) {
      const file = fileOf(runId)
      if (!existsSync(file)) return { events: [], offset: 0 }
      const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean)
      const events: TaskEvent[] = lines.slice(after).map(line => JSON.parse(line) as TaskEvent)
      return { events, offset: lines.length }
    },

    async listActiveRuns() {
      const runs: ActiveRun[] = []
      for (const [runId, status] of index) {
        if (status === 'pending' || status === 'running') {
          runs.push({ runId, status })
        }
      }
      return runs
    },

    async setRunStatus(runId, status) {
      index.set(runId, status)
      saveIndex(dir, index)
    },

    async send(runId, payload) {
      // 本地队列：异步投递给 handler（进程内）。
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

/** 列出一个目录下所有的 run 文件（调试/恢复用）。 */
export function listRunFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => f.replace(/\.jsonl$/, ''))
}

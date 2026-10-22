// TaskIndex：taskId → backendId 的 durable 索引（taskMap 的 durable 化）。
// 内存缓存 + 日志兜底重建：进程崩溃后从日志 fold 恢复 task 归属。
// 对应 durable-design.md §3、切片 4。

import type { TaskWorld } from './world'
import { loadState } from './effect'

/** 从日志 fold 找 task 的 submit effect，提取 backendId。 */
async function backendIdFromLog(world: TaskWorld, taskId: string): Promise<string | undefined> {
  const state = await loadState(world, taskId)
  for (const rec of state.effectOrder) {
    if (rec.name === 'submit') {
      const input = rec.input as { backendId?: string }
      if (input.backendId) return input.backendId
    }
  }
  return undefined
}

/** taskId → backendId 索引：内存缓存，崩溃后从日志重建。 */
export class TaskIndex {
  private cache = new Map<string, string>()

  constructor(readonly world: TaskWorld) {}

  /** 记录 task 归属（submit 时调用）。 */
  set(taskId: string, backendId: string): void {
    this.cache.set(taskId, backendId)
  }

  /** 清理终态 task。 */
  delete(taskId: string): void {
    this.cache.delete(taskId)
  }

  /** 查询 task 归属：先查缓存，未命中读日志兜底。 */
  async get(taskId: string): Promise<string | undefined> {
    const hit = this.cache.get(taskId)
    if (hit) return hit
    const fromLog = await backendIdFromLog(this.world, taskId)
    if (fromLog) this.cache.set(taskId, fromLog)
    return fromLog
  }

  /** 进程重启后重建所有 active 任务的索引。 */
  async rebuild(): Promise<void> {
    const runs = await this.world.listActiveRuns()
    for (const run of runs) {
      const backendId = await backendIdFromLog(this.world, run.runId)
      if (backendId) this.cache.set(run.runId, backendId)
    }
  }

  /** 当前缓存中的进行中任务数（调试用）。 */
  get size(): number {
    return this.cache.size
  }
}

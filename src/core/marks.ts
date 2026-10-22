// Timing marks：关键时序点写到 TaskWorld 的 live 流，用于 benchmark + UI + debug。
// 对齐 durable-harness 的 marks.ts：t 是墙钟毫秒，pid 标识写入进程（跨进程时钟不比）。
// 对应 durable-design.md §11.2。

import type { TaskWorld } from '../durable/world'

export type MarkName =
  | 'submit' // 委派任务提交
  | 'route' // 路由决策
  | 'intent' // intent 落盘
  | 'ack' // 写日志 ack（含写延迟）
  | 'forward' // 转发给后台 harness
  | 'complete' // 任务完成
  | 'recover.start' // 崩溃恢复开始
  | 'recover.done' // 崩溃恢复结束
  | 'idle' // 任务空闲
  | 'model.first_token' // 模型首 token（TTFT）
  | 'tool.start' // 工具开始
  | 'tool.end' // 工具结束

export interface Mark {
  type: 'mark'
  name: MarkName
  /** 写入进程的墙钟毫秒（跨进程不比时钟，靠 pid 区分） */
  t: number
  /** 写入进程标识（每个 JS realm 一个） */
  pid: string
  runId: string
  /** 委派任务 id（traceId） */
  taskId?: string
  /** 写 mark 时的日志位置（durable slot） */
  durableSlot?: number
  /** ack mark：事件类型与写延迟 */
  eventType?: string
  writeMs?: number
  /** effect 的 memo key / step name */
  key?: string
  effect?: string
}

const PROCESS_ID = `pid_${process.pid}_${Math.random().toString(36).slice(2, 8)}`

/** 写一个 timing mark 到 run 的 live 流（实时订阅者）+ 落盘（日志，供 inspect 事后查看）。fire-and-forget，绝不抛出。 */
export function mark(
  world: TaskWorld,
  runId: string,
  name: MarkName,
  fields: Partial<Omit<Mark, 'type' | 'name' | 't' | 'pid' | 'runId'>> = {},
): void {
  const m = {
    type: 'mark',
    name,
    t: Date.now(),
    pid: PROCESS_ID,
    runId,
    ...fields,
  } satisfies Mark
  try {
    // append 即发布（world 的 append 会同步通知实时订阅者），无需单独 publish
    void world.append(runId, { type: 'mark', data: m, at: m.t }).catch(() => {})
  } catch {
    // marks 失败绝不破坏被记录的操作
  }
}

export { PROCESS_ID }

// effect sandwich：exactly-once 的核心原语。
// 对齐 durable-harness 的 driver.ts effect()：
//   completed → 回放 output（不重跑、不重复计费）
//   failed    → 抛 EffectFailure（不重跑）
//   running   → anchor 判定：gone+safe 重跑 / gone+never 抛中断 / 否则让位
// 对应 durable-design.md §3、切片 3。

import type { TaskWorld, TaskEvent } from './world'
import { emptyTaskState, fold, type EffectRecord, type ReplayPolicy, type TaskState } from './fold'
import { judgeAnchor, processIdentity } from './anchor'
import { mark } from '../core/marks'

export interface EffectOptions {
  name: string
  replay: ReplayPolicy
  input: unknown
}

export interface EffectContext {
  world: TaskWorld
  runId: string
  signal?: AbortSignal
}

/** 一个 committed failure 被抛出（fold 里 status=failed）。 */
export class EffectFailure extends Error {
  readonly error: { message: string; interrupted?: boolean }
  constructor(error: { message: string; interrupted?: boolean }) {
    super(error.message)
    this.name = 'EffectFailure'
    this.error = error
  }
}

/** 一个 replay=never 的 running effect 崩溃后被要求不重跑。 */
export class EffectInterrupted extends Error {
  constructor(message = 'interrupted: replay never') {
    super(message)
    this.name = 'EffectInterrupted'
  }
}

/** 另一个进程正在驱动这个 effect（anchor covered），本进程让位。 */
export class Contended extends Error {
  constructor() {
    super('another process drives this effect')
    this.name = 'Contended'
  }
}

function stepId(): string {
  return `step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** 读 run 的全部日志并 fold 到 TaskState。 */
export async function loadState(world: TaskWorld, runId: string): Promise<TaskState> {
  const { events } = await world.read(runId)
  return fold(emptyTaskState(runId), events)
}

/** 会话移交（多端 takeover）：写 handoff 事件递增 epoch，stale 写被 fence。 */
export async function handoff(world: TaskWorld, runId: string): Promise<void> {
  await world.append(runId, { type: 'run_handoff', at: Date.now() })
}

/**
 * exactly-once 原语：key 是 memo 键，同一逻辑调用的稳定标识。
 * fn 只在「无记录」或「gone+safe 重跑」时执行；其余情况回放或抛错。
 */
export async function effect<T>(
  ctx: EffectContext,
  key: string,
  opts: EffectOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const state = await loadState(ctx.world, ctx.runId)
  const record = state.effects.get(key)

  // memo：completed 回放，failed 抛错
  if (record?.status === 'completed') return record.output as T
  if (record?.status === 'failed') throw new EffectFailure(record.error!)

  // running：anchor 判定
  if (record?.status === 'running') {
    const verdict = judgeAnchor(record.anchor)
    if (verdict === 'gone') {
      if (opts.replay === 'safe') {
        return runEffect(ctx, key, opts, fn, record)
      }
      throw new EffectInterrupted()
    }
    // mine（自己还在跑）或 covered（别人还活着）：让位
    throw new Contended()
  }

  return runEffect(ctx, key, opts, fn)
}

/** 写 intent → 跑 fn → 写 outcome。 */
async function runEffect<T>(
  ctx: EffectContext,
  key: string,
  opts: EffectOptions,
  fn: () => Promise<T>,
  retryOf?: EffectRecord,
): Promise<T> {
  const id = stepId()
  const anchor = processIdentity()
  const epoch = (await loadState(ctx.world, ctx.runId)).epoch
  const intent: TaskEvent = {
    type: 'step_started',
    correlationId: id,
    data: {
      key,
      name: opts.name,
      replay: opts.replay,
      input: opts.input,
      anchor,
      epoch,
      ...(retryOf ? { retryOf: retryOf.stepId } : {}),
    },
    at: Date.now(),
  }
  await ctx.world.append(ctx.runId, intent)
  mark(ctx.world, ctx.runId, 'intent', { taskId: ctx.runId, key, effect: opts.name })

  try {
    const output = await fn()
    await ctx.world.append(ctx.runId, {
      type: 'step_completed',
      correlationId: id,
      data: { result: output },
      at: Date.now(),
    })
    mark(ctx.world, ctx.runId, 'complete', { taskId: ctx.runId, key, effect: opts.name })
    return output
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await ctx.world.append(ctx.runId, {
      type: 'step_failed',
      correlationId: id,
      data: { error: { message } },
      at: Date.now(),
    })
    throw new EffectFailure({ message })
  }
}

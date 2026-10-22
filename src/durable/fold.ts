// fold：任务事件日志的唯一语义读者（纯函数、增量式）。
// 对齐 durable-harness 的 fold.ts：折叠两半 = 一次折叠，harness 只看 fold 产物不看原始事件。
// 规则：first-writer-wins per key / outcome 只对 running 生效 / run 状态转换。
// 对应 durable-design.md §3、切片 2。

import type { TaskEvent } from './world'

export type ReplayPolicy = 'safe' | 'never'

/** 一个委派步骤（effect）的记录：intent/outcome 两段式折叠的产物。 */
export interface EffectRecord {
  /** memo key：同一逻辑调用的稳定标识（如 task:<id>:submit:<backendId>） */
  key: string
  /** step id（事件 correlationId） */
  stepId: string
  name: string
  replay: ReplayPolicy
  input: unknown
  status: 'pending' | 'running' | 'completed' | 'failed'
  output?: unknown
  error?: { message: string; interrupted?: boolean }
  attempt: number
}

/** 任务（run）状态：fold 的产物。 */
export interface TaskState {
  runId: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  /** memo key → 第一条 committed step */
  effects: Map<string, EffectRecord>
  /** 按 step 创建顺序 */
  effectOrder: EffectRecord[]
  /** 输了 first-writer-wins 竞争的 step id */
  superseded: Set<string>
  /** 已折叠的事件数（也是日志 offset） */
  eventCount: number
}

export function emptyTaskState(runId: string): TaskState {
  return {
    runId,
    status: 'pending',
    effects: new Map(),
    effectOrder: [],
    superseded: new Set(),
    eventCount: 0,
  }
}

/** step_started 的 data 形状（effect 的 intent envelope）。 */
interface StepEnvelope {
  key: string
  name: string
  replay: ReplayPolicy
  input: unknown
}

/**
 * Fold 事件到任务状态。纯函数，增量式。
 * 唯一读者：上层只通过 TaskState 看任务，从不看原始事件。
 */
export function fold(state: TaskState, events: TaskEvent[]): TaskState {
  for (const event of events) {
    state.eventCount++
    switch (event.type) {
      case 'run_started':
        state.status = 'running'
        break
      case 'run_completed':
        state.status = 'completed'
        break
      case 'run_failed':
        state.status = 'failed'
        break
      case 'run_cancelled':
        state.status = 'cancelled'
        break

      case 'step_started': {
        const stepId = event.correlationId ?? ''
        const env = event.data as StepEnvelope | undefined
        if (!stepId || !env?.key) break
        // first-writer-wins：同 key 已有记录，后一个被 superseded
        if (state.effects.has(env.key)) {
          state.superseded.add(stepId)
          break
        }
        const record: EffectRecord = {
          key: env.key,
          stepId,
          name: env.name,
          replay: env.replay,
          input: env.input,
          status: 'running',
          attempt: 1,
        }
        state.effects.set(env.key, record)
        state.effectOrder.push(record)
        break
      }

      case 'step_completed': {
        const stepId = event.correlationId ?? ''
        const record = findRunning(state, stepId)
        if (!record) break // 只对 running 生效，迟到/重复 outcome 是 inert
        record.status = 'completed'
        record.output = (event.data as { result?: unknown } | undefined)?.result
        break
      }

      case 'step_failed': {
        const stepId = event.correlationId ?? ''
        const record = findRunning(state, stepId)
        if (!record) break
        record.status = 'failed'
        record.error = (event.data as { error?: EffectRecord['error'] } | undefined)?.error
        break
      }

      default:
        break
    }
  }
  return state
}

/** 按 stepId 找 running 的 record（outcome 只对 running 生效）。 */
function findRunning(state: TaskState, stepId: string): EffectRecord | undefined {
  const record = state.effectOrder.find(r => r.stepId === stepId)
  return record && record.status === 'running' && !state.superseded.has(stepId)
    ? record
    : undefined
}

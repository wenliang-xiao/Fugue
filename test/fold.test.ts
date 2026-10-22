// 切片 2：fold 纯函数折叠契约测试。
// 追溯：durable-design.md §3、ADR-0009、切片 2。
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { emptyTaskState, fold } from '../src/durable/fold'
import type { TaskEvent } from '../src/durable/world'

function evt(type: string, correlationId: string, data?: unknown, at = 0): TaskEvent {
  return { type, correlationId, data, at }
}

function intent(key: string, stepId: string, name = 'submit', replay: 'safe' | 'never' = 'safe') {
  return evt('step_started', stepId, { key, name, replay, input: { id: key } })
}

function outcome(stepId: string, result: unknown) {
  return evt('step_completed', stepId, { result })
}

test('step_started 创建 running 记录，step_completed 置 completed + output', () => {
  const state = fold(emptyTaskState('run-1'), [
    intent('task:1:submit', 'step-1'),
    outcome('step-1', { content: 'done' }),
  ])
  assert.equal(state.effects.size, 1)
  const rec = state.effects.get('task:1:submit')!
  assert.equal(rec.status, 'completed')
  assert.deepEqual(rec.output, { content: 'done' })
  assert.equal(rec.attempt, 1)
})

test('step_failed 置 failed + error', () => {
  const state = fold(emptyTaskState('run-1'), [
    intent('task:1:submit', 'step-1'),
    evt('step_failed', 'step-1', { error: { message: 'boom' } }),
  ])
  assert.equal(state.effects.get('task:1:submit')!.status, 'failed')
  assert.deepEqual(state.effects.get('task:1:submit')!.error, { message: 'boom' })
})

test('first-writer-wins：同 key 第二个 step_started 被 superseded', () => {
  const state = fold(emptyTaskState('run-1'), [
    intent('task:1:submit', 'step-1'),
    intent('task:1:submit', 'step-2'), // 竞争失败
  ])
  assert.equal(state.effects.size, 1)
  assert.equal(state.effects.get('task:1:submit')!.stepId, 'step-1')
  assert.ok(state.superseded.has('step-2'))
})

test('outcome 只对 running 生效：重复 completed 是 inert', () => {
  const state = fold(emptyTaskState('run-1'), [
    intent('task:1:submit', 'step-1'),
    outcome('step-1', { content: 'first' }),
    outcome('step-1', { content: 'second' }), // inert，不覆盖
  ])
  assert.deepEqual(state.effects.get('task:1:submit')!.output, { content: 'first' })
})

test('增量折叠：分两次 fold = 一次 fold', () => {
  const events = [
    intent('task:1:submit', 'step-1'),
    outcome('step-1', { content: 'x' }),
    intent('task:1:forward', 'step-2'),
  ]
  const one = fold(emptyTaskState('run-1'), events)
  const two = fold(fold(emptyTaskState('run-1'), events.slice(0, 2)), events.slice(2))
  assert.deepEqual([...one.effectOrder].map(r => r.stepId), [...two.effectOrder].map(r => r.stepId))
  assert.deepEqual(one.effects.get('task:1:submit'), two.effects.get('task:1:submit'))
  assert.equal(one.eventCount, two.eventCount)
})

test('run 状态转换：pending → running → completed', () => {
  const state = fold(emptyTaskState('run-1'), [
    evt('run_started', ''),
    evt('run_completed', ''),
  ])
  assert.equal(state.status, 'completed')
})

test('completed 的 record 可回放（memo 命中）', () => {
  const state = fold(emptyTaskState('run-1'), [
    intent('task:1:submit', 'step-1', 'submit', 'never'),
    outcome('step-1', { ok: true }),
  ])
  const rec = state.effects.get('task:1:submit')!
  // 崩溃后新进程 fold 日志，看到 completed → 回放 output，不重跑
  assert.equal(rec.status, 'completed')
  assert.equal(rec.replay, 'never')
  assert.deepEqual(rec.output, { ok: true })
})

test('superseded 的 step 的 outcome 被忽略', () => {
  const state = fold(emptyTaskState('run-1'), [
    intent('task:1:submit', 'step-1'),
    intent('task:1:submit', 'step-2'), // superseded
    outcome('step-2', { content: 'lost' }), // 被忽略
  ])
  assert.equal(state.effects.get('task:1:submit')!.stepId, 'step-1')
  assert.equal(state.effects.get('task:1:submit')!.status, 'running') // step-1 仍未完成
})

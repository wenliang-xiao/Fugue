// 切片 5：epoch fencing（多端分时共享的写冲突防护）契约测试。
// 追溯：durable-design.md §3、ADR-0009、切片 5。
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createLocalWorld } from '../src/durable/world-local'
import { emptyTaskState, fold } from '../src/durable/fold'
import { effect, handoff, loadState } from '../src/durable/effect'
import { processIdentity } from '../src/durable/anchor'

function evt(type: string, correlationId: string, data?: unknown, at = 0) {
  return { type, correlationId, data, at }
}

test('fold：run_handoff 递增 epoch', () => {
  const state = fold(emptyTaskState('run-1'), [evt('run_handoff', '')])
  assert.equal(state.epoch, 1)
  fold(state, [evt('run_handoff', '')])
  assert.equal(state.epoch, 2)
})

test('fold：stale epoch 的 step 被 fence（忽略）', () => {
  const state = fold(emptyTaskState('run-1'), [
    evt('run_handoff', ''), // epoch → 1
    // 这个 intent 写于 epoch 0（未看到 handoff），被 fence
    evt('step_started', 'step-1', {
      key: 'task:1:submit', name: 'submit', replay: 'never', input: {}, epoch: 0,
    }),
  ])
  assert.equal(state.effects.size, 0) // 被 fence，未进入 effects
  assert.ok(state.fenced.has('step-1'))
})

test('fold：当前 epoch 的 step 正常进入 effects', () => {
  const state = fold(emptyTaskState('run-1'), [
    evt('run_handoff', ''), // epoch → 1
    evt('step_started', 'step-1', {
      key: 'task:1:submit', name: 'submit', replay: 'never', input: {}, epoch: 1,
    }),
  ])
  assert.equal(state.effects.size, 1)
})

test('effect：handoff 后旧进程的 intent 被 fence', async () => {
  const world = createLocalWorld()
  const runId = 'run-1'
  // 进程 B 接管：handoff 递增 epoch
  await handoff(world, runId) // epoch → 1
  // 旧进程（未看到 handoff，仍用 epoch 0）写 intent → 被 fence
  await world.append(runId, {
    type: 'step_started', correlationId: 'step-a',
    data: { key: 'task:1:submit', name: 'submit', replay: 'never', input: {}, anchor: processIdentity(), epoch: 0 },
    at: Date.now(),
  })

  const state = await loadState(world, runId)
  assert.equal(state.epoch, 1)
  assert.ok(state.fenced.has('step-a')) // 旧 intent 被 fence
  assert.equal(state.effects.size, 0) // 未进入 effects
})

test('fenced 的 step 的 outcome 被忽略', () => {
  const state = fold(emptyTaskState('run-1'), [
    evt('run_handoff', ''), // epoch 1
    evt('step_started', 'step-1', { key: 'k', name: 'x', replay: 'safe', input: {}, epoch: 0 }), // fenced
    evt('step_completed', 'step-1', { result: 'x' }), // inert
  ])
  assert.equal(state.effects.size, 0)
  assert.ok(state.fenced.has('step-1'))
})

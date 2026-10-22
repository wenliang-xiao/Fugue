// 切片 3：effect sandwich + anchor 契约测试。
// 追溯：durable-design.md §3、ADR-0009、切片 3。
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { hostname } from 'node:os'
import { createLocalWorld } from '../src/durable/world-local'
import { effect, EffectFailure, EffectInterrupted, Contended } from '../src/durable/effect'
import { judgeAnchor, processIdentity } from '../src/durable/anchor'
import type { ProcessIdentity } from '../src/durable/anchor'

function ctx() {
  return { world: createLocalWorld(), runId: 'run-1' }
}

// 一个"已死进程"的 anchor（pid 大概率不存在）
const deadAnchor: ProcessIdentity = { pid: 999999, boot: 'boot_dead', host: hostname() }
// 一个"活进程但不同 boot"的 anchor（covered）
const liveAnchor: ProcessIdentity = { pid: process.pid, boot: 'boot_other', host: hostname() }

test('首次执行：写 intent → 跑 fn → 写 outcome', async () => {
  const c = ctx()
  let calls = 0
  const output = await effect(c, 'task:1:submit', { name: 'submit', replay: 'never', input: {} }, async () => {
    calls++
    return 'done'
  })
  assert.equal(output, 'done')
  assert.equal(calls, 1)
  // 日志有 intent + outcome
  const { events } = await c.world.read('run-1')
  assert.deepEqual(events.map(e => e.type), ['step_started', 'step_completed'])
})

test('completed 回放：不重跑 fn，返回缓存 output', async () => {
  const c = ctx()
  await effect(c, 'task:1:submit', { name: 'submit', replay: 'never', input: {} }, async () => 'first')
  let calls = 0
  const output = await effect(c, 'task:1:submit', { name: 'submit', replay: 'never', input: {} }, async () => {
    calls++
    return 'second'
  })
  assert.equal(output, 'first') // 回放第一次的结果
  assert.equal(calls, 0) // 不重跑
})

test('failed 抛 EffectFailure：不重跑 fn', async () => {
  const c = ctx()
  await effect(c, 'task:1:submit', { name: 'submit', replay: 'never', input: {} }, async () => {
    throw new Error('boom')
  }).catch(() => {})

  let calls = 0
  await assert.rejects(
    effect(c, 'task:1:submit', { name: 'submit', replay: 'never', input: {} }, async () => {
      calls++
      return 'x'
    }),
    EffectFailure,
  )
  assert.equal(calls, 0)
})

test('running + gone + safe → 重跑', async () => {
  const c = ctx()
  // 预写一个 running intent（死进程 anchor），模拟崩溃
  await c.world.append('run-1', {
    type: 'step_started', correlationId: 'step-old',
    data: { key: 'task:1:lookup', name: 'lookup', replay: 'safe', input: {}, anchor: deadAnchor },
    at: Date.now(),
  })
  let calls = 0
  const output = await effect(c, 'task:1:lookup', { name: 'lookup', replay: 'safe', input: {} }, async () => {
    calls++
    return 'retried'
  })
  assert.equal(output, 'retried')
  assert.equal(calls, 1) // 重跑了一次
})

test('running + gone + never → 抛 EffectInterrupted（不重跑）', async () => {
  const c = ctx()
  await c.world.append('run-1', {
    type: 'step_started', correlationId: 'step-old',
    data: { key: 'task:1:refund', name: 'refund', replay: 'never', input: {}, anchor: deadAnchor },
    at: Date.now(),
  })
  let calls = 0
  await assert.rejects(
    effect(c, 'task:1:refund', { name: 'refund', replay: 'never', input: {} }, async () => {
      calls++
      return 'x'
    }),
    EffectInterrupted,
  )
  assert.equal(calls, 0) // never 绝不重跑
})

test('running + covered → 抛 Contended（让位）', async () => {
  const c = ctx()
  await c.world.append('run-1', {
    type: 'step_started', correlationId: 'step-old',
    data: { key: 'task:1:submit', name: 'submit', replay: 'safe', input: {}, anchor: liveAnchor },
    at: Date.now(),
  })
  await assert.rejects(
    effect(c, 'task:1:submit', { name: 'submit', replay: 'safe', input: {} }, async () => 'x'),
    Contended,
  )
})

test('anchor：mine / gone / covered 判定', () => {
  const self = processIdentity()
  assert.equal(judgeAnchor({ ...self }, self), 'mine')
  assert.equal(judgeAnchor(undefined, self), 'gone')
  assert.equal(judgeAnchor(deadAnchor, self), 'gone')
  assert.equal(judgeAnchor(liveAnchor, self), 'covered')
})

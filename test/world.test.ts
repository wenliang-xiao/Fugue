// 切片 1：TaskWorld 接口 + world-local 实现契约测试。
// 追溯：ADR-0009、docs/02-tech/durable-design.md §3、切片 1。
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createLocalWorld } from '../src/durable/world-local'
import type { TaskWorld } from '../src/durable/world'

function makeWorld(): TaskWorld {
  return createLocalWorld()
}

function evt(type: string, correlationId?: string): { type: string; correlationId?: string; data?: unknown; at: number } {
  return { type, correlationId, at: Date.now() }
}

test('Storage：append 后 read 能读到，增量 read 正确', async () => {
  const world = makeWorld()
  await world.append('run-1', evt('task_submitted', 'step-1'))
  await world.append('run-1', evt('task_accepted', 'step-1'))

  const first = await world.read('run-1')
  assert.equal(first.events.length, 2)
  assert.equal(first.events[0].type, 'task_submitted')
  assert.equal(first.offset, 2)

  await world.append('run-1', evt('task_completed', 'step-1'))
  const second = await world.read('run-1', first.offset)
  assert.equal(second.events.length, 1)
  assert.equal(second.events[0].type, 'task_completed')
})

test('Storage：读不存在的 run 返回空', async () => {
  const world = makeWorld()
  const result = await world.read('nope')
  assert.deepEqual(result, { events: [], offset: 0 })
})

test('Storage：listActiveRuns 只列 pending/running，setRunStatus 生效', async () => {
  const world = makeWorld()
  await world.setRunStatus('run-1', 'running')
  await world.setRunStatus('run-2', 'pending')
  await world.setRunStatus('run-3', 'completed')

  const active = await world.listActiveRuns()
  const ids = active.map(r => r.runId).sort()
  assert.deepEqual(ids, ['run-1', 'run-2'])
})

test('Queue：send 后 handler 被异步调用，unsubscribe 后不再调用', async () => {
  const world = makeWorld()
  const calls: Array<{ runId: string; payload?: unknown }> = []
  const unsub = world.onMessage(async (runId, payload) => {
    calls.push({ runId, payload })
  })

  await world.send('run-1', { kind: 'backstop' })
  // 本地队列异步投递，等一个微任务
  await Promise.resolve()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].runId, 'run-1')

  unsub()
  await world.send('run-2')
  await Promise.resolve()
  assert.equal(calls.length, 1) // 不再增长
})

test('Streamer：publish 后订阅者收到，unsubscribe 后收不到', () => {
  const world = makeWorld()
  const received: unknown[] = []
  const unsub = world.subscribe('run-1', e => received.push(e))

  world.publish('run-1', { type: 'progress', value: 1 })
  assert.equal(received.length, 1)

  unsub()
  world.publish('run-1', { type: 'progress', value: 2 })
  assert.equal(received.length, 1) // 不再增长
})

test('Streamer：不同 run 的订阅隔离', () => {
  const world = makeWorld()
  const a: unknown[] = []
  const b: unknown[] = []
  world.subscribe('run-a', e => a.push(e))
  world.subscribe('run-b', e => b.push(e))

  world.publish('run-a', { x: 1 })
  assert.equal(a.length, 1)
  assert.equal(b.length, 0)
})

test('综合：任务生命周期（submitted → accepted → completed）', async () => {
  const world = makeWorld()
  await world.setRunStatus('run-1', 'pending')
  await world.append('run-1', evt('task_submitted', 'step-1'))
  await world.setRunStatus('run-1', 'running')
  await world.append('run-1', evt('task_accepted', 'step-1'))
  await world.append('run-1', evt('task_completed', 'step-1'))
  await world.setRunStatus('run-1', 'completed')

  const { events } = await world.read('run-1')
  assert.equal(events.length, 3)
  assert.deepEqual(events.map(e => e.type), ['task_submitted', 'task_accepted', 'task_completed'])
  // completed 后不在 active 列表
  const active = await world.listActiveRuns()
  assert.equal(active.length, 0)
})

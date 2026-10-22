// 切片 4：MultiBackendAdapter durable 化契约测试。
// 追溯：durable-design.md §3、ADR-0009、切片 4。
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createLocalWorld } from '../src/durable/world-local'
import { MultiBackendAdapter } from '../src/backend/multi-backend-adapter'
import { MockBackend } from './helpers/mock-backend'

function makeDurable() {
  const world = createLocalWorld()
  const a = new MockBackend({ id: 'a' })
  const b = new MockBackend({ id: 'b' })
  const mba = new MultiBackendAdapter({ a, b }, { defaultBackend: 'a', world })
  return { world, mba, a, b }
}

test('durable submit：走 effect，日志记录 intent + outcome', async () => {
  const { world, mba } = makeDurable()
  await mba.start()
  const outcome = await mba.submit({ id: 't1', ownerId: 'o1', instruction: 'x' })
  assert.match((outcome as { content: string }).content, /MockBackend\(a\)/)

  const { events } = await world.read('t1')
  assert.deepEqual(events.map(e => e.type), ['step_started', 'step_completed'])
  assert.equal((events[0].data as { replay: string }).replay, 'never') // submit 防重复
  await mba.close()
})

test('durable submit 防重复：同 task 重复 submit 不重跑 backend', async () => {
  const { mba, a } = makeDurable()
  await mba.start()
  let calls = 0
  const original = a.submit.bind(a)
  a.submit = async (work) => {
    calls++
    return original(work)
  }
  await mba.submit({ id: 't1', ownerId: 'o1', instruction: 'x' })
  // 第二次 submit：effect 回放 completed，不重跑 backend
  const outcome2 = await mba.submit({ id: 't1', ownerId: 'o1', instruction: 'x' })
  assert.match((outcome2 as { content: string }).content, /MockBackend\(a\)/)
  assert.equal(calls, 1) // backend.submit 只调了一次
  await mba.close()
})

test('rebuildTaskMap：崩溃后从日志重建 taskMap', async () => {
  const { world } = makeDurable()
  // 模拟崩溃前：写 submit intent（无 outcome）+ run 状态 running
  await world.setRunStatus('t9', 'running')
  await world.append('t9', {
    type: 'step_started',
    correlationId: 'step-1',
    data: { key: 'task:t9:submit:b', name: 'submit', replay: 'never', input: { backendId: 'b' } },
    at: Date.now(),
  })

  // 新进程：同 world 创建新 adapter，rebuild 恢复 taskMap
  const a2 = new MockBackend({ id: 'a' })
  const b2 = new MockBackend({ id: 'b' })
  const mba2 = new MultiBackendAdapter({ a: a2, b: b2 }, { defaultBackend: 'a', world })
  await mba2.rebuildTaskMap()

  assert.equal(mba2.taskMap.get('t9'), 'b') // 从日志恢复了 backendId
  // taskMap 命中后路由到 b 的 status（MockBackend 无 active 记录，返回 not_found 属预期）
  const status = mba2.status('t9') as { state: string }
  assert.ok(status.state === 'working' || status.state === 'not_found')
  await mba2.close()
})

test('无 world 时保持现有非 durable 行为（向后兼容）', async () => {
  const a = new MockBackend({ id: 'a' })
  const mba = new MultiBackendAdapter({ a }, { defaultBackend: 'a' })
  await mba.start()
  const outcome = await mba.submit({ id: 't1', ownerId: 'o1', instruction: 'x' })
  assert.match((outcome as { content: string }).content, /MockBackend\(a\)/)
  await mba.close()
})

test('durable submit 完成后台 taskMap 清理，run 状态 completed', async () => {
  const { world, mba } = makeDurable()
  await mba.start()
  await mba.submit({ id: 't2', ownerId: 'o1', instruction: 'x' })
  assert.equal(mba.taskMap.size, 0) // 终态清理
  const active = await world.listActiveRuns()
  assert.equal(active.length, 0) // run 已 completed，不在 active
  await mba.close()
})

// REQ-005 多 harness 委派：MultiBackendAdapter 单元测试 + 上游一致性套件
// 追溯：ADR-0002、docs/04-test/cases/multi-backend-001.md
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { verifyBackendAdapterConformance } from 'qwen-audio-agent/backend-adapter-sdk'
import { MultiBackendAdapter } from '../src/backend/multi-backend-adapter'
import { MockBackend } from './helpers/mock-backend'

function makeFixture({ hold }: { hold: boolean }) {
  const a = new MockBackend({ id: 'a', hold })
  const b = new MockBackend({ id: 'b', hold })
  const mba = new MultiBackendAdapter({ a, b }, { defaultBackend: 'a' })
  return {
    backend: mba,
    work: { id: 'task-1', ownerId: 'owner-1', instruction: 'do work A' },
    nextWork: { id: 'task-2', ownerId: 'owner-1', instruction: 'do work B' },
    started: hold ? a.waitStarted() : undefined,
    internals: { a, b },
  }
}

test('通过上游 BackendPort 一致性套件', async () => {
  await verifyBackendAdapterConformance({ createFixture: makeFixture })
})

test('默认路由到 defaultBackend', async () => {
  const { backend } = makeFixture({ hold: false })
  await backend.start()
  const outcome = await backend.submit({
    id: 't1', ownerId: 'o1', instruction: 'x',
  })
  assert.match((outcome as { content: string }).content, /MockBackend\(a\)/)
  await backend.close()
})

test('显式 routing.backendId 路由到指定 backend', async () => {
  const { backend } = makeFixture({ hold: false })
  await backend.start()
  const outcome = await backend.submit({
    id: 't2', ownerId: 'o1', instruction: 'y',
    routing: { backendId: 'b' },
  })
  assert.match((outcome as { content: string }).content, /MockBackend\(b\)/)
  await backend.close()
})

test('未知 backend 报错', async () => {
  const { backend } = makeFixture({ hold: false })
  await backend.start()
  await assert.rejects(
    backend.submit({
      id: 't3', ownerId: 'o1', instruction: 'z',
      routing: { backendId: 'nope' },
    }),
    /Unknown backend: nope/,
  )
  await backend.close()
})

test('同步完成后 taskMap 清理，status 返回 not_found', async () => {
  const { backend } = makeFixture({ hold: false })
  await backend.start()
  await backend.submit({ id: 't4', ownerId: 'o1', instruction: 'x' })
  assert.equal(backend.taskMap.size, 0)
  assert.equal(backend.status('t4').state, 'not_found')
  await backend.close()
})

test('事件聚合：子 backend 事件透传到上层，taskId 为 gateway taskId', async () => {
  const { backend } = makeFixture({ hold: false })
  const events: Array<Record<string, unknown>> = []
  backend.subscribe(e => events.push(e))
  await backend.start()
  await backend.submit({ id: 't5', ownerId: 'o1', instruction: 'x' })
  assert.ok(events.length > 0)
  assert.ok(events.every(e => e.taskId === 't5'))
  assert.ok(events.every(e => e.ownerId === 'o1'))
  await backend.close()
})

test('health 懒启动：不显式 start 也能就绪（回归修复：backend_unavailable）', async () => {
  const { backend } = makeFixture({ hold: false })
  // 不调 backend.start()，直接 health()——qwen-audio-agent 的真实路径
  const health = await backend.health()
  assert.equal(health.ok, true)
  assert.equal(backend.ready, true)
  await backend.close()
})

test('submit 懒启动：不显式 start 也能委派', async () => {
  const { backend } = makeFixture({ hold: false })
  // 不调 backend.start()，直接 submit()
  const outcome = await backend.submit({ id: 't6', ownerId: 'o1', instruction: 'x' })
  assert.match((outcome as { content: string }).content, /MockBackend\(a\)/)
  assert.equal(backend.ready, true)
  await backend.close()
})

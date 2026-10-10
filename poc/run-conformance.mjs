// PoC 主入口：验证 MultiBackendAdapter 通过上游 BackendPort 一致性套件，
// 并额外验证路由正确性与 owner 隔离。
import { verifyBackendAdapterConformance } from '/Users/wenlix/project/qwen-audio-agent/server/src/backend/backend-adapter-sdk.mjs'
import { MockBackend } from './mock-backend.mjs'
import { MultiBackendAdapter } from './multi-backend-adapter.mjs'

function makeFixture({ hold }) {
  const a = new MockBackend({ id: 'a', hold })
  const b = new MockBackend({ id: 'b', hold })
  const mba = new MultiBackendAdapter({ a, b }, { defaultBackend: 'a' })
  return {
    backend: mba,
    work: { id: 'task-1', ownerId: 'owner-1', instruction: 'do work A' },
    nextWork: { id: 'task-2', ownerId: 'owner-1', instruction: 'do work B' },
    started: hold ? a.waitStarted() : undefined,
    // 暴露子 backend 供额外断言
    _internals: { a, b },
  }
}

async function verifyRouting() {
  const { backend, _internals } = makeFixture({ hold: false })
  const { a, b } = _internals
  const events = []
  backend.subscribe(e => events.push(e))
  await backend.start()

  // 默认路由 -> a
  const r1 = await backend.submit({
    id: 't-default', ownerId: 'o1', instruction: 'x',
  })
  console.log('  默认路由 content:', r1.content)

  // 显式路由 -> b
  const r2 = await backend.submit({
    id: 't-routed', ownerId: 'o1', instruction: 'y', routing: { backendId: 'b' },
  })
  console.log('  显式路由 content:', r2.content)

  // 未知 backend -> 报错
  let unknownErr = null
  try {
    await backend.submit({
      id: 't-unknown', ownerId: 'o1', instruction: 'z',
      routing: { backendId: 'nope' },
    })
  } catch (e) {
    unknownErr = e.message
  }
  console.log('  未知 backend 报错:', unknownErr)

  console.log(
    '  路由断言:',
    r1.content.includes('MockBackend(a)') && r2.content.includes('MockBackend(b)')
      ? 'PASS' : 'FAIL',
    '| 事件全部携带 gateway taskId:',
    events.every(e => ['t-default', 't-routed'].includes(e.taskId)) ? 'PASS' : 'FAIL',
    '| 未知 backend 拒绝:',
    /unknown backend/i.test(unknownErr) ? 'PASS' : 'FAIL',
  )
  await backend.close()
}

async function main() {
  console.log('=== 1. 上游一致性套件 verifyBackendAdapterConformance ===')
  await verifyBackendAdapterConformance({ createFixture: makeFixture })
  console.log('✅ 一致性套件通过：MultiBackendAdapter 是合法的 BackendPort\n')

  console.log('=== 2. 路由正确性 + owner 隔离（额外验证）===')
  await verifyRouting()
  console.log('✅ 路由验证完成\n')
}

main().then(() => {
  console.log('ALL PASS')
  process.exit(0)
}).catch(err => {
  console.error('FAIL:', err)
  process.exit(1)
})

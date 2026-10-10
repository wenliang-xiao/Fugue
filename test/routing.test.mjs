// REQ-005 多 harness 委派：路由规则单元测试
// 验证：显式指定 > 规则匹配 > 默认 backend 的优先级
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRouter } from '../src/backend/routing.mjs'

test('显式指定 routing.backendId 优先级最高', () => {
  const route = createRouter({
    defaultBackend: 'opencode',
    rules: [{ backendId: 'hermes', match: { instruction: /迁移/ } }],
  })
  assert.equal(
    route({ routing: { backendId: 'pi' }, instruction: '迁移数据库' }),
    'pi',
  )
})

test('规则匹配：instruction 正则命中', () => {
  const route = createRouter({
    defaultBackend: 'opencode',
    rules: [{ backendId: 'hermes', match: { instruction: /迁移|重构/ } }],
  })
  assert.equal(route({ instruction: '帮我重构这个模块' }), 'hermes')
})

test('规则匹配：instruction 字符串包含', () => {
  const route = createRouter({
    defaultBackend: 'opencode',
    rules: [{ backendId: 'pi', match: { instruction: '写周报' } }],
  })
  assert.equal(route({ objective: '帮我写周报' }), 'pi')
})

test('规则匹配：taskType 精确匹配', () => {
  const route = createRouter({
    defaultBackend: 'opencode',
    rules: [{ backendId: 'hermes', match: { taskType: 'long' } }],
  })
  assert.equal(route({ taskType: 'long', instruction: 'x' }), 'hermes')
})

test('多条规则按顺序命中第一条', () => {
  const route = createRouter({
    defaultBackend: 'opencode',
    rules: [
      { backendId: 'pi', match: { instruction: /写/ } },
      { backendId: 'hermes', match: { instruction: /周报/ } },
    ],
  })
  assert.equal(route({ instruction: '写周报' }), 'pi')
})

test('无匹配走默认 backend', () => {
  const route = createRouter({ defaultBackend: 'opencode', rules: [] })
  assert.equal(route({ instruction: '随便聊聊' }), 'opencode')
})

test('未配置默认 backend 时返回空串', () => {
  const route = createRouter({})
  assert.equal(route({ instruction: 'x' }), '')
})

test('显式指定不存在的 backend 原样返回（由 adapter 层报错）', () => {
  const route = createRouter({ defaultBackend: 'opencode' })
  assert.equal(route({ routing: { backendId: 'nope' }, instruction: 'x' }), 'nope')
})

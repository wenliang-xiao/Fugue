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

test('领域专家路由：财经→hermes，调研→dsh，其余→默认 pi', () => {
  const route = createRouter({
    defaultBackend: 'pi',
    rules: [
      { backendId: 'hermes', match: { instruction: ['财经', '投资', '股票', 'ETF', '行情', '量化', '大盘'] } },
      { backendId: 'dsh', match: { instruction: ['深度调研', 'research', '长程', '综述', '行业研究'] } },
    ],
  })
  assert.equal(route({ instruction: '帮我分析今天的大盘行情' }), 'hermes')
  assert.equal(route({ instruction: '做个行业深度调研' }), 'dsh')
  assert.equal(route({ instruction: '帮我写个周报' }), 'pi')
})

test('objective 里“交给 pi”显式路由到 pi（前台指定）', () => {
  const route = createRouter({
    defaultBackend: 'opencode',
    experts: { pi: { label: 'Pi' }, dsh: { label: 'DeepSeek' } },
  })
  assert.equal(route({ instruction: '交给 pi：帮我写周报' }), 'pi')
})

test('objective 里“让 DeepSeek 调研”路由到 dsh（按 label）', () => {
  const route = createRouter({
    defaultBackend: 'opencode',
    experts: { pi: { label: 'Pi' }, dsh: { label: 'DeepSeek' } },
  })
  assert.equal(route({ instruction: '让 DeepSeek 深度调研一下行业' }), 'dsh')
})

test('显式 routing.backendId 优先于“交给 XX”', () => {
  const route = createRouter({
    defaultBackend: 'opencode',
    experts: { pi: { label: 'Pi' } },
  })
  assert.equal(route({ routing: { backendId: 'dsh' }, instruction: '交给 pi' }), 'dsh')
})

test('没有“交给 XX”时走关键词规则（fallback）', () => {
  const route = createRouter({
    defaultBackend: 'opencode',
    experts: { pi: { label: 'Pi' } },
    rules: [{ backendId: 'pi', match: { instruction: ['周报'] } }],
  })
  assert.equal(route({ instruction: '帮我写周报' }), 'pi')
})

test('“交给 未知专家”不命中，回退到默认', () => {
  const route = createRouter({
    defaultBackend: 'opencode',
    experts: { pi: { label: 'Pi' } },
  })
  assert.equal(route({ instruction: '交给 未知专家：随便干点啥' }), 'opencode')
})

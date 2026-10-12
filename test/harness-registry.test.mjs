// harness 注册表测试：配置驱动的通用接入 + 领域路由自动生成
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHarnessConfig, buildSpawnThinkingDescription } from '../src/config.mjs'

const sample = {
  harnesses: [
    {
      id: 'pi',
      label: 'Pi · 工作主力',
      protocol: 'pi',
      domains: ['工作', '周报', '文档'],
      default: true,
    },
    {
      id: 'opencode',
      label: 'OpenCode · 代码',
      protocol: 'opencode',
      domains: ['写代码', '修bug', '重构'],
    },
    {
      id: 'my-agent',
      label: '我的自定义 ACP',
      command: 'my-agent',
      args: ['--acp'],
      domains: ['调研'],
    },
  ],
}

test('内置 protocol → backend 配置', () => {
  const cfg = buildHarnessConfig(sample)
  assert.deepEqual(cfg.backends.pi, { protocol: 'pi', label: 'Pi · 工作主力' })
  assert.deepEqual(cfg.backends.opencode, { protocol: 'opencode', label: 'OpenCode · 代码' })
})

test('任意 ACP command+args → backend 配置', () => {
  const cfg = buildHarnessConfig(sample)
  assert.deepEqual(cfg.backends['my-agent'], {
    command: 'my-agent',
    args: ['--acp'],
    label: '我的自定义 ACP',
  })
})

test('default 标记 → defaultBackend', () => {
  const cfg = buildHarnessConfig(sample)
  assert.equal(cfg.defaultBackend, 'pi')
})

test('domains → 路由规则自动生成', () => {
  const cfg = buildHarnessConfig(sample)
  assert.equal(cfg.rules.length, 3)
  assert.deepEqual(cfg.rules[0], { backendId: 'pi', match: { instruction: ['工作', '周报', '文档'] } })
  assert.deepEqual(cfg.rules[2], { backendId: 'my-agent', match: { instruction: ['调研'] } })
})

test('无 domains 的 harness 不生成规则', () => {
  const cfg = buildHarnessConfig({
    harnesses: [{ id: 'x', protocol: 'x' }],
  })
  assert.equal(cfg.rules.length, 0)
  assert.equal(cfg.defaultBackend, '')
})

test('空输入安全', () => {
  const cfg = buildHarnessConfig({})
  assert.deepEqual(cfg.backends, {})
  assert.deepEqual(cfg.rules, [])
})

test('MCP 工具集（P1）跳过 backend，但保留 domains 规则', () => {
  const cfg = buildHarnessConfig({
    harnesses: [
      { id: 'finance', label: '财经', mcp: { command: 'python', args: ['mcp.py'] }, domains: ['财经'] },
    ],
  })
  assert.deepEqual(cfg.backends, {})
  assert.equal(cfg.rules[0].backendId, 'finance')
})

test('总指挥提示词：从 harnesses 生成专家列表 + 自动协调语义', () => {
  const cfg = {
    backends: {
      pi: { label: 'Pi · 工作主力' },
      opencode: { label: 'OpenCode · 代码' },
    },
    routing: {
      rules: [
        { backendId: 'pi', match: { instruction: ['工作', '周报'] } },
        { backendId: 'opencode', match: { instruction: ['写代码'] } },
      ],
    },
  }
  const desc = buildSpawnThinkingDescription(cfg)
  assert.match(desc, /总指挥/)
  assert.match(desc, /Pi · 工作主力/)
  assert.match(desc, /擅长：工作、周报/)
  assert.match(desc, /OpenCode · 代码/)
  assert.match(desc, /自动判断/)
  assert.match(desc, /权限确认/)
})

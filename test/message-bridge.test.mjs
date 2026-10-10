// REQ-002 飞书 client：消息桥接层测试（纯逻辑，不依赖飞书 SDK）
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  feishuTextToGatewayInput,
  gatewayEventToFeishu,
} from '../src/clients/feishu/message-bridge.mjs'

test('文本消息转 Gateway 输入（text_only）', () => {
  assert.deepEqual(feishuTextToGatewayInput('帮我查个东西'), {
    type: 'input.message',
    text: '帮我查个东西',
    textOnly: true,
  })
})

test('空文本返回 null', () => {
  assert.equal(feishuTextToGatewayInput('   '), null)
  assert.equal(feishuTextToGatewayInput(''), null)
})

test('assistant transcript.final 转文本', () => {
  const out = gatewayEventToFeishu({
    type: 'transcript.final',
    role: 'assistant',
    content: '好的，我来处理',
  })
  assert.deepEqual(out, { text: '好的，我来处理' })
})

test('transcript.delta 不单独发（等 final）', () => {
  assert.equal(gatewayEventToFeishu({ type: 'transcript.delta', role: 'assistant', content: '好' }), null)
})

test('task.completed 转完成通知', () => {
  const out = gatewayEventToFeishu({
    type: 'task.completed',
    task: { id: 't1', objective: '删除 console.log', result: '删了 23 处' },
  })
  assert.match(out.text, /✅/)
  assert.match(out.text, /删除 console\.log/)
  assert.match(out.text, /删了 23 处/)
})

test('task.failed 转失败通知（含 error）', () => {
  const out = gatewayEventToFeishu({
    type: 'task.failed',
    task: { id: 't1', objective: '重构', error: '编译失败' },
  })
  assert.match(out.text, /❌/)
  assert.match(out.text, /编译失败/)
})

test('task.cancelled 转取消通知', () => {
  const out = gatewayEventToFeishu({
    type: 'task.cancelled',
    task: { id: 't1', objective: '重构' },
  })
  assert.match(out.text, /已取消/)
})

test('task.permission.requested 转授权请求', () => {
  const out = gatewayEventToFeishu({
    type: 'task.permission.requested',
    task: {
      id: 't1',
      objective: '删文件',
      authorization: { id: 'a1', summary: '删除 3 个文件', operation: { title: '删除' } },
    },
  })
  assert.match(out.text, /授权/)
  assert.match(out.text, /删除 3 个文件/)
})

test('task.input.requested 转补充信息请求', () => {
  const out = gatewayEventToFeishu({
    type: 'task.input.requested',
    task: {
      id: 't1',
      objective: '发布',
      inputRequest: { id: 'i1', prompt: '请确认版本号', mode: 'text' },
    },
  })
  assert.match(out.text, /补充/)
  assert.match(out.text, /请确认版本号/)
})

test('error 转错误提示', () => {
  const out = gatewayEventToFeishu({ type: 'error', message: '连接超时' })
  assert.match(out.text, /连接超时/)
})

test('无关事件返回 null', () => {
  assert.equal(gatewayEventToFeishu({ type: 'audio.delta' }), null)
  assert.equal(gatewayEventToFeishu({ type: 'gateway.connected' }), null)
})

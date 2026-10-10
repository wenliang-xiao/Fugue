// REQ-002 / REQ-003：飞书 client 核心桥接逻辑测试（mock connection + mock gateway）
import test from 'node:test'
import assert from 'node:assert/strict'
import { FeishuClient, gatewayWebSocketUrl } from '../src/clients/feishu/client.mjs'
import { GatewayClientProtocolEvent } from 'qwen-audio-agent/gateway-client-protocol'

function makeHarness() {
  const gatewayCalls = { sent: [], requests: [], started: false }
  const gateway = {
    ready: true,
    start() { gatewayCalls.started = true },
    send(event) { gatewayCalls.sent.push(event) },
    async request(type, payload) { gatewayCalls.requests.push({ type, payload }) },
    stop() {},
  }
  const feishu = { sent: [], handlers: {} }
  const connection = {
    connect: async () => {},
    onMessage: h => { feishu.handlers.message = h },
    onError: h => { feishu.handlers.error = h },
    sendText: async (to, text) => { feishu.sent.push({ to, text }) },
    sendMarkdown: async () => {},
  }
  const client = new FeishuClient({
    gatewayUrl: 'http://127.0.0.1:3101',
    connection,
    gatewayFactory: () => gateway,
  })
  return { client, gateway, gatewayCalls, connection, feishu }
}

test('websocket url 构造（http→ws，带 sessionId）', () => {
  const url = gatewayWebSocketUrl('http://127.0.0.1:3101', 'feishu')
  assert.equal(url, 'ws://127.0.0.1:3101/api/realtime?sessionId=feishu')
})

test('start 启动 gateway 并注册飞书消息处理', async () => {
  const { client, gatewayCalls, feishu } = makeHarness()
  await client.start()
  assert.equal(gatewayCalls.started, true)
  assert.equal(typeof feishu.handlers.message, 'function')
})

test('文本消息转发到 gateway（input.message）', async () => {
  const { client, gatewayCalls } = makeHarness()
  await client.start()
  await client.handleFeishuMessage({
    rawContentType: 'text', chatId: 'chat-1', content: '帮我查个东西',
  })
  assert.equal(client.chatId, 'chat-1')
  assert.ok(gatewayCalls.sent.some(e => e.type === 'input.message' && e.text === '帮我查个东西'))
})

test('非文本消息忽略', async () => {
  const { client, gatewayCalls } = makeHarness()
  await client.start()
  await client.handleFeishuMessage({ rawContentType: 'image', chatId: 'chat-1', content: '' })
  assert.equal(gatewayCalls.sent.length, 0)
})

test('权限请求后回复「同意」→ permission.respond decision=task', async () => {
  const { client, gatewayCalls } = makeHarness()
  await client.start()
  await client.handleGatewayEvent({
    type: 'task.permission.requested',
    task: { id: 't1', objective: '删文件', authorization: { id: 'auth-1', summary: '删除 3 个文件' } },
  })
  await client.handleFeishuMessage({ rawContentType: 'text', chatId: 'chat-1', content: '同意' })
  const req = gatewayCalls.requests.find(r => r.type === GatewayClientProtocolEvent.PERMISSION_RESPOND)
  assert.deepEqual(req.payload, { permission_id: 'auth-1', decision: 'task' })
})

test('权限请求后回复「拒绝」→ decision=reject', async () => {
  const { client, gatewayCalls } = makeHarness()
  await client.start()
  await client.handleGatewayEvent({
    type: 'task.permission.requested',
    task: { id: 't1', objective: '删文件', authorization: { id: 'auth-1', summary: 'x' } },
  })
  await client.handleFeishuMessage({ rawContentType: 'text', chatId: 'chat-1', content: '拒绝' })
  const req = gatewayCalls.requests.find(r => r.type === GatewayClientProtocolEvent.PERMISSION_RESPOND)
  assert.deepEqual(req.payload, { permission_id: 'auth-1', decision: 'reject' })
})

test('gateway 回复转发到飞书（有 chatId 时）', async () => {
  const { client, feishu } = makeHarness()
  await client.start()
  await client.handleFeishuMessage({ rawContentType: 'text', chatId: 'chat-1', content: 'hi' })
  await client.handleGatewayEvent({ type: 'transcript.final', role: 'assistant', content: '你好' })
  assert.ok(feishu.sent.some(s => s.to === 'chat-1' && s.text === '你好'))
})

test('无 chatId 时不发飞书消息', async () => {
  const { client, feishu } = makeHarness()
  await client.start()
  await client.handleGatewayEvent({ type: 'transcript.final', role: 'assistant', content: '你好' })
  assert.equal(feishu.sent.length, 0)
})

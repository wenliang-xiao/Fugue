# 测试用例 feishu-client-001：飞书消息桥接

- 验证 REQ：REQ-002（多端对话入口）、REQ-003（多端状态共享）
- 对应模块：`feishu-client`
- 追溯：[ADR-0003](../../02-tech/adr/0003-multi-endpoint-sharing.md) · 模块设计 [feishu-client](../../02-tech/modules/feishu-client.md)

## 前置条件

- mock connection（`connect/onMessage/onError/sendText` 记录调用）
- mock gatewayFactory（`ready/send/request/start/stop` 记录调用）

## 用例（已实现于 `test/feishu-client.test.mjs`）

### TC-001 websocket url 构造
- 步骤：`gatewayWebSocketUrl('http://127.0.0.1:3101', 'feishu')`
- 期望：`ws://127.0.0.1:3101/api/realtime?sessionId=feishu`

### TC-002 start 启动并注册
- 步骤：`client.start()`
- 期望：gateway `start` 被调；飞书 `message` handler 已注册

### TC-003 文本转发
- 步骤：`handleFeishuMessage({rawContentType:'text', chatId, content})`
- 期望：记录 chatId；gateway `send` 收到 `input.message`

### TC-004 非文本忽略
- 步骤：`handleFeishuMessage({rawContentType:'image'})`
- 期望：gateway 无 `send`

### TC-005/006 权限确认
- 步骤：先 `handleGatewayEvent(task.permission.requested)`，再 `handleFeishuMessage('同意'/'拒绝')`
- 期望：gateway `request(PERMISSION_RESPOND)`，decision 为 `task`/`reject`

### TC-007/008 回复转发与 chatId 门控
- 步骤：`handleGatewayEvent(transcript.final)`；有 chatId 发飞书，无 chatId 不发
- 期望：`connection.sendText(chatId, content)`；无 chatId 时不发

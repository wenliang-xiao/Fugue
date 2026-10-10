# 模块设计 — feishu-client

> 对应 REQ-002 / REQ-003 · ADR-0003 · 架构 §2.2

## 职责

飞书机器人作为 Gateway 的一个 `text_only` client，把飞书消息桥接到 Gateway，把 Gateway 回复/任务通知发回飞书。与语音 App 分时共享同一 Gateway（takeover + replay）。

## 组成

| 文件 | 职责 |
|------|------|
| `src/clients/feishu/client.mjs` | FeishuClient：桥接核心 + 权限确认 |
| `src/clients/feishu/lark-connection.mjs` | 飞书长连接薄封装（createLarkChannel） |
| `src/clients/feishu/message-bridge.mjs` | 消息转换纯逻辑（可单测） |

## 关键接口

```js
const client = new FeishuClient({
  gatewayUrl, connection,          // connection 依赖注入，便于单测
  accessToken, sessionId, takeover, gatewayFactory,
})
await client.start()               // 连 Gateway（text_only）+ 飞书长连接
await client.handleFeishuMessage(msg)   // 飞书消息 → gateway input.message
await client.handleGatewayEvent(event)  // gateway 事件 → 飞书文本
```

## 数据流

```
飞书消息(text) → handleFeishuMessage → input.message → Gateway
Gateway 事件(transcript.final / task.*) → handleGatewayEvent → 飞书文本
```

## 关键设计

- **text_only 协商**：`configure` 返回 `{voiceEnabled:true, textOnly:true}`——启用输出通道接收任务播报转写，但不采音。
- **权限确认**：收到 `task.permission.requested` 记录 `pendingPermission`；用户回复「同意/拒绝」→ `permission.respond`（decision `task`/`reject`）。
- **chatId 记忆**：记录最近会话 chatId，Gateway 回复据此定向发送。
- **消息转换**：集中在 message-bridge（纯函数），Gateway 事件字段已对照 `gateway-events.mjs` 的 schema 确认。

## 约束

- 飞书开放平台不开放第三方 RTC，真全双工语音只能走独立语音 App（ADR-0003）。
- 依赖注入（connection / gatewayFactory）保证核心逻辑可脱离真实飞书/Gateway 单测。

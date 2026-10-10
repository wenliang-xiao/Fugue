# Glossary — Fugue 术语表

> 本文是 Fugue 术语的**唯一注册表**。写文档、代码、讨论前先查本文；新术语先注册再用，改词义走 ADR。
> 关联：[宪法](../CONSTITUTION.md) · [PRD](./01-prd/PRD.md)

## 产品与核心概念

| 术语 | 统一含义 | 不要混用 |
|------|---------|---------|
| **Fugue** | 产品 / 仓库的单一名称（"指挥家"） | 不写成多个产品名或旧代号 |
| **harness** | 智能体运行框架：承载模型、工具、记忆、权限、渲染的系统外壳 | 不等同于单个模型或聊天 UI |
| **编排（orchestration）** | 前台对话与后台干活分离、任务并行、主动播报的**异步对话**模式 | 不等同于"桥接"（见下） |
| **桥接（bridge）** | 把某个 harness 的 stdin/stdout 转发到 IM 的**同步 console**模式 | 是编排的降级形态，不是本产品定位 |
| **委派（delegation）** | 前台 Agent 把任务交给后台 harness 执行 | 不等同于普通 tool call |

## 对话与"全双工"

| 术语 | 统一含义 | 不要混用 |
|------|---------|---------|
| **通信层全双工** | 像打电话：同时说和听、随时打断（barge-in） | 只在实时语音流里存在 |
| **任务层全双工** | 派活不阻塞对话、后台并行、干完主动播报 | 文本和语音都能提供 |
| **实时语音流** | wss 流式语音（豆包 Seeduplex / Qwen Audio Realtime） | 飞书机器人无此通道 |
| **语音消息** | 按住说话发录音、听语音回复的**异步半双工** | 不等同于实时语音流 |
| **双通道** | 语音 App + 飞书文本两个入口，共享同一编排层 | 是"分时互补"，不是"同时并发" |
| **分时互补（takeover）** | 两个 client 轮流连同一 Gateway，状态在 Gateway 层共享 | 不等同于多 client 并发 |

## 架构分层（复用 qwen-audio-agent）

| 术语 | 统一含义 | 不要混用 |
|------|---------|---------|
| **Gateway** | 编排中枢：前台 Agent + 任务编排 + 权限 + 播报 + Client 协议 | 不是简单的消息转发器 |
| **前台 Agent** | 实时语音/文本模型，负责对话、打断、简单自答、判断是否委派 | 不等于后台 harness |
| **后台 Agent** | 被委派干活的 harness（OpenCode / Pi / Hermes） | 不等于前台 Agent |
| **Client** | I/O 层：语音 App / 飞书机器人，走 Gateway Client Protocol | 不是业务逻辑所在 |
| **BackendPort** | 编排运行时与 backend 之间的协议无关边界 | 不是 client 协议 |
| **MultiBackendAdapter** | 聚合多个 harness、实现 BackendPort、内部路由的适配器 | 不是新的 harness |

## 协议

| 术语 | 统一含义 | 不要混用 |
|------|---------|---------|
| **ACP** | Agent Client Protocol，agent 与宿主间的 stdio JSON-RPC | 不等同于 MCP |
| **A2A** | Agent-to-Agent，远程 agent 互操作协议（HTTP/JSON-RPC） | 不等同于 ACP |
| **MCP** | Model Context Protocol，工具/资源接入协议 | 是工具接入方式，不是独立于 Tool 体系的能力类别 |
| **Gateway Client Protocol** | 本项目 client 与 Gateway 之间的 WebSocket 协议 | 不等同于 ACP/A2A/MCP |

## 使用原则

- 正式文档优先英文术语（`harness`、`delegation`、`full-duplex`），中文解释首次出现处给出。
- 新增术语前问三问：① 是否跨文档高频易混？② 是否有唯一推荐叫法 + "不要混用"边界？③ 能否自洽一句话解释？
- 本文与 Accepted ADR / architecture.md 冲突时，以 ADR / architecture 为准。

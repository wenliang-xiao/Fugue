# ADR-0005 harness backend 复用：文件路径复用上游 ACP factory

- 状态：已采纳
- 日期：2026-10-10

## 背景

MultiBackendAdapter 需要创建真实的 harness backend 实例（opencode / pi / hermes，均为 ACP stdio）。qwen-audio-agent 的完整 ACP 实现（进程启动、session 管理、权限、事件归一化）位于 `server/src/backend/adapters/acp/backend-factory.mjs`（`createAcpBackendAdapter`）。

## 决策

**通过文件路径复用上游 `createAcpBackendAdapter`，而不是重写 ACP 适配器，也不通过 npm 包的 exports 引用（因为 exports 未公开该入口）。** 路径由环境变量 `QWEN_AUDIO_AGENT_ROOT` 指定，默认指向本地 qwen-audio-agent 源码。

## 理由

- 上游 `createAcpBackendAdapter` 已完整实现 ACP：进程生命周期、`session/update` 事件归一化、`request_permission` 权限、session 复用——重写成本极高（ACP 协议 + 各 harness 差异 + 权限语义）。
- 实测（`describe()`）opencode / hermes / pi 三种 backend 均能正常创建，能力声明正确（opencode/hermes 支持 permissions，pi 不支持——与文档一致）。
- `generic-acp` driver 支持自定义 `command`/`args`，可承载 Hermes 的 SSH 隧道（ADR-0004）。

## 后果

- **收益**：零重写复用完整 ACP 实现，多 harness 委派立刻可用。
- **代价**：
  1. 依赖 qwen-audio-agent 源码存在且已 `npm install`（生产依赖）。
  2. 依赖未公开的内部 API，上游版本升级可能破坏（backend-factory 签名变化）。
  3. 硬编码默认路径（`QWEN_AUDIO_AGENT_ROOT`），开源前需文档化。
- **备选**：
  - 自研 ACP 适配器（用 `@agentclientprotocol/sdk` + `backend-adapter-sdk`）：工作量大，但无上游耦合。若上游 API 频繁变更或需完全独立，转此方案。
  - 等上游通过 exports 公开 `backend-factory`：届时改用 `qwen-audio-agent/backend-factory` 包名引用，去掉文件路径。

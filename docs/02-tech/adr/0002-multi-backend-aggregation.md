# ADR-0002 多 harness 委派：BackendPort 聚合，而非改上游 core

- 状态：已采纳（PoC 已验证 ✅）
- 日期：2026-10-10

## 背景

qwen-audio-agent 的 `AGENT_PROTOCOL` 是单值，一次只能接一个 backend。产品要求接入 opencode / pi / Hermes 多个 harness（REQ-005）。

## 决策

**实现一个协议无关的 `MultiBackendAdapter`，实现上游 `BackendPort` 接口，内部聚合多个 backend 并路由。通过 `createGatewayApplication({ agent: createBackendAgentHost(mba) })` 组装，不改上游 core。**

## 理由

- 上游 `BackendPort` 是编排运行时与 backend 之间的协议无关边界（`submit/status/cancel/respondAuthorization/respondInput/subscribe`），Gateway 只认这一个接口——**多 backend 完全可以封装在接口后面**，上游无感知。
- `MultiBackendAdapter` 维护 `taskMap`（gatewayTaskId → backendId + backendTaskId），`submit` 时路由，其余方法按映射转发，事件经 `subscribe` 归一化聚合。这是标准的"组合适配器"模式。
- 上游提供 `verifyBackendAdapterConformance` 一致性套件，可直接验证 MultiBackendAdapter 是否正确实现 BackendPort 契约。

## 后果

- **收益**：多 harness 委派完全在扩展点内实现，跟随上游更新、可独立开源、改动面收敛到单个模块。
- **代价**：需自行维护路由逻辑与 taskMap 生命周期；多 backend 的并发/取消/权限请求映射需逐一实现并测试。
- **PoC 验证结果（2026-10-10）**：`poc/run-conformance.mjs` 用 `MockBackend` 聚合两个 backend，通过上游 `verifyBackendAdapterConformance` 一致性套件（生命周期幂等、owner 隔离、hold/取消、订阅清理），并验证了显式/默认路由与未知 backend 拒绝。**结论：BackendPort 契约足以承载多 backend 聚合，ADR-0001 的关键验证点成立。**
- **遗留验证**：真实 ACP backend（opencode/pi/hermes）作为子 backend 的进程启动与断线恢复，仍需下一阶段 PoC（它们本身已是合法 BackendPort，契约层面等价）。
- **备选**：fork 上游改 core 支持多 `AGENT_PROTOCOL`（维护成本高、与上游分叉）。

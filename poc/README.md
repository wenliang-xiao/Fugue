# PoC — MultiBackendAdapter 一致性验证

> 验证目标：[ADR-0002](../docs/02-tech/adr/0002-multi-backend-aggregation.md)
> 结论：**通过** ✅（2026-10-10）

## 验证了什么

`MultiBackendAdapter` 是否能在 **不改 qwen-audio-agent core** 的前提下，聚合多个 harness backend，并通过上游 `verifyBackendAdapterConformance` 一致性套件。

## 运行

```bash
node poc/run-conformance.mjs
```

## 结果

```
=== 1. 上游一致性套件 verifyBackendAdapterConformance ===
✅ 一致性套件通过：MultiBackendAdapter 是合法的 BackendPort

=== 2. 路由正确性 + owner 隔离 ===
✅ 路由验证完成
```

一致性套件覆盖：生命周期幂等（start/close）、submit 输入校验、owner 隔离（status/cancel 跨 owner 拒绝）、hold/取消（pending 任务取消语义）、订阅清理（unsubscribe 后不再收事件）、事件归一化（type/taskId/ownerId 正确）。

## 文件

| 文件 | 作用 |
|------|------|
| `mock-backend.mjs` | Mock BackendPort：完整实现 10 方法，支持 hold + owner 隔离 |
| `multi-backend-adapter.mjs` | 核心：聚合多 backend，路由 + taskMap + 事件聚合 |
| `run-conformance.mjs` | 跑一致性套件 + 额外路由断言 |

## 下一步 PoC（遗留验证）

1. 用**真实 ACP backend**（opencode / pi / hermes）替换 Mock 作为子 backend，验证进程启动、事件透传、断线恢复。
2. 飞书 text_only client 最小冒烟（REQ-002）。
3. Hermes 远程 ACP 能力确认（ADR-0004）。

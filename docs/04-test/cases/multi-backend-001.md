# 测试用例 multi-backend-001：MultiBackendAdapter 路由与事件聚合

- 验证 REQ：REQ-005（多 harness 委派）
- 对应模块：`multi-backend-adapter`
- 追溯：[ADR-0002](../../02-tech/adr/0002-multi-backend-aggregation.md) · BackendPort 契约

## 前置条件

- 两个模拟 backend（`mockA`、`mockB`），各自实现 BackendPort，能产生带 `taskId` 的事件。
- 一个 router：`task.routing.backendId === 'mockB'` 时路由到 mockB，否则 mockA。

## 用例

### TC-001 显式指定路由

- 步骤：`submit(task)` 传入 `routing.backendId = 'mockB'`。
- 期望：`mockB.submit` 被调用一次，`mockA.submit` 不被调用；`taskMap` 记录 `task.id → {mockB, <mockB taskId>}`。

### TC-002 默认路由

- 步骤：`submit(task)` 不带 routing。
- 期望：路由到默认 backend（mockA）。

### TC-003 事件聚合与归一化

- 步骤：mockA 与 mockB 各 publish 一条 `backend.activity`（不同 taskId）。
- 期望：`subscribe` 回调收到两条归一化事件，`taskId` 为 gateway taskId（非 backend 内部 id），原始协议对象不出现。

### TC-004 status/cancel 按映射转发

- 步骤：对已提交的 task 调 `status(taskId)`、`cancel(taskId)`。
- 期望：转发到对应 backend 的 `status/cancel`，入参为 backend taskId。

### TC-005 权限请求映射回目标 backend

- 步骤：mockB 发出 `backend.permission.requested`；对 task 调 `respondAuthorization(taskId, ...)`。
- 期望：`mockB.respondAuthorization` 被调用，mockA 不被调用。

### TC-006 taskMap 清理

- 步骤：任务终态（completed/failed/cancelled）后，多次 `status`。
- 期望：终态后 `taskMap` 对应条目被清理或安全返回终态，无泄漏。

### TC-007 一致性套件

- 步骤：对 MultiBackendAdapter 运行上游 `verifyBackendAdapterConformance`。
- 期望：通过（生命周期幂等、结果边界、事件隔离、重复任务、取消、订阅清理）。

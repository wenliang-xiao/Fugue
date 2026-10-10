# 模块设计 — multi-backend-adapter

> 对应 REQ-005 · ADR-0002 · 测试用例 [multi-backend-001](../../04-test/cases/multi-backend-001.md)

## 职责

聚合多个 harness backend（各自实现 BackendPort），对外呈现为**一个** BackendPort。上游 Gateway 无感知，任务经内部路由分发。

## 组成

| 文件 | 职责 |
|------|------|
| `src/backend/multi-backend-adapter.mjs` | MultiBackendAdapter：路由 + taskMap + 事件聚合 |
| `src/backend/routing.mjs` | createRouter：显式指定 > 规则匹配 > 默认 |
| `src/backend/backends/harness-backend.mjs` | 创建真实 ACP backend（复用上游 factory） |

## 关键接口

```js
new MultiBackendAdapter(backends: Record<id, BackendPort>, {
  router?: (task) => id,          // 默认用 createRouter
  defaultBackend?: string,
  rules?: Array<{backendId, match}>,
})

// BackendPort 全部方法：describe/start/health/submit/status/cancel/
// respondAuthorization/respondInput/subscribe/close
```

## 关键设计

- **taskMap 生命周期**：仅登记"进行中"任务；`submit` resolve/reject、`cancel` 终态即清理。重复 submit 不覆盖登记（避免误删 hold 中任务）——此 bug 由一致性套件捕获并修复。
- **事件聚合**：子 backend 的 `taskId` 已是 gateway taskId，`subscribe` 直接透传归一化事件。
- **路由优先级**：`task.routing.backendId`（显式）> `rules`（按序命中）> `defaultBackend`。

## 约束（来自 BackendPort 契约）

- 原始协议对象（ACP session id、remote task id、token）不得跨边界进入模型可见文本。
- 每个子 backend 必须通过 `verifyBackendAdapterConformance`（本模块自身也通过）。

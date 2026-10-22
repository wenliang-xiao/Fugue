# 模块设计 — multi-backend-adapter

> 对应 REQ-005 · ADR-0002 · ADR-0009 · 测试用例 [multi-backend-001](../../04-test/cases/multi-backend-001.md)

## 职责

聚合多个 harness backend（各自实现 BackendPort），对外呈现为**一个** BackendPort。上游 Gateway 无感知，任务经内部路由分发。**可选接入 durable 内核（ADR-0009）**：任务状态持久化到 TaskWorld 日志，崩溃后从日志恢复。

## 组成

| 文件 | 职责 |
|------|------|
| `src/backend/multi-backend-adapter.ts` | MultiBackendAdapter：路由 + taskMap + 事件聚合 + durable（effect/rebuildTaskMap） |
| `src/backend/routing.ts` | createRouter：显式指定 > 规则匹配 > 默认 |
| `src/backend/backends/harness-backend.ts` | 创建真实 ACP backend（复用上游 factory） |
| `src/backend/backends/headless-backend.ts` | 一次性进程执行（如 dsh --profile headless） |
| `src/durable/world.ts` | TaskWorld 三合一接口（Storage + Queue + Streamer） |
| `src/durable/world-file.ts` | 本地 JSONL 持久化（个人助手形态） |
| `src/durable/fold.ts` | 纯函数折叠（first-writer-wins / fence / outcome-only-on-running） |
| `src/durable/effect.ts` | exactly-once 原语（回放/抛错/重跑/中断/让位） |
| `src/durable/anchor.ts` | 进程活性判定（mine/gone/covered） |
| `src/durable/task-index.ts` | taskId → backendId 的 durable 索引 |

## 关键接口

```ts
new MultiBackendAdapter(backends: Record<id, BackendPort>, {
  router?: (task) => id,          // 默认用 createRouter
  defaultBackend?: string,
  rules?: Array<{backendId, match}>,
  world?: TaskWorld,              // durable：任务事件日志（可选，个人助手用 world-file）
})

// BackendPort 全部方法：describe/start/health/submit/status/cancel/
// respondAuthorization/respondInput/subscribe/close
// durable 附加：rebuildTaskMap() —— 进程重启后从日志重建 taskMap
```

## 关键设计

- **taskMap 生命周期**：仅登记"进行中"任务；`submit` resolve/reject、`cancel` 终态即清理。重复 submit 不覆盖登记（避免误删 hold 中任务）——此 bug 由一致性套件捕获并修复。
- **事件聚合**：子 backend 的 `taskId` 已是 gateway taskId，`subscribe` 直接透传归一化事件。
- **路由优先级**：`task.routing.backendId`（显式）> `rules`（按序命中）> `defaultBackend`。

### durable 化（ADR-0009）

- **submit 走 effect(replay: never)**：写 intent（step_started）→ 跑 backend.submit → 写 outcome（step_completed）。崩溃后 `never` 不重跑，**防重复 submit 产生重复任务**；`safe` 的读/幂等步骤可重跑续跑。
- **taskMap 从日志 fold 重建**：`rebuildTaskMap()` 扫描 `listActiveRuns()` + fold 日志，恢复 taskId → backendId 索引。
- **个人助手本地真实跑**：launcher 用 `world-file`（`data/tasks/` JSONL），进程崩溃重启后从文件恢复；无 world 时向后兼容（纯内存，不持久化）。

## 约束（来自 BackendPort 契约）

- 原始协议对象（ACP session id、remote task id、token）不得跨边界进入模型可见文本。
- 每个子 backend 必须通过 `verifyBackendAdapterConformance`（本模块自身也通过）。
- durable 时 `submit` 的 `replay: never` 是硬约束：重复 submit 有副作用（重复任务），绝不由 effect 自动重跑。

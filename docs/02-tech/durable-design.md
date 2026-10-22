# 后台委派 durable 化设计 — Fugue

> 版本：v0.1（草案，待评审）
> 状态：待评审
> 关联：[ADR-0008](./adr/0008-typescript-adoption.md) · [ADR-0009](./adr/0009-durable-backend.md) · [durable-harness 深度分析](../00-research/durable-harness-analysis.md) · [架构](architecture.md)

---

## 1. 要解决的问题

Fugue 当前「前台委派 → 后台 harness 执行 → 播报」链路中，**任务状态是进程内存态**：

| 现状 | 崩溃后果 |
|------|---------|
| `taskMap: Map<gatewayTaskId, {backendId, backendTaskId}>` 在内存 | Gateway 崩溃/重启 → 全部进行中任务丢失 |
| 后台 harness（opencode/pi/hermes）是子进程 | harness 崩溃 → task 状态无从恢复，用户以为在跑其实死了 |
| 事件聚合（subscribe）是内存回调 | 重连后错过的事件无法回放 |
| 无幂等语义 | 重复 submit 产生重复任务；崩溃后已完成的工作重复执行 |

durable-harness 给出了成熟答案：**把「任务」建模为「workflow run」，事件日志 = 唯一真相源**。本设计把它系统性地移植到 Fugue 的编排层。

参考图（durable-harness 机制，已在调研中绘制）：
- [整体架构](../00-research/diagrams/durable-harness-architecture.html)
- [崩溃恢复时序](../00-research/diagrams/durable-harness-crash-recovery.html)
- [effect sandwich 状态机](../00-research/diagrams/durable-harness-effect-sandwich.html)

---

## 2. 核心抽象：TaskWorld 三合一

```typescript
import type { Queue, Storage, Streamer } from './world'

interface TaskWorld extends Storage, Queue, Streamer {}
```

一个 `TaskWorld` 同时提供 durable agent 的全部需求，换实现不改 adapter 代码：

| 能力 | 职责 | 本地（开发） | 生产 |
|------|------|-------------|------|
| **Storage** | 任务事件日志（唯一真相源） | 文件（world-local） | Postgres / Redis |
| **Queue** | 崩溃重投递（backstop） | 进程内重投递 | 真实队列 |
| **Streamer** | 事件流（进度/播报/UI） | 进程内 pub-sub | 持久流 |

---

## 3. 目标架构

```
┌─────────────────────────────────────────────────────────────┐
│ Gateway（编排中枢，复用 qwen-audio-agent）                    │
│  前台 Agent → 语义路由 → Agent Delivery                      │
└──────────────────────────┬──────────────────────────────────┘
                           │ BackendPort.submit
┌──────────────────────────▼──────────────────────────────────┐
│ MultiBackendAdapter（本项目核心，durable 化）                 │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ fold（纯函数）── 从 TaskWorld 日志重建 taskMap + 状态    │  │
│  │ effect sandwich ── submit/wait/forward 每步 memoize    │  │
│  │ anchor ── liveness 归队列，不写心跳                     │  │
│  │ epoch fencing ── 多端分时共享防僵尸写坏                  │  │
│  └───────────────────────────────────────────────────────┘  │
│        │ intent/outcome 事件日志                            │
│        ▼                                                     │
│  TaskWorld（Storage + Queue + Streamer）                    │
└──────────┬──────────────────────────────────┬───────────────┘
           │ 委派                               │ 崩溃重投递
     ┌─────▼─────┐  ┌─────┐  ┌────────┐         └──► 新进程读日志续跑
     │ opencode  │  │ pi  │  │ hermes │
     └───────────┘  └─────┘  └────────┘
     （子进程，不可靠资源：崩溃→重启→从日志恢复 task）
```

---

## 4. 任务事件日志（intent/outcome 两段式）

每个委派步骤先写意图、再写结果：

```
task_submitted    (intent)  ──►  task_accepted   (outcome)
   │
   ├─ task_progress  (intent) ──► task_progress   (outcome)
   │
   └─ task_completed / task_failed / task_cancelled  (outcome)
```

崩溃后日志精确回答三件事：
- **完成了什么** → outcome 在日志 → 回放结果（不重复 submit）；
- **正在跑什么** → 只有 intent → 按 replay 策略决定重跑与否；
- **没开始什么** → 什么都没有 → 从头跑。

---

## 5. effect sandwich + replay 策略

```typescript
await ctx.effect(key, opts, fn)
// key    : memo 键（如 `task:<id>:submit:<backendId>`）
// opts   : { name, replay, input }
// fn     : 真正执行的函数（调用 backend.submit 等）
```

| key 状态 | 行为 |
|---------|------|
| `completed` | 回放结果，不重复 submit |
| `failed` | 抛错，不重跑 |
| `running` | 按 replay：`safe` 重跑；`never` 告知「可能已发生」 |

`replay` 标注（映射到 Fugue 的委派步骤）：

| 步骤 | replay | 理由 |
|------|--------|------|
| 读任务状态 / 查进度 | `safe` | 幂等读，可重跑 |
| 转发事件给前台 | `safe` | 幂等，可重发 |
| `submit` 给后台 harness | `never` | 重复 submit 产生重复任务 |
| 取消任务 | `never` | 重复取消可能误伤 |

---

## 6. 分阶段实施（TDD 纵向切片）

### 切片 0 · TypeScript 全量迁移（ADR-0008）

- `src/**/*.mjs → .ts`、`test/**/*.test.mjs → .test.ts`
- 新增 `tsconfig.json`（strict + ES2023）、`vitest.config.ts`
- 手写 `src/types/qwen-audio-agent.d.ts` 冻结 BackendPort 契约
- 验收：全部现有 50+ 测试在 vitest 下全绿

### 切片 1 · TaskWorld 接口 + 本地实现

- `src/durable/world.ts`：`TaskWorld` 接口定义
- `src/durable/world-local.ts`：文件 + 进程内队列实现
- 验收：Storage 增删查、Queue 重投递、Streamer 订阅，纯单测

### 切片 2 · 任务事件日志 + fold

- `src/durable/task-log.ts`：事件写入（step_started/step_completed）
- `src/durable/fold.ts`：纯函数 fold，从日志重建 task 状态
- 验收：增量折叠、fencing、first-writer-wins，单测

### 切片 3 · effect sandwich + replay + anchor

- `src/durable/effect.ts`：`effect(key, opts, fn)` memoization
- `src/durable/anchor.ts`：anchor 判定（mine/gone/covered）
- 验收：completed 回放、failed 抛错、safe/never 重跑语义，单测 + 崩溃注入测试

### 切片 4 · MultiBackendAdapter durable 化

- taskMap 从 fold 重建；submit/status/cancel/事件转发走 effect sandwich
- harness 子进程崩溃 → 重启 → 从日志恢复
- 验收：一致性套件 + 崩溃恢复端到端（kill Gateway → 队列重投递 → 续跑）

### 切片 5 · 生产 TaskWorld（Postgres）+ epoch fencing 多端验证

- `src/durable/world-postgres.ts`
- 语音 + 飞书分时共享的 takeover fencing 验证
- 验收：多端并发写冲突测试

---

## 7. 风险与验证点

| 风险 | 验证方式 |
|------|---------|
| fold/effect/anchor 基础设施复杂度 | 对齐 durable-harness 裁剪实现，每层独立单测 |
| 「单 session 单 writer」vs Fugue 多端并发 | epoch fencing 专项测试（切片 5） |
| 本地开发队列降级 | world-local 进程内重投递，行为对齐生产 |
| 重复 submit 的历史 bug 重演 | replay: never + 一致性套件回归 |

---

## 8. 与 durable-harness 的边界

| 维度 | durable-harness | Fugue 借鉴后 |
|------|----------------|-------------|
| durable 对象 | harness 的 session（模型/工具调用） | **编排层的任务**（委派/进度/播报） |
| harness 角色 | 被 durable 化的对象 | **不可靠子进程**，崩溃即重启 |
| 复用关系 | 全套（World/fold/effect/anchor） | 借鉴设计、裁剪实现，不 fork |
| 底座 | Vercel/Workflow SDK | qwen-audio-agent + 本地优先 |

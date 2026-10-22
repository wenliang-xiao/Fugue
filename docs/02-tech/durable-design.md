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

---

## 9. agent 矩阵演进（愿景与差距）

> 本节回答「这套设计能否实现真正的 agent 矩阵」，明确**现在能覆盖什么 / 还缺什么 / 演进路线**。诚实原则：本文是 durable 化的「地基」，不是矩阵本身。

### 9.1 现状 vs 矩阵愿景

| 诉求 | 现状 | 本方案覆盖 | 结论 |
|------|------|-----------|------|
| agent 不会死 | ❌ 子进程死即丢状态 | ✅ durable 化核心 | ⚠️ 见 9.2 澄清 |
| 统一层编排 | ✅ MultiBackendAdapter + 总指挥 | ✅ 强化（taskMap 从日志 fold 重建） | ✅ 成立 |
| 语音全双工 | ✅ 豆包 Seeduplex | ⚠️ 正交，本方案不管这层 | ✅ 已有，与 durable 化是两层 |
| 长程任务派发 | ⚠️ 能跑但崩溃即断 | ✅ 核心价值所在 | ✅ 成立（见 9.3） |
| agent 矩阵 | ⚠️ 串行委派 + 总指挥居中 | ⚠️ 只打地基 | ❌ 还缺 5 块（见 9.4） |

### 9.2 「不会死」的正确语义

durable-harness 自身也不是「让进程不死」，而是「**进程死了无所谓，session 状态从日志复活，换个进程接着跑**」。落到 Fugue 各 agent：

| agent | 可行性 | 落地方式 |
|-------|--------|---------|
| pi | ✅ 最可行 | Pi 1.0 自带 `@earendil-works/pi-durable` durable storage，storage swap + resumeWith |
| opencode | ✅ 可行 | event store 镜像进日志 |
| hermes | ⚠️ 依赖远端 | 它是云端常驻进程，Fugue 只管连接 + 任务状态持久化 |
| dsh headless | ✅ 无所谓死 | 一次性任务，跑完即弃 |

### 9.3 「长程」分两种

- **任务跑几小时、跨崩溃**：✅ 本方案直接解决（queue backstop + 日志续跑）。
- **跨天定时派发 / cron 调度**：❌ 当前没有（Hermes 自带 cron，Fugue 未接），P2+ 缺口。

### 9.4 矩阵还缺的 5 块拼图

当前方案是「一个总指挥 → 逐个专家委派」的**星型拓扑**。真正的矩阵（横向协作、并行、共享记忆）还需要：

1. **横向协作**：专家间直接互相派活/传递产出。现在是总指挥居中（Pi 不支持 third-layer delegation，ADR-0009 约束）；矩阵若需 agent↔agent，要么等上游，要么做「黑板/共享状态」模式替代。
2. **并行 fan-out**：一个任务同时派多个 agent、交叉 review（ccteam 已有）。Fugue 现在串行。
3. **跨 agent 共享记忆**：durable-harness 的 documents 机制提供会话级共享状态，但「专家 A 产出 → 专家 B 输入」的共享语义未设计（当前仅 Gateway 层 taskMap）。
4. **任务调度器**：优先级、定时、任务队列持久化。
5. **成本账本 + 权限矩阵**：多 agent 并行时的成本控制、各自权限边界、不可逆操作审批。

### 9.5 演进路线

```
P0：durable 地基（本方案 6 切片）
  ↓
P1：pi/opencode 真正接 durable storage（「agent 不会死」落地）
  ↓
P2：documents 共享记忆 + 并行 fan-out（矩阵雏形）
  ↓
P3：专家横向协作 / 调度器 / 成本账本（真矩阵）
```

**判断**：当前设计能让「多 agent 编排」稳定、可恢复、可长跑——这是 80% 的工程难度，也是 ccteam/cc-connect 等竞品没做扎实的地方；剩下 20%（横向协作、并行、共享记忆）是「矩阵」区别于「多 agent 串行」的增量，在 durable 地基上继续演进。

---

## 10. 实现路径：qwen-audio-agent 底座 + durable-harness 设计内化

> 本节回答「怎么基于 durable-harness 和 qwen-audio-agent 实现目标」。核心结论：**复用 qwen-audio-agent 的前台编排，内化 durable-harness 的设计（不 fork、不直接依赖），在 BackendPort 边界做「任务级 durable」**。

### 10.1 三层架构与分工

```
┌────────────────────────────────────────────────┐
│ 第 1 层：前台编排（复用 qwen-audio-agent，不改）   │
│   前台 Agent（豆包全双工）+ 语义路由 + TaskManager │
│   + Agent Delivery + Gateway Client Protocol    │
│   + 权限/审批                                    │
│   接入：BackendPort + spawnThinkingDescription   │
└───────────────────────┬────────────────────────┘
                        │ BackendPort.submit
┌───────────────────────▼────────────────────────┐
│ 第 2 层：编排 durable 层（Fugue 自研，内化 dh 设计）│
│   MultiBackendAdapter（durable 版）              │
│   ├─ fold：从 TaskWorld 日志重建 taskMap          │
│   ├─ effect sandwich：submit/wait/forward        │
│   │   memoize + replay（exactly-once）           │
│   ├─ anchor + queue backstop：崩溃恢复            │
│   └─ epoch fencing：多端分时共享                  │
│   TaskWorld = Storage + Queue + Streamer         │
└───────────┬────────────────────────────────────┘
            │ ACP stdio（qwen factory，非 storage）
┌───────────▼────────────────────────────────────┐
│ 第 3 层：harness 层（不可靠子进程）                │
│   pi / opencode / hermes / dsh                   │
│   —— 崩溃 → 重启 → 从日志重新 submit              │
│   —— harness 自身 durable 交给 harness 自己        │
│      （Pi 用 @earendil-works/pi-durable，若 ACP 暴露）│
└────────────────────────────────────────────────┘
```

### 10.2 为什么内化设计，而不是直接依赖 durable-harness

| 维度 | 直接依赖 durable-harness | 内化设计（本方案） |
|------|------------------------|-------------------|
| durable 对象 | harness **session**（模型/工具调用） | 编排**任务**（委派/进度/播报） |
| 底座 | Vercel / Workflow SDK | qwen-audio-agent |
| 依赖 | 引入 `@workflow/world` + `durable-harness` | **零新运行时依赖**，借鉴设计 |
| harness 接入 | 直接操作 harness storage | ACP stdio（qwen factory） |
| 匹配度 | 低（Fugue 碰不到 harness storage） | 高（在 BackendPort 边界 durable） |

**核心原因**：Fugue 通过 qwen-audio-agent 的 ACP factory 接 harness，看到的是 **ACP 协议（stdio）**，碰不到 harness 的 storage/session 内部。durable-harness 的 adapter 是「直接操作 harness storage」（如 pi-durable 的 `openWorldStorage`），这条路在 Fugue 的 ACP 接入方式下**走不通**。因此 Fugue 只能在 **BackendPort 边界（任务级）做 durable**，把 durable-harness 的「session durable」设计**内化成「任务 durable」**。

### 10.3 两者分工（一句话）

- **qwen-audio-agent**：前台编排 + 多端 + 全双工 + 权限——复用，一行不改。
- **durable-harness**：提供「如何做 durable」的**设计蓝图**（World 三合一 / intent-outcome 日志 / fold / effect sandwich / replay / anchor / epoch fencing），Fugue 内化成「任务级 durable」的实现。
- **Fugue 自研**：TaskWorld + 任务事件日志 + fold + effect + anchor 的「任务级」实现 + MultiBackendAdapter durable 化。

### 10.4 关键映射（durable-harness 概念 → Fugue 任务级实现）

| durable-harness 概念 | Fugue 任务级对应 |
|---------------------|-----------------|
| session = run | task = run（每个委派任务一条日志） |
| model/tool 调用 = step | submit/wait/forward = step |
| `Harness.drive(ctx)` | `MultiBackendAdapter.drive(task)` |
| `ctx.effect(key, opts, fn)` | 委派步骤 memoize（completed 回放 / failed 抛错 / running 按 replay） |
| `ReplayPolicy` | submit=`never`（重复产生重复任务），read=`safe` |
| anchor（队列锁/进程） | Gateway 进程 + 队列消息锁 |
| epoch fencing | 多端（语音+飞书）takeover 的写冲突防护 |
| queue backstop | 任务背后队列消息，Gateway 死 → 重投递 |
| documents | 任务 to-do/进度/结果的 typed JSON 共享状态 |
| recoverSessions | Gateway 重启扫描 pending 任务重入队 |

### 10.5 为什么不引入 durable-harness 依赖的补充理由

1. **生态耦合**：durable-harness 设计目标是 Vercel/Workflow SDK 部署；Fugue 是本地优先 + 云端 Hermes（阿里云/腾讯云），引入会带来 Vercel 生态的部署假设。
2. **接口冲突**：qwen-audio-agent 的 `BackendPort` 与 durable-harness 的 `Harness` 是两个不同的契约，Fugue 已实现前者，桥接两者需额外适配层，收益不成比例。
3. **学习/掌控成本**：durable-harness 的机制（~3000 行内核）内化成「任务级」裁剪版，比引入完整依赖更可控、更贴合 Fugue 的「可读 + 模块化」宪法。

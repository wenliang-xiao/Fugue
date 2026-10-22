# durable-harness 深度技术分析

> 版本：v0.1（2026-10 调研）
> 状态：已收口
> 方法：clone `github.com/vercel-labs/durable-harness`（Apache-2.0）逐源码精读
> 关联：本结论将支撑 Fugue 的 durable 化方案（ADR-0008 及后续）
> 上游：<https://github.com/vercel-labs/durable-harness> · <https://vercel.com/docs/agent-harnesses>

---

## 0. 一句话结论

durable-harness 把「harness 的 session」建模为「Workflow SDK 的一条 workflow run」：**session = run，事件日志 = 唯一真相源**。任何时刻崩溃，都能从日志重建「什么完成了 / 什么正在跑 / 什么没开始」，由队列把 turn 交给新进程续跑，**完成的调用永不重复（不重复计费），不可重复的副作用永不跑两次**。

它没有发明新范式，而是把「workflow 的持久执行」思想系统地搬到了「AI agent 的 turn」上，并用**类型系统作为契约载体**（这是它选择 TypeScript 的根本原因，不是工具偏好）。

---

## 1. 世界观：session = workflow run

| 传统 harness（本地） | durable-harness（云端） |
|---------------------|------------------------|
| session 存在进程内存 | session 存在 run 的**事件日志**（World 持久化） |
| 崩溃 = 丢工作，人工重试 | 崩溃 = 队列重投递，新进程读日志续跑 |
| 工具调用无幂等语义 | 每个调用带 **replay 策略**（safe/never） |
| 工作目录在本机磁盘 | 工作目录在「会话日志」（virtual）或「持久 Drive」（sandbox） |
| 无跨进程协作 | park/settle/detach 等 **fact 步骤**表达跨进程协作 |

**核心抽象**（`packages/harness-world/src/types.ts`）：

```typescript
import type { Queue, Storage, Streamer } from '@workflow/world'
interface World extends Storage, Queue, Streamer {}
```

一个 `World` 同时提供三件事，这正是 durable agent 的全部需求：

1. **Storage**（日志）：session 的每一步都写成事件；
2. **Queue**（恢复）：turn 背后有一条队列消息，进程死了队列重投递；
3. **Streamer**（观测）：把进度流给 UI / Agent Runs。

换 World 不改 agent 代码（可移植性）：Vercel World / 本地文件 / Postgres / MongoDB / Redis / Turso / 浏览器 IndexedDB。

---

## 2. 核心机制逐层拆解

### 2.1 intent/outcome 日志（一切的地基）

每个模型调用、每个工具调用，都走「先写意图、再写结果」两段式：

```
step_started  (intent)  →  step_completed / step_failed  (outcome)
```

崩溃后，日志精确回答三件事：
- **完成了什么** → outcome 已在日志 → 回放结果，不重跑；
- **正在跑什么** → 只有 intent、没有 outcome → 按 replay 策略决定重跑与否；
- **没开始什么** → 什么都没有 → 从头跑。

### 2.2 fold：日志的唯一语义读者（纯函数）

`fold.ts` 是把「事件流」折叠成「会话状态（SessionState）」的纯函数，**增量式**（折叠两半 = 一次折叠），是整个系统唯一理解日志语义的地方。harness 永远不看原始事件，只看 fold 产出的 `transcript + memo table`。

单写者约束靠五条规则在 fold 里保证（`fold.ts` 头部注释）：

1. **First-writer-wins per memo key**：同一 key 的后一个 step 被 ignore（`superseded`）；
2. **Fencing**：epoch 不匹配的 step 被 ignore（防僵尸进程）；
3. **Outcome 只对 running 记录生效**：迟到结果 vs 恢复写的中断结果，谁先落地谁赢；
4. **Retry 原地替换**：新 step 带 `retryOf` 命名被释放的旧 step，`effectOrder` 仍每 key 一条；
5. **Fact 步骤 intent 即生效**，且只在目标处于正确状态时生效（详见 §2.7）。

### 2.3 effect sandwich + memoization（exactly-once 的核心原语）

`driver.ts` 的 `effect()` 方法（约 2298 行起）是整套系统的原语：

```typescript
await ctx.effect(key, opts, fn)
// key    : memo 键，同一逻辑调用的稳定标识
// opts   : { name, replay, input, requires/needs }
// fn     : 真正执行的函数
```

语义：

| 该 key 的状态 | effect 行为 |
|--------------|------------|
| `completed` | **直接回放缓存结果**（不重复计费 token / 不重跑工具） |
| `failed` | 抛 `EffectFailure`（不重跑） |
| `running` | 按 replay 策略：`safe` 重跑；`never` 告知模型「可能已发生」 |
| 无记录 | 写 intent → 跑 `fn` → 写 outcome |

`replay` 策略（`types.ts` 的 `ReplayPolicy`）：

- `safe`：崩溃后可安全重跑（读、幂等写、模型调用）；
- `never`：绝不跑两次（退款、发评论）。崩溃后模型被告知「该调用可能已发生」，由模型决定是否先检查。

### 2.4 anchor：liveness 归队列，永远不写心跳

`anchor.ts` 开篇一句话是整套设计哲学：

> *"Liveness is the queue's, never ours."*（活性是队列的，永远不是我们的）

每个 drive 挂在一个 **anchor** 上——它的「锚」的丢失即证明 drive 已死：

| Anchor 类型 | 持有者 | 证明「已死」的方式 |
|-------------|--------|-------------------|
| `msg` | 队列消息 | 队列锁（VQS lease / Web Lock / 进程）失效 |
| `deadline` | 直连 drive（chatRoute 默认） | 超过 deadline 没写 |
| `tab` | 浏览器页 | 同 profile 的 Web Lock 空闲 |
| `host` | sandbox daemon | 服务端 tether 断链 |

判断一个 running intent 的持有者死活，只问一个问题（`anchorVerdict`）：

- `mine`：这个 intent 锚在本 delivery 自己的消息上 → 立即恢复（fenced）；
- `gone`：日志或 World 能证明持有者死了 → 立即恢复；
- `covered`：其他情况 → ack，持有者活着就接手，死了消息会回来。

**没有任何地方写心跳、探活、lease 续期**（queue-send-and-hold 是未来优化，见 §2.6）。

### 2.5 epoch fencing：防僵尸进程写坏状态

每次 `handoff`（会话移交）递增 `epoch`。一个 driver 写的每个 intent 都带它看到的 `epoch`；fold 遇到 epoch 不匹配的 step 直接 fence 掉（`superseded` + `fenced`）。这样「看起来死了、其实还活着的进程」的迟到写入永远不会污染新 owner 的状态。

配合 **in-band fence**（`session-log.ts` 的 `arm()`）：World 层的写者栅栏，从「读后写」升级到「写时校验」，两个 drive 竞争时 World 拒绝 stale 的写。

### 2.6 queue backstop + send-and-hold

每个 turn 背后有一条队列消息：进程死了，队列重新投递，新进程读日志续跑。

`docs/queue-send-and-hold.md` 讲透了 chatRoute 的 60s handover 设计（这也是「为什么 chatRoute 默认 drive 60s 后交给队列」的原因）：

- `drive: 'route'`（默认）：请求在自己的 invocation 里直驱 60s（首个 token 立即流式），超时用「delayed companion 队列消息」兜底（deadline + 5s）；
- 静默死亡在约 65-70s 后被 companion 恢复；
- `drive: 'queue'`：整个 turn 都在队列 delivery 里跑（锁随 handler 续期），代价是首个 token 前多一跳队列；
- **send-and-hold**（演进中）：消息发送时即租给发送者，请求可跑满整个 invocation，静默死亡秒级恢复。

### 2.7 fact 步骤：跨进程协作的「事实」

`facts.ts` 定义了几类「intent 时即生效」的步骤（born-running），用于表达跨进程协作：

| Fact | 作用 |
|------|------|
| `park` | 把 running intent 交给 drive 之外的 owner（sandbox VM 里的命令） |
| `settle` | 记录被 park 的工作的结局（first-writer-wins） |
| `detach` | parker 放手（宽限期到，或死了被 recovery detach） |
| `close` | 某 drive 声明「我再也不会写任何东西」，其遗留 running intent 被放弃 |
| `host` | 记录 sandbox daemon 接管会话（含 bootId，防 stale 标记掩盖新 boot） |
| `chaos` | 注入崩溃（测试 Kill Function） |

fold 保证这些 fact 只在目标处于正确状态时生效，所以 `detach` 和 `settle` 竞争时，日志顺序唯一决定谁赢。

### 2.8 documents + virtual workspace

**documents**（`docs.ts`）：会话级 typed JSON 状态，存在日志里，**不展示给模型**（除非 app 给它读文档的工具）。

- **in-band 编辑**（`io.docs.update`）：改动随 effect 的 outcome 原子提交；调用抛错/崩溃 = 没改；
- **out-of-band 编辑**（`sessions.updateDoc`）：走 docs hook，乐观并发（按 revision），冲突抛 `DocConflict`；
- fold 是唯一解释器，不读 schema、不读时钟 → 同一日志永远折叠出同一文档。

**virtual workspace**：`virtual()` 的文件树本身就是 session 里的一个 document；工具每次调用的文件改动随其结果提交，崩溃中断的调用改了零。配 `just-bash` 提供 bash 兼容 shell，不能碰 function 的文件、进程、网络。

### 2.9 lanes：能力分层与会话迁移

`lanes.ts` 定义 `browser < function < sandbox` 三级能力：

| Lane | 原生能力 |
|------|---------|
| `browser` | workspace + gateway（模型调用） |
| `function` | workspace + gateway + **secrets**（后端凭据），remote: machine |
| `sandbox` | workspace + gateway + **machine**（真实 Linux） |

一个 effect 声明 `needs`（需要的 capability），`route()` 决定「原地跑」还是「handoff 到更高 lane」。典型场景：查数据库（secrets）在 function 跑，跑 `npm install`（machine）handoff 到 sandbox。会话在 lane 间迁移，靠 handoff fact + epoch fencing 保证安全。

### 2.10 recover：进程重启后的续跑

`recover.ts` 的 `recoverSessions(world)`：扫所有 `pending/running` 的 run，按 kernel 的 queue namespace 重新入队。进程重启后所有未完成的 session 自动续跑。

### 2.11 PipelinedLog：run-ahead 性能优化

`pipelined-log.ts`：`safe` 的 effect 可以先执行、intent 后落盘（流水线），只在 **barrier** 处阻塞：

- 一个绝不能跑两次的 effect（`never`）之前；
- 一个「我赢了吗？」的判定之前；
- 进程放弃 session 之前。

这消除了「每个模型调用都等一次日志写」的延迟。

---

## 3. 各 harness 的接入方式

| Harness | Package | 接入思路 |
|---------|---------|---------|
| Pi（推荐） | `durable-harness/pi-durable` | Pi 1.0 自带 durable `Harness`，只做 **storage swap**：`openWorldStorage` 把 SQLite/JSONL/memory 换成 World-backed storage，每个 Pi commit = 一个 run event。`resumeWith(open)` 一行注册「如何重开会话」。 |
| OpenCode | `durable-harness/opencode` | 自身有 event store，**每条记录镜像进日志**，新进程从日志重建 store。 |
| Claude Code / Codex | `durable-harness/claude-code` `/codex` | 有 transcript / rollout 文件，同样镜像进日志；只跑 sandbox（需要真 shell 和文件系统）。 |
| fx / eve | `libfx` / `eve` | 本身已 durable，直接挂 World。 |

**Pi 的 one-owner 规则**是 Fugue 要特别注意的点：打开 session = takeover，一个进程里一个 session 只能有一个 open Harness（`acquireHarness` 共享）。

---

## 4. 语言选型：TS 是契约载体，不是工具偏好

durable-harness 纯 TS（679 个 `.ts`），`strict`，发布全量 `.d.ts`。它的核心设计**以类型形式存在**：

```typescript
type ReplayPolicy = 'safe' | 'never';
type Verdict = { v: 'mine' } | { v: 'gone' } | { v: 'covered' };
type Settlement = { ok: true; value: string } | { ok: false; error: EffectError };
interface Harness { drive(ctx: DriveContext): Promise<void> }
```

epoch / fence / superseded / retryOf 这些位状态，无类型时写错的 bug **只在崩溃恢复那一刻才爆**（最难测），discriminated union 恰好防这个。→ 这是 Fugue 全量切 TS 的直接依据（ADR-0008）。

---

## 5. 对 Fugue 的借鉴映射

Fugue 现状：`MultiBackendAdapter` 把任务委派给 opencode/pi/hermes/dsh，但**后台任务状态是进程内存态**——Gateway 崩溃/超时即丢任务进度。durable-harness 的机制可逐条映射：

| durable-harness 机制 | Fugue 借鉴点 |
|---------------------|-------------|
| World 三合一接口 | 抽象「后台任务状态」为接口，本地/生产可切换 |
| intent/outcome 日志 | `submit(task)` 后每个阶段（受理/进度/完成/失败）落日志 |
| effect sandwich | 委派步骤 memoize，重连后判断「已做过」不重做 |
| ReplayPolicy | 给后台 tool 标注幂等性（safe/never） |
| anchor + 队列兜底 | Gateway 重启后队列重投递，从日志续跑 |
| epoch fencing | 多端（语音+飞书）分时共享时的写冲突防护 |
| documents | 任务 to-do / 进度 / 结果作为会话级 typed JSON |
| lanes | 委派按能力路由（本地 harness vs 云端 Hermes） |

详细方案见后续 OpenSpec 评审文档。

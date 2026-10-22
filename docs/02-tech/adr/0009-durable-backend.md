# ADR-0009 后台委派 durable 化：任务日志 + effect sandwich + 队列兜底

- 状态：草案（待评审）
- 日期：2026-10-22
- 关联：ADR-0008 · [durable-harness 深度分析](../../00-research/durable-harness-analysis.md) · [durable 化设计](../durable-design.md)

## 背景

Fugue 的 `MultiBackendAdapter` 把任务委派给 opencode/pi/hermes/dsh，但**任务状态（taskMap、路由、事件聚合）是进程内存态**：Gateway 崩溃/超时即丢任务进度，后台 harness 子进程崩溃后 task 状态无从恢复。

durable-harness 提供了一套成熟设计：session = workflow run，事件日志 = 唯一真相源，intent/outcome 日志 + effect sandwich（memoization）+ replay policy + anchor（liveness 归队列）+ epoch fencing + queue backstop。详见调研文档。

## 决策

**把 Fugue 的「任务」建模为「durable-harness 风格的 run」：引入 `TaskWorld` 抽象（Storage + Queue + Streamer 三合一），每个委派任务的完整生命周期写成 intent/outcome 事件日志；`MultiBackendAdapter` 的 taskMap 从日志 fold 重建；每个委派步骤用 effect sandwich 包裹并标注 replay 策略；Gateway 重启后由队列重投递，从日志续跑。**

要点：

1. **TaskWorld 接口**：`interface TaskWorld extends Storage, Queue, Streamer {}`。本地实现用文件/SQLite（对齐 durable-harness 的 world-local），生产用 Postgres/Redis。换实现不改 adapter 代码。
2. **任务事件日志**：`task_submitted → task_accepted → task_progress → task_completed / task_failed / task_cancelled`，每个都是 intent/outcome 两段式（`step_started` / `step_completed`）。
3. **fold 重建 taskMap**：taskMap 不再是在内存里增删的 Map，而是日志 fold 的产物（纯函数、增量式）。重启后从日志重建全部进行中任务。
4. **effect sandwich + replay**：`submit`、`wait result`、`forward event` 等步骤用 `effect(key, opts, fn)` 包裹；`replay: safe`（幂等，如读任务状态）vs `replay: never`（有副作用，如向 harness 重复提交任务）。
5. **anchor + queue backstop**：每个任务背后一条队列消息，Gateway 进程死 → 队列重投递 → 新进程读日志续跑；liveness 归队列，应用层不写心跳。
6. **epoch fencing**：多端（语音 + 飞书）分时共享时，任务移交（takeover）递增 epoch，僵尸进程的迟到写入被 fence。
7. **harness 子进程作为不可靠资源管理**：后台 harness 崩溃 → 重启 harness → 从日志恢复 task 状态；harness 自身的 session 状态（如 Pi 的 durable storage）镜像进日志（对齐 durable-harness 对 Claude Code/Codex 的「从外面加 durability」做法）。

## 理由

- durable-harness 已被 Vercel 验证，机制成熟且开源（Apache-2.0），直接借鉴比自研低风险。
- 「任务」与「session」在 durable 语义上同构：都有长生命周期、多步骤、跨进程、需崩溃恢复。
- World 抽象把「本地开发（文件）」与「生产（Postgres）」解耦，符合 Fugue 现阶段的本地优先 + 云端 Hermes 的部署形态。
- effect sandwich + replay 解决的核心问题（完成的调用不重复计费、有副作用的调用不重复执行）正是多 harness 委派的真实痛点（重复 submit 会产生重复任务）。

## 后果

- **收益**：Gateway/后台 harness 崩溃可恢复，任务不丢、不重复；多端分时共享有 fencing 保证；部署可移植。
- **代价**：引入事件日志的写入开销（每个步骤两次写）；需实现 fold + effect + anchor + queue 基础设施（对齐 durable-harness，可裁剪）；TaskWorld 的本地/生产实现各自维护。
- **风险**：durable-harness 的机制为「单 session 单 writer」设计，Fugue 的「多端 + 多 harness 并发」需要额外验证 fencing 语义；队列基础设施在本地开发需降级（本地队列 = 进程内重投递，见 world-local 做法）。
- **备选**：只做「任务状态持久化到 DB」不做崩溃恢复（简单但丢了核心价值）；fork durable-harness 直接复用（引入 Vercel 生态依赖，与 Fugue 本地优先 + qwen-audio-agent 底座耦合过重）。

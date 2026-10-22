# Fugue 🎼

> **Many agents, one fugue.** — 全双工、多端可达、**崩溃可恢复**的多 agent harness 编排中枢。

[English](README.en.md) | 中文

[![GitHub stars](https://img.shields.io/github/stars/wenliang-xiao/Fugue?style=social)](https://github.com/wenliang-xiao/Fugue/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/wenliang-xiao/Fugue?style=social)](https://github.com/wenliang-xiao/Fugue/network/members)
[![GitHub issues](https://img.shields.io/github/issues/wenliang-xiao/Fugue)](https://github.com/wenliang-xiao/Fugue/issues)
[![CI](https://github.com/wenliang-xiao/Fugue/actions/workflows/ci.yml/badge.svg)](https://github.com/wenliang-xiao/Fugue/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/wenliang-xiao/Fugue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

## 这是什么

把你已有的 agent harness（本地 **OpenCode / Pi**、云端 **Hermes**、任意 ACP/A2A 兼容 harness）变成一个**随时随地、边聊边干、干完主动汇报、崩溃也不丢任务**的助手。

- 🎙️ **全双工对话** — 像打电话一样同时说和听，随时插话、打断，不是一问一答。
- 📱 **多端可达** — 语音 App（orb / WebUI / 手机）与飞书文字，共享同一份记忆、任务与状态。
- 🧩 **多 harness 委派** — 一个前台陪你聊，多个后台 harness 并行干活，按领域路由或你显式指定（"交给 pi"）。
- 💪 **崩溃可恢复** — 任务状态写入事件日志，进程崩溃后从日志续跑；**完成的调用不重复、有副作用的调用不重跑**。
- 🔌 **零侵入接入** — 复用你已有的 harness，不 fork 底座（qwen-audio-agent），只走它的标准扩展点。

## 快速开始

**前置**：Node ≥ 22。

```bash
# 1. 安装
cd /path/to/fugue && npm install

# 2. 配置飞书入口（可选，不用飞书可跳过）
cp config/config.example.env config/config.env

# 3. 启动
npm start
# → WebUI: http://127.0.0.1:3101
# → 前台语音凭据复用 qwen-audio-agent 的 config（DASHSCOPE_API_KEY / DOUBAO_API_KEY）
```

```bash
npm test           # vitest：94 个测试（durable 内核 + 路由 + 多后端 + 端到端崩溃恢复）
npm run typecheck  # tsc --noEmit（TypeScript strict）
npm run inspect    # 任务观察台：本地任务流转 / 打点 / effect 状态
```

## 使用

### 配置你的 harness

编辑 `config/harnesses.json`，声明你要接入的 harness 和它擅长的领域：

```json
{
  "harnesses": [
    { "id": "pi", "label": "Pi · 工作主力", "protocol": "pi", "domains": ["工作", "周报", "文档"], "default": true },
    { "id": "opencode", "label": "OpenCode · 代码", "protocol": "opencode", "domains": ["代码", "重构"] },
    { "id": "hermes", "label": "Hermes · 财经", "protocol": "acp", "command": "ssh", "args": ["<host>", "hermes", "acp", "--accept-hooks"], "domains": ["财经", "投资"] },
    { "id": "dsh", "label": "DeepSeek · 调研", "type": "headless", "command": "dsh", "args": ["--profile", "headless"], "domains": ["调研", "research"] }
  ]
}
```

三种接入方式：`protocol`（内置协议 pi/opencode）、`command+args`（任意 ACP harness，如 SSH 隧道接 Hermes）、`type: "headless"`（一次性进程，如 dsh）。

### 对话委派

```
你（语音/飞书）："帮我写个周报"
  → 前台判断 → 按领域路由到 pi → 后台执行 → 主动播报"写好了"

你（语音/飞书）："交给 opencode：重构这个模块"
  → 显式指定专家 → 路由到 opencode
```

委派后你可以继续聊别的，后台并行干活，完成时主动播报。进度、取消、补信息随时可说。

### 实时观察（debug）

启动时自动开启**实时打点观察器**，任务流转实时打印到终端：

```
[fugue] 实时打点观察器已开启
08:07:59.948  [step] step_started (submit) replay=never
08:07:59.950  [mark] intent (submit) key=task:live-1:submit:pi
08:07:59.951  [step] step_completed
08:07:59.952  [run] run_handoff live-1
```

另开终端回看全量流转：`npm run inspect`。

## 架构

<img src="assets/diagrams/fugue-architecture.png" alt="Fugue 架构" width="720">

三层分工：**qwen-audio-agent**（前台编排 + 多端 + 全双工，复用不改）→ **Fugue durable 层**（任务日志 + fold + 崩溃恢复，自研）→ **harness 层**（不可靠子进程，崩溃重启从日志续跑）。

## 崩溃恢复（durable）

任务不丢、不重复执行，机制借鉴 Vercel 的 [durable-harness](docs/00-research/durable-harness-analysis.md)：

<table>
<tr>
<td width="50%"><img src="assets/diagrams/durable-harness-crash-recovery.png" alt="崩溃恢复时序" width="460"></td>
<td width="50%"><img src="assets/diagrams/durable-harness-effect-sandwich.png" alt="effect sandwich 状态机" width="460"></td>
</tr>
</table>

- **intent/outcome 日志** — 每个步骤先写意图、再写结果；崩溃后日志精确回答「完成了什么 / 正在跑什么 / 没开始什么」。
- **effect sandwich + replay** — `completed` 回放结果（不重复计费）、`failed` 抛错、`running` 按 `safe/never` 决定重跑；`never` 的调用（如重复 submit）绝不跑两次。
- **anchor + queue backstop** — liveness 归队列，应用层不写心跳；进程死 → 重投递 → 新进程读日志续跑。
- **epoch fencing** — 多端（语音 + 飞书）分时共享时，僵尸进程的迟到写入被 fence。

## 为什么是编排，不是桥接

市面上的「飞书 agent」多是**同步桥接**（cc-connect、botmux）：把 harness 的 stdin/stdout 转发到 IM——发指令、等结果。

| | 桥接 | Fugue（编排） |
|---|---|---|
| 交互 | 发指令 → 执行 → 回结果（同步 console） | 派活 → 继续聊 → 后台并行 → 主动播报 |
| 体验 | 远程操控终端 | 跟助手打电话 |
| 多任务 | 基本串行 | 多后台并行，随时问进度/取消 |
| 全双工语音 | ❌ | ✅ |
| 崩溃恢复 | ❌ 进程死即丢状态 | ✅ 从事件日志续跑 |
| 多 harness | 弱（CLI 转发） | ✅ 可插拔，路由/显式指定 |
| 云端 harness | ❌ | ✅ 一等支持（SSH 隧道 ACP） |

## Roadmap

### P0 · 基础体验打磨（进行中）

- [x] durable 内核（TaskWorld/fold/effect/anchor/fencing + 崩溃恢复）
- [x] 播报只说结论不全文朗读（6000→500 字符）
- [x] 工作目录指向项目
- [x] 不打断用户（话轮规则）
- [ ] 打断即时生效（待验证）
- [ ] 进度简短更新（播报节奏）
- [ ] 任务完成明确确认
- [ ] 内部工具路径不播报

### P1 · durable 加固

- [ ] 真实崩溃恢复验证（kill -9 → 重启续跑）
- [ ] pi/opencode session 持久化

### P2 · 多 agent 能力

- [ ] documents 共享记忆
- [ ] 并行 fan-out

### P3 · 矩阵愿景

- [ ] 专家横向协作 / 调度器 / 成本账本

## 文档

- [架构设计](docs/02-tech/architecture.md) · [durable 化设计](docs/02-tech/durable-design.md) · [架构决策 ADR](docs/02-tech/adr/) · [模块设计](docs/02-tech/modules/)
- [durable-harness 深度分析](docs/00-research/durable-harness-analysis.md) · [竞品调研](docs/00-research/competitor-analysis.md)
- [产品需求 PRD](docs/01-prd/PRD.md) · [术语表](docs/glossary.md) · [测试计划](docs/04-test/test-plan.md)

## 贡献

遵循 [SDD 工作流](AGENTS.md)（Spec-Driven Development）：Spec 是唯一真相源，先写规格再写代码。贡献前请读 [工程宪法](CONSTITUTION.md) 与 [AI 协同规范](docs/vibe-coding.md)。

## License

[MIT](LICENSE)

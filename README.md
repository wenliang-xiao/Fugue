# Fugue

> **Many agents, one fugue.** — 一个全双工、多端可达、可委派多种 agent harness 的对话编排中枢。

[English](README.en.md) | 中文

[![CI](https://github.com/wenliang-xiao/Fugue/actions/workflows/ci.yml/badge.svg)](https://github.com/wenliang-xiao/Fugue/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

把你自己已有的 agent harness（本地 OpenCode / Pi、云端 Hermes，以及任意 ACP/A2A 兼容的 harness）变成一个**随时随地、边聊边干、干完主动汇报**的助手：

- **全双工对话**：像打电话一样同时说和听，随时插话、随时打断，不是一问一答。
- **多端可达**：语音 App（桌面 orb / WebUI / 手机）与飞书文字，两个入口共享同一个 Agent 的记忆、任务与状态。
- **多 harness 委派**：一个前台陪你聊，多个后台 harness 并行干活，按任务类型路由或你手动指定。

---

## 为什么要做这个

Agent harness 已经百花齐放（OpenCode、Pi、Claude Code、Codex、DeepSeek Harness、Hermes……），但它们各自是"一个终端 / 一个桌面窗口"，交互入口单一、彼此孤立：

| 现状 | 问题 |
|------|------|
| 每个 harness 一个入口 | 你想用几个就得开几个窗口，来回切 |
| 入口绑在本地终端 | 离开电脑就断了，云端 harness（如 Hermes）没有统一入口 |
| 干活时对话阻塞 | 一问一答，复杂任务只能干等 |
| 没有语音 | 想边走边说 / 开车时用，基本无解 |

Fugue 做的是**编排层**（不是再做一个 harness）：把"前台对话"和"后台干活"拆开，前台永远在线陪你聊，后台把任务委派给你已有的多个 harness 并行执行，干完主动插话汇报。飞书和语音只是同一套编排的两个入口。

> 与市面上"飞书桥接器"（cc-connect、botmux、dsh-lark-*）的本质区别：它们做的是**同步 console 转发**（发指令 → 执行 → 回结果），我们做的是**异步对话编排**（派活不阻塞、多任务并行、主动播报、随时打断追问）。详见 [docs/01-prd/PRD.md](docs/01-prd/PRD.md)。

---

## 技术底座（当前规格阶段，尚未写代码）

基于 [qwen-audio-agent](https://github.com/QwenAudio/qwen-audio-agent)（Apache-2.0）——它是目前唯一同时具备「全双工实时语音前端 + 前台/后台分离 + 任务生命周期编排 + 可插拔 Client 协议」的开源运行时。我们**不 fork 它的 core**，通过它的两个标准扩展点接入：

- **多 harness**：实现一个协议无关的 `MultiBackendAdapter`（聚合多个 backend，内部路由），走 Backend Adapter SDK 的 `BackendPort` 接口。
- **飞书入口**：实现一个 `text_only` 的飞书机器人 Client，走 Gateway Client Protocol 的 WebSocket。

详细设计见 [docs/02-tech/architecture.md](docs/02-tech/architecture.md)。

---

## 开发工作流：Spec-Driven Development（SDD）

本仓库严格遵循 **SDD（规格驱动开发）**：**先写规格，规格驱动实现、评审与测试**。这也是本项目要开源的工作流本身。

### 四类文档，一个闭环

```
        ┌───────────────┐
        │  01-prd/      │  要什么（Why / What）
        │  产品需求      │  愿景 · 用户 · 功能 · 分级 · MVP · 成功指标
        └──────┬────────┘
               │ 驱动
        ┌──────▼────────┐
        │  02-tech/     │  怎么做（How）
        │  技术设计      │  架构 · 模块 · ADR · 接口契约 · 数据模型
        └──────┬────────┘
               │ 约束
        ┌──────▼────────┐
        │   实现 / 代码   │
        └──────┬────────┘
               │ 依据 spec 评审
        ┌──────▼────────┐
        │  03-review/   │  是否符合 spec
        │  评审规范      │  标准 · checklist · 流程
        └──────┬────────┘
               │ 依据 spec 验证
        ┌──────▼────────┐
        │  04-test/     │  是否满足 spec
        │  测试文档      │  计划 · 策略 · 用例（可追溯到 PRD/Tech）
        └───────────────┘
```

### 三条铁律

1. **Spec 是唯一真相源**。代码、review、test 都以 spec 为准；spec 与实现冲突时，改实现，不改 spec（除非先走变更流程改 spec）。
2. **Spec 先行**。任何功能先落 PRD/Tech，再写代码；禁止"边写边想"。
3. **可追溯**。每个需求（PRD）→ 设计（Tech）→ 测试用例（Test）可双向追溯；每份 ADR 记录"为什么这么选"。

执行纪律见 [docs/vibe-coding.md](docs/vibe-coding.md)（AI 协同开发的五道验证门 + 决策权边界），治理规则见 [CONSTITUTION.md](CONSTITUTION.md)。

### 变更流程

需求变化 → 先改 PRD/Tech（记 ADR）→ 再改代码 → 最后更新 Test。顺序不可颠倒。

完整流程定义见 [AGENTS.md](AGENTS.md)（面向 AI Agent 的协作规范，也是工作流的可执行版本）。

---

## 文档导航

| 目录 | 内容 | 状态 |
|------|------|------|
| [CONSTITUTION.md](CONSTITUTION.md) | 工程宪法（五条铁律） | ✅ 已落 |
| [docs/vibe-coding.md](docs/vibe-coding.md) | AI 协同开发规范（四陷阱 + 五道门） | ✅ 已落 |
| [docs/glossary.md](docs/glossary.md) | 术语注册表 | ✅ 已落 |
| [docs/00-research/competitor-analysis.md](docs/00-research/competitor-analysis.md) | 竞品调研 | ✅ 已落 |
| [docs/01-prd/PRD.md](docs/01-prd/PRD.md) | 产品需求文档 | ✅ 已落 |
| [docs/02-tech/architecture.md](docs/02-tech/architecture.md) | 总体架构设计 | ✅ 已落 |
| [docs/02-tech/adr/](docs/02-tech/adr/) | 架构决策记录（ADR） | ✅ 已落 |
| [docs/02-tech/modules/](docs/02-tech/modules/) | 模块级设计 | ✅ 已落（multi-backend-adapter / feishu-client） |
| [docs/03-review/review-guide.md](docs/03-review/review-guide.md) | 代码评审规范 | ✅ 已落 |
| [docs/04-test/test-plan.md](docs/04-test/test-plan.md) | 测试计划 | ✅ 已落 |
| [docs/04-test/cases/](docs/04-test/cases/) | 测试用例 | ✅ 已落（multi-backend / feishu-client） |
| [docs/trace/](docs/trace/) | 过程记录（dev-log / debug-log / handoff / ratify-log） | 随 session 推进 |

---

## 运行

```bash
# 1. 依赖（含上游 qwen-audio-agent 源码，需先在其仓库 npm install）
cd /Users/wenlix/project/qwen-audio-agent && npm install --omit=dev
cd /Users/wenlix/project/fugue && npm install

# 2. 配置（多 harness 编排 + 飞书入口）
cp config/config.example.env config/config.env
# 编辑 config/config.env：启用 opencode/pi/hermes + Hermes SSH host + 飞书凭据

# 3. 语音前端凭据（复用 qwen-audio-agent 的 config.env）
#   ~/.config/qwaudio/config.env 填 DASHSCOPE_API_KEY 等

# 4. 启动
npm start
```

测试：

```bash
npm test       # 33 个测试（routing / multi-backend / message-bridge / feishu-client）
npm run poc    # 上游 BackendPort 一致性套件
```

---

## License

[MIT](LICENSE)

# 竞品分析 — 飞书/IM × Agent Harness 编排赛道

> 版本：v0.1（2026-10-10 调研）
> 状态：已收口（结论进 PRD §3）
> 方法：GitHub 搜索 + 源码 clone 分析（ccteam/cc-connect/botmux）+ Hermes 生态调研

---

## 1. 赛道全景

| 项目 | Star | 技术栈 | 定位 | 关键结论 |
|------|------|--------|------|---------|
| NousResearch/hermes-agent | 252k | Python | 云端自进化 agent，自带 IM | 自带 Telegram/Discord/Slack/WhatsApp/Signal，**无飞书** |
| farion1231/cc-switch | 142k | — | 桌面切 agent 的 All-in-One | 是"切换器"非"编排" |
| chenhg5/cc-connect | 15.8k | Go | 本地 agent → 20+ IM 桥接 | 支持 opencode/pi/通用 acp，**无 Hermes**，桥接非编排 |
| nexu-io/nexu | 3.3k | TS | OpenClaw 桌面 client → 微信/飞书 | 单 harness 桥接 |
| op7418/Claude-to-IM-skill | 2.9k | — | Claude Code/Codex → IM | 桥接 |
| deepcoldy/botmux | 1.6k | TS/Bun | 多 CLI（含 OpenCode）→ 飞书 | 多 CLI 桥接，非编排 |
| firstintent/ccteam | 648 | Rust | 多 vendor agent 组队编排 | **最接近**：opencode/pi 都有，异步编排+远端 satellite+成本账本，**无 Hermes**、无全双工语音、飞书二等 |
| hyperlist/feishu-multi-agent | 273 | — | OpenClaw 飞书多 agent | 群聊隔离，桥接 |
| hermes-lark-streaming | 40 | — | Hermes → 飞书 channel | 只接 Hermes 一个，桥接 |
| dsh-lark-*（5+ 个） | 2~40 | — | dsh → 飞书 | 重复造轮子，全沉 |

## 2. 关键源码级发现

### 2.1 ccteam（clone 源码分析）

- 支持 vendor：Claude Code / Codex / Grok / Kimi / DSH / **Pi / OpenCode**，以及通用 ACP。
- 能力：`agent`（派活）、`agent_read`（查状态）、`agent_stop`、fan-out 并行、cross-vendor review、completion 通知、远端 satellite、成本账本、`routing.md` 路由。
- 交互模式："hand codex the RFC-12 — work in the background, report back" → **异步派活 + 完成通知**，已接近"任务层全双工"。
- 缺口：无 Hermes；无全双工语音；IM 是 Telegram/Lark（Lark 二等）。

### 2.2 cc-connect（clone 源码分析）

- `agent/` 支持：claudecode / codex / cursor / gemini / kimi / **opencode / pi** / qoder / copilot / devin / tmux / **acp（通用）**。
- `platform/` 支持 20+ IM：feishu / dingtalk / slack / telegram / wecom / weixin / discord / line / qq / ...（飞书一等）。
- 定位：**单 agent → 多 IM 的桥接器**（有 Multi-Agent Orchestration 章节，但本质是转发 + 远程控制）。
- 缺口：无 Hermes；同步 console 体验；无"前台/后台分离 + 主动播报"的编排。

### 2.3 Hermes（NousResearch/hermes-agent）

- 定位原文："It's not tied to your laptop — talk to it from Telegram while it works on a cloud VM."
- 自带 IM：Telegram / Discord / Slack / WhatsApp / Signal——**无飞书/Lark**。
- 自带：并行 subagent、cron scheduler、SSH/Docker/Modal/Daytona 等 7 种运行后端。
- 结论：Hermes 自己就是"云端 agent + IM 入口"，缺的是飞书，以及"编排多个 vendor harness"。

## 3. 差异化结论

**唯一没人做的组合 = 飞书 + 云端 Hermes + 本地 harness（opencode/pi）的多 harness 编排。**

- Hermes 官方无飞书；ccteam 无 Hermes；cc-connect 无 Hermes 且桥接非编排；hermes-lark-streaming 只接 Hermes 一个且是桥接。

**但空白很窄**：飞书（国内团队）与 Hermes（英文生态）的用户交集小——这正是没人认真做的原因。

**定位**（已收口进 PRD §3）：**异步对话编排，而非同步桥接**。唯一同时具备「全双工语音 + 多端共享 + 多 harness 编排 + 支持云端 Hermes」的开源编排层。

## 4. 待验证点（写进 ADR/PRD 风险）

1. ccteam 的通用 ACP 能否直接拉起 Hermes（若可，则"编排 Hermes"它已间接支持）。
2. hermes-lark-streaming（40★）做到什么程度，Hermes 官方对飞书的 roadmap。
3. Hermes 是否支持远程 ACP/HTTP server 模式（决定远端接入方案，见 ADR-0004）。

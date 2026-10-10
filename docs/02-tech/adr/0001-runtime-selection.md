# ADR-0001 底座选型：基于 qwen-audio-agent 而非自研或 ccteam

- 状态：已采纳
- 日期：2026-10-10

## 背景

产品需要三件事：全双工语音对话、多端入口（飞书 + 语音 App）、多 harness 委派。调研了三条路线：

1. **自研编排层**：从零写前台对话 + 任务编排 + 语音前端。
2. **基于 ccteam**（多 vendor agent 组队编排，Rust）。
3. **基于 qwen-audio-agent**（全双工语音运行时，Apache-2.0）。

## 决策

**基于 qwen-audio-agent，复用其编排运行时，不 fork core，通过两个标准扩展点（BackendPort、Gateway Client Protocol）接入。**

## 理由

| 维度 | 自研 | ccteam | qwen-audio-agent |
|------|------|--------|------------------|
| 全双工语音前端 | 需自研（极高成本） | ❌ 无（文本 IM） | ✅ 现成，且是多 provider |
| 前台/后台分离 | 需自研 | 部分 | ✅ 现成 |
| 任务生命周期（进度/取消/权限/播报） | 需自研 | ✅ 有 | ✅ 现成 |
| 可插拔 Client 协议 | 需自研 | 文本 IM 为主 | ✅ Gateway Client Protocol（飞书可写 text_only client） |
| 多 harness | 需自研 | ✅ 有 | ⚠️ 单 backend（但可经 BackendPort 聚合，见 ADR-0002） |
| 许可证 | — | MIT | Apache-2.0（可 fork/商用） |

全双工语音是 P0 核心卖点（REQ-001），自研语音前端成本不可接受；ccteam 没有语音。qwen-audio-agent 是唯一同时具备"全双工语音 + 前台/后台分离 + 任务编排 + 可插拔 client"的开源运行时。其"单 backend"短板可由 BackendPort 聚合解决（ADR-0002），是三个缺口中最小、最可控的一个。

## 后果

- **代价**：受上游架构约束（单 client、单 backend），需在扩展点内工作；跟随上游版本节奏。
- **收益**：语音前端、任务编排、权限、播报全部复用，开发量集中在 MultiBackendAdapter + 飞书 client 两处。
- **备选**：若上游无法满足多 backend 聚合（ADR-0002 的 PoC 失败），退回 ccteam 路线并接受"无全双工语音"或自研语音前端（成本大幅上升）。

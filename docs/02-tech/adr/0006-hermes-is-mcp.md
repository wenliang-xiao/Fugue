# ADR-0006 Hermes 是财经 MCP，不是 ACP harness（推翻 ADR-0004 的接入方式）

- 状态：已采纳（supersede ADR-0004）
- 日期：2026-10-12

## 背景

ADR-0004 基于"Hermes = NousResearch hermes-agent（ACP harness，远端部署）"的假设，决策 SSH 隧道透传 ACP 接入。经用户澄清：**Hermes 实为用户自己的量化投资系统 `hermes-investment`**，通过 `mcp_akshare_server.py` 暴露 10 个财经 MCP 工具（股票搜索/行情/财务/因子评分/技术指标），使用个人 TUSHARE_TOKEN，**只做财经**。

## 决策

**Hermes（财经）通过 MCP 接入，不再走 ACP / SSH 隧道。** 具体：
- 接入类型为 `mcp: {command, args}`（P1 落地），作为「财经工具集」挂在领域专家层；
- 领域路由严格限定财经关键词，只读工具 + TUSHARE_TOKEN 只在财经任务消耗；
- ADR-0004 的 SSH 隧道 ACP 方案**作废**（但通用 `command+args` 接入能力保留，用于接入其他真·远端 ACP harness）。

## 理由

- `hermes-investment` 不是 agent（不实现 BackendPort 的 submit/status/cancel），是财经数据 + 因子引擎，通过 MCP 暴露工具。
- 10 个工具全为只读查询，天然无副作用；个人 token 有额度，须按领域严格路由避免浪费。
- qwen-audio 的 generic-acp 只能接 ACP harness，接不了 MCP server；MCP 工具集需走前端 MCP 或挂到某 harness 的 MCP（P1）。

## 后果

- **收益**：接入模型更清晰——ACP harness（protocol / command+args）与 MCP 工具集（mcp）分属两类，见 [harness-registry](../harness-registry.md)。
- **代价**：P1 需实现 MCP 工具集接入（前端 MCP / harness MCP）；财经能力暂不可用。
- **遗留**：用户本地 `hermes-investment` 仍在，但作为「财经 MCP 工具集」而非独立 agent。

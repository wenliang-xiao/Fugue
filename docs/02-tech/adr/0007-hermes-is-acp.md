# ADR-0007 Hermes 是 ACP harness（SSH 隧道接入），纠正 ADR-0006

- 状态：已采纳（supersede ADR-0006，恢复 ADR-0004 的接入方式）
- 日期：2026-10-12

## 背景

ADR-0006 误判"Hermes = 财经 MCP 工具集"（只看 hermes-investment 的 `mcp_akshare_server.py`）。经用户确认（选项 A）：**Hermes = NousResearch 的 hermes-agent（ACP harness，远端阿里云/腾讯云）**，与 opencode/pi 并列；hermes-investment 的财经 MCP 是 **Hermes Agent 自带的工具**（"只做财经、个人 TUSHARE_TOKEN、不要浪费"是 Hermes 的领域定位，不是接入方式）。

## 决策

**Hermes 通过 ACP harness 接入（远端 SSH 隧道），财经能力随 agent 自带，不单独接 MCP。**

- 接入：通用 `command + args` 即可实现 SSH 隧道 —— `command: "ssh"`, `args: ["<host>", "hermes", "acp", "--accept-hooks"]`（复用 qwen-audio 的 generic-acp driver，无需专用代码）。
- 领域路由：财经关键词 → hermes，Hermes Agent 用自己的财经 MCP 工具完成分析。
- ADR-0006 作废；ADR-0004 的 SSH 隧道方案恢复成立。

## 理由

- 用户最初将 Hermes 与 opencode、pi-agent 并列，说明它是 agent harness。
- `mcp_akshare_server.py` 注释明确"供 Hermes Agent 调用"——MCP 是 Hermes 的工具，不是 Hermes 本身。
- 通用 command+args 已能承载 SSH 隧道（generic-acp），无需专用 backend 代码。

## 后果

- **收益**：接入模型统一——Hermes 就是"任意 ACP harness（command+args）"的一个实例，SSH 只是它的启动命令。
- **代价**：远端依赖 SSH 连接稳定（断线重连待测）；财经 MCP 工具由 Hermes 自身管理，Fugue 不感知。
- **遗留**：ADR-0004/0006/0007 三份并存，以 0007 为准（0004 恢复、0006 作废）。

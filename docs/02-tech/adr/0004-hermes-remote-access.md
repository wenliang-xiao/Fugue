# ADR-0004 Hermes 远端接入：SSH 隧道透传 ACP

- 状态：已采纳（已验证 ✅）
- 日期：2026-10-10

## 背景

Hermes（NousResearch/hermes-agent）部署在阿里云/腾讯云，本地 Gateway 需要委派任务给它（REQ-007）。Hermes 走 ACP 协议，qwen-audio-agent 的上游 driver 是 `hermes acp --accept-hooks`（本地 stdio JSON-RPC）。

## 决策

**默认方案：SSH 隧道透传 stdio。本地 Gateway 以 `ssh <host> hermes acp --accept-hooks` 作为 backend 启动命令，把远端 Hermes 的 ACP stdio 透传到本地。**

## 理由

- ACP 是 stdio JSON-RPC，SSH 原生能透传 stdio，无需 Hermes 暴露额外网络端口。
- 复用上游 local-ACP driver，只需把 `command` 换成 `ssh`、`args` 换成远端命令，接入成本最低。
- 安全性沿用 SSH 已有的认证与加密。

## 后果

- **收益**：远端 harness 以"本地进程"形态接入，上游机制零改动。
- **代价**：依赖 SSH 连接稳定（断线需重连 + 任务恢复）；SSH 密钥管理；多台远端需多份配置。
- **风险/验证点**：
  1. Hermes 的 ACP 是否在 SSH 非交互 shell 下正常工作（PATH、环境变量、`--accept-hooks` 行为）——待实测。
  2. 断线重连时上游 Gateway 对 backend 进程退出/重启的处理（需用例覆盖）。
- **验证结果（2026-10-10）**：clone 分析 hermes-agent 源码确认，Hermes 的 ACP 为 **stdio-only**：`hermes acp` 的 help 是 "Run Hermes Agent as an ACP server (editor integration)"，参数仅 `--accept-hooks/--version/--check/--setup/--setup-browser/--yes`，无 `--listen/--http/--port`；`acp_adapter/entry.py` 注释明确 "stdout is reserved for ACP JSON-RPC"。**结论：远程 ACP/HTTP 备选不成立，SSH 隧道是唯一正解，本决策成立。**
- **备选**：
  - 远程 ACP/HTTP server 模式——**已验证不存在**，排除。
  - A2A adapter（Hermes 若支持 A2A 暴露）——Hermes 有 gateway 进程（自带 Telegram/Discord/Slack 等 IM 入口），但其 ACP 出口仍是 stdio，A2A 未见暴露，不优先。

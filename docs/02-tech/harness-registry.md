# Harness 注册表设计 — 配置驱动的通用接入

> 版本：v0.1
> 关联：[协调模型](coordination-model.md) · [架构](architecture.md) · ADR

---

## 1. 目标

Fugue 的核心能力之一：**用户只改配置文件，不改代码，就能接入任意 agent harness**。

- 本地 opencode / pi / hermes-investment 只是验证机制的**实验**；
- 真正的价值是「任何开发者都能把自己的 harness（Claude Code、Codex、dsh、自研 ACP agent……）接进来，按领域分工、统一协调」。

## 2. 接入类型（三类）

| 类型 | 形态 | 协议 | 举例 |
|------|------|------|------|
| **内置协议** | `protocol: pi/opencode/deepseek/...` | ACP | qwen-audio 原生支持的 harness |
| **任意 ACP** | `command` + `args` | ACP stdio | 任何支持 ACP 的 harness（`claude --acp`、自研 agent）|
| **MCP 工具集**（P1）| `mcp: {command, args}` | MCP | hermes-investment 财经工具、自定义工具集 |

> MCP 工具集不是 BackendPort（不实现 submit/status/cancel），接入方式不同（前端 MCP 或挂到某 harness 的 MCP），P1 再做。P0 先落地 ACP 两类。

## 3. 配置格式（config/harnesses.json）

```json
{
  "harnesses": [
    {
      "id": "pi",
      "label": "Pi · 工作主力",
      "protocol": "pi",
      "domains": ["工作", "周报", "文档"],
      "default": true
    },
    {
      "id": "opencode",
      "label": "OpenCode · 代码",
      "protocol": "opencode",
      "domains": ["写代码", "修bug", "重构"]
    },
    {
      "id": "my-agent",
      "label": "我的自定义 ACP agent",
      "command": "my-agent",
      "args": ["--acp"],
      "domains": ["调研", "长程"]
    }
  ]
}
```

字段：

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | ✅ | 路由标识（领域路由的 backendId）|
| `label` | ✅ | 显示名 |
| `protocol` / `command` | 二选一 | 内置协议 或 任意 ACP 命令 |
| `args` | 可选 | 任意 ACP 的启动参数 |
| `domains` | 可选 | 领域关键词，自动生成路由规则 |
| `default` | 可选 | 是否为默认路由目标（最多一个）|

## 4. 领域路由自动生成

每个 harness 的 `domains` 自动转成路由规则：

```js
// { domains: ["财经", "股票"] } → { backendId: "finance", match: { instruction: ["财经", "股票"] } }
```

优先级：显式指定（用户说"让 X 干"）> 领域规则（domains 按序）> 默认（default）。

## 5. 实现架构

```
config/harnesses.json ──► config.mjs loadHarnesses()
                              │
                              ├─► backends: [{id, protocol|command, args, label}]
                              └─► routing: {rules: [{backendId, match}], defaultBackend}
                                      │
launcher.mjs buildAgent() ───────────┤
                                      ▼
                    MultiBackendAdapter(backends, router)
```

- `harness-backend.mjs`：`createHarnessBackend(spec)` 按 `protocol` 或 `command+args` 创建 BackendPort。
- `config.mjs`：加载 JSON，生成 backends + routing rules。
- `launcher.mjs`：遍历 harnesses 动态创建，不再硬编码。

## 6. 分阶段

| 阶段 | 内容 |
|------|------|
| P0 | ACP 两类接入（protocol / command+args）+ 领域路由自动生成 |
| P1 | MCP 工具集接入（前端 MCP / harness MCP）+ 专家画像 |
| P2 | A2A 远程 agent + 语义路由（前台判断最适合的专家）|

## 7. 验收

- 用户改 `config/harnesses.json`，不碰代码，就能：加一个 harness、改领域分工、换默认主力。
- 任意 `command --acp` 的 harness 能接入并被路由到对应领域任务。
- 领域路由测试覆盖：`domains` → 规则生成 → 路由命中。

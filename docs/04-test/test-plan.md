# 测试计划 — Fugue

> 版本：v0.1
> 关联：[PRD](../01-prd/PRD.md) · [架构](../02-tech/architecture.md) · [评审规范](../03-review/review-guide.md)

---

## 1. 测试策略

遵循 TDD（红 → 绿 → 重构），测试以 spec 为准，所有用例可追溯到 REQ。

分层：

| 层 | 范围 | 工具 | 目标 |
|----|------|------|------|
| L1 单元测试 | 单模块（router、taskMap、SSH 命令构造等） | node:test | 逻辑正确、边界、幂等 |
| L2 适配器一致性 | MultiBackendAdapter 是否符合 BackendPort 契约 | 上游 `verifyBackendAdapterConformance` | 契约符合度 |
| L3 集成测试 | 飞书 client ↔ Gateway ↔ backend 端到端 | 冒烟脚本 + 真实/模拟 harness | 数据流、状态共享 |
| L4 验收测试 | 对应 PRD 成功指标 | 手工 + 自动化 | spec 被满足 |

## 2. 测试环境

- 本地：node 22+，qwen-audio-agent 依赖，本地 OpenCode/Pi（或模拟 ACP server）。
- 远端：阿里云/腾讯云 Hermes（或 SSH 到测试机）。
- 飞书：测试企业自建应用 + 沙箱群，避免污染正式群。

## 3. 通过标准（对应 PRD §8）

| 指标 | 通过标准 |
|------|---------|
| 双端无缝切换 | 飞书 ↔ 语音切换后，任务/会话状态 100% 一致（L3/L4） |
| 对话不阻塞 | 派活后 2s 内前台可继续对话（L3） |
| harness 可插拔 | 新 ACP harness 零代码接入（L2 + 文档） |
| 主动播报 | 任务完成 → 播报延迟 < 1s（L3） |
| 全双工打断 | 复用上游指标，不在本项目重复验证 |

## 4. 用例组织

- 用例文件：`cases/<模块>-<NNN>.md`
- 每条用例必含：`验证 REQ`、`对应模块`、`前置条件`、`步骤`、`期望结果`、`追溯`（对应 ADR/接口）。
- 已落示例：[cases/multi-backend-001.md](cases/multi-backend-001.md)

## 5. 回归与 CI

- 所有 L1/L2 纳入 CI，PR 门禁。
- L3 冒烟按需执行（依赖真实 harness/飞书，不做每次 PR 门禁）。
- 上游 qwen-audio-agent 升级后，跑 L2 一致性 + L3 冒烟。

## 6. 风险与覆盖缺口

| 风险 | 缺口 | 应对 |
|------|------|------|
| Hermes SSH 断线 | 难自动化 | 手工用例 + 断线重连场景标注 |
| 飞书平台回调不稳定 | 依赖外网 | 沙箱环境 + 超时重试用例 |
| 上游契约变化 | L2 依赖上游套件 | 锁定上游版本，升级时回归 |

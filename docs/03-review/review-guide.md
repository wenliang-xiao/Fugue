# 代码评审规范 — Fugue

> 版本：v0.1
> 关联：[AGENTS.md](../../AGENTS.md) · [PRD](../01-prd/PRD.md)

---

## 1. 评审的唯一标准：Spec 符合度

本项目的评审**第一优先**是判断"代码是否实现了 spec 承诺"，其次才是风格、健壮性、性能。评审者必须：

1. 先读对应 spec（PRD 的 REQ + Tech 的模块/ADR），明确"这段代码应该做什么"。
2. 再读代码，逐条核对 spec 承诺是否落地。
3. **Spec 与实现冲突 → 判不合格**，要求改实现或走变更流程（AGENTS.md §6），不允许"代码顺手实现了 spec 之外的东西"。

## 2. 评审维度与权重

| 维度 | 权重 | 说明 |
|------|------|------|
| Spec 符合度 | 高 | 是否完整、正确地实现了 PRD/Tech 承诺，无遗漏、无越界 |
| 正确性 | 高 | 边界条件、错误处理、并发/幂等（尤其 BackendPort 契约） |
| 可测试性 | 中 | 是否配了对应测试用例（TDD），用例可追溯到 REQ |
| 协议/接口契约 | 中 | 是否遵守 BackendPort / Gateway Client Protocol 的边界约束 |
| 可维护性 | 低 | 命名、结构、注释是否清晰 |

## 3. Checklist（逐条勾选）

### A. Spec 符合度

- [ ] 实现的每个功能都能对应到一个 REQ 编号，无"spec 之外"的功能。
- [ ] 没有遗漏 spec 承诺的行为（对照 PRD §4 / Tech 模块设计逐条）。
- [ ] 关键技术决策与对应 ADR 一致（尤其 MultiBackendAdapter 路由、双端分时、Hermes 接入方式）。

### B. 正确性

- [ ] 错误路径被处理（backend 断线、任务取消、权限拒绝、输入请求超时）。
- [ ] 幂等性：`start/close/submit/cancel` 重复调用行为符合 BackendPort 契约。
- [ ] 并发：多 backend 事件聚合无串扰，`taskMap` 生命周期正确（创建/清理）。

### C. 协议边界（本项目特有，重点）

- [ ] 原始协议对象（ACP session id、remote task id、token、凭证）不跨 BackendPort / Gateway 边界。
- [ ] 模型可见文本只含 canonical `instruction` + 附件，不含 Task 对象、owner、路径、ASR 原文等。
- [ ] 飞书 client 的 text_only 协商正确，未误声明音频能力。

### D. 可测试性

- [ ] 每个新增模块配了测试用例，用例标注 `验证 REQ` 与 `对应模块`。
- [ ] 关键路径有集成/冒烟测试（不只单测）。

### E. 安全

- [ ] 无硬编码凭据（SSH 密钥、飞书 app_secret、API key 一律走环境变量）。
- [ ] 权限确认链路完整（Pi 无审批属特例，已显式声明）。

## 4. 评审流程

```
作者自查（对照本 checklist）
   → 提交 PR，附 "REQ 对应表 + 自测结果"
   → 评审者按 §2 维度 + §3 checklist 评审
   → 意见 → 作者修订 → 复审
   → 合并（需 spec 符合度通过，不得带病合并）
```

## 5. 常见否决项（一票否决）

1. 实现了 spec 之外的功能，或遗漏了 spec 承诺的核心行为。
2. 违反 BackendPort / Gateway 协议边界（协议对象泄漏到模型文本）。
3. 硬编码凭据。
4. 无测试用例，或测试用例与 REQ 无追溯。
5. 技术方案与已合并 ADR 冲突且未走 ADR 变更流程。

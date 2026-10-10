# CONSTITUTION — Fugue 工程宪法

> 版本：v0.1
> 本文定义"**怎么做事**"。修改本文必须人类 ratify，AI 不得自批生效。
> 关联：[AGENTS.md](AGENTS.md) · [vibe-coding 规范](docs/vibe-coding.md)

## 权威与冲突裁决

本文约束本仓库的代码、协议、CI、工程文档与可追溯记录。

冲突时按问题域裁决：
- 治理 / 工程纪律 / 修宪 → 本文为准。
- 文档目录结构与归属 → [AGENTS.md](AGENTS.md) §5 为准。
- 架构口径 → [docs/02-tech/architecture.md](docs/02-tech/architecture.md) 与 Accepted ADR 为准。
- 术语叫法 → [docs/glossary.md](docs/glossary.md) 为准。

## 五条铁律

1. **可读 + 模块化**：代码与文档对人类和 AI 友好；任何模块的 README + 公开接口可被一次消化（≤ 8K tokens）。
2. **Spec 先行**：跨模块 API 先冻结协议再写实现；任何功能先落 PRD/Tech 再写代码。禁止边写边想。
3. **测试纪律**：核心模块强制单测；协议/适配器强制一致性套件；改动路径必有测试。
4. **决策落档**：架构 / 协议 / 依赖 / 安全决策的结论落 ADR，禁止 chat 即决策；Accepted ADR 不可改，只可 supersede。
5. **同步闭环**：实现、协议、文档不得长期漂移；文档增删改与代码同一个 commit；每个开发 session 结尾写一条 dev-log（宜短：结论 + 接力）。

## 破例机制（Break-Glass）

铁律默认必守，破例须显式：

| 级别 | 对象 | 要求 |
|------|------|------|
| Class 1 | 铁律 / 核心协议 / 安全语义 / 不可逆操作 | `BREAK-GLASS:` 标记 + ADR + `[human]`/`[reviewed]` 审批 + 限时偿还 |
| Class 2 | Spec 先行 / 测试纪律的局部 | `BREAK-GLASS:` 标记 + ADR 或 dev-log 落档 |
| Class 3 | 软性指引（文档风格等） | `BREAK-GLASS:` 标记 + commit 说明 |

**AI 不得单方面开 Class 1。**

## AI 协作纪律

- **Commit 前缀**：默认 AI 单做（无前缀）；`[human]`（纯人工/修宪/Class1 审批）、`[reviewed]`（AI 起草 + 人逐条 review）、`[draft]`（草案不入 main）必须显式。
- **五道验证门**（解释 / 依赖 / 测试 / RCA / 不可逆）是 review 硬卡点，见 [vibe-coding 规范](docs/vibe-coding.md) §2。
- **不可逆操作**（生产数据、git 历史、对外发布、危险命令）AI 永远只提案、不执行。
- 每个 AI session 结束写一条 [dev-log](docs/trace/dev-log/)，作为跨会话接力棒（对话会压缩，文件不会）。

## 语言

- 不可逆事项英文：代码标识符、commit、公共 API、协议字段、测试用例名。
- 仓内文档中文优先（思考精度优先）；对外门面文档（README）可中英双语，但不全程双语。
- 术语以 [docs/glossary.md](docs/glossary.md) 为唯一注册表，新术语先注册再用。

## 修改本文

AI 可起草修订，不得自批生效。修改必须人类 ratify，实质修订在 [docs/trace/ratify-log/](docs/trace/ratify-log/) 留过程记录。

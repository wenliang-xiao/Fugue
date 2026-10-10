# AGENTS.md — Spec-Driven Development 协作规范

本文件是 Fugue 项目的工作流定义，面向在此仓库协作的**人类开发者与 AI Agent**。它同时是本项目要开源的可执行工作流规范。

核心信条：**Spec 是唯一真相源，先写规格，再写代码。**

## 必读入口（开工前按序读）

1. [CONSTITUTION.md](CONSTITUTION.md) —— 五条铁律，不可协商。
2. [docs/02-tech/architecture.md](docs/02-tech/architecture.md) —— 权威架构。
3. [docs/glossary.md](docs/glossary.md) —— 术语唯一注册表，写作前先查。
4. [docs/trace/dev-log/](docs/trace/dev-log/) 最近 3 篇 —— 跨会话接力上下文。

---

## 1. 文档结构（四类文档，一个闭环）

```
docs/
├── 01-prd/            # 产品需求（Why / What）—— 需求的事实来源
├── 02-tech/           # 技术设计（How）—— 实现的事实来源
│   ├── adr/           #   架构决策记录（为什么这么选）
│   └── modules/       #   模块级设计（每个模块一份）
├── 03-review/         # 评审规范 —— 保证"实现符合 spec"
└── 04-test/           # 测试文档 —— 保证"spec 被验证"
```

四类文档的职责边界（**禁止越界**）：

| 文档 | 回答 | 不应包含 |
|------|------|---------|
| PRD | 要做什么、为谁、为什么 | 技术实现细节、代码结构 |
| Tech | 怎么做、模块怎么拆、接口是什么 | 产品愿景、营销话术 |
| Review | 怎么判断代码合格 | 具体业务需求 |
| Test | 怎么验证 spec 被满足 | 新的需求定义 |

---

## 2. 三条铁律

1. **Spec 是唯一真相源**。实现、评审、测试全部以 `docs/` 下的 spec 为准。代码与 spec 冲突 → 改代码；除非走 §6 变更流程，否则不改 spec。
2. **Spec 先行**。任何功能：先落 PRD（新需求）→ Tech（新设计）→ 再写代码。禁止边写边想、代码里藏着规格。
3. **可追溯**。每个需求、设计、测试用例都要能被互相找到：
   - PRD 的需求编号形如 `REQ-<NNN>`；
   - Tech 引用它实现的 `REQ`；
   - Test 用例标注它验证的 `REQ` 与对应模块。

> 铁律的执行纪律见 [docs/vibe-coding.md](docs/vibe-coding.md) 的**五道验证门**（解释 / 依赖 / 测试 / RCA / 不可逆）与**反模式表**，它们构成 review 的判断依据。

---

## 3. 开发流程（每个功能切片的标准路径）

```
① 写 PRD          需求澄清，编号 REQ-xxx
② 写/改 Tech      架构 + 模块设计 + ADR（若有决策）
③ 拆任务          纵向切片，标注 HITL/AFK
④ TDD 实现        red → green → refactor（先写测试）
⑤ 自审           对照 03-review 的 checklist 自查
⑥ 更新 Test       补充/修正测试用例，保持与 PRD/Tech 追溯
⑦ 提交            commit 关联 REQ 编号
```

**任何一步产出都必须落到 `docs/` 对应目录**，不允许只存在于对话里。

---

## 4. 各类文档的格式约定

### 4.1 PRD（docs/01-prd/）

必含章节：`背景与问题`、`目标用户`、`核心功能（按 P0/P1/P2 分级）`、`MVP 边界`、`非目标`、`成功指标`、`需求清单（REQ 编号）`。

- 每条核心功能必须有唯一 `REQ-<NNN>` 编号。
- 需求用可验证的语言写（"用户能 X"），不用模糊词（"更好地""更加"）。

### 4.2 Tech（docs/02-tech/）

- `architecture.md`：总体架构、模块边界、数据流、关键接口。
- `adr/NNNN-<标题>.md`：每个不可逆/重要决策一份，固定四段：`背景`、`决策`、`理由`、`后果（含代价与备选）`。ADR 一经合并不可修改，只可追加新 ADR 推翻。
- `modules/<模块>.md`：每个模块一份，含职责、对外接口、依赖、关键数据结构。

### 4.3 Review（docs/03-review/）

- 定义评审标准 + checklist + 评审流程。
- 评审的唯一标准是 **spec 符合度**（代码是否实现了 PRD/Tech 承诺），其次才是风格/健壮性。

### 4.4 Test（docs/04-test/）

- `test-plan.md`：测试策略、分层、环境、通过标准。
- `cases/<模块>-<NNN>.md`：每条用例标注 `验证 REQ` + `对应模块` + `前置` + `步骤` + `期望`。

---

## 5. 目录与命名约定

- 文档一律放 `docs/`，按上述四类分目录，禁止散落根目录。
- ADR 编号四位递增：`0001`、`0002`……
- 模块名用小写连字符：`multi-backend-adapter.md`。
- 需求编号：`REQ-001`、`REQ-002`……顺序递增，废弃的不复用。

---

## 6. 变更流程（spec 变更的唯一入口）

```
需求变化
   │
   ▼
① 先改 PRD（新增/修改 REQ，标注变更）
② 改 Tech（受影响模块 + 追加 ADR 说明为何变）
③ 改 Test（更新受影响用例）
④ 改代码（实现新 spec）
```

**禁止**：先改代码再补 spec。发现"spec 写错了"与"需求变了"是两回事——前者可当场修正并注明，后者必须走上述流程。

---

## 7. 提交规范

- commit message 用英文（本仓库约定，便于开源），格式：`<type>(<scope>): <summary>`，关联 `REQ-<NNN>`。
  - 例：`feat(multi-backend): add MultiBackendAdapter routing (REQ-005)`
  - type：`feat` / `fix` / `docs` / `refactor` / `test` / `chore`
- 只提交代码与 `docs/` 下的 spec，**禁止提交** `.pi/`、`.opencode/`、`.trellis/`、`.claude/` 等本地工具目录。

---

## 8. AI Agent 协作约定

1. 动手前按「必读入口」读 spec（宪法 → 架构 → 术语 → 近 3 篇 dev-log），确认当前状态。
2. 接到新需求，先判断是否需要走 §6 变更流程，再动手。
3. 完成实现后，主动更新对应 `docs/04-test/cases/` 与 review 自查记录。
4. 不确定的决策，写进 `docs/02-tech/adr/`，不要拍脑袋定。
5. 遵守 [docs/vibe-coding.md](docs/vibe-coding.md)：五道验证门是提交硬卡点；不可逆操作只提案不执行；同一问题连续 2 次修不动就停下来找根因。
6. **每个 session 结尾写一条 `docs/trace/dev-log/`**（宜短：结论 + 接力；对话会压缩，文件不会）。
7. 术语一律用 [docs/glossary.md](docs/glossary.md) 的登记叫法，新术语先注册再用。
8. 本文件本身也是 spec，修改它同样走 §6 变更流程。

# ADR-0008 全量迁移 TypeScript + vitest

- 状态：已采纳（用户拍板 2026-10-22，全量、不留历史债务）
- 日期：2026-10-22

## 背景

Fugue 现有 `src/`（9 个 `.mjs`）+ `test/`（6 个 `.mjs`）为纯 JS ESM，无类型。上游 `qwen-audio-agent` 无类型，`BackendPort` 契约靠 `verifyBackendAdapterConformance` 一致性套件隐式兜底。

durable-harness（本项目 durable 化设计的直接参考）为纯 TypeScript（679 个 `.ts`，`strict`，发布全量 `.d.ts`）。其核心设计——`ReplayPolicy`、`EffectRecord` 状态机、`Verdict`、`Settlement`、`World`/`Harness` 接口——**以类型为契约载体**；epoch / fence / superseded / retryOf 等位状态，无类型时写错的 bug 只在崩溃恢复那一刻才暴露（最难测的场景）。

## 决策

**Fugue 全量迁移 TypeScript（src + test 一次切完，不留混合状态），测试运行器从 `node --test` 切换到 vitest。** 引入 `tsconfig.json`（对齐 durable-harness 的 `strict` + `ES2023` + `moduleResolution: Bundler`）。上游 `qwen-audio-agent` 无类型，手写最小 `.d.ts` 声明（`BackendPort`、`createGatewayApplication` 等），把 BackendPort 契约从"一致性套件兜底"升级为"类型冻结 + 一致性套件双保险"。

## 理由

- durable-harness 的机制（intent/outcome、effect sandwich、replay policy、anchor、epoch fencing）是 Fugue durable 化要引入的同一套机制，同语言同类型体系直接对齐，借鉴成本最低。
- 类型即契约：`BackendPort` 现在靠 conformance 套件保证，运行时才能发现契约破坏；`.d.ts` 声明把契约前移到编译期，与宪法「跨模块 API 先冻结协议」一致。
- 迁移量小（15 个文件），`"type": "module"` + Node>=22 已就位，时机在核心模块重写（durable 化）之前，避免二次迁移。
- vitest 与 durable-harness 对齐，TS 一等支持，断言/覆盖率体验优于 `node --test`。

## 后果

- **收益**：编译期契约；durable 化机制可移植到类型体系；`.d.ts` 冻结 BackendPort 协议。
- **代价**：需手写上游 `.d.ts`（一次性，约 BackendPort 全接口 + 组装函数）；测试运行器迁移（`node --test` 断言 → vitest，机械改动）。
- **范围**：`src/**/*.mjs → .ts`、`test/**/*.test.mjs → .test.ts`、新增 `tsconfig.json` + `vitest.config.ts`；`src/types/qwen-audio-agent.d.ts` 冻结上游契约。
- **备选**：保持 JS + 手写 JSDoc 类型注解（类型能力弱、与 durable-harness 不对齐）；渐进迁移（留混合状态，违背"不留历史债务"的拍板）。

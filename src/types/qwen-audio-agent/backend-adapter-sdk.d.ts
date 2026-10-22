// qwen-audio-agent `backend-adapter-sdk` 的类型声明（上游无类型，按 BackendPort 契约冻结）。
// 依据：node_modules/qwen-audio-agent/server/src/backend/{backend-port,backend-adapter-sdk,backend-events}.mjs
// 契约来源与范围见 docs/02-tech/adr/0008-typescript-adoption.md。

/** 委派任务：Gateway 下发的结构化 Task。路由/关联字段在 adapter 内部使用，不进入模型可见文本。 */
export interface BackendTask {
  id?: string
  ownerId?: string
  /** canonical instruction；adapter 兼容 instruction / objective / message 任一字段。 */
  instruction?: string
  objective?: string
  message?: string
  taskType?: string
  /** 显式路由：routing.backendId 优先级最高。 */
  routing?: { backendId?: string }
  /** Gateway 信任的 hint：'shared'（默认）| 'isolated'，非模型可控。 */
  continuity?: 'shared' | 'isolated'
  [key: string]: unknown
}

/** 协议无关的 backend 事件（ACP/A2A/custom 归一化后）。原始协议对象不得跨边界。 */
export interface BackendEvent {
  type: string
  taskId?: string
  ownerId?: string
  [key: string]: unknown
}

/** BackendPort：Gateway 与单个 backend 之间的协议无关边界。 */
export interface BackendPort {
  describe(): Record<string, unknown>
  start(context?: unknown): Promise<unknown>
  health(): Promise<unknown>
  submit(task: BackendTask, context?: unknown): Promise<unknown>
  status(taskId?: string, context?: unknown): unknown
  cancel(taskId: string, context?: unknown): Promise<unknown>
  respondAuthorization(
    taskId: string,
    authorizationId: string,
    decision: string,
    context?: unknown,
  ): Promise<unknown>
  respondInput(
    taskId: string,
    inputRequestId: string,
    response?: unknown,
    context?: unknown,
  ): Promise<unknown>
  subscribe(listener: (event: BackendEvent) => void): () => void
  close(): Promise<void>
  /** 可选：delegated Task 恢复能力。 */
  canRecoverDelegatedWork?(task: BackendTask): boolean
  recoverDelegatedWork?(task: BackendTask, context?: unknown): Promise<unknown>
  uiUrl?(context?: unknown): Promise<string | null>
}

/** 归一化 backend 事件类型（backend-events.mjs）。 */
export const BackendEventType: Readonly<Record<string, string>>
export function backendEvent(
  type: string,
  details?: Record<string, unknown>,
): BackendEvent

/** 组合期校验 BackendPort 契约，返回原 adapter。 */
export function defineBackendAdapter<T extends BackendPort>(
  adapter: T,
  options?: { name?: string },
): T

/** 为 createGatewayApplication 提供的最小 application-host 表面。 */
export function createBackendAgentHost(
  adapter: BackendPort,
  options?: { name?: string },
): Record<string, unknown>

export interface ConformanceFixture {
  backend: BackendPort
  work: BackendTask
  nextWork: BackendTask
  started?: Promise<unknown>
  internals?: Record<string, unknown>
}

export function verifyBackendAdapterConformance(options: {
  createFixture: (context: { hold: boolean }) => ConformanceFixture | Promise<ConformanceFixture>
}): Promise<void>

export const BACKEND_ADAPTER_SDK_VERSION: string
export const BACKEND_PORT_METHODS: readonly string[]
export function assertBackendPort<T extends BackendPort>(
  value: T,
  options?: { name?: string },
): T
export class BackendPortContractError extends TypeError {
  code: string
  missing: string[]
}

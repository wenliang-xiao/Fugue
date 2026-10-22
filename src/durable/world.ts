// TaskWorld：Fugue durable 层的三合一抽象（Storage + Queue + Streamer）。
// 借鉴 durable-harness 的 World 接口，裁剪为「任务级」。
// 换实现（本地内存 / 文件 / Postgres / Redis）不改上层代码。
// 对应 durable-design.md §3、ADR-0009。

/** 任务事件日志里的一条事件。 */
export interface TaskEvent {
  /** 事件类型：task_submitted / task_accepted / task_progress / task_completed / task_failed / task_cancelled */
  type: string
  /** 关联的 step id（intent/outcome 两段式共用同一个 correlationId） */
  correlationId?: string
  /** 事件负载 */
  data?: unknown
  /** 服务端时间戳（ms） */
  at: number
}

/** 一个 active run 的摘要（recover 用）。 */
export interface ActiveRun {
  runId: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
}

/**
 * TaskWorld：durable agent 的全部需求。
 * - Storage：任务事件日志（唯一真相源）
 * - Queue：崩溃重投递（backstop）
 * - Streamer：实时事件流（进度/播报）
 */
export interface TaskWorld {
  // ---------- Storage ----------
  /** 追加一条事件到 run 的日志。 */
  append(runId: string, event: TaskEvent): Promise<void>
  /** 读 run 的事件（从 after offset 之后开始，增量）。返回新 offset。 */
  read(runId: string, after?: number): Promise<{ events: TaskEvent[]; offset: number }>
  /** 列出所有 pending/running 的 run（进程重启后 recover）。 */
  listActiveRuns(): Promise<ActiveRun[]>
  /** 设置 run 状态。 */
  setRunStatus(runId: string, status: ActiveRun['status']): Promise<void>

  // ---------- Queue ----------
  /** 发送一条 backstop 消息（run 背后的队列消息，进程死 → 重投递）。 */
  send(runId: string, payload?: unknown): Promise<void>
  /** 注册消息处理器（重投递时调用）。返回 unsubscribe。 */
  onMessage(handler: (runId: string, payload?: unknown) => Promise<void>): () => void

  // ---------- Streamer ----------
  /** 发布实时事件到 run 的流。 */
  publish(runId: string, event: unknown): void
  /** 订阅 run 的实时事件流。返回 unsubscribe。 */
  subscribe(runId: string, listener: (event: unknown) => void): () => void
  /** 订阅所有 run 的实时事件（全局观察，如实时打印打点）。返回 unsubscribe。 */
  subscribeAll(listener: (runId: string, event: unknown) => void): () => void
}

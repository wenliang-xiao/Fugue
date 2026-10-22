// qwen-audio-agent `gateway-client-sdk` 类型声明（上游无类型）。
// 依据：node_modules/qwen-audio-agent/shared/gateway/client-sdk.mjs

export interface GatewayClientOptions {
  url: string
  createSocket: (url: string, opts?: Record<string, unknown>) => unknown
  clientType?: string
  clientVersion?: string
  clientInstanceId?: string
  clientLabel?: string
  accessToken?: string
  takeover?: boolean
  capabilities?: unknown[]
  tools?: unknown[]
  locale?: string
  timeZone?: string
  configure?: () => Record<string, unknown>
  reconnect?: boolean
  reconnectMinMs?: number
  reconnectMaxMs?: number
  requestTimeoutMs?: number
  connectTimeoutMs?: number
  handshakeTimeoutMs?: number
  onEvent?: (event: Record<string, unknown>) => void
  onStatus?: (status: unknown) => void
  onAction?: (action: unknown) => void
  onRecovery?: (recovery: unknown) => void
}

export class GatewayClient {
  constructor(options: GatewayClientOptions)
  ready: boolean
  stopped: boolean
  start(): this
  stop(): void
  send(event: Record<string, unknown>): unknown
  request(type: string, payload: Record<string, unknown>): Promise<unknown>
}

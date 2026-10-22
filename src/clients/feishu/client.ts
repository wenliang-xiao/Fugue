// 飞书 client：飞书消息 ↔ Gateway（text_only）的桥接核心。
// 依赖注入 connection（飞书长连接）与 gatewayFactory（GatewayClient 工厂），便于单测。
// 对应 REQ-002、REQ-003。
import WebSocket from 'ws'
import { GatewayClient } from 'qwen-audio-agent/gateway-client-sdk'
import { gatewayReferenceClientCapabilities } from 'qwen-audio-agent/gateway-client-profiles'
import { GatewayClientProtocolEvent } from 'qwen-audio-agent/gateway-client-protocol'
import { feishuTextToGatewayInput, gatewayEventToFeishu } from './message-bridge'

export function gatewayWebSocketUrl(baseUrl: string, sessionId: string): string {
  const url = new URL('/api/realtime', String(baseUrl || '').replace(/\/+$/, ''))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('sessionId', sessionId)
  return url.toString()
}

const APPROVE_RE = /同意|允许|可以|approve|accept|yes/i
const REJECT_RE = /拒绝|不行|不可以|deny|reject|no/i

export interface LarkConnection {
  connect(): Promise<unknown>
  onMessage(handler: (msg: Record<string, unknown>) => void): void
  onError(handler: (err: unknown) => void): void
  sendText(to: string, text: string): Promise<unknown>
  sendMarkdown(to: string, md: string): Promise<unknown>
}

export interface FeishuClientOptions {
  gatewayUrl: string
  connection: LarkConnection
  accessToken?: string
  sessionId?: string
  takeover?: boolean
  locale?: string
  timeZone?: string
  gatewayFactory?: () => GatewayClient
}

export class FeishuClient {
  readonly gatewayUrl: string
  readonly connection: LarkConnection
  readonly accessToken: string
  readonly sessionId: string
  readonly takeover: boolean
  readonly locale: string
  readonly timeZone: string
  readonly gatewayFactory?: () => GatewayClient
  gateway: GatewayClient | null = null
  chatId: string | null = null
  pendingPermission: { permissionId: string; taskId?: string } | null = null
  startedResponses = new Set<string>()
  onStatus?: (status: unknown) => void
  onError?: (err: unknown) => void

  constructor(options: FeishuClientOptions) {
    const {
      gatewayUrl,
      connection,
      accessToken = '',
      sessionId = 'feishu',
      takeover = false,
      locale = 'zh-CN',
      timeZone = 'Asia/Shanghai',
      gatewayFactory,
    } = options
    if (!gatewayUrl) throw new TypeError('gatewayUrl is required')
    if (!connection) throw new TypeError('connection is required')
    this.gatewayUrl = gatewayUrl
    this.connection = connection
    this.accessToken = accessToken
    this.sessionId = sessionId
    this.takeover = takeover
    this.locale = locale
    this.timeZone = timeZone
    this.gatewayFactory = gatewayFactory
  }

  async start(): Promise<void> {
    this.gateway = this.gatewayFactory
      ? this.gatewayFactory()
      : new GatewayClient({
        url: gatewayWebSocketUrl(this.gatewayUrl, this.sessionId),
        createSocket: (url, opts = {}) => new WebSocket(url, { headers: opts.headers as Record<string, string> }),
        accessToken: this.accessToken,
        takeover: this.takeover,
        clientType: 'feishu',
        clientLabel: 'Feishu',
        clientInstanceId: `feishu-${this.sessionId}`,
        capabilities: gatewayReferenceClientCapabilities('cli'),
        reconnect: true,
        configure: () => ({
          voiceEnabled: true, // 启用输出通道以接收任务播报转写
          textOnly: true,
          timeZone: this.timeZone,
          locale: this.locale,
        }),
        onStatus: status => this.onStatus?.(status),
        onEvent: event => {
          this.handleGatewayEvent(event).catch(() => {})
        },
      })
    this.connection.onMessage(msg => {
      this.handleFeishuMessage(msg).catch(() => {})
    })
    this.connection.onError(err => this.onError?.(err))
    this.gateway.start()
    await this.connection.connect()
  }

  async stop(): Promise<void> {
    this.gateway?.stop()
  }

  async handleFeishuMessage(msg: Record<string, unknown> = {}): Promise<void> {
    if (msg.rawContentType && msg.rawContentType !== 'text') return
    this.chatId = String(msg.chatId || this.chatId || '')
    const content = String(msg.content || '').trim()
    if (!content) return

    // 权限确认：有待决授权请求且用户回复同意/拒绝
    if (this.pendingPermission && (APPROVE_RE.test(content) || REJECT_RE.test(content))) {
      await this.#respondPermission(content)
      return
    }

    const input = feishuTextToGatewayInput(content)
    if (input && this.gateway?.ready) this.gateway.send(input)
  }

  async handleGatewayEvent(event: Record<string, unknown> = {}): Promise<void> {
    // text_only client 需回执 playback，Gateway 才下发文本转写（transcript）
    if (event.type === 'audio.delta') {
      const responseId = String(event.responseId || '')
      if (responseId && !this.startedResponses.has(responseId)) {
        this.startedResponses.add(responseId)
        this.gateway?.send({ type: 'playback.started', responseId })
      }
      return
    }
    if (event.type === 'audio.done') {
      const responseId = String(event.responseId || '')
      if (responseId && this.startedResponses.has(responseId)) {
        this.startedResponses.delete(responseId)
        this.gateway?.send({ type: 'playback.ended', responseId })
      }
      return
    }
    if (event.type === 'task.permission.requested') {
      const task = (event.task || {}) as Record<string, unknown>
      const auth = (task.authorization || event.permission || {}) as Record<string, unknown>
      if (auth?.id) {
        this.pendingPermission = { permissionId: String(auth.id), taskId: String(task.id || '') || undefined }
      }
    }
    const out = gatewayEventToFeishu(event as never)
    if (out && this.chatId) {
      await this.connection.sendText(this.chatId, out.text)
    }
  }

  async #respondPermission(content: string): Promise<void> {
    const decision = APPROVE_RE.test(content) ? 'task' : 'reject'
    const { permissionId } = this.pendingPermission!
    this.pendingPermission = null
    if (this.gateway?.ready) {
      await this.gateway.request(GatewayClientProtocolEvent.PERMISSION_RESPOND, {
        permission_id: permissionId,
        decision,
      })
    }
  }
}

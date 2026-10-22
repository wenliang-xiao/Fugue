// qwen-audio-agent `gateway-application` 类型声明（上游无类型）。
// 依据：node_modules/qwen-audio-agent/server/src/app/gateway-application.mjs

export interface GatewayApplicationOptions {
  agent?: unknown
  spawnThinkingDescription?: string
  config?: unknown
  [key: string]: unknown
}

export interface GatewayApplication {
  close(): Promise<unknown>
  [key: string]: unknown
}

export function createGatewayApplication(
  options?: GatewayApplicationOptions,
): GatewayApplication

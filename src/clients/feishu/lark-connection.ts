// 飞书长连接封装：薄薄包一层 SDK 的 createLarkChannel，屏蔽 SDK 细节。
// 依赖 @larksuiteoapi/node-sdk。对应 REQ-002。
import { createLarkChannel } from '@larksuiteoapi/node-sdk'
import type { LarkConnection } from './client'

export interface LarkConnectionOptions {
  appId: string
  appSecret: string
}

export function createLarkConnection(options: LarkConnectionOptions = { appId: '', appSecret: '' }): LarkConnection {
  const { appId, appSecret } = options
  if (!appId || !appSecret) {
    throw new TypeError('createLarkConnection requires appId and appSecret')
  }
  const channel = createLarkChannel({
    appId,
    appSecret,
    transport: 'websocket',
  })
  return {
    connect: () => channel.connect(),
    onMessage: handler => channel.on('message', handler as never),
    onError: handler => channel.on('error', handler as never),
    sendText: (to, text) => channel.send(to, { text }),
    sendMarkdown: (to, md) => channel.send(to, { markdown: md }),
  }
}

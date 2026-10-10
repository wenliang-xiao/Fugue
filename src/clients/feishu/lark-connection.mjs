// 飞书长连接封装：薄薄包一层 SDK 的 createLarkChannel，屏蔽 SDK 细节。
// 依赖 @larksuiteoapi/node-sdk。对应 REQ-002。
import { createLarkChannel } from '@larksuiteoapi/node-sdk'

/**
 * @param {object} options
 * @param {string} options.appId 飞书应用 App ID
 * @param {string} options.appSecret 飞书应用 App Secret
 * @returns 连接句柄 { connect, onMessage, onError, sendText, sendMarkdown }
 */
export function createLarkConnection({ appId, appSecret } = {}) {
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
    onMessage: handler => channel.on('message', handler),
    onError: handler => channel.on('error', handler),
    sendText: (to, text) => channel.send(to, { text }),
    sendMarkdown: (to, md) => channel.send(to, { markdown: md }),
  }
}

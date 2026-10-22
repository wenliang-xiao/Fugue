// 消息桥接：飞书消息 ↔ Gateway 事件的纯逻辑转换。
// 不依赖飞书 SDK 与 Gateway 连接，可独立单测。
// 对应 REQ-002。

function clean(value: unknown): string {
  return String(value || '').trim()
}

/** 飞书文本消息 → Gateway 输入事件 */
export function feishuTextToGatewayInput(
  text: string,
): { type: string; text: string; textOnly: boolean } | null {
  const value = clean(text)
  if (!value) return null
  return { type: 'input.message', text: value, textOnly: true }
}

export interface FeishuEvent {
  type: string
  role?: string
  content?: string
  message?: string
  task?: {
    id?: string
    objective?: string
    result?: string
    error?: string
    authorization?: { id?: string; summary?: string; operation?: { title?: string } }
    inputRequest?: { id?: string; prompt?: string; mode?: string }
  }
  permission?: { id?: string; summary?: string; operation?: { title?: string } }
}

/** Gateway 事件 → 飞书文本消息（返回 null 表示不发） */
export function gatewayEventToFeishu(event: FeishuEvent = { type: '' }): { text: string } | null {
  switch (event.type) {
    case 'transcript.final':
      if (event.role === 'assistant' && clean(event.content)) {
        return { text: event.content! }
      }
      return null

    case 'task.accepted':
    case 'task.scheduled':
    case 'task.running':
    case 'task.delegated':
    case 'task.finalizing':
      return { text: `⏳ 已开始处理：${objective(event)}` }

    case 'task.completed':
      return { text: `✅ 任务完成：${objective(event)}${resultLine(event)}` }

    case 'task.failed':
      return { text: `❌ 任务失败：${objective(event)}${errorLine(event)}` }

    case 'task.cancelled':
      return { text: `已取消任务：${objective(event)}` }

    case 'task.permission.requested':
      return { text: `🔐 需要授权：${permissionSummary(event)}\n回复「同意」或「拒绝」` }

    case 'task.input.requested':
      return { text: `❓ 需要补充：${inputPrompt(event)}` }

    case 'error':
      return { text: `⚠️ ${clean(event.message) || '出错了'}` }

    default:
      return null
  }
}

function objective(event: FeishuEvent): string {
  return clean(event.task?.objective) || '(未命名任务)'
}

function resultLine(event: FeishuEvent): string {
  const result = clean(event.task?.result)
  return result ? `\n${result}` : ''
}

function errorLine(event: FeishuEvent): string {
  const error = clean(event.task?.error)
  return error ? `\n原因：${error}` : ''
}

function permissionSummary(event: FeishuEvent): string {
  const auth = event.task?.authorization || event.permission
  return clean(auth?.summary) || clean(auth?.operation?.title) || '(需要确认操作)'
}

function inputPrompt(event: FeishuEvent): string {
  return clean(event.task?.inputRequest?.prompt) || '(请补充信息)'
}

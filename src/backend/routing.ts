// 路由：显式 routing.backendId > 前台指定（"交给 XX"）> 关键词规则 > 默认 backend
// 对应 ADR-0002、REQ-005。纯函数，无副作用。

/** 路由输入：Gateway 下发的 task（路由只读 instruction/objective/message/taskType/routing）。 */
export interface RouteInput {
  routing?: { backendId?: string }
  instruction?: string
  objective?: string
  message?: string
  taskType?: string
}

/** 专家名映射：用于解析 objective 里的"交给 XX"。 */
export interface ExpertSpec {
  label?: string
  aliases?: string[]
}

export interface RouteRule {
  backendId: string
  match: {
    instruction?: string | string[] | RegExp
    taskType?: string
  }
}

export interface RouterOptions {
  defaultBackend?: string
  rules?: RouteRule[]
  experts?: Record<string, ExpertSpec>
}

export type Router = (task: RouteInput) => string

export function createRouter(options: RouterOptions = {}): Router {
  const { defaultBackend = '', rules = [], experts = {} } = options
  return function route(task: RouteInput): string {
    const explicit = task?.routing?.backendId
    if (explicit) return String(explicit)
    const named = matchExpert(taskInstruction(task), experts)
    if (named) return named
    for (const rule of rules) {
      if (matchRule(rule, task)) return String(rule.backendId)
    }
    return String(defaultBackend || '')
  }
}

/** 解析 objective 里的"交给 XX"或"让 XX"，匹配专家 id/label/别名 */
function matchExpert(instruction: string, experts: Record<string, ExpertSpec>): string | null {
  if (!experts || Object.keys(experts).length === 0) return null
  const m = instruction.match(/交给\s*([A-Za-z][A-Za-z0-9]*)/i)
    || instruction.match(/让\s*([A-Za-z][A-Za-z0-9]*)/i)
  if (!m) return null
  const name = m[1].toLowerCase()
  for (const [id, expert] of Object.entries(experts)) {
    if (name === id.toLowerCase()) return id
    if (name === String(expert?.label || '').toLowerCase()) return id
    if ((expert?.aliases || []).some(a => String(a).toLowerCase() === name)) return id
  }
  return null
}

function matchRule(rule: RouteRule, task: RouteInput): boolean {
  const match = rule?.match || {}
  if (match.instruction != null && matchesText(match.instruction, taskInstruction(task))) {
    return true
  }
  if (match.taskType != null && task?.taskType === match.taskType) {
    return true
  }
  return false
}

function taskInstruction(task: RouteInput): string {
  return String(task?.instruction || task?.objective || task?.message || '')
}

function matchesText(pattern: string | string[] | RegExp, text: string): boolean {
  if (pattern instanceof RegExp) return pattern.test(text)
  if (Array.isArray(pattern)) return pattern.some(p => matchesText(p, text))
  return text.includes(String(pattern))
}

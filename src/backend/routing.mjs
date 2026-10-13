// 路由：显式 routing.backendId > 前台指定（"交给 XX"）> 关键词规则 > 默认 backend
// 对应 ADR-0002、REQ-005。纯函数，无副作用。

/**
 * @param {object} options
 * @param {string} [options.defaultBackend] 默认 backend id
 * @param {Array<{backendId: string, match: object}>} [options.rules] 规则列表（按序命中第一条）
 * @param {Record<string, {label?: string, aliases?: string[]}>} [options.experts] 专家名映射，用于解析 objective 里的"交给 XX"
 * @returns {(task: object) => string} 路由函数，返回 backend id
 */
export function createRouter({ defaultBackend = '', rules = [], experts = {} } = {}) {
  return function route(task) {
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
function matchExpert(instruction, experts) {
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

function matchRule(rule, task) {
  const match = rule?.match || {}
  if (match.instruction != null && matchesText(match.instruction, taskInstruction(task))) {
    return true
  }
  if (match.taskType != null && task?.taskType === match.taskType) {
    return true
  }
  return false
}

function taskInstruction(task) {
  return String(task?.instruction || task?.objective || task?.message || '')
}

function matchesText(pattern, text) {
  if (pattern instanceof RegExp) return pattern.test(text)
  if (Array.isArray(pattern)) return pattern.some(p => matchesText(p, text))
  return text.includes(String(pattern))
}

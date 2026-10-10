// 路由：显式指定 > 规则匹配 > 默认 backend
// 对应 ADR-0002、REQ-005。纯函数，无副作用。

/**
 * @param {object} options
 * @param {string} [options.defaultBackend] 默认 backend id
 * @param {Array<{backendId: string, match: object}>} [options.rules] 规则列表（按序命中第一条）
 * @returns {(task: object) => string} 路由函数，返回 backend id
 */
export function createRouter({ defaultBackend = '', rules = [] } = {}) {
  return function route(task) {
    const explicit = task?.routing?.backendId
    if (explicit) return String(explicit)
    for (const rule of rules) {
      if (matchRule(rule, task)) return String(rule.backendId)
    }
    return String(defaultBackend || '')
  }
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

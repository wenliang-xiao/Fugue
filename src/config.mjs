// Fugue 配置加载：配置驱动的多 harness 接入 + 领域路由 + 飞书入口。
// 核心：config/harnesses.json 定义任意 harness（内置协议 / 任意 ACP / MCP），
// 领域路由按 domains 自动生成。见 docs/02-tech/harness-registry.md。
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

function truthy(value) {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value).trim().toLowerCase())
}

function loadEnvFile() {
  const file = resolve(process.cwd(), 'config', 'config.env')
  if (!existsSync(file)) return {}
  const merged = {}
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m) merged[m[1]] = m[2].trim()
  }
  return merged
}

/** 加载 config/harnesses.json；不存在或无内容返回 null */
export function loadHarnesses(file) {
  const path = file || resolve(process.cwd(), 'config', 'harnesses.json')
  if (!existsSync(path)) return null
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    return Array.isArray(data?.harnesses) && data.harnesses.length ? data : null
  } catch {
    return null
  }
}

/**
 * 从 harnesses 配置生成 backends + 路由规则。
 * @param {{harnesses: Array}} raw
 * @returns {{backends: object, rules: Array, defaultBackend: string}}
 */
export function buildHarnessConfig(raw) {
  const harnesses = raw?.harnesses || []
  const backends = {}
  const rules = []
  let defaultBackend = ''
  for (const h of harnesses) {
    if (!h?.id) continue
    if (h.protocol) {
      backends[h.id] = { protocol: h.protocol, label: h.label || h.id }
    } else if (h.command) {
      backends[h.id] = {
        command: h.command,
        args: Array.isArray(h.args) ? h.args : [],
        label: h.label || h.id,
      }
    }
    // mcp 类型（P1）：不作为 BackendPort backend，但保留 domains 规则
    if (h.default) defaultBackend = h.id
    if (Array.isArray(h.domains) && h.domains.length) {
      rules.push({ backendId: h.id, match: { instruction: h.domains } })
    }
  }
  return { backends, rules, defaultBackend }
}

export function loadConfig(env = process.env) {
  const fileEnv = loadEnvFile()
  const merged = { ...fileEnv, ...env }

  const harnesses = loadHarnesses()
  let backends
  let rules
  let defaultBackend
  if (harnesses) {
    const hc = buildHarnessConfig(harnesses)
    backends = hc.backends
    rules = hc.rules
    defaultBackend = hc.defaultBackend || Object.keys(hc.backends)[0] || 'pi'
  } else {
    // 无 harnesses.json 时的兜底：本地实验默认（pi + opencode）
    backends = {
      pi: { protocol: 'pi', label: 'Pi · 工作主力' },
      opencode: { protocol: 'opencode', label: 'OpenCode · 代码' },
    }
    rules = []
    defaultBackend = String(merged.AGENT_CONDUCTOR_DEFAULT_BACKEND || 'pi').trim()
  }

  return {
    gatewayUrl: String(merged.AGENT_CONDUCTOR_GATEWAY_URL || 'http://127.0.0.1:3101').replace(/\/+$/, ''),
    backends,
    routing: { defaultBackend, rules },
    feishu: {
      enabled: truthy(merged.AGENT_CONDUCTOR_FEISHU_ENABLED),
      appId: String(merged.AGENT_CONDUCTOR_FEISHU_APP_ID || '').trim(),
      appSecret: String(merged.AGENT_CONDUCTOR_FEISHU_APP_SECRET || '').trim(),
    },
  }
}

// fugue 配置加载：多 harness 编排 + 飞书入口。
// 复用 qwen-audio-agent 的 config.env 管理语音前端（DASHSCOPE_API_KEY 等），
// 本配置只负责"多 backend + 路由 + 飞书"这一层。
// 配置来源：环境变量 > config/config.env（本地，不提交）。
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

function backendEnabled(id, env) {
  const key = `AGENT_CONDUCTOR_BACKEND_${id.toUpperCase()}`
  if (env[key] === undefined) return id === 'opencode' // 默认只开 opencode，其余显式开启
  return truthy(env[key])
}

export function loadConfig(env = process.env) {
  const fileEnv = loadEnvFile()
  // 环境变量优先，config/config.env 兜底
  const merged = { ...fileEnv, ...env }
  const hermesHost = String(merged.AGENT_CONDUCTOR_HERMES_SSH_HOST || '').trim()
  const feishuEnabled = truthy(merged.AGENT_CONDUCTOR_FEISHU_ENABLED)

  return {
    gatewayUrl: String(merged.AGENT_CONDUCTOR_GATEWAY_URL || 'http://127.0.0.1:3101').replace(/\/+$/, ''),
    backends: {
      opencode: { enabled: backendEnabled('opencode', merged), protocol: 'opencode' },
      pi: { enabled: backendEnabled('pi', merged), protocol: 'pi' },
      hermes: { enabled: backendEnabled('hermes', merged) && Boolean(hermesHost), host: hermesHost },
    },
    routing: {
      defaultBackend: String(merged.AGENT_CONDUCTOR_DEFAULT_BACKEND || 'opencode').trim(),
    },
    feishu: {
      enabled: feishuEnabled,
      appId: String(merged.AGENT_CONDUCTOR_FEISHU_APP_ID || '').trim(),
      appSecret: String(merged.AGENT_CONDUCTOR_FEISHU_APP_SECRET || '').trim(),
    },
  }
}

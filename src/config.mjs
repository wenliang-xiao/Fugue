// fugue 配置加载：多 harness 编排 + 飞书入口。
// 复用 qwen-audio-agent 的 config.env 管理语音前端（DASHSCOPE_API_KEY 等），
// 本配置只负责"多 backend + 路由 + 飞书"这一层。

function truthy(value) {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value).trim().toLowerCase())
}

function backendEnabled(id, env) {
  const key = `AGENT_CONDUCTOR_BACKEND_${id.toUpperCase()}`
  if (env[key] === undefined) return id === 'opencode' // 默认只开 opencode，其余显式开启
  return truthy(env[key])
}

export function loadConfig(env = process.env) {
  const hermesHost = String(env.AGENT_CONDUCTOR_HERMES_SSH_HOST || '').trim()
  const feishuEnabled = truthy(env.AGENT_CONDUCTOR_FEISHU_ENABLED)

  return {
    gatewayUrl: String(env.AGENT_CONDUCTOR_GATEWAY_URL || 'http://127.0.0.1:3101').replace(/\/+$/, ''),
    backends: {
      opencode: { enabled: backendEnabled('opencode', env), protocol: 'opencode' },
      pi: { enabled: backendEnabled('pi', env), protocol: 'pi' },
      hermes: { enabled: backendEnabled('hermes', env) && Boolean(hermesHost), host: hermesHost },
    },
    routing: {
      defaultBackend: String(env.AGENT_CONDUCTOR_DEFAULT_BACKEND || 'opencode').trim(),
    },
    feishu: {
      enabled: feishuEnabled,
      appId: String(env.AGENT_CONDUCTOR_FEISHU_APP_ID || '').trim(),
      appSecret: String(env.AGENT_CONDUCTOR_FEISHU_APP_SECRET || '').trim(),
    },
  }
}

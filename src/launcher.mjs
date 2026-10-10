// Fugue 启动入口：组装 MultiBackendAdapter + Gateway + 飞书 client。
// 对应 REQ-002/003/004/005/007。
import { createGatewayApplication } from 'qwen-audio-agent/gateway-application'
import { createBackendAgentHost } from 'qwen-audio-agent/backend-adapter-sdk'
import { MultiBackendAdapter } from './backend/multi-backend-adapter.mjs'
import { createRouter } from './backend/routing.mjs'
import {
  createHarnessBackend,
  createSshHermesBackend,
} from './backend/backends/harness-backend.mjs'
import { loadConfig } from './config.mjs'
import { FeishuClient } from './clients/feishu/client.mjs'
import { createLarkConnection } from './clients/feishu/lark-connection.mjs'

export function buildBackends(cfg) {
  const backends = {}
  if (cfg.backends.opencode?.enabled) {
    backends.opencode = createHarnessBackend({ protocol: 'opencode' })
  }
  if (cfg.backends.pi?.enabled) {
    backends.pi = createHarnessBackend({ protocol: 'pi' })
  }
  if (cfg.backends.hermes?.enabled) {
    backends.hermes = createSshHermesBackend({ host: cfg.backends.hermes.host })
  }
  return backends
}

export function buildAgent(cfg) {
  const backends = buildBackends(cfg)
  if (Object.keys(backends).length === 0) {
    throw new Error('没有启用任何后台 harness，请检查 config/config.env')
  }
  const mba = new MultiBackendAdapter(backends, {
    router: createRouter({ defaultBackend: cfg.routing.defaultBackend }),
  })
  return createBackendAgentHost(mba)
}

async function main() {
  const cfg = loadConfig()

  const agent = buildAgent(cfg)
  const application = createGatewayApplication({ agent })

  let feishuClient = null
  if (cfg.feishu.enabled) {
    if (!cfg.feishu.appId || !cfg.feishu.appSecret) {
      console.error('[fugue] 飞书已启用但缺少 appId/appSecret')
    } else {
      feishuClient = new FeishuClient({
        gatewayUrl: cfg.gatewayUrl,
        connection: createLarkConnection({
          appId: cfg.feishu.appId,
          appSecret: cfg.feishu.appSecret,
        }),
      })
      await feishuClient.start()
      console.log('[fugue] 飞书 client 已启动')
    }
  }

  const shutdown = async () => {
    await feishuClient?.stop()
    await application.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

if (import.meta.url === new URL(`file://${process.argv[1] || ''}`).href
  || process.argv[1]?.endsWith('launcher.mjs')) {
  main().catch(error => {
    console.error('[fugue] 启动失败:', error)
    process.exit(1)
  })
}

export { main }

// Fugue 启动入口：组装 MultiBackendAdapter + Gateway + 飞书 client。
// 对应 REQ-002/003/004/005/007。
import { fileURLToPath } from 'node:url'
import { createBackendAgentHost } from 'qwen-audio-agent/backend-adapter-sdk'
import { MultiBackendAdapter } from './backend/multi-backend-adapter.mjs'
import { createRouter } from './backend/routing.mjs'
import {
  createHarnessBackend,
} from './backend/backends/harness-backend.mjs'
import { HeadlessBackend } from './backend/backends/headless-backend.mjs'
import { loadConfig, buildSpawnThinkingDescription } from './config.mjs'
import { FeishuClient } from './clients/feishu/client.mjs'
import { createLarkConnection } from './clients/feishu/lark-connection.mjs'

// 前台提示词目录：Fugue 自定义“总指挥”人设（在 qwen-audio config 加载前设置）。
// 见 docs/02-tech/coordination-model.md。
process.env.QWEN_AUDIO_AGENT_FRONTEND_PROMPT_DIR = process.env.QWEN_AUDIO_AGENT_FRONTEND_PROMPT_DIR
  || fileURLToPath(new URL('../config/frontend-prompt', import.meta.url))

/**
 * 根据 harness 配置动态创建 backend：
 * - spec.headless：一次性进程执行（如 dsh --profile headless）
 * - spec.protocol：内置协议（pi/opencode/deepseek/...）
 * - spec.command + args：任意 ACP harness（走 generic-acp）
 */
export async function buildBackends(cfg) {
  const backends = {}
  for (const [id, spec] of Object.entries(cfg.backends || {})) {
    if (spec.headless) {
      backends[id] = new HeadlessBackend({
        id, command: spec.command, args: spec.args, label: spec.label,
      })
    } else if (spec.protocol) {
      backends[id] = await createHarnessBackend({
        protocol: spec.protocol,
        label: spec.label,
      })
    } else if (spec.command) {
      backends[id] = await createHarnessBackend({
        protocol: 'acp',
        cliPath: spec.command,
        args: spec.args,
        label: spec.label,
      })
    }
  }
  return backends
}

export async function buildAgent(cfg) {
  const backends = await buildBackends(cfg)
  if (Object.keys(backends).length === 0) {
    throw new Error('没有可用的后台 harness，请检查 config/harnesses.json')
  }
  const mba = new MultiBackendAdapter(backends, {
    router: createRouter({
      defaultBackend: cfg.routing.defaultBackend,
      rules: cfg.routing.rules,
      experts: Object.fromEntries(
        Object.entries(cfg.backends || {}).map(([id, spec]) => [id, { label: spec.label }]),
      ),
    }),
  })
  return createBackendAgentHost(mba)
}

async function main() {
  const cfg = loadConfig()

  const agent = await buildAgent(cfg)
  // 动态 import：确保 QWEN_AUDIO_AGENT_FRONTEND_PROMPT_DIR 在 qwen-audio config 加载前生效
  const { createGatewayApplication } = await import('qwen-audio-agent/gateway-application')
  const application = createGatewayApplication({
    agent,
    spawnThinkingDescription: buildSpawnThinkingDescription(cfg),
  })

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

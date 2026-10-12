// 创建真实 harness backend（复用 qwen-audio-agent 的 ACP factory）。
// 对应 REQ-004/005/007。
// 说明：qwen-audio-agent 未通过 npm exports 公开 backend-factory，这里按 ADR-0005
// 用文件路径复用其完整 ACP 实现（权限、事件归一化、session 管理）。
// 要求设置环境变量 QWEN_AUDIO_AGENT_ROOT 指向 qwen-audio-agent 源码根目录。
let acpFactory = null

async function loadAcpFactory() {
  if (acpFactory) return acpFactory
  const root = process.env.QWEN_AUDIO_AGENT_ROOT
  if (!root) {
    throw new Error(
      '需要设置 QWEN_AUDIO_AGENT_ROOT 指向 qwen-audio-agent 源码根目录（见 ADR-0005）',
    )
  }
  ;({ createAcpBackendAdapter: acpFactory } = await import(
    `${root}/server/src/backend/adapters/acp/backend-factory.mjs`
  ))
  return acpFactory
}

/**
 * @param {object} spec
 * @param {string} spec.protocol backend id（'opencode'|'pi'|'hermes'|'acp' 等）
 * @param {string} [spec.cliPath] 覆盖启动命令（如 'ssh'）
 * @param {string[]} [spec.args] 覆盖启动参数（仅 generic acp driver 支持）
 * @param {string} [spec.label] 显示名
 * @param {string} [spec.model] 模型
 * @param {string} [spec.permissionMode] 权限模式
 */
export async function createHarnessBackend(spec = {}) {
  const factory = await loadAcpFactory()
  const { protocol, permissionMode, ...backendConfig } = spec
  return factory({
    protocol,
    ...(permissionMode ? { permissionMode } : {}),
    backends: {
      [protocol]: backendConfig,
    },
  })
}

/** Hermes 远端（SSH 隧道透传 ACP stdio）——ADR-0004 */
export async function createSshHermesBackend({ host, cliPath = 'ssh', label = 'Hermes(远端)' } = {}) {
  if (!host) throw new TypeError('createSshHermesBackend requires host')
  return createHarnessBackend({
    protocol: 'acp',
    label,
    cliPath,
    args: [host, 'hermes', 'acp', '--accept-hooks'],
  })
}

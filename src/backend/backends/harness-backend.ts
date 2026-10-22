// 创建真实 harness backend（复用 qwen-audio-agent 的 ACP factory）。
// 对应 REQ-004/005/007。
// 说明：qwen-audio-agent 未通过 npm exports 公开 backend-factory，这里按 ADR-0005
// 用文件路径复用其完整 ACP 实现（权限、事件归一化、session 管理）。
// 默认定位 node_modules/qwen-audio-agent（无需手动设置）；可用 QWEN_AUDIO_AGENT_ROOT 覆盖为源码目录。
import { fileURLToPath } from 'node:url'
import type { BackendPort } from '../../types/qwen-audio-agent/backend-adapter-sdk'

type AcpFactory = (options: Record<string, unknown>) => BackendPort

let acpFactory: AcpFactory | null = null

/** 默认定位 node_modules 里的 qwen-audio-agent（backend-factory 在 server/src/backend/adapters/acp/）。 */
const DEFAULT_ROOT = fileURLToPath(new URL('../../../node_modules/qwen-audio-agent', import.meta.url))

async function loadAcpFactory(): Promise<AcpFactory> {
  if (acpFactory) return acpFactory
  const root = process.env.QWEN_AUDIO_AGENT_ROOT || DEFAULT_ROOT
  // 上游内部路径（未通过 exports 公开），动态 import；ADR-0005 记录。
  // @ts-ignore 动态路径无法静态解析
  const mod = (await import(
    `${root}/server/src/backend/adapters/acp/backend-factory.mjs`
  )) as { createAcpBackendAdapter: AcpFactory }
  acpFactory = mod.createAcpBackendAdapter
  return acpFactory
}

export interface HarnessBackendSpec {
  protocol: string
  cliPath?: string
  args?: string[]
  label?: string
  permissionMode?: string
  [key: string]: unknown
}

/**
 * 创建 harness backend（复用 qwen-audio-agent 的 ACP factory）。
 * 支持两类：
 * - protocol：内置协议（pi/opencode/deepseek/...）
 * - protocol: 'acp' + cliPath + args：任意 ACP harness（generic-acp driver）
 * 对应 REQ-005，设计见 docs/02-tech/harness-registry.md。
 */
export async function createHarnessBackend(spec: HarnessBackendSpec = { protocol: '' }): Promise<BackendPort> {
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

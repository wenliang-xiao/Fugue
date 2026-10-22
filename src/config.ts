// Fugue 配置加载：配置驱动的多 harness 接入 + 领域路由 + 飞书入口。
// 核心：config/harnesses.json 定义任意 harness（内置协议 / 任意 ACP / MCP），
// 领域路由按 domains 自动生成。见 docs/02-tech/harness-registry.md。
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

function truthy(value: unknown): boolean {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value).trim().toLowerCase())
}

function loadEnvFile(): Record<string, string> {
  const file = resolve(process.cwd(), 'config', 'config.env')
  if (!existsSync(file)) return {}
  const merged: Record<string, string> = {}
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m) merged[m[1]] = m[2].trim()
  }
  return merged
}

export interface HarnessSpec {
  id: string
  protocol?: string
  command?: string
  args?: string[]
  label?: string
  type?: string
  default?: boolean
  domains?: string[]
  [key: string]: unknown
}

export interface HarnessFile {
  harnesses: HarnessSpec[]
}

export interface BackendSpec {
  protocol?: string
  label?: string
  headless?: boolean
  command?: string
  args?: string[]
}

export interface BuildHarnessConfig {
  backends: Record<string, BackendSpec>
  rules: Array<{ backendId: string; match: { instruction: string[] } }>
  defaultBackend: string
}

/** 加载 config/harnesses.json；不存在或无内容返回 null */
export function loadHarnesses(file?: string): HarnessFile | null {
  const path = file || resolve(process.cwd(), 'config', 'harnesses.json')
  if (!existsSync(path)) return null
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8')) as HarnessFile
    return Array.isArray(data?.harnesses) && data.harnesses.length ? data : null
  } catch {
    return null
  }
}

/**
 * 从 harnesses 配置生成 backends + 路由规则。
 */
export function buildHarnessConfig(raw: Partial<HarnessFile> | null): BuildHarnessConfig {
  const harnesses = raw?.harnesses || []
  const backends: Record<string, BackendSpec> = {}
  const rules: BuildHarnessConfig['rules'] = []
  let defaultBackend = ''
  for (const h of harnesses) {
    if (!h?.id) continue
    if (h.protocol) {
      backends[h.id] = { protocol: h.protocol, label: h.label || h.id }
    } else if (h.command) {
      // type: 'headless' 走一次性进程执行；否则走通用 ACP
      backends[h.id] = {
        ...(h.type === 'headless' ? { headless: true } : {}),
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

/**
 * 生成总指挥提示词（替换 spawn_thinking 工具的 description）。
 * 从 harnesses 配置动态生成专家列表，注入"自动协调"语义。
 * 见 docs/02-tech/coordination-model.md。
 */
export function buildSpawnThinkingDescription(cfg: {
  backends: Record<string, BackendSpec>
  routing?: { rules?: BuildHarnessConfig['rules'] }
}): string {
  const experts: string[] = []
  for (const [id, spec] of Object.entries(cfg.backends || {})) {
    const rule = cfg.routing?.rules?.find(r => r.backendId === id)
    const domains = rule?.match?.instruction?.join('、') || '通用'
    experts.push(`- ${spec.label || id}（${id}）：擅长 ${domains}`)
  }
  const expertList = experts.join('\n')
  return [
    '调用后台领域专家访问或操作用户环境、设备、文件、屏幕、应用和代码，进行媒体创作、持续执行和制作交付物。',
    `你是多专家团队的总指挥。团队成员：\n${expertList}`,
    '委派任务时，根据专家擅长选择最合适的人，并在 objective 开头明确写出"交给 <专家>"（如"交给 pi：帮我写周报"）。',
    '委派后根据结果自动判断：正确则自然汇总汇报；不对则带着纠正重新委派；需要换专家则改派给更合适的专家。',
    '仅在涉及权限确认、不可逆操作或方向性选择时才询问用户，其余自动继续推进，直到任务完成。',
  ].join('')
}

export interface FugueConfig {
  gatewayUrl: string
  backends: Record<string, BackendSpec>
  routing: { defaultBackend: string; rules: BuildHarnessConfig['rules'] }
  feishu: { enabled: boolean; appId: string; appSecret: string }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): FugueConfig {
  const fileEnv = loadEnvFile()
  const merged = { ...fileEnv, ...env }

  const harnesses = loadHarnesses()
  let backends: Record<string, BackendSpec>
  let rules: BuildHarnessConfig['rules']
  let defaultBackend: string
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

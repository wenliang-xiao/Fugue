// 审计日志：append-only JSONL，记录不可逆操作（权限审批、任务取消等）。
// 对齐 qwen-audio-agent 的 core/operation-audit.mjs：审计失败绝不破坏被记录的操作。
// 对应 durable-design.md §11.2。

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface AuditEvent {
  /** 事件类型：authorization.approved / authorization.rejected / task.cancelled / ... */
  type: string
  taskId?: string
  runId?: string
  [key: string]: unknown
}

export interface AuditWarning {
  message: string
  at: number
}

export interface AuditOptions {
  /** JSONL 文件路径；不传则审计停用 */
  filePath?: string | null
  now?: () => number
  onWarning?: (warning: AuditWarning) => void
}

/**
 * append-only JSONL 审计。记录失败（权限不足/磁盘满）后停用审计，绝不影响被记录的操作。
 */
export class Audit {
  readonly filePath: string | null
  readonly now: () => number
  readonly onWarning: (warning: AuditWarning) => void
  disabled = false
  warning: AuditWarning | null = null

  constructor(options: AuditOptions = {}) {
    this.filePath = options.filePath ?? null
    this.now = options.now ?? (() => Date.now())
    this.onWarning = options.onWarning ?? (warning => console.warn(warning.message))
  }

  record(event: AuditEvent): boolean {
    if (!this.filePath || this.disabled) return false
    try {
      mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 })
      appendFileSync(
        this.filePath,
        `${JSON.stringify({ at: new Date(this.now()).toISOString(), ...event })}\n`,
        { encoding: 'utf8', mode: 0o600 },
      )
      return true
    } catch (error) {
      this.disabled = true
      this.warning = {
        message: `无法写入审计日志：${error instanceof Error ? error.message : String(error)}；已停用审计，当前操作不受影响。`,
        at: this.now(),
      }
      try {
        this.onWarning(this.warning)
      } catch {
        // 诊断失败不得阻止被记录的操作
      }
      return false
    }
  }

  health(): { ok: boolean; configured: boolean; enabled: boolean; warning: AuditWarning | null } {
    return {
      ok: !this.warning,
      configured: Boolean(this.filePath),
      enabled: Boolean(this.filePath) && !this.disabled,
      warning: this.warning,
    }
  }
}

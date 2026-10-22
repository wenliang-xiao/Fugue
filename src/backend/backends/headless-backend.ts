// HeadlessBackend：通过一次性进程执行任务（如 dsh --profile headless）。
// 适合"低频长任务"，绕开持久 session（ACP）profile 的一些配置限制。
// 实现 BackendPort 契约；submit 为同步完成语义（提交即执行，无持久 session）。
// 对应 REQ-005，设计见 docs/02-tech/harness-registry.md。
import { spawn } from 'node:child_process'
import type { BackendPort, BackendTask } from '../../types/qwen-audio-agent/backend-adapter-sdk'

function clean(value: unknown): string {
  return String(value || '').trim()
}

export interface HeadlessBackendOptions {
  id: string
  command: string
  args?: string[]
  label?: string
  env?: Record<string, string>
}

export class HeadlessBackend implements BackendPort {
  readonly id: string
  readonly command: string
  readonly args: string[]
  readonly label: string
  readonly env: Record<string, string>
  ready = false
  closed = false

  constructor(options: HeadlessBackendOptions) {
    const { id, command, args = [], label, env = {} } = options
    if (!id) throw new TypeError('HeadlessBackend requires id')
    if (!command) throw new TypeError('HeadlessBackend requires command')
    this.id = id
    this.command = command
    this.args = Array.isArray(args) ? args : []
    this.label = label || id
    this.env = env
  }

  describe(): Record<string, unknown> {
    return {
      label: this.label,
      protocol: 'headless',
      capabilities: { delegation: true, permissions: false },
    }
  }

  async start(): Promise<{ ok: boolean }> {
    this.ready = true
    return { ok: true }
  }

  async health(): Promise<{ ok: boolean }> {
    return { ok: this.ready && !this.closed }
  }

  async submit(work: BackendTask): Promise<{ content: string; artifacts: unknown[] }> {
    const instruction = clean(work?.instruction || work?.objective || work?.message)
    if (!clean(work?.id) || !clean(work?.ownerId) || !instruction) {
      throw new Error('requires task id, owner and input')
    }
    const content = await this._run(instruction)
    return { content, artifacts: [] }
  }

  status(taskId?: string): Record<string, unknown> {
    if (!clean(taskId)) {
      return { ok: this.ready && !this.closed, status: this.ready ? 'ready' : 'stopped', protocol: 'headless' }
    }
    // 一次性执行：无持久 session，任何 taskId 都是终态
    return { taskId, state: 'not_found', activity: [] }
  }

  async cancel(taskId: string): Promise<{ taskId: string; state: string }> {
    return { taskId: clean(taskId), state: 'not_found' }
  }

  async respondAuthorization(): Promise<never> {
    throw new Error('headless backend does not support authorization')
  }

  async respondInput(): Promise<never> {
    throw new Error('headless backend does not support input')
  }

  subscribe(): () => void {
    return () => {}
  }

  async close(): Promise<void> {
    this.closed = true
    this.ready = false
  }

  _run(instruction: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, [...this.args, instruction], {
        env: { ...process.env, ...this.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let out = ''
      let err = ''
      child.stdout.on('data', (d: Buffer) => { out += d })
      child.stderr.on('data', (d: Buffer) => { err += d })
      child.on('error', error => reject(error))
      child.on('close', code => {
        if (code === 0) resolve(out.trim())
        else reject(new Error(`${this.id} headless exited ${code}: ${clean(err).slice(-200)}`))
      })
    })
  }
}

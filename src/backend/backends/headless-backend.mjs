// HeadlessBackend：通过一次性进程执行任务（如 dsh --profile headless）。
// 适合"低频长任务"，绕开持久 session（ACP）profile 的一些配置限制。
// 实现 BackendPort 契约；submit 为同步完成语义（提交即执行，无持久 session）。
// 对应 REQ-005，设计见 docs/02-tech/harness-registry.md。
import { spawn } from 'node:child_process'

function clean(value) {
  return String(value || '').trim()
}

export class HeadlessBackend {
  /**
   * @param {object} options
   * @param {string} options.id
   * @param {string} options.command 启动命令（如 'dsh'）
   * @param {string[]} [options.args] 启动参数（如 ['--profile', 'headless']）
   * @param {string} [options.label] 显示名
   * @param {object} [options.env] 额外环境变量
   */
  constructor({ id, command, args = [], label, env = {} } = {}) {
    if (!id) throw new TypeError('HeadlessBackend requires id')
    if (!command) throw new TypeError('HeadlessBackend requires command')
    this.id = id
    this.command = command
    this.args = Array.isArray(args) ? args : []
    this.label = label || id
    this.env = env
    this.ready = false
    this.closed = false
  }

  describe() {
    return {
      label: this.label,
      protocol: 'headless',
      capabilities: { delegation: true, permissions: false },
    }
  }

  async start() {
    this.ready = true
    return { ok: true }
  }

  async health() {
    return { ok: this.ready && !this.closed }
  }

  async submit(work) {
    const instruction = clean(work?.instruction || work?.objective || work?.message)
    if (!clean(work?.id) || !clean(work?.ownerId) || !instruction) {
      throw new Error('requires task id, owner and input')
    }
    const content = await this._run(instruction)
    return { content, artifacts: [] }
  }

  status(taskId) {
    if (!clean(taskId)) {
      return { ok: this.ready && !this.closed, status: this.ready ? 'ready' : 'stopped', protocol: 'headless' }
    }
    // 一次性执行：无持久 session，任何 taskId 都是终态
    return { taskId, state: 'not_found', activity: [] }
  }

  async cancel(taskId) {
    return { taskId: clean(taskId), state: 'not_found' }
  }

  async respondAuthorization() {
    throw new Error('headless backend does not support authorization')
  }

  async respondInput() {
    throw new Error('headless backend does not support input')
  }

  subscribe() {
    return () => {}
  }

  async close() {
    this.closed = true
    this.ready = false
  }

  _run(instruction) {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, [...this.args, instruction], {
        env: { ...process.env, ...this.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let out = ''
      let err = ''
      child.stdout.on('data', d => { out += d })
      child.stderr.on('data', d => { err += d })
      child.on('error', error => reject(error))
      child.on('close', code => {
        if (code === 0) resolve(out.trim())
        else reject(new Error(`${this.id} headless exited ${code}: ${clean(err).slice(-200)}`))
      })
    })
  }
}

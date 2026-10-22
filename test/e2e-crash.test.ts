// 切片 5b：端到端崩溃恢复——真实 SIGKILL 子进程 → 主进程从文件恢复。
// 个人助手核心闭环：进程死，任务不丢、不重复。
// 追溯：durable-design.md §3、ADR-0009、切片 5。
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileWorld } from '../src/durable/world-file'
import { MultiBackendAdapter } from '../src/backend/multi-backend-adapter'
import { effect, EffectInterrupted } from '../src/durable/effect'
import { MockBackend } from './helpers/mock-backend'

const CHILD_SCRIPT = `
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
const dir = process.env.CRASH_DIR
mkdirSync(dir, { recursive: true })
// 模拟崩溃：写 running 状态 + submit intent（无 outcome），然后 SIGKILL 自杀
writeFileSync(dir + '/index.json', JSON.stringify({ 't-crash': 'running' }))
appendFileSync(dir + '/t-crash.jsonl', JSON.stringify({
  type: 'step_started',
  correlationId: 'step-1',
  data: {
    key: 'task:t-crash:submit:a',
    name: 'submit',
    replay: 'never',
    input: { backendId: 'a' },
    anchor: { pid: process.pid, boot: 'boot_child_' + process.pid, host: hostname() },
  },
  at: Date.now(),
}) + '\\n')
process.kill(process.pid, 'SIGKILL')
`

test('端到端：子进程 SIGKILL 后，主进程从文件恢复任务状态', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fugue-crash-'))

  // 子进程：写 intent 后自杀（真实进程死亡，不是同进程模拟）
  const script = join(dir, 'child.mjs')
  writeFileSync(script, CHILD_SCRIPT)
  await new Promise<void>((resolve) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, CRASH_DIR: dir },
      stdio: 'ignore',
    })
    child.on('exit', () => resolve())
  })

  // 主进程：从同一目录恢复
  const world = createFileWorld(dir)
  const active = await world.listActiveRuns()
  assert.deepEqual(active, [{ runId: 't-crash', status: 'running' }])

  // rebuildTaskMap：从日志恢复 task → backend 索引
  const a = new MockBackend({ id: 'a' })
  const mba = new MultiBackendAdapter({ a }, { defaultBackend: 'a', world })
  await mba.rebuildTaskMap()
  assert.equal(mba.taskMap.get('t-crash'), 'a')

  // effect 判定：子进程已死（anchor gone）+ replay never → 中断，不重跑（防重复任务）
  await assert.rejects(
    effect(
      { world, runId: 't-crash' },
      'task:t-crash:submit:a',
      { name: 'submit', replay: 'never', input: { backendId: 'a' } },
      async () => 'should-not-run',
    ),
    EffectInterrupted,
  )

  await mba.close()
  rmSync(dir, { recursive: true, force: true })
})

test('端到端：safe 的步骤崩溃后重跑（续跑）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fugue-crash-'))

  // 子进程：写一个 safe 步骤的 intent 后自杀
  const safeScript = `
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
const dir = process.env.CRASH_DIR
mkdirSync(dir, { recursive: true })
writeFileSync(dir + '/index.json', JSON.stringify({ 't-safe': 'running' }))
appendFileSync(dir + '/t-safe.jsonl', JSON.stringify({
  type: 'step_started',
  correlationId: 'step-1',
  data: {
    key: 'task:t-safe:lookup',
    name: 'lookup',
    replay: 'safe',
    input: {},
    anchor: { pid: process.pid, boot: 'boot_child_' + process.pid, host: hostname() },
  },
  at: Date.now(),
}) + '\\n')
process.kill(process.pid, 'SIGKILL')
`
  const script = join(dir, 'child.mjs')
  writeFileSync(script, safeScript)
  await new Promise<void>((resolve) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, CRASH_DIR: dir },
      stdio: 'ignore',
    })
    child.on('exit', () => resolve())
  })

  const world = createFileWorld(dir)
  let calls = 0
  const output = await effect(
    { world, runId: 't-safe' },
    'task:t-safe:lookup',
    { name: 'lookup', replay: 'safe', input: {} },
    async () => {
      calls++
      return 'recovered'
    },
  )
  assert.equal(output, 'recovered')
  assert.equal(calls, 1) // safe 重跑了一次

  rmSync(dir, { recursive: true, force: true })
})

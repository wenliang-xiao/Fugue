// 切片 1.5：可观测性基础设施测试（marks + audit）。
// 追溯：durable-design.md §11、ADR-0009。
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalWorld } from '../src/durable/world-local'
import { mark, type Mark } from '../src/core/marks'
import { Audit } from '../src/core/audit'

test('mark：写到 world 的 live 流，字段正确', () => {
  const world = createLocalWorld()
  const received: unknown[] = []
  world.subscribe('run-1', e => received.push(e))

  mark(world, 'run-1', 'submit', { taskId: 'task-1' })

  assert.equal(received.length, 1)
  // mark 经 append 发布：事件是 TaskEvent 形状（{ type:'mark', data: Mark, at }）
  const evt = received[0] as { type: string; data: Mark }
  const m = evt.data
  assert.equal(evt.type, 'mark')
  assert.equal(m.name, 'submit')
  assert.equal(m.runId, 'run-1')
  assert.equal(m.taskId, 'task-1')
  assert.equal(typeof m.t, 'number')
  assert.equal(typeof m.pid, 'string')
})

test('mark：fire-and-forget，world 抛错不向上抛', () => {
  // 构造一个 publish 抛错的 world
  const world = createLocalWorld()
  const broken = {
    ...world,
    publish() {
      throw new Error('boom')
    },
  }
  assert.doesNotThrow(() => mark(broken, 'run-1', 'idle'))
})

test('audit：record 写入 JSONL，health 正常', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fugue-audit-'))
  const file = join(dir, 'audit.jsonl')
  const audit = new Audit({ filePath: file })

  const ok = audit.record({ type: 'task.cancelled', taskId: 't1' })
  assert.equal(ok, true)

  const lines = readFileSync(file, 'utf-8').trim().split('\n')
  assert.equal(lines.length, 1)
  const entry = JSON.parse(lines[0])
  assert.equal(entry.type, 'task.cancelled')
  assert.equal(entry.taskId, 't1')
  assert.ok(entry.at) // 时间戳

  const health = audit.health()
  assert.deepEqual(health, { ok: true, configured: true, enabled: true, warning: null })

  rmSync(dir, { recursive: true, force: true })
})

test('audit：不传 filePath 时停用，record 返回 false', () => {
  const audit = new Audit()
  assert.equal(audit.record({ type: 'x' }), false)
  assert.equal(audit.health().configured, false)
  assert.equal(audit.health().enabled, false)
})

test('audit：写入失败后停用 + warning，不抛错', () => {
  // filePath 指向一个无法创建的路径（父目录是文件）
  const audit = new Audit({
    filePath: '/dev/null/audit.jsonl',
    onWarning: () => {},
  })
  assert.doesNotThrow(() => audit.record({ type: 'x' }))
  assert.equal(audit.disabled, true)
  assert.equal(audit.health().enabled, false)
  assert.ok(audit.health().warning)
})

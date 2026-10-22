// REQ-005：HeadlessBackend 单元测试（一次性进程执行）
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { HeadlessBackend } from '../src/backend/backends/headless-backend'

test('submit：spawn 命令并返回 stdout 作为 content', async () => {
  const backend = new HeadlessBackend({ id: 'echo', command: 'echo' })
  await backend.start()
  const outcome = await backend.submit({ id: 't1', ownerId: 'o1', instruction: 'hello world' })
  assert.equal(outcome.content, 'hello world')
  assert.deepEqual(outcome.artifacts, [])
  await backend.close()
})

test('submit 校验：缺 id/owner/instruction 抛错', async () => {
  const backend = new HeadlessBackend({ id: 'echo', command: 'echo' })
  await assert.rejects(backend.submit({}), /requires task id, owner and input/)
  await assert.rejects(
    backend.submit({ id: 't', ownerId: 'o' }),
    /requires task id, owner and input/,
  )
})

test('status：一次性执行，任意 taskId 返回 not_found', async () => {
  const backend = new HeadlessBackend({ id: 'echo', command: 'echo' })
  await backend.start()
  assert.equal(backend.status('t1').state, 'not_found')
  assert.equal(backend.status('').ok, true)
})

test('cancel 返回 not_found', async () => {
  const backend = new HeadlessBackend({ id: 'echo', command: 'echo' })
  assert.deepEqual(await backend.cancel('t1'), { taskId: 't1', state: 'not_found' })
})

test('命令失败时 submit 抛错（含 stderr）', async () => {
  const backend = new HeadlessBackend({ id: 'fail', command: 'sh', args: ['-c'] })
  await backend.start()
  await assert.rejects(
    backend.submit({ id: 't1', ownerId: 'o1', instruction: 'exit 3' }),
    /exited 3/,
  )
})

test('args 拼接到命令后，instruction 作为最后参数', async () => {
  const backend = new HeadlessBackend({ id: 'echo', command: 'echo', args: ['-n'] })
  const outcome = await backend.submit({ id: 't1', ownerId: 'o1', instruction: 'x' })
  assert.equal(outcome.content, 'x')
})

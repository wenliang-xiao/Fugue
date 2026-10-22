// A 形态守护：buildPlist 纯函数契约测试。
// 追溯：ADR-0011。
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { buildPlist, plistPath, logDir } from '../scripts/daemon'

test('plist 含 KeepAlive + RunAtLoad（崩溃自愈 + 登录自启）', () => {
  const plist = buildPlist({ projectRoot: '/proj/fugue', logPath: '/proj/fugue/data/daemon.log' })
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/)
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/)
})

test('plist ProgramArguments 用绝对路径的 node + tsx cli + launcher.ts', () => {
  const plist = buildPlist({ projectRoot: '/proj/fugue' })
  assert.ok(plist.includes('/proj/fugue/node_modules/tsx/dist/cli.mjs'))
  assert.ok(plist.includes('/proj/fugue/src/launcher.ts'))
  assert.ok(plist.includes(process.execPath)) // node 绝对路径
})

test('plist WorkingDirectory 是项目根，日志落到 data/daemon.log', () => {
  const plist = buildPlist({ projectRoot: '/proj/fugue', logPath: '/proj/fugue/data/daemon.log' })
  assert.match(plist, /<key>WorkingDirectory<\/key>\s*<string>\/proj\/fugue<\/string>/)
  assert.ok(plist.includes('/proj/fugue/data/daemon.log'))
})

test('plist Label 是 com.fugue.agent', () => {
  const plist = buildPlist({ projectRoot: '/proj/fugue' })
  assert.match(plist, /<key>Label<\/key>\s*<string>com\.fugue\.agent<\/string>/)
})

test('plistPath 指向 ~/Library/LaunchAgents/com.fugue.agent.plist', () => {
  const path = plistPath()
  assert.ok(path.endsWith('Library/LaunchAgents/com.fugue.agent.plist'))
  assert.ok(path.startsWith(process.env.HOME || '/'))
})

test('logDir 指向项目 data 目录', () => {
  assert.ok(logDir().endsWith('/data'))
})

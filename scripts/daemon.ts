// Fugue 本地守护（A 形态）：macOS launchd 常驻 + 崩溃自愈 + 登录自启。
// 用法：node scripts/daemon.mjs <install|uninstall|start|stop|restart|status>
// 对应 ADR-0011（本地个人助手形态）。
import { execSync } from 'node:child_process'
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

const LABEL = 'com.fugue.agent'
const PROJECT_ROOT = resolve(process.cwd())

export function plistPath() {
  return resolve(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
}

export function logDir() {
  return resolve(PROJECT_ROOT, 'data')
}

/**
 * 生成 launchd plist（纯函数，可单测）。
 * - RunAtLoad: true → 登录自动启动
 * - KeepAlive: true → 崩溃自动重启（进程自愈）
 * - WorkingDirectory: 项目根，data/ 落本地持久化
 */
export function buildPlist({ projectRoot = PROJECT_ROOT, logPath = resolve(PROJECT_ROOT, 'data', 'daemon.log') } = {}) {
  const node = process.execPath
  const cli = resolve(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const launcher = resolve(projectRoot, 'src', 'launcher.ts')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${cli}</string>
    <string>${launcher}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${projectRoot}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`
}

function launchctl(args: string): string {
  try {
    return execSync(`launchctl ${args}`, { encoding: 'utf8' })
  } catch (error) {
    const err = error as { stdout?: string; message?: string }
    return err.stdout || String(err.message || error)
  }
}

export function install() {
  const path = plistPath()
  mkdirSync(logDir(), { recursive: true })
  writeFileSync(path, buildPlist())
  launchctl(`bootstrap gui/$(id -u) ${path}`)
  return path
}

export function uninstall() {
  const path = plistPath()
  launchctl(`bootout gui/$(id -u)/${LABEL}`)
  if (existsSync(path)) rmSync(path)
  return path
}

export function start() {
  return launchctl(`kickstart -k gui/$(id -u)/${LABEL}`)
}

export function stop() {
  return launchctl(`bootout gui/$(id -u)/${LABEL}`)
}

export function status() {
  return launchctl(`print gui/$(id -u)/${LABEL}`)
}

const commands: Record<string, () => string> = { install, uninstall, start, stop, status }

function main() {
  const command = process.argv[2]
  if (!command || !commands[command]) {
    console.error(`用法: node scripts/daemon.mjs <${Object.keys(commands).join('|')}>`)
    process.exit(1)
  }
  const output = commands[command]()
  console.log(output)
}

if (import.meta.url === new URL(`file://${process.argv[1] || ''}`).href) {
  main()
}

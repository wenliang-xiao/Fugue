// Fugue 任务观察台（CLI）：读本地 data/tasks/ 日志，展示任务流转、打点、effect 状态。
// 个人助手 debug 入口：`npm run inspect`。
// 对应 durable-design.md §11（可观测性消费端）。
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { createFileWorld, listRunFiles } from './durable/world-file'
import { loadState } from './durable/effect'
import type { TaskEvent } from './durable/world'

function fmtTime(at: number): string {
  return new Date(at).toISOString().slice(11, 23)
}

function fmtStepEvent(e: TaskEvent): string {
  const d = e.data as { name?: string; key?: string; replay?: string } | undefined
  const name = d?.name ? ` (${d.name})` : ''
  const replay = d?.replay ? ` replay=${d.replay}` : ''
  return `[step] ${e.type} ${e.correlationId}${name}${replay}`
}

function fmtMarkEvent(e: TaskEvent): string {
  const m = e.data as { name?: string; effect?: string; writeMs?: number }
  const effect = m?.effect ? ` (${m.effect})` : ''
  const writeMs = m?.writeMs !== undefined ? ` ${m.writeMs}ms` : ''
  return `[mark] ${m?.name ?? '?'}${effect}${writeMs}`
}

const STATUS_ICON: Record<string, string> = {
  pending: '⏳', running: '▶️', completed: '✅', failed: '❌', cancelled: '⏹️',
}

async function main(): Promise<void> {
  const dir = resolve(process.cwd(), 'data', 'tasks')
  const world = createFileWorld(dir)
  const runs = listRunFiles(dir)
  const active = await world.listActiveRuns()

  console.log('┌─────────────────────────────────────────────┐')
  console.log('│            Fugue 任务观察台                  │')
  console.log('└─────────────────────────────────────────────┘')
  console.log(`目录: ${dir}`)
  console.log(`进行中任务: ${active.map(r => r.runId).join(', ') || '（无）'}`)
  console.log(`总任务数: ${runs.length}`)
  console.log()

  if (runs.length === 0) {
    console.log('（暂无任务记录。启动 Fugue 并委派任务后，这里会显示流转。）')
    return
  }

  for (const runId of runs) {
    const { events } = await world.read(runId)
    const state = await loadState(world, runId)
    const icon = STATUS_ICON[state.status] ?? '❓'
    const isActive = active.some(a => a.runId === runId)
    console.log(`${icon} 任务 ${runId}  [status=${state.status}]${isActive ? ' (进行中)' : ''}  epoch=${state.epoch}`)
    console.log('   流转:')
    for (const e of events) {
      const line = e.type === 'mark'
        ? fmtMarkEvent(e)
        : e.type.startsWith('step_')
          ? fmtStepEvent(e)
          : `[${e.type}]`
      console.log(`     ${fmtTime(e.at)}  ${line}`)
    }
    if (state.effectOrder.length > 0) {
      console.log('   effect 状态:')
      for (const rec of state.effectOrder) {
        const ric = STATUS_ICON[rec.status] ?? '❓'
        const err = rec.error ? ` error="${rec.error.message}"` : ''
        console.log(`     ${ric} ${rec.name} [${rec.status}] key=${rec.key} attempt=${rec.attempt}${err}`)
      }
    }
    console.log()
  }
}

main().catch(error => {
  console.error('[inspect] 读取失败:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})

export { main }

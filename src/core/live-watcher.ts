// 实时打点观察器：订阅所有 run 的 live 流，把 mark/step/run 事件实时打印到终端。
// 个人助手 debug：启动时挂上，委派任务时终端实时看到打点流转。
// 对应 durable-design.md §11（可观测性实时消费端）。
import type { TaskWorld } from '../durable/world'
import type { Mark } from './marks'

const C = {
  mark: '\x1b[36m', // cyan
  step: '\x1b[33m', // yellow
  run: '\x1b[35m', // magenta
  err: '\x1b[31m', // red
  reset: '\x1b[0m',
}

function fmtTime(at: number): string {
  return new Date(at).toISOString().slice(11, 23)
}

/** 订阅所有 run 的 live 流，实时打印 mark/step/run 事件。返回 unsubscribe。 */
export function watchLive(world: TaskWorld, log: (line: string) => void = console.log): () => void {
  return world.subscribeAll((runId, event) => {
    const e = event as Record<string, unknown>
    const type = typeof e.type === 'string' ? e.type : ''

    if (type === 'mark') {
      // mark 事件：data 里是扁平的 Mark（{ type:'mark', data: {name, effect, key, ...}, at }）
      const m = (e.data ?? e) as unknown as Mark
      const parts = [`[mark] ${m.name}`]
      if (m.effect) parts.push(`(${m.effect})`)
      if (m.key) parts.push(`key=${m.key}`)
      if (m.writeMs !== undefined) parts.push(`${m.writeMs}ms`)
      log(`${C.mark}${fmtTime(m.t)} ${parts.join(' ')}${C.reset}`)
      return
    }

    if (type.startsWith('step_failed')) {
      const d = (e.data ?? {}) as { name?: string }
      const err = (e.data ?? {}) as { error?: { message?: string } }
      log(`${C.err}${fmtTime(Date.now())} [step] ${type}${d.name ? ' (' + d.name + ')' : ''} ${err.error?.message ?? ''}${C.reset}`)
      return
    }

    if (type.startsWith('step_')) {
      const d = (e.data ?? {}) as { name?: string; replay?: string }
      log(`${C.step}${fmtTime(Date.now())} [step] ${type}${d.name ? ' (' + d.name + ')' : ''}${d.replay ? ` replay=${d.replay}` : ''}${C.reset}`)
      return
    }

    if (type.startsWith('run_')) {
      log(`${C.run}[run] ${type} ${runId}${C.reset}`)
    }
  })
}

// anchor：liveness 判定——一个 running effect 的持有者（进程）是否还活着。
// 对齐 durable-harness 的 anchor.ts / localAnchors：liveness 归队列/进程，应用层不写心跳。
// 对应 durable-design.md §3、切片 3。

import { hostname } from 'node:os'

/** 写 intent 的进程身份。boot 区分 pid 复用（进程重启后 pid 可能被复用）。 */
export interface ProcessIdentity {
  pid: number
  /** 进程启动标识（每个进程启动一个唯一值） */
  boot: string
  host: string
}

let identity: ProcessIdentity | null = null

/** 当前进程的身份（懒加载、进程内单例）。 */
export function processIdentity(): ProcessIdentity {
  if (identity) return identity
  identity = {
    pid: process.pid,
    boot: `boot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    host: hostname(),
  }
  return identity
}

/** pid 是否还活着（zombie 也计入；EPERM 表示存在但无权限）。 */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as { code?: string }).code === 'EPERM'
  }
}

/** anchor 判定结果：mine（自己写的）/ gone（持有者已死）/ covered（持有者还活着）。 */
export type Verdict = 'mine' | 'gone' | 'covered'

/**
 * 判定一个 running intent 的持有者死活：
 * - `mine`：anchor 是本进程写的（重入，安全重跑由调用方决定）
 * - `gone`：无 anchor（遗留）或持有进程已死（可恢复）
 * - `covered`：持有进程还活着（让位，绝不抢）
 */
export function judgeAnchor(
  anchor: ProcessIdentity | undefined,
  self: ProcessIdentity = processIdentity(),
): Verdict {
  if (!anchor) return 'gone' // 写于 anchor 引入之前，或已无主
  if (anchor.boot === self.boot) return 'mine'
  if (anchor.host === self.host && isAlive(anchor.pid)) return 'covered'
  return 'gone'
}

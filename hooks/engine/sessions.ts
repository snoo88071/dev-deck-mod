import type { LiveSession } from '../../types'

/**
 * Claude Code keeps one file per open session in `<config>/sessions/<pid>.json`
 * and deletes it when the session exits. A crash leaves it behind, so the pids
 * are checked against the running processes too.
 */

/** Reads one session file; `undefined` for anything that isn't an open CLI session. */
export function parseSession(text: string): LiveSession | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null) return undefined
  const f = raw as Record<string, unknown>
  if (f.entrypoint !== 'cli') return undefined
  if (typeof f.pid !== 'number' || typeof f.sessionId !== 'string' || typeof f.cwd !== 'string') return undefined
  return {
    pid: f.pid,
    sessionId: f.sessionId,
    name: typeof f.name === 'string' && f.name !== '' ? f.name : f.sessionId.slice(0, 8),
    cwd: f.cwd,
    status: typeof f.status === 'string' ? f.status : '',
    startedAt: typeof f.startedAt === 'number' ? f.startedAt : 0,
  }
}

/** The pids in `tasklist /FO CSV /NH` output. */
export function parseTasklist(csv: string): Set<number> {
  const pids = new Set<number>()
  for (const line of csv.split(/\r?\n/)) {
    const pid = Number(/^"[^"]*","(\d+)"/.exec(line)?.[1])
    if (pid > 0) pids.add(pid)
  }
  return pids
}

/** Open sessions first by the one that started last. */
export function sortSessions(list: LiveSession[]): LiveSession[] {
  return [...list].sort((a, b) => b.startedAt - a.startedAt)
}

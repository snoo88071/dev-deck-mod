import type { LiveSession } from '../../types'

/**
 * Claude Code keeps one file per open session in `<config>/sessions/<pid>.json`
 * and deletes it when the session exits. A crash leaves it behind, so the pids
 * are checked against the running processes too (`register.tsx`, with the process tree).
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
    statusSince: typeof f.statusUpdatedAt === 'number' ? f.statusUpdatedAt : 0,
    startedAt: typeof f.startedAt === 'number' ? f.startedAt : 0,
  }
}

/** How long a session that stopped reads «finito» before it reads «ferma». */
export const DONE_MS = 10 * 60_000

/**
 * A status set this soon after the session started may be its start (Claude Code takes a while to
 * come up), not the end of an answer.
 */
const START_MS = 60_000

/**
 * The state a row shows: at work, just finished (for a while after it stopped), or idle. Finished is
 * certain when the pane saw it stop (`stoppedAt`); before the pane opened, the file's own time says
 * it, once it's clear of the session's start.
 */
export function shownState(
  s: Pick<LiveSession, 'status' | 'statusSince' | 'startedAt'>,
  now: number,
  stoppedAt?: number,
): 'busy' | 'done' | 'idle' | string {
  if (s.status === 'busy') return 'busy'
  // Anything but busy is stopped: `idle`, or `shell` with a command left running in the background.
  if (stoppedAt !== undefined) return now - stoppedAt < DONE_MS ? 'done' : 'idle'
  const answered = s.statusSince > 0 && s.statusSince - s.startedAt > START_MS
  return answered && now - s.statusSince < DONE_MS ? 'done' : 'idle'
}

/**
 * The state a row shows, from the best source there is. A session running the mod says itself when
 * an answer ended (`presence`, written at the end of each answer): a slash command flipping the file
 * to busy and back isn't an answer. For one without the mod, the file is all there is.
 */
export function rowState(
  s: Pick<LiveSession, 'status' | 'statusSince' | 'startedAt'>,
  now: number,
  source: { hasMod: boolean; presence?: { state: string; at: number }; stoppedAt?: number },
): 'busy' | 'done' | 'idle' | string {
  if (!source.hasMod) return shownState(s, now, source.stoppedAt)
  if (s.status === 'busy') return 'busy'
  // Anything but busy is stopped: `idle`, or `shell` with a command left running in the background.
  const p = source.presence
  return p?.state === 'done' && now - p.at < DONE_MS ? 'done' : 'idle'
}

/** The sessions that were at work at the last read and have stopped since. */
export function justFinished(before: ReadonlyMap<string, string>, now: readonly LiveSession[]): LiveSession[] {
  return now.filter(s => before.get(s.sessionId) === 'busy' && s.status !== 'busy')
}

/** The last title Claude Code wrote, in findstr's output of a transcript's `aiTitle` lines. */
export function lastTitle(lines: string): string | undefined {
  let title: string | undefined
  for (const raw of lines.split(/\r?\n/)) {
    if (!raw.includes('"aiTitle"')) continue
    try {
      const line = JSON.parse(raw)
      if (typeof line.aiTitle === 'string' && line.aiTitle.trim()) title = line.aiTitle.trim()
    } catch {
      // A line cut short: the next one may still say.
    }
  }
  return title
}

/** Open sessions first by the one that started last. */
export function sortSessions(list: LiveSession[]): LiveSession[] {
  return [...list].sort((a, b) => b.startedAt - a.startedAt)
}

import type { PastSession } from '../../types'
import { t } from './i18n'

/**
 * The history is read from the transcripts in `<config>/projects/<folder>/<id>.jsonl`, the files
 * `claude --resume` reopens. Only the ones started from a terminal (`"entrypoint":"cli"`) count;
 * most files are `claude -p` and SDK runs.
 */

/** The prompts kept per session for the search, each cut to this length. */
const PROMPTS_KEPT = 40
const PROMPT_CHARS = 200

/** A prompt the person typed: plain text, not a command's expansion or a tool's result. */
export function typedPrompt(line: Record<string, unknown>): string | undefined {
  if (line.type !== 'user' || line.isMeta === true) return undefined
  const content = (line.message as { content?: unknown } | undefined)?.content
  if (typeof content !== 'string') return undefined
  const text = content.trim()
  if (text === '' || text.startsWith('<')) return undefined
  return text
}

/**
 * What a row needs from a transcript's lines. `undefined` when it isn't a terminal session or
 * holds no prompt: nothing to resume.
 */
export function parseTranscript(sessionId: string, text: string, mtimeMs: number): PastSession | undefined {
  let entrypoint: unknown
  let cwd = ''
  let branch = ''
  let title = ''
  let firstAt = 0
  const prompts: string[] = []
  for (const raw of text.split('\n')) {
    if (raw === '') continue
    let line: Record<string, unknown>
    try {
      line = JSON.parse(raw)
    } catch {
      continue // A line cut at the end of a file still being written, or by a head/tail read.
    }
    if (entrypoint === undefined && line.entrypoint !== undefined) entrypoint = line.entrypoint
    if (!cwd && typeof line.cwd === 'string') cwd = line.cwd
    if (!branch && typeof line.gitBranch === 'string') branch = line.gitBranch
    if (line.type === 'ai-title' && typeof line.aiTitle === 'string') title = line.aiTitle
    if (!firstAt && typeof line.timestamp === 'string') firstAt = Date.parse(line.timestamp) || 0
    const prompt = typedPrompt(line)
    if (prompt) prompts.push(prompt.slice(0, PROMPT_CHARS))
  }
  if (entrypoint !== 'cli' || !cwd || prompts.length === 0) return undefined
  const kept = prompts.length <= PROMPTS_KEPT ? prompts : [...prompts.slice(0, PROMPTS_KEPT / 2), ...prompts.slice(-PROMPTS_KEPT / 2)]
  return {
    sessionId,
    cwd,
    branch,
    title: title || oneLine(prompts[0] ?? ''),
    prompts: kept,
    startedAt: firstAt || mtimeMs,
    lastAt: mtimeMs,
  }
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** The sessions whose title, prompts or folder hold every word of the query, case aside. */
export function search(list: readonly PastSession[], query: string): PastSession[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...list]
  return list.filter(s => {
    const hay = (s.title + '\n' + s.cwd + '\n' + s.branch + '\n' + s.prompts.join('\n')).toLowerCase()
    return words.every(w => hay.includes(w))
  })
}

/** Midnight of the day `at` falls in, local time. */
function dayOf(at: number): number {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** A day's heading in the mod's language, in sentence case as Dev Deck writes it: `Today`, `Yesterday`, `Mon 12 Oct` (`Lun 12 ott`). */
export function dayLabel(at: number, now: number): string {
  const days = Math.round((dayOf(now) - dayOf(at)) / 86_400_000)
  const d = new Date(at)
  const text =
    days === 0 ? t('today') : days === 1 ? t('yesterday') : t('weekdays').split(' ')[d.getDay()] + ' ' + d.getDate() + ' ' + t('months').split(' ')[d.getMonth()]
  return text.charAt(0).toLocaleUpperCase() + text.slice(1)
}

/** `14:02`. */
export function clock(at: number): string {
  const d = new Date(at)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

/** The sessions newest first, in runs of one day each. */
export function byDay(list: readonly PastSession[], now: number): { day: string; sessions: PastSession[] }[] {
  const groups: { day: string; sessions: PastSession[] }[] = []
  for (const s of [...list].sort((a, b) => b.lastAt - a.lastAt)) {
    const day = dayLabel(s.lastAt, now)
    const last = groups.at(-1)
    if (last && last.day === day) last.sessions.push(s)
    else groups.push({ day, sessions: [s] })
  }
  return groups
}

/** The paths in `findstr /m` output, one per line. */
export function parseFindstr(out: string): string[] {
  return out.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
}

/** Paths in runs whose joined length stays under `max` characters: a command line has a limit. */
export function batches(paths: readonly string[], max = 24_000): string[][] {
  const runs: string[][] = []
  let run: string[] = []
  let len = 0
  for (const p of paths) {
    if (run.length > 0 && len + p.length + 3 > max) {
      runs.push(run)
      run = []
      len = 0
    }
    run.push(p)
    len += p.length + 3
  }
  if (run.length > 0) runs.push(run)
  return runs
}

/** The arguments for `wt` to open a tab in the current window, in `cwd`, resuming the session. */
export function resumeArgv(cwd: string, sessionId: string): string[] {
  return ['wt', '-w', '0', 'nt', '-d', cwd, 'claude', '--resume', sessionId]
}

/**
 * The ways to resume, tried in order: Windows Terminal directly; through `start`, which finds
 * it the way the shell does; a plain console window in the folder, as Dev Deck falls back to.
 */
export function resumeAttempts(cwd: string, sessionId: string): string[][] {
  const wt = resumeArgv(cwd, sessionId)
  return [wt, ['cmd', '/c', 'start', '', ...wt], ['cmd', '/c', 'start', '', '/d', cwd, 'cmd', '/k', 'claude', '--resume', sessionId]]
}

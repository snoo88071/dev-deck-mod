import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderNode, Timer } from 'claude-code'

import { fit, fitStart, shortPath, since, statusLabel } from './engine/format'
import { batches, byDay, clock, parseFindstr, parseTranscript, resumeAttempts, search } from './engine/history'
import { bytes, contextPercent, findOrphans, lastUsage, parseNetstat, parseProcs, projectFolder, sessionLoad, treeOf } from './engine/procs'
import { commandFolder, reuseNote, runningServer, serverStart } from './engine/guard'
import { justFinished, lastTitle, parseSession, shownState, sortSessions } from './engine/sessions'
import { parseChapters, scrollId, textKey } from './engine/chapters'
import { regLanguage, resolveLang, setLang, t } from './engine/i18n'
import { INPUT, PRESENCE, alertsFor } from './engine/alerts'
import type { Presence } from './engine/alerts'
import type { Branch, Chapter, DeckTab, LiveSession, PastSession, SessionLoad } from '../types'

const PANE = 'deck'
/** The session files are read this often while the pane is open: a read is a few small files. */
const REFRESH_MS = 2_000
/** The processes are read this often: one PowerShell call and netstat, 1.2-2.2 s measured. */
const PROCS_MS = 10_000
/** How long a first press on Stop waits for the second. */
const ARM_MS = 3_000
/** Where the history index is kept between sessions. */
const INDEX_KEY = 'history-index'

const sessions = atom({ plugin: 'dev-deck-mod', key: 'sessions' } as const, [])
const tab = atom({ plugin: 'dev-deck-mod', key: 'tab' } as const, 'open')
const history = atom({ plugin: 'dev-deck-mod', key: 'history' } as const, [])
const query = atom({ plugin: 'dev-deck-mod', key: 'query' } as const, '')
const isScanning = atom({ plugin: 'dev-deck-mod', key: 'isScanning' } as const, false)
const loads = atom({ plugin: 'dev-deck-mod', key: 'loads' } as const, {})
const armed = atom({ plugin: 'dev-deck-mod', key: 'armed' } as const, 0)
const chapters = atom({ plugin: 'dev-deck-mod', key: 'chapters' } as const, [])
const band = atom({ plugin: 'dev-deck-mod', key: 'band' } as const, { servers: [], ram: 0 })
const orphans = atom({ plugin: 'dev-deck-mod', key: 'orphans' } as const, [])
const alerts = atom({ plugin: 'dev-deck-mod', key: 'alerts' } as const, [])
const focused = atom({ plugin: 'dev-deck-mod', key: 'focused' } as const, '')

/** After a command, the band waits this long before reading: a server takes a moment to listen. */
const OWN_DELAY_MS = 3_000
/** The other sessions' states are read this often, pane open or not: a few small store reads. */
const ALERTS_MS = 3_000
/** A closed session's state is forgotten after this long (a crash leaves it behind). */
const PRESENCE_TTL_MS = 24 * 3_600_000

/**
 * One transcript as the index last saw it: its size, its last write, and what it held,
 * `0` for a transcript that isn't a terminal session.
 */
type IndexEntry = [size: number, mtimeMs: number, session: PastSession | 0]

// Module variables: set again by session.start after every reload.
let home = ''
let me = ''
let langKnown = false
let ticker: Timer | undefined
let alive: Set<number> | undefined
let procsAt = 0
let scanning: Promise<void> | undefined
/** Each open session's status at the last read: a change from busy to idle is «finished». */
let lastStatus = new Map<string, string>()
/** Titles read from the transcripts, with the status they were read at: a new answer may retitle. */
const titles = new Map<string, { title: string | undefined; status: string; at: number }>()
/** A title is read again this often even when nothing changed. */
const TITLE_MS = 60_000
/** The ids Claude Code drew the person's messages under, by the start of their text. */
const drawnIds = new Map<string, string>()
/** The transcript's last write when the chapters were read. */
let chaptersMtime = 0
/** The band's next read, pending: a later ask moves it, so reads close together are one. */
let ownTimer: Timer | undefined
/** When the current answer began, and whether Claude ran a shell command in it. */
let turnStartedAt = 0
let ranCommand = false
/** Set when an answer ended: the next read says which servers born since then are still up. */
let reportFrom: number | undefined
/** What this session last said about itself, and how it names itself to the others. */
let ownState: Presence['state'] | undefined
let ownLabel = ''
/** Whether this session is a terminal one: only those take part in the alerts. */
let isCli = false
let alertTimer: Timer | undefined

// What reaches outside the mod goes through $, and $ can't cross an import: these live here.

/** Tells the other sessions what this one is doing now. */
async function publish($: EngineInterface, state: Presence['state']): Promise<void> {
  if (!isCli || !me) return
  ownState = state
  const presence: Presence = { state, label: ownLabel || me.slice(0, 8), at: await $.clock.now() }
  try {
    await $.store.set(PRESENCE + me, presence)
  } catch {
    // Not written this time: the next change says it again.
  }
}

/** How this session names itself: Claude's title for it once there is one, else its name. */
async function refreshLabel($: EngineInterface): Promise<void> {
  const mine = (await readSessions($, await configDir($))).find(s => s.sessionId === me)
  if (!mine) return
  ownLabel = ownLabel || mine.name
  try {
    const path = (await configDir($)) + '\\projects\\' + projectFolder(mine.cwd) + '\\' + me + '.jsonl'
    const r = await $.process.run(['findstr', '/c:"aiTitle"', path], { timeoutMs: 10_000 })
    ownLabel = lastTitle(r.stdout) ?? ownLabel
  } catch {
    // No transcript yet: the name stands in.
  }
}

/** Starts reading the other sessions' states, once: from session.start, or the first event after a reload. */
async function ensureAlerts($: EngineInterface): Promise<void> {
  if (alertTimer) return
  if (!me) me = await $.session.id()
  await ensureLang($)
  alertTimer = $.clock.every(ALERTS_MS, () => void readAlerts($).catch(() => {}))
  await readAlerts($).catch(() => {})
  if (isCli && !ownLabel) await refreshLabel($)
}

/** Reads what every open CLI session last said, for the band of the session the person is in. */
async function readAlerts($: EngineInterface): Promise<void> {
  const live = await readSessions($, await configDir($))
  isCli = live.some(s => s.sessionId === me)
  if (!isCli) return
  const now = await $.clock.now()
  const ids = new Set(live.map(s => s.sessionId))
  const presences: Record<string, Presence> = {}
  const inputs: Record<string, number> = {}
  for (const key of await $.store.keys()) {
    if (key.startsWith(PRESENCE)) {
      const id = key.slice(PRESENCE.length)
      const p = (await $.store.get(key)) as Presence | undefined
      if (!p) continue
      if (!ids.has(id) && now - p.at > PRESENCE_TTL_MS) await $.store.delete(key)
      else presences[id] = p
    } else if (key.startsWith(INPUT)) {
      const id = key.slice(INPUT.length)
      const at = Number(await $.store.get(key)) || 0
      if (!ids.has(id) && now - at > PRESENCE_TTL_MS) await $.store.delete(key)
      else inputs[id] = at
    }
  }
  const { show, alerts: list } = alertsFor(me, presences, inputs, ids)
  await update($, alerts, () => (show ? list : []))
}

/** Where Claude Code keeps its files: `CLAUDE_CONFIG_DIR`, or `.claude` in the home folder. */
async function configDir($: EngineInterface): Promise<string> {
  const custom = await $.env.get('CLAUDE_CONFIG_DIR')
  return custom ? custom : (await homeDir($)) + '\\.claude'
}

/**
 * Sets the mod's language once: `DEVDECK_LANG` when set (as in the app), else Windows' display
 * language from the registry (~40 ms), else its regional format; English when none says.
 */
async function ensureLang($: EngineInterface): Promise<void> {
  if (langKnown) return
  langKnown = true
  const forced = await $.env.get('DEVDECK_LANG')
  if (forced?.trim()) return setLang(resolveLang(forced))
  const places: [string, string][] = [
    ['HKCU\\Control Panel\\Desktop', 'PreferredUILanguages'],
    ['HKCU\\Control Panel\\International', 'LocaleName'],
  ]
  for (const [key, value] of places) {
    try {
      const tag = regLanguage((await $.process.run(['reg', 'query', key, '/v', value], { timeoutMs: 5_000 })).stdout)
      if (tag) return setLang(resolveLang(tag))
    } catch {
      // Not there: the next place may say.
    }
  }
}

async function homeDir($: EngineInterface): Promise<string> {
  if (!home) home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  return home
}

/** Every session file that parses as an open CLI session. */
async function readSessions($: EngineInterface, dir: string): Promise<LiveSession[]> {
  const folder = dir + '\\sessions'
  let entries
  try {
    entries = await $.fs.list(folder)
  } catch {
    return []
  }
  const found: LiveSession[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    try {
      const one = parseSession(await $.fs.read(folder + '\\' + entry.name))
      if (one) found.push(one)
    } catch {
      // Deleted between the listing and the read: the session just exited.
    }
  }
  return sortSessions(found)
}

/**
 * One PowerShell call: every process (pid, parent, name, memory, command line) and, for each open
 * session, the last answer in its transcript, read from the file's last 256 KB.
 */
function loadScript(transcripts: [string, string][]): string {
  const tails = transcripts
    .map(([id, path]) => `Tail '${id.replace(/'/g, "''")}' '${path.replace(/'/g, "''")}'`)
    .join('; ')
  return [
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
    // s: when the process started, in milliseconds since the epoch.
    '$procs = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,WorkingSetSize,CommandLine,CreationDate | ForEach-Object { [pscustomobject]@{ i=[int]$_.ProcessId; p=[int]$_.ParentProcessId; n=$_.Name; w=[double]$_.WorkingSetSize; c=$_.CommandLine; s=$(if ($_.CreationDate) { [long]([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { 0 }) } })',
    '$tails = @{}',
    // The file's last 256 KB, shared with Claude Code still writing it; the last answer's line.
    `function Tail($id, $f) { try { $s=[IO.File]::Open($f,'Open','Read','ReadWrite'); try { $n=[Math]::Min(262144,$s.Length); [void]$s.Seek(-$n,'End'); $b=New-Object byte[] $n; [void]$s.Read($b,0,$n) } finally { $s.Close() }; $l=[Text.Encoding]::UTF8.GetString($b) -split "\`n"; for ($k=$l.Length-1; $k -ge 0; $k--) { if ($l[$k] -like '*"type":"assistant"*' -and $l[$k] -like '*"usage"*') { $tails[$id]=$l[$k]; break } } } catch {} }`,
    tails,
    '@{ procs=$procs; tails=$tails } | ConvertTo-Json -Compress -Depth 3',
  ].join('\n')
}

/** What each open session holds; also which pids are alive. `undefined` when Windows can't say. */
async function readLoads($: EngineInterface, live: LiveSession[]): Promise<Record<string, SessionLoad> | undefined> {
  const root = (await configDir($)) + '\\projects\\'
  const transcripts = live.map(s => [s.sessionId, root + projectFolder(s.cwd) + '\\' + s.sessionId + '.jsonl'] as [string, string])
  let out: { procs?: unknown; tails?: Record<string, string> }
  try {
    const r = await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', loadScript(transcripts)], { timeoutMs: 20_000 })
    out = JSON.parse(r.stdout)
  } catch {
    return undefined
  }
  const procs = parseProcs(JSON.stringify(out.procs ?? []))
  if (procs.length === 0) return undefined
  alive = new Set(procs.map(p => p.pid))
  let ports = new Map<number, number[]>()
  try {
    ports = parseNetstat((await $.process.run(['netstat', '-ano', '-p', 'TCP'], { timeoutMs: 10_000 })).stdout)
  } catch {
    // No ports this time: the rest still shows.
  }
  const own = await ownContext($)
  const tree = treeOf(procs)
  const leftover = findOrphans(tree, ports)
  await update($, orphans, () => leftover)
  const result: Record<string, SessionLoad> = {}
  for (const s of live) {
    const load: SessionLoad = sessionLoad(s.pid, tree, ports)
    const usage = lastUsage(out.tails?.[s.sessionId] ?? '')
    if (s.sessionId === me && own) load.context = own.percent
    else if (usage) load.context = contextPercent(usage.tokens, usage.model, own)
    result[s.sessionId] = load
  }
  return result
}

/** This session's context, exact, and its model: the yardstick for the others. */
async function ownContext($: EngineInterface): Promise<{ model: string; window: number; percent: number } | undefined> {
  try {
    const u = await $.session.usage()
    // Before the first answer the session has no measure yet.
    if (u.context.percent === undefined) return undefined
    return { model: await $.session.model(), window: u.context.window, percent: Math.round(u.context.percent) }
  } catch {
    return undefined
  }
}

async function refresh($: EngineInterface): Promise<void> {
  await ensureLang($)
  const now = await $.clock.now()
  if (!me) me = await $.session.id()
  const found = await readSessions($, await configDir($))
  if (now - procsAt >= PROCS_MS) {
    procsAt = now
    const read = await readLoads($, found)
    if (read) await update($, loads, () => read)
  }
  const alivenow = alive ? found.filter(s => alive!.has(s.pid) || s.sessionId === me) : found
  const open = await withTitles($, alivenow, now)
  for (const s of justFinished(lastStatus, open)) {
    if (s.sessionId !== me) $.ui.toast(t('finished', { name: s.title ?? s.name }))
  }
  lastStatus = new Map(open.map(s => [s.sessionId, s.status]))
  await update($, sessions, () => open)
  if ((await read($, tab)) === 'chapters') await readChapters($)
  // The ages move even when the list doesn't.
  $.ui.invalidate('ui.render')
}

/** The sessions with the title Claude Code wrote, read again when one stops or a minute went by. */
async function withTitles($: EngineInterface, list: LiveSession[], now: number): Promise<LiveSession[]> {
  const root = (await configDir($)) + '\\projects\\'
  const out: LiveSession[] = []
  for (const s of list) {
    let known = titles.get(s.sessionId)
    if (!known || known.status !== s.status || now - known.at >= TITLE_MS) {
      let title = known?.title
      try {
        const path = root + projectFolder(s.cwd) + '\\' + s.sessionId + '.jsonl'
        const r = await $.process.run(['findstr', '/c:"aiTitle"', path], { timeoutMs: 10_000 })
        title = lastTitle(r.stdout) ?? title
      } catch {
        // No transcript yet: the name stands in.
      }
      known = { title, status: s.status, at: now }
      titles.set(s.sessionId, known)
    }
    out.push(known.title ? { ...s, title: known.title } : s)
  }
  return out
}

/** Starts the refresh while the pane is open; resolves once the first read is in. */
async function start($: EngineInterface): Promise<void> {
  if (ticker) return
  procsAt = 0
  ticker = $.clock.every(REFRESH_MS, () => void refresh($))
  await refresh($)
}

function stop(): void {
  ticker?.cancel()
  ticker = undefined
  // What happened while the pane was closed isn't news when it opens again.
  lastStatus = new Map()
}

/** Every top-level transcript under `<config>/projects`, with its size and last write. */
async function listTranscripts($: EngineInterface, root: string): Promise<Map<string, [number, number]>> {
  const found = new Map<string, [number, number]>()
  let folders
  try {
    folders = await $.fs.list(root)
  } catch {
    return found
  }
  for (const folder of folders) {
    if (folder.kind !== 'dir') continue
    let files
    try {
      files = await $.fs.list(root + '\\' + folder.name)
    } catch {
      continue
    }
    for (const f of files) {
      if (f.kind === 'file' && f.name.endsWith('.jsonl')) found.set(root + '\\' + folder.name + '\\' + f.name, [f.size, f.mtimeMs])
    }
  }
  return found
}

/** Which of `paths` were started from a terminal: findstr stops at the first match in each file. */
async function terminalTranscripts($: EngineInterface, paths: string[]): Promise<Set<string>> {
  const hits = new Set<string>()
  for (const run of batches(paths)) {
    try {
      // Exit 1 just means no file matched.
      const r = await $.process.run(['findstr', '/m', '/c:"entrypoint":"cli"', ...run], { timeoutMs: 120_000 })
      for (const p of parseFindstr(r.stdout)) hits.add(p.toLowerCase())
    } catch {
      // A run that failed counts as no match: it is read again on the next scan.
    }
  }
  return hits
}

/**
 * The lines of a transcript a row needs: its titles and the prompts typed as plain text, which
 * carry the folder and the branch too. findstr pulls them out in ~50 ms from a 5 MB file, where
 * reading it whole (or PowerShell's `-Tail`, minutes) costs far more.
 */
async function transcriptLines($: EngineInterface, path: string): Promise<string> {
  const r = await $.process.run(['findstr', '/c:"aiTitle"', '/c:"role":"user","content":"', path], { timeoutMs: 30_000 })
  return r.stdout
}

/** Brings the history up to date: only new or changed transcripts are read again. */
async function scanHistory($: EngineInterface): Promise<void> {
  const root = (await configDir($)) + '\\projects'
  const index = ((await $.store.get(INDEX_KEY)) ?? {}) as Record<string, IndexEntry>
  const isFirst = Object.keys(index).length === 0
  if (isFirst) await update($, isScanning, () => true)

  const files = await listTranscripts($, root)
  const changed = [...files].filter(([p, [size, mtime]]) => {
    const was = index[p]
    return !was || was[0] !== size || was[1] !== mtime
  })
  const cli = changed.length > 0 ? await terminalTranscripts($, changed.map(([p]) => p)) : new Set<string>()

  const next: Record<string, IndexEntry> = {}
  for (const [p, [size, mtime]] of files) {
    const was = index[p]
    if (was && was[0] === size && was[1] === mtime) {
      next[p] = was
      continue
    }
    let session: PastSession | 0 = 0
    if (cli.has(p.toLowerCase())) {
      try {
        const id = p.slice(p.lastIndexOf('\\') + 1, -'.jsonl'.length)
        session = parseTranscript(id, await transcriptLines($, p), mtime) ?? 0
      } catch {
        continue // Unreadable now: left out of the index, so the next scan tries again.
      }
    }
    next[p] = [size, mtime, session]
  }
  await $.store.set(INDEX_KEY, next)
  const past = Object.values(next).flatMap(([, , s]) => (s ? [s] : []))
  await update($, history, () => past)
  await update($, isScanning, () => false)
}

/** One scan at a time: a second ask while one runs waits for it. */
function rescan($: EngineInterface): Promise<void> {
  scanning ??= scanHistory($).finally(() => {
    scanning = undefined
  })
  return scanning
}

/** Asks for the band to read this session again in a few seconds; asks close together are one. */
function scheduleOwnRead($: EngineInterface): void {
  ownTimer?.cancel()
  ownTimer = $.clock.after(OWN_DELAY_MS, () => void readOwn($))
}

/** What this session keeps on, for the band: its servers, its memory, its context. */
async function readOwn($: EngineInterface): Promise<void> {
  await ensureLang($)
  if (!me) me = await $.session.id()
  const mine = (await readSessions($, await configDir($))).find(s => s.sessionId === me)
  if (!mine) return
  const snap = await readTree($)
  if (!snap) return
  const load = sessionLoad(mine.pid, snap.tree, snap.ports)
  const own = await ownContext($)
  const up = load.branches.filter(b => b.ports.length > 0)
  const servers = up.map(b => ({ label: b.label, ports: b.ports }))
  await update($, band, () => ({ servers, ram: load.ram, ...(own ? { context: own.percent } : {}) }))
  if (reportFrom !== undefined) {
    const from = reportFrom
    reportFrom = undefined
    const born = up.filter(b => b.started >= from)
    if (born.length > 0) {
      const names = born.map(b => b.label + ' ' + b.ports.map(p => ':' + p).join(' ')).join(' · ')
      $.ui.log(t(born.length === 1 ? 'leftOnOne' : 'leftOnMany', { names }))
    }
  }
}

/** Reads this session's messages again, when its transcript changed since the last read. */
async function readChapters($: EngineInterface): Promise<void> {
  if (!me) me = await $.session.id()
  const cwd = (await read($, sessions)).find(s => s.sessionId === me)?.cwd ?? (await $.session.cwd())
  const path = (await configDir($)) + '\\projects\\' + projectFolder(cwd) + '\\' + me + '.jsonl'
  let mtime: number
  try {
    mtime = (await $.fs.stat(path)).mtimeMs
  } catch {
    return // No transcript before the first message.
  }
  if (mtime === chaptersMtime) return
  try {
    const r = await $.process.run(['findstr', '/c:"role":"user","content":"', path], { timeoutMs: 15_000 })
    await update($, chapters, () => parseChapters(r.stdout))
    chaptersMtime = mtime
  } catch {
    // Read again at the next refresh.
  }
}

/** Shows the chapters, from the newest: the pane's window goes to its end. */
async function openChapters($: EngineInterface): Promise<void> {
  await readChapters($)
  try {
    await $.ui.scroll({ in: PANE, to: 'end' })
  } catch {
    // The pane opens at its top instead.
  }
}

/** Brings a message back into view at the top of the conversation. */
async function goTo($: EngineInterface, chapter: Chapter): Promise<void> {
  let moved = false
  try {
    moved = !(await $.ui.scroll({ to: { requestId: scrollId(chapter, drawnIds) }, block: 'start' })).deny
  } catch {
    // No row by that id on this surface.
  }
  if (!moved) $.ui.toast(t('goneMessage'))
}

/** Opens a terminal in the session's folder resuming it: Windows Terminal, else a console window. */
async function resume($: EngineInterface, s: PastSession): Promise<void> {
  if (!(await $.fs.exists(s.cwd))) {
    $.ui.toast(t('noFolder', { path: s.cwd }))
    return
  }
  let why = ''
  for (const argv of resumeAttempts(s.cwd, s.sessionId)) {
    try {
      const r = await $.process.run(argv, { timeoutMs: 15_000 })
      if (r.exitCode === 0) return
      why = argv[0] + ' exit ' + r.exitCode + (r.stderr.trim() ? ': ' + r.stderr.trim() : '')
    } catch (err) {
      why = argv[0] + ': ' + (err instanceof Error ? err.message : String(err))
    }
    $.ui.log('resume: ' + why, { to: 'debug' })
  }
  $.ui.toast(t('noTerminal') + ' (' + why.slice(0, 160) + ')')
}

/** Closes a branch and its whole tree, then reads the processes again so the row goes. */
async function stopBranch($: EngineInterface, pid: number): Promise<void> {
  try {
    await $.process.run(['taskkill', '/PID', String(pid), '/T', '/F'], { timeoutMs: 15_000 })
  } catch {
    // Gone already, or not ours to close: the next read says which.
  }
  procsAt = 0
  await refresh($)
  scheduleOwnRead($)
}

/** Every process and the ports they listen on, for the guard and the band: no transcripts read. */
async function readTree($: EngineInterface) {
  try {
    const r = await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', loadScript([])], { timeoutMs: 20_000 })
    const procs = parseProcs(JSON.stringify(JSON.parse(r.stdout).procs ?? []))
    if (procs.length === 0) return undefined
    const net = await $.process.run(['netstat', '-ano', '-p', 'TCP'], { timeoutMs: 10_000 })
    return { tree: treeOf(procs), ports: parseNetstat(net.stdout) }
  } catch {
    return undefined
  }
}


/** Stop takes two presses: the first arms the button for a few seconds, the second closes. */
async function pressStop($: EngineInterface, pid: number): Promise<void> {
  if ((await read($, armed)) !== pid) {
    await update($, armed, () => pid)
    $.clock.after(ARM_MS, () => void update($, armed, was => (was === pid ? 0 : was)))
    return
  }
  await update($, armed, () => 0)
  await stopBranch($, pid)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await homeDir($)
    await ensureLang($)
    me = await $.session.id()
    try {
      await $.command.register({ name: 'deck', description: t('commandDescription'), immediate: true })
    } catch {
      // The name is taken: the pane can't be opened, the rest of the mod still runs.
    }
    // A reload while the pane is open keeps the pane: keep it fed.
    if ((await $.ui.panes()).some(p => p.id === PANE)) {
      void start($)
      if ((await read($, tab)) === 'history') void rescan($)
    }
    await ensureAlerts($)
    return next(e)
  })

  // The person typed here: this is the session they're in, and whatever it had to say is seen.
  on('prompt.submit', async ($, e, next) => {
    await ensureAlerts($)
    if (isCli) await $.store.set(INPUT + me, await $.clock.now()).catch(() => {})
    return next(e)
  }).catch(($, e, next) => next(e))

  // A permission to give: the session waits for the person.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask') await publish($, 'waiting')
    return verdict
  }).catch(($, e, next) => next(e))

  // A question Claude asks waits for the person too; once a tool runs, the session is at work again.
  on('tool.call', async ($, e, next) => {
    if (String(e.tool) === 'AskUserQuestion') await publish($, 'waiting')
    const ran = await next(e)
    if (ownState === 'waiting') await publish($, 'busy')
    return ran
  }).catch(($, e, next) => next(e))

  // A session that ends says nothing more.
  on('session.end', async ($, e, next) => {
    if (isCli && me) {
      await $.store.delete(PRESENCE + me).catch(() => {})
      await $.store.delete(INPUT + me).catch(() => {})
    }
    return next(e)
  })

  on('command.run', { command: 'deck' }, async $ => {
    await start($)
    await $.ui.open({ id: PANE, title: 'Dev Deck', focus: true })
    if ((await read($, tab)) === 'history') void rescan($)
    return {}
  })

  // After a shell command the processes may have changed: the band reads again shortly.
  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const ran = await next(e)
    ranCommand = true
    scheduleOwnRead($)
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    turnStartedAt = await $.clock.now()
    ranCommand = false
    await ensureAlerts($)
    await publish($, 'busy')
    return next(e)
  })

  // At the end of each answer, for what changed some other way; after one that ran commands,
  // the read also says which servers it left on. The other sessions learn this one is done.
  on('turn.complete', async ($, e, next) => {
    if (ranCommand && turnStartedAt > 0) reportFrom = turnStartedAt
    scheduleOwnRead($)
    await refreshLabel($)
    await publish($, 'done')
    return next(e)
  })

  // Above the prompt: the other sessions waiting for you or done, then what this one keeps on.
  // Nothing when there's nothing to say.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface === 'mobile') return next(e)
    const state = await read($, band)
    const others = await read($, alerts)
    if (state.servers.length === 0 && others.length === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const servers = state.servers.map(s => s.label + ' ' + s.ports.map(p => ':' + p).join(' ')).join(' · ')
    const rest = ' · ' + bytes(state.ram) + (state.context !== undefined ? ' · ctx ' + state.context + '%' : '')
    return (
      <Box flexDirection="column">
        {others.length > 0 && (
          <Box key="alerts" flexDirection="row" columnGap={2}>
            {others.map(a => (
              <Text key={'alert-' + a.sessionId} color={a.state === 'waiting' ? 'warning' : 'success'} wrap="truncate-end">
                {(a.state === 'waiting' ? '⏳ ' : '✓ ') + t(a.state === 'waiting' ? 'waiting' : 'finished', { name: a.label })}
              </Text>
            ))}
          </Box>
        )}
        {state.servers.length > 0 && (
          <Box key="servers" flexDirection="row">
            <Text color="success" wrap="truncate-end">
              {servers}
            </Text>
            <Text dimColor>{rest}</Text>
          </Box>
        )}
      </Box>
    )
  })

  // A second dev server for the same project, or on a port already taken: ask first.
  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const command = (e as { command?: unknown }).command
    if (typeof command !== 'string') return next(e)
    const start = serverStart(command)
    if (!start) return next(e)
    const snap = await readTree($)
    if (!snap) return next(e)
    const live = await readSessions($, await configDir($))
    const found = runningServer(start, commandFolder(command, await $.session.cwd()), snap.tree, snap.ports, live)
    if (!found) return next(e)

    await ensureLang($)
    const where = found.ports.map(p => ':' + p).join(' ')
    // The answer comes back as the label chosen: the same words both ways.
    const reuse = t('reuse')
    const restart = t('restart')
    const launch = t('launch')
    const question =
      found.why === 'port'
        ? t('guardPort', { port: start.port ?? '', label: found.label, where })
        : t('guardProject', { label: found.label, where })
    let choice: string
    try {
      choice = await $.ui.ask(question, { header: t('guardHeader'), options: [reuse, restart, launch] })
    } catch {
      // Nobody to ask (claude -p), or the question was closed: the command goes on as asked.
      return next(e)
    }
    if (choice === reuse) return { deny: reuseNote(found) }
    if (choice === restart) {
      try {
        await $.process.run(['taskkill', '/PID', String(found.pid), '/T', '/F'], { timeoutMs: 15_000 })
      } catch {
        // Gone already: the command starts all the same.
      }
      return next(e)
    }
    if (choice === launch) return next(e)
    // Typed under "Other": it's for Claude.
    return { deny: `A dev server is already running (${found.label}, ${where}). Before starting another, the person said: ${choice}` }
  }).catch(($, e, next) => next(e))

  // Where the pane's focus is, so the row holding it can read whole.
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)
    if (!('deny' in moved && moved.deny)) await update($, focused, () => e.element ?? '')
    return moved
  }).catch(($, e, next) => next(e))

  // Notes the id each of the person's messages is drawn under, for the chapters; draws nothing.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.origin?.kind === 'composer' && e.requestId) {
      drawnIds.set(textKey(e.props.text), e.requestId)
      if (drawnIds.size > 2_000) drawnIds.delete(drawnIds.keys().next().value!)
    }
    return next(e)
  })

  // Never keeps a pane open: whatever happens here, the close goes on.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) stop()
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    // The phone has no text field; the CLI is what this is for.
    if (e.surface === 'mobile') return next(e)
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const shown = await read($, tab)
    const focusedKey = await read($, focused)
    const live = await read($, sessions)
    const now = await $.clock.now()
    const width = e.props.bodyColumns ?? 80
    const rows = Math.max(4, e.props.scroll?.bodyRows ?? 12)

    const tabButton = (name: DeckTab, label: string, hotkey: string) => (
      <Button
        key={'tab-' + name}
        label={label}
        hotkey={hotkey}
        plain
        dimColor={shown !== name}
        onPress={async () => {
          await update($, tab, () => name)
          if (name === 'history') void rescan($)
          if (name === 'chapters') await openChapters($)
        }}
      />
    )
    const tabs = (
      <Box flexDirection="row" columnGap={3}>
        {tabButton('open', t('tabOpen'), '1')}
        {tabButton('history', t('tabHistory'), '2')}
        {tabButton('chapters', t('tabChapters'), '3')}
      </Box>
    )

    if (shown === 'chapters') {
      const list = await read($, chapters)
      return (
        <Box flexDirection="column">
          {tabs}
          {list.length === 0 && <Text dimColor>{t('noMessages')}</Text>}
          {list.map(ch => {
            // The row with the focus reads whole, its time included.
            const isFocused = focusedKey === 'ch-' + ch.uuid
            return (
              <Box key={'chapter-' + ch.uuid} flexDirection="row">
                <Text inverse={isFocused} dimColor={!isFocused}>
                  {(ch.at ? clock(ch.at) : '     ') + '  '}
                </Text>
                <Button key={'ch-' + ch.uuid} label={fit(ch.text, Math.max(10, width - 9))} plain onPress={() => goTo($, ch)} />
              </Box>
            )
          })}
        </Box>
      )
    }

    if (shown === 'open') {
      const held = await read($, loads)
      const armedPid = await read($, armed)
      const markW = 2
      const stateW = 10
      const ageW = 8
      const ctxW = 8
      const ramW = 8
      // The title says what a session is about: it gets the room, the folder what's left.
      const nameW = Math.min(40, Math.max(12, Math.floor(width * 0.32)))
      const folderW = Math.max(8, width - markW - nameW - stateW - ageW - ctxW - ramW - 6)
      const stopW = 11
      const portsW = 14
      const labelW = Math.max(10, width - 4 - portsW - ramW - stopW - 3)
      const left = await read($, orphans)
      // One thing a session started, or left behind, a level under it: name, ports, memory, Stop.
      // Stop stays quiet until it has the focus or its first press arms it.
      const branchRows = (list: Branch[]) =>
        list.map((b, i) => {
          const isArmed = armedPid === b.pid
          return (
            <Box key={'branch-' + b.pid} flexDirection="row" columnGap={1}>
              <Text color="subtle">{i === list.length - 1 ? ' └' : ' ├'}</Text>
              <Box width={labelW}>
                <Text wrap="truncate-end">{b.label}</Text>
              </Box>
              <Box width={portsW}>
                <Text color="success">{b.ports.map(p => ':' + p).join(' ')}</Text>
              </Box>
              <Box width={ramW}>
                <Text>{bytes(b.ram)}</Text>
              </Box>
              {isArmed ? (
                <Button key={'stop-' + b.pid} label={t('sure')} variant="primary" onPress={() => pressStop($, b.pid)} />
              ) : (
                <Button key={'stop-' + b.pid} label={t('stop')} plain dimColor onPress={() => pressStop($, b.pid)} />
              )}
            </Box>
          )
        })
      return (
        <Box flexDirection="column">
          {tabs}
          {live.length === 0 && (
            <Box marginTop={1}>
              <Text dimColor>{t('noOpenSessions')}</Text>
            </Box>
          )}
          {live.map(s => {
            const state = shownState(s, now)
            const isBusy = state === 'busy'
            const isDone = state === 'done'
            const isMe = s.sessionId === me
            const load = held[s.sessionId]
            // The session heads its branches: its title and memory in bold, its state in colour.
            return (
              <Box key={s.sessionId} flexDirection="column" marginTop={1}>
                <Box flexDirection="row" columnGap={1}>
                  <Box width={markW}>
                    <Text color={isBusy || isDone ? 'success' : 'subtle'}>{isBusy ? '●' : isDone ? '✓' : '○'}</Text>
                  </Box>
                  <Box width={nameW}>
                    <Text bold color={isMe ? 'claude' : undefined} wrap="truncate-end">
                      {s.title ?? s.name}
                    </Text>
                  </Box>
                  <Box width={folderW}>
                    <Text dimColor wrap="truncate-start">{shortPath(s.cwd, home)}</Text>
                  </Box>
                  <Box width={stateW}>
                    <Text bold={isDone} color={isBusy || isDone ? 'success' : undefined} dimColor={!isBusy && !isDone}>
                      {statusLabel(state)}
                    </Text>
                  </Box>
                  <Box width={ageW}>
                    <Text dimColor>{since(s.startedAt, now)}</Text>
                  </Box>
                  <Box width={ctxW}>
                    <Text dimColor>{load?.context !== undefined ? 'ctx ' + load.context + '%' : ''}</Text>
                  </Box>
                  <Box width={ramW}>
                    <Text bold>{load ? bytes(load.ram) : ''}</Text>
                  </Box>
                </Box>
                {branchRows(load?.branches ?? [])}
              </Box>
            )
          })}
          {left.length > 0 && (
            <Box key="orphans" flexDirection="column" marginTop={1}>
              <Text color="warning" bold>
                {t('orphans')}
              </Text>
              {branchRows(left)}
            </Box>
          )}
        </Box>
      )
    }

    const q = await read($, query)
    const past = await read($, history)
    const isFirstScan = await read($, isScanning)
    const openIds = new Set(live.map(s => s.sessionId))
    const timeW = 5
    const folderW = Math.min(36, Math.max(12, Math.floor(width * 0.35)))
    const titleW = Math.max(10, width - folderW - timeW - 6)

    // The tab row and the field take two rows; each day takes two more, a blank line and its heading.
    let room = rows - 2
    const lines: RenderNode[] = []
    let firstRow: string | undefined
    for (const group of byDay(search(past, q), now)) {
      if (room < 3) break
      lines.push(
        <Box key={'day-' + group.day} marginTop={1}>
          <Text bold color="suggestion">
            {group.day}
          </Text>
        </Box>,
      )
      room -= 2
      for (const s of group.sessions) {
        if (room < 1) break
        room -= 1
        const label = fit(s.title, titleW) + '  '
        const tail = fitStart(shortPath(s.cwd, home), folderW) + '  ' + clock(s.lastAt)
        if (openIds.has(s.sessionId)) {
          lines.push(
            <Text key={s.sessionId} dimColor>
              {'● ' + label + tail}
            </Text>,
          )
          continue
        }
        firstRow ??= s.sessionId
        // The row with the focus reads whole, its folder and time included.
        const isFocused = focusedKey === s.sessionId
        lines.push(
          <Box key={'row-' + s.sessionId} flexDirection="row">
            <Text inverse={isFocused}>{'  '}</Text>
            <Button key={s.sessionId} label={label} plain onPress={() => resume($, s)} />
            <Text inverse={isFocused} dimColor={!isFocused}>
              {tail}
            </Text>
          </Box>,
        )
      }
    }

    return (
      <Box flexDirection="column">
        {tabs}
        <Input
          key="search"
          label={t('search')}
          placeholder={t('searchPlaceholder')}
          value={q}
          autoFocus
          submitLabel={t('go')}
          onInput={(value: string) => void update($, query, () => value)}
          onSubmit={async (value: string) => {
            await update($, query, () => value)
            // Enter takes the keyboard to the first result.
            if (firstRow) await $.ui.focus({ requestId: PANE, key: firstRow }).catch(() => {})
          }}
        />
        {isFirstScan && past.length === 0 && <Text dimColor>…</Text>}
        {lines}
      </Box>
    )
  })
}

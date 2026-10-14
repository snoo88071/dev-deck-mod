import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderNode, Timer } from 'claude-code'

import { fit, fitStart, shortPath, since, statusLabel } from './engine/format'
import { batches, byDay, clock, parseFindstr, parseTranscript, resumeArgv, search } from './engine/history'
import { parseSession, parseTasklist, sortSessions } from './engine/sessions'
import type { LiveSession, PastSession } from '../types'

const PANE = 'deck'
/** The session files are read this often while the pane is open: a read is a few small files. */
const REFRESH_MS = 2_000
/** The pids are checked this often: tasklist costs ~300 ms, and only a crash leaves a file behind. */
const ALIVE_MS = 10_000
/** Where the history index is kept between sessions. */
const INDEX_KEY = 'history-index'

const sessions = atom({ plugin: 'dev-deck-mod', key: 'sessions' } as const, [])
const tab = atom({ plugin: 'dev-deck-mod', key: 'tab' } as const, 'open')
const history = atom({ plugin: 'dev-deck-mod', key: 'history' } as const, [])
const query = atom({ plugin: 'dev-deck-mod', key: 'query' } as const, '')
const isScanning = atom({ plugin: 'dev-deck-mod', key: 'isScanning' } as const, false)

/**
 * One transcript as the index last saw it: its size, its last write, and what it held,
 * `0` for a transcript that isn't a terminal session.
 */
type IndexEntry = [size: number, mtimeMs: number, session: PastSession | 0]

// Module variables: set again by session.start after every reload.
let home = ''
let me = ''
let ticker: Timer | undefined
let alive: Set<number> | undefined
let aliveAt = 0
let scanning: Promise<void> | undefined

// What reaches outside the mod goes through $, and $ can't cross an import: these live here.

/** Where Claude Code keeps its files: `CLAUDE_CONFIG_DIR`, or `.claude` in the home folder. */
async function configDir($: EngineInterface): Promise<string> {
  const custom = await $.env.get('CLAUDE_CONFIG_DIR')
  return custom ? custom : (await homeDir($)) + '\\.claude'
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

/** The pids of running `claude.exe` processes; `undefined` when tasklist can't say. */
async function runningClaudes($: EngineInterface): Promise<Set<number> | undefined> {
  try {
    const r = await $.process.run(['tasklist', '/FO', 'CSV', '/NH', '/FI', 'IMAGENAME eq claude.exe'], { timeoutMs: 10_000 })
    return r.exitCode === 0 ? parseTasklist(r.stdout) : undefined
  } catch {
    return undefined
  }
}

async function refresh($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  if (!me) me = await $.session.id()
  if (now - aliveAt >= ALIVE_MS) {
    alive = await runningClaudes($)
    aliveAt = now
  }
  const found = await readSessions($, await configDir($))
  const open = alive ? found.filter(s => alive!.has(s.pid) || s.sessionId === me) : found
  await update($, sessions, () => open)
  // The ages move even when the list doesn't.
  $.ui.invalidate('ui.render')
}

/** Starts the refresh while the pane is open; resolves once the first read is in. */
async function start($: EngineInterface): Promise<void> {
  if (ticker) return
  aliveAt = 0
  ticker = $.clock.every(REFRESH_MS, () => void refresh($))
  await refresh($)
}

function stop(): void {
  ticker?.cancel()
  ticker = undefined
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

/** Opens a Windows Terminal tab in the session's folder, resuming it. */
async function resume($: EngineInterface, s: PastSession): Promise<void> {
  if (!(await $.fs.exists(s.cwd))) {
    $.ui.toast('Cartella non trovata: ' + s.cwd)
    return
  }
  try {
    await $.process.run(resumeArgv(s.cwd, s.sessionId), { timeoutMs: 15_000 })
  } catch {
    $.ui.toast('Windows Terminal non si è aperto')
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await homeDir($)
    me = await $.session.id()
    try {
      await $.command.register({ name: 'deck', description: 'Your Claude Code CLI sessions, in a pane', immediate: true })
    } catch {
      // The name is taken: the pane can't be opened, the rest of the mod still runs.
    }
    // A reload while the pane is open keeps the pane: keep it fed.
    if ((await $.ui.panes()).some(p => p.id === PANE)) {
      void start($)
      if ((await read($, tab)) === 'history') void rescan($)
    }
    return next(e)
  })

  on('command.run', { command: 'deck' }, async $ => {
    await start($)
    await $.ui.open({ id: PANE, title: 'Dev Deck', focus: true })
    if ((await read($, tab)) === 'history') void rescan($)
    return {}
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
    const live = await read($, sessions)
    const now = await $.clock.now()
    const width = e.props.bodyColumns ?? 80
    const rows = Math.max(4, e.props.scroll?.bodyRows ?? 12)

    const tabButton = (name: 'open' | 'history', label: string, hotkey: string) => (
      <Button
        key={'tab-' + name}
        label={label}
        hotkey={hotkey}
        plain
        dimColor={shown !== name}
        onPress={() => {
          void update($, tab, () => name)
          if (name === 'history') void rescan($)
        }}
      />
    )
    const tabs = (
      <Box flexDirection="row" columnGap={3}>
        {tabButton('open', 'Aperte', '1')}
        {tabButton('history', 'Storico', '2')}
      </Box>
    )

    if (shown === 'open') {
      const nameW = Math.min(22, Math.max(10, Math.floor(width * 0.25)))
      const stateW = 10
      const ageW = 8
      const markW = 2
      const folderW = Math.max(8, width - nameW - stateW - ageW - markW - 4)
      return (
        <Box flexDirection="column">
          {tabs}
          {live.length === 0 && <Text dimColor>Nessuna sessione CLI aperta</Text>}
          {live.map(s => {
            const isBusy = s.status === 'busy'
            const isMe = s.sessionId === me
            return (
              <Box key={s.sessionId} flexDirection="row" columnGap={1}>
                <Box width={markW}>
                  <Text color={isBusy ? 'success' : undefined} dimColor={!isBusy}>{isBusy ? '●' : '○'}</Text>
                </Box>
                <Box width={nameW}>
                  <Text bold={isMe} wrap="truncate-end">{s.name}</Text>
                </Box>
                <Box width={folderW}>
                  <Text dimColor wrap="truncate-start">{shortPath(s.cwd, home)}</Text>
                </Box>
                <Box width={stateW}>
                  <Text dimColor={!isBusy}>{statusLabel(s.status)}</Text>
                </Box>
                <Box width={ageW}>
                  <Text dimColor>{since(s.startedAt, now)}</Text>
                </Box>
              </Box>
            )
          })}
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

    // The tab row and the field take two rows; each day takes one more for its heading.
    let room = rows - 2
    const lines: RenderNode[] = []
    for (const group of byDay(search(past, q), now)) {
      if (room < 2) break
      lines.push(<Text key={'day-' + group.day} dimColor bold>{group.day}</Text>)
      room -= 1
      for (const s of group.sessions) {
        if (room < 1) break
        room -= 1
        const label = fit(s.title, titleW) + '  '
        const tail = fitStart(shortPath(s.cwd, home), folderW) + '  ' + clock(s.lastAt)
        lines.push(
          openIds.has(s.sessionId) ? (
            <Text key={s.sessionId} dimColor>
              {'● ' + label + tail}
            </Text>
          ) : (
            <Box key={'row-' + s.sessionId} flexDirection="row">
              <Text>{'  '}</Text>
              <Button key={s.sessionId} label={label} plain onPress={() => void resume($, s)} />
              <Text dimColor>{tail}</Text>
            </Box>
          ),
        )
      }
    }

    return (
      <Box flexDirection="column">
        {tabs}
        <Input
          key="search"
          label="Cerca"
          placeholder="titolo, prompt, cartella"
          value={q}
          autoFocus
          onInput={(value: string) => void update($, query, () => value)}
          onSubmit={(value: string) => void update($, query, () => value)}
        />
        {isFirstScan && past.length === 0 && <Text dimColor>…</Text>}
        {lines}
      </Box>
    )
  })
}

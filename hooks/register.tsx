import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { shortPath, since, statusLabel } from './engine/format'
import { parseSession, parseTasklist, sortSessions } from './engine/sessions'
import type { LiveSession } from '../types'

const PANE = 'deck'
/** The session files are read this often while the pane is open: a read is a few small files. */
const REFRESH_MS = 2_000
/** The pids are checked this often: tasklist costs ~160 ms, and only a crash leaves a file behind. */
const ALIVE_MS = 10_000

const sessions = atom({ plugin: 'dev-deck-mod', key: 'sessions' } as const, [])

// Module variables: set again by session.start after every reload.
let home = ''
let me = ''
let ticker: Timer | undefined
let alive: Set<number> | undefined
let aliveAt = 0

// What reaches outside the mod goes through $, and $ can't cross an import: these live here.

/** Where Claude Code keeps its files: `CLAUDE_CONFIG_DIR`, or `.claude` in the home folder. */
async function configDir($: EngineInterface): Promise<string> {
  const custom = await $.env.get('CLAUDE_CONFIG_DIR')
  return custom ? custom : (await homeDir($)) + '/.claude'
}

async function homeDir($: EngineInterface): Promise<string> {
  if (!home) home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  return home
}

/** Every session file that parses as an open CLI session. */
async function readSessions($: EngineInterface, dir: string): Promise<LiveSession[]> {
  const folder = dir + '/sessions'
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
      const one = parseSession(await $.fs.read(folder + '/' + entry.name))
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
    if ((await $.ui.panes()).some(p => p.id === PANE)) void start($)
    return next(e)
  })

  on('command.run', { command: 'deck' }, async $ => {
    await start($)
    await $.ui.open({ id: PANE, title: 'Dev Deck', focus: true })
    return {}
  })

  // Never keeps a pane open: whatever happens here, the close goes on.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) stop()
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, sessions)
    const now = await $.clock.now()
    const width = e.props.bodyColumns ?? 80
    const nameW = Math.min(22, Math.max(10, Math.floor(width * 0.25)))
    const stateW = 10
    const ageW = 8
    const markW = 2
    const folderW = Math.max(8, width - nameW - stateW - ageW - markW - 4)

    if (list.length === 0) return <Text dimColor>Nessuna sessione CLI aperta</Text>

    return (
      <Box flexDirection="column">
        {list.map(s => {
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
  })
}

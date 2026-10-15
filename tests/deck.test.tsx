import { describe, expect, mock, test } from 'claude-code/testing'

import { shortPath, since, statusLabel } from '../hooks/engine/format'
import { setLang } from '../hooks/engine/i18n'
import { parseSession } from '../hooks/engine/sessions'

const HOME = 'C:\\Users\\me'
const NOW = 1_800_000_000_000

const cli = (pid: number, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    pid,
    sessionId: 'sess-' + pid,
    cwd: 'C:\\Users\\me\\Desktop\\shop',
    startedAt: NOW - 2 * 3_600_000 - 14 * 60_000,
    entrypoint: 'cli',
    name: 'shop-' + pid,
    status: 'busy',
    ...over,
  })

describe('reading a session file', () => {
  test('keeps a CLI session and drops the others', () => {
    expect(parseSession(cli(1))?.name).toBe('shop-1')
    expect(parseSession(cli(2, { entrypoint: 'claude-vscode' }))).toBeUndefined()
    expect(parseSession(cli(3, { entrypoint: 'sdk-cli' }))).toBeUndefined()
    expect(parseSession('{ half a file')).toBeUndefined()
  })

  test('names a session with no name by its id', () => {
    expect(parseSession(cli(4, { name: undefined, sessionId: 'abcdef1234' }))?.name).toBe('abcdef12')
  })
})

describe('the words a row shows', () => {
  test('ages in their two largest units', () => {
    expect(since(NOW - 45_000, NOW)).toBe('45s')
    expect(since(NOW - 12 * 60_000, NOW)).toBe('12m')
    expect(since(NOW - (2 * 60 + 14) * 60_000, NOW)).toBe('2h 14m')
    expect(since(NOW - (3 * 24 + 5) * 3_600_000, NOW)).toBe('3d 5h')
  })

  test('the home folder as ~, whatever the case', () => {
    expect(shortPath('c:\\Users\\me\\Desktop\\shop', HOME)).toBe('~\\Desktop\\shop')
    expect(shortPath('D:\\work\\shop', HOME)).toBe('D:\\work\\shop')
    expect(shortPath('C:\\Users\\meg\\x', HOME)).toBe('C:\\Users\\meg\\x')
  })

  test('busy and idle in words', () => {
    setLang('it')
    expect(statusLabel('busy')).toBe('al lavoro')
    expect(statusLabel('idle')).toBe('ferma')
  })
})

test('/deck shows the open CLI sessions, not the others and not a dead one', async ($, on) => {
  mock.env(on, { DEVDECK_LANG: 'it', USERPROFILE: HOME })
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {
    '100.json': cli(100),
    '200.json': cli(200, { status: 'idle', name: 'blog', cwd: 'C:\\Users\\me\\Desktop\\blog' }),
    '300.json': cli(300, { entrypoint: 'claude-vscode', name: 'from-vscode' }),
    '400.json': cli(400, { name: 'crashed' }),
  }
  on('session.id', async () => ({ value: 'sess-100' }))
  on('fs.list', async () => ({
    value: Object.keys(files).map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async ($, e) => ({ value: files[e.path.split(/[\\/]/).pop() ?? ''] ?? '' }))
  on('process.run', async ($, e) => {
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'powershell') {
      const procs = [100, 200, 300].map(i => ({ i, p: 1, n: 'claude.exe', w: 200 * 1024 * 1024, c: 'claude' }))
      return out(JSON.stringify({ procs, tails: {} }))
    }
    return out('')
  })
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.panes', async () => ({ value: [] }))

  await $.command.run({ command: 'deck', args: '' } as never)

  const ui = await $.ui.mount({
    plugin: 'dev-deck-mod',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'deck',
    props: { title: 'Dev Deck', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { top: 0, bodyRows: 20 } } as never,
  })
  const shown = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(shown).toContain('shop-100')
  expect(shown).toContain('blog')
  expect(shown).toContain('~\\Desktop\\blog')
  expect(shown).toContain('ferma')
  expect(shown).toContain('2h 14m')
  expect(shown).not.toContain('from-vscode')
  expect(shown).not.toContain('crashed')
})

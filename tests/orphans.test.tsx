import { describe, expect, mock, test } from 'claude-code/testing'

import { findOrphans, treeOf } from '../hooks/engine/procs'
import type { Proc } from '../hooks/engine/procs'

const NOW = 1_800_000_000_000
const MB = 1024 * 1024
const p = (pid: number, ppid: number, name: string, cmd: string, started = NOW - 60_000, ram = 10 * MB): Proc => ({ pid, ppid, name, ram, cmd, started })

describe('what sessions left behind', () => {
  const procs = [
    // A live session and its MCP server: not orphans.
    p(50, 1, 'claude.exe', 'claude', NOW - 3_600_000),
    p(51, 50, 'node.exe', 'node C:\\Users\\me\\.claude\\plugins\\cache\\dev-deck\\dev-deck\\0.2.0\\mcp\\dist\\server.mjs'),
    // An MCP server whose session crashed: parent 900 is gone.
    p(60, 900, 'node.exe', '"node" "C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\98\\node_modules\\@playwright\\mcp\\cli.js"'),
    p(61, 60, 'chrome.exe', 'chrome --headless', NOW - 50_000, 200 * MB),
    // A dev server listening, its shell gone.
    p(70, 901, 'node.exe', 'node C:\\shop\\node_modules\\vite\\bin\\vite.js'),
    // Windows' own, whose parent exited long ago.
    p(80, 902, 'explorer.exe', 'C:\\WINDOWS\\Explorer.EXE'),
    // Some other node program with a dead parent, no port, nothing of Claude Code's.
    p(90, 903, 'node.exe', 'node D:\\tools\\backup.js'),
    // Its parent's pid now belongs to a younger process: an orphan all the same.
    p(100, 110, 'python.exe', 'python -m http.server 8000', NOW - 600_000),
    p(110, 1, 'notepad.exe', 'notepad', NOW - 1_000),
  ]
  const ports = new Map([
    [70, [5173]],
    [100, [8000]],
  ])

  test('runtimes Claude Code started or listening, whose parent is gone; ports first', () => {
    const found = findOrphans(treeOf(procs), ports)
    expect(found.map(b => [b.pid, b.label, b.ports])).toEqual([
      [70, 'vite', [5173]],
      [100, 'python', [8000]],
      [60, '@playwright/mcp', []],
    ])
    // The branch counts what runs under it: the browser the MCP server opened.
    expect(found[2]!.ram).toBe(210 * MB)
  })
})

test('Orfani shows under the sessions, and Stop closes one', async ($, on) => {
  mock.env(on, { DEVDECK_LANG: 'it', USERPROFILE: 'C:\\Users\\me' })
  mock.clock(on, { now: NOW })
  const session = JSON.stringify({ pid: 50, sessionId: 'me', cwd: 'C:\\shop', startedAt: 0, entrypoint: 'cli', name: 'shop', status: 'idle', statusUpdatedAt: 0 })
  let procs = [
    { i: 50, p: 1, n: 'claude.exe', w: 1, c: 'claude', s: NOW - 3_600_000 },
    { i: 60, p: 900, n: 'node.exe', w: 1, c: 'node C:\\npm-cache\\_npx\\98\\node_modules\\@playwright\\mcp\\cli.js', s: NOW - 60_000 },
  ]
  const killed: string[][] = []

  on('session.id', async () => ({ value: 'me' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.panes', async () => ({ value: [] }))
  on('fs.list', async () => ({ value: [{ name: '50.json', kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }] }))
  on('fs.read', async () => ({ value: session }))
  on('process.run', async ($, e) => {
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'powershell') return out(JSON.stringify({ procs, tails: {} }))
    if (e.argv[0] === 'taskkill') {
      killed.push([...e.argv])
      procs = procs.filter(x => x.i !== 60)
    }
    return out('')
  })

  await $.command.run({ command: 'deck', args: '' } as never)
  const ui = await $.ui.mount({
    plugin: 'dev-deck-mod',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'deck',
    props: { title: 'Dev Deck', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 20 } } as never,
  })
  const texts = async () => (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(await texts()).toContain('Orfani')
  expect(await texts()).toContain('@playwright/mcp')

  await ui.press({ key: 'stop-60' })
  await ui.press({ key: 'stop-60' })
  expect(killed).toEqual([['taskkill', '/PID', '60', '/T', '/F']])
  expect(await texts()).not.toContain('Orfani')
})

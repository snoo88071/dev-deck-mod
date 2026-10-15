import { describe, expect, mock, test } from 'claude-code/testing'

import { contextPercent, labelOf, lastUsage, parseNetstat, projectFolder, sessionLoad, treeOf } from '../hooks/engine/procs'
import type { Proc } from '../hooks/engine/procs'

const MB = 1024 * 1024
const p = (pid: number, ppid: number, name: string, cmd: string, ram = 10 * MB): Proc => ({ pid, ppid, name, ram, cmd })

// What runs under a Claude Code session on this machine, command lines as Windows reports them.
const CLAUDE = p(18932, 1, 'claude.exe', 'claude', 300 * MB)
const TREE: Proc[] = [
  CLAUDE,
  p(23828, 18932, 'conhost.exe', '\\??\\C:\\WINDOWS\\system32\\conhost.exe 0x4'),
  p(28836, 18932, 'cmd.exe', 'C:\\WINDOWS\\system32\\cmd.exe /d /s /c "npx ^"@playwright/mcp@latest^""'),
  p(24552, 28836, 'node.exe', '"C:\\Program Files\\nodejs\\\\node.exe"  "C:\\Program Files\\nodejs\\\\node_modules\\npm\\bin\\npx-cli.js" "@playwright/mcp@latest"'),
  p(1400, 24552, 'cmd.exe', 'C:\\WINDOWS\\system32\\cmd.exe /d /s /c playwright-mcp'),
  p(10936, 1400, 'node.exe', '"node"   "C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\98\\node_modules\\.bin\\\\..\\@playwright\\mcp\\cli.js"'),
  p(2148, 18932, 'node.exe', 'node C:/Users/me/.claude/plugins/cache/dev-deck/dev-deck/0.2.0/mcp/dist/server.mjs'),
  p(27060, 18932, 'bash.exe', '"C:\\Program Files\\Git\\bin\\bash.exe" -c "source /c/Users/me/.claude/shell-snapshots/snapshot-bash.sh && npm run dev"'),
  p(4256, 27060, 'cmd.exe', 'C:\\WINDOWS\\system32\\cmd.exe /d /s /c vite'),
  p(4300, 4256, 'node.exe', '"node" "C:\\Users\\me\\Desktop\\shop\\node_modules\\.bin\\\\..\\vite\\bin\\vite.js"', 120 * MB),
  p(9999, 1, 'node.exe', 'node unrelated.js'),
]

describe('naming what a session started', () => {
  const tree = treeOf(TREE)
  const branch = (pid: number) => {
    const out: Proc[] = []
    const walk = (x: Proc) => {
      out.push(x)
      for (const c of tree.children.get(x.pid) ?? []) walk(c)
    }
    walk(tree.byPid.get(pid)!)
    return out
  }

  test('an MCP server started through npx is named after its package', () => {
    expect(labelOf(branch(28836))).toBe('@playwright/mcp')
  })

  test("a plugin's MCP server is named after the plugin", () => {
    expect(labelOf(branch(2148))).toBe('dev-deck')
  })

  test('a dev server behind a shell and npm is named after the tool', () => {
    expect(labelOf(branch(27060))).toBe('vite')
  })

  test("npm's own script is a runner too: `npm run dev` from Claude's Bash tool is named after vite", () => {
    // As recorded: Git Bash, then node running npm-cli.js, then cmd, then vite.
    const recorded = [
      p(1, 0, 'bash.exe', '"C:\\Program Files\\Git\\bin\\bash.exe" -c "source snapshot.sh && npm run dev"'),
      p(2, 1, 'node.exe', '"C:\\Program Files\\nodejs\\node.exe" "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" run dev'),
      p(3, 2, 'cmd.exe', 'C:\\WINDOWS\\system32\\cmd.exe /d /s /c vite --port 5173 --strictPort'),
      p(4, 3, 'node.exe', '"node" "C:\\Users\\me\\demo-shop\\node_modules\\.bin\\..\\vite\\bin\\vite.js" --port 5173 --strictPort'),
    ]
    expect(labelOf(recorded)).toBe('vite')
  })
})

describe('what a session holds', () => {
  const ports = parseNetstat(
    [
      '  Proto  Local Address          Foreign Address        State           PID',
      '  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       4300',
      '  TCP    [::1]:5173             [::]:0                 LISTENING       4300',
      '  TCP    127.0.0.1:5173         127.0.0.1:50000        ESTABLISHED     4300',
      '  TCP    0.0.0.0:8099           0.0.0.0:0              LISTENING       9999',
    ].join('\r\n'),
  )

  test('listening ports, once each, not connections', () => {
    expect(ports.get(4300)).toEqual([5173])
    expect(ports.get(9999)).toEqual([8099])
  })

  test('one branch per child, the one with a port first, console hosts left out', () => {
    const load = sessionLoad(18932, treeOf(TREE), ports)
    expect(load.branches.map(b => b.label)).toEqual(['vite', '@playwright/mcp', 'dev-deck'])
    expect(load.branches[0]).toMatchObject({ pid: 27060, ports: [5173] })
    // claude 300 + conhost 10 + playwright 4x10 + plugin 10 + bash, cmd 2x10 + vite 120
    expect(load.ram).toBe((300 + 10 + 40 + 10 + 20 + 120) * MB)
  })
})

describe('the context a session holds', () => {
  const answer = (usage: Record<string, number>, model = 'claude-opus-5-5') =>
    JSON.stringify({ type: 'assistant', message: { model, usage } })

  test('the last answer counts, input, cache and output together', () => {
    const tail = ['{"half a line', answer({ input_tokens: 1, cache_read_input_tokens: 1000 }), answer({ input_tokens: 2, cache_creation_input_tokens: 1167, cache_read_input_tokens: 281_556, output_tokens: 468 }), '{"type":"user"}'].join('\n')
    expect(lastUsage(tail)).toEqual({ tokens: 283_193, model: 'claude-opus-5-5' })
  })

  test("the window of this session's model, else 200k, else 1M past 200k", () => {
    const own = { model: 'claude-opus-5-5[1m]', window: 1_000_000 }
    expect(contextPercent(283_193, 'claude-opus-5-5', own)).toBe(28)
    expect(contextPercent(50_000, 'claude-sonnet-5-5', own)).toBe(25)
    expect(contextPercent(300_000, 'claude-sonnet-5-5', own)).toBe(30)
  })

  test("a transcript's folder", () => {
    expect(projectFolder('c:\\Users\\me\\Desktop\\dev-deck')).toBe('c--Users-me-Desktop-dev-deck')
    expect(projectFolder('C:\\Users\\me\\.claude')).toBe('C--Users-me--claude')
  })
})

test('Stop asks once more, then closes the branch and its tree', async ($, on) => {
  mock.env(on, { DEVDECK_LANG: 'it', USERPROFILE: 'C:\\Users\\me' })
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  const session = JSON.stringify({ pid: 18932, sessionId: 'me', cwd: 'C:\\Users\\me\\Desktop\\shop', startedAt: 0, entrypoint: 'cli', name: 'shop', status: 'busy' })
  let procs = TREE
  const killed: string[][] = []

  on('session.id', async () => ({ value: 'me' }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { tokens: 84_000, window: 200_000, percent: 42 }, rateLimits: [] } as never }))
  on('session.model', async () => ({ value: 'claude-opus-5-5' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.panes', async () => ({ value: [] }))
  on('fs.list', async () => ({ value: [{ name: '18932.json', kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }] }))
  on('fs.read', async () => ({ value: session }))
  on('process.run', async ($, e) => {
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const [cmd] = e.argv
    if (cmd === 'powershell') return out(JSON.stringify({ procs: procs.map(x => ({ i: x.pid, p: x.ppid, n: x.name, w: x.ram, c: x.cmd })), tails: {} }))
    if (cmd === 'netstat') return out(procs.some(x => x.pid === 4300) ? '  TCP    127.0.0.1:5173    0.0.0.0:0    LISTENING    4300' : '')
    if (cmd === 'taskkill') {
      killed.push([...e.argv])
      const gone = new Set([27060, 4256, 4300])
      procs = procs.filter(x => !gone.has(x.pid))
    }
    return out('')
  })

  await $.command.run({ command: 'deck', args: '' } as never)
  const ui = await $.ui.mount({
    plugin: 'dev-deck-mod',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'deck',
    props: { title: 'Dev Deck', isFocused: true, bodyColumns: 110, placement: 'inline', scroll: { offset: 0, bodyRows: 20 } } as never,
  })

  const texts = async () => (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(await texts()).toContain('vite')
  expect(await texts()).toContain(':5173')
  expect(await texts()).toContain('ctx 42%')

  await ui.press({ key: 'stop-27060' })
  expect(killed).toEqual([])
  expect((await ui.find({ key: 'stop-27060' }))?.props.label).toBe('Sicuro?')

  // Left alone, the button disarms.
  await clock.advance(3_000)
  expect((await ui.find({ key: 'stop-27060' }))?.props.label).toBe('Spegni')

  await ui.press({ key: 'stop-27060' })
  await ui.press({ key: 'stop-27060' })
  expect(killed).toEqual([['taskkill', '/PID', '27060', '/T', '/F']])
  expect(await texts()).not.toContain('vite')
  expect(await texts()).toContain('@playwright/mcp')
})

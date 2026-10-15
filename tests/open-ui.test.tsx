import { expect, mock, test } from 'claude-code/testing'

const NOW = 1_800_000_000_000
const MB = 1024 * 1024

test('Open: sessions head their branches, Stop stays quiet until armed, on terminal and desktop', async ($, on) => {
  mock.env(on, { DEVDECK_LANG: 'it', USERPROFILE: 'C:\\Users\\me' })
  mock.clock(on, { now: NOW })
  const session = JSON.stringify({ pid: 50, sessionId: 'me', cwd: 'C:\\shop', startedAt: 0, entrypoint: 'cli', name: 'shop', status: 'busy', statusUpdatedAt: 0 })
  const procs = [
    { i: 50, p: 1, n: 'claude.exe', w: 300 * MB, c: 'claude', s: NOW - 3_600_000 },
    { i: 52, p: 50, n: 'node.exe', w: 100 * MB, c: 'node C:\\shop\\node_modules\\vite\\bin\\vite.js', s: NOW - 60_000 },
    { i: 53, p: 50, n: 'node.exe', w: 50 * MB, c: 'node C:/Users/me/.claude/plugins/cache/dev-deck/dev-deck/0.2.0/mcp/dist/server.mjs', s: NOW - 60_000 },
    { i: 60, p: 900, n: 'node.exe', w: 40 * MB, c: 'node C:\\npm-cache\\_npx\\98\\node_modules\\@playwright\\mcp\\cli.js', s: NOW - 60_000 },
  ]
  on('session.id', async () => ({ value: 'me' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.panes', async () => ({ value: [] }))
  on('fs.list', async () => ({ value: [{ name: '50.json', kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }] }))
  on('fs.read', async () => ({ value: session }))
  on('process.run', async ($$, e) => {
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'powershell') return out(JSON.stringify({ procs, tails: {} }))
    if (e.argv[0] === 'netstat') return out('  TCP    0.0.0.0:5173    0.0.0.0:0    LISTENING    52')
    return out('')
  })
  await $.command.run({ command: 'deck', args: '' } as never)

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({
      plugin: 'dev-deck-mod',
      surface,
      component: 'Pane',
      requestId: 'deck',
      props: { title: 'Dev Deck', isFocused: true, bodyColumns: 110, placement: 'inline', scroll: { offset: 0, bodyRows: 30 } } as never,
    })
    const texts = (await ui.findAll({ type: 'Text' })).map(x => x.text)
    // The session's title heads the rows, in bold, in Claude's colour: it's this one.
    const title = await ui.find({ type: 'Text', text: 'shop' })
    expect(title?.props).toMatchObject({ bold: true, color: 'claude' })
    expect(texts).toContain(' ├')
    expect(texts).toContain(' └')
    // Stop is quiet: no brackets, dimmed.
    expect((await ui.find({ key: 'stop-52' }))?.props).toMatchObject({ plain: true, dimColor: true, label: 'Spegni' })
    // Orphans in amber, the colour Dev Deck gives forgotten processes.
    expect((await ui.find({ type: 'Text', text: 'Orfani' }))?.props).toMatchObject({ color: 'warning', bold: true })
    if (surface === 'terminal') {
      await ui.press({ key: 'stop-52' })
      const armed = await ui.find({ key: 'stop-52' })
      expect(armed?.props).toMatchObject({ label: 'Sicuro?', variant: 'primary' })
      expect(armed?.props.plain).toBeUndefined()
    }
    await ui.unmount()
  }
})

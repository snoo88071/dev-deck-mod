import { expect, mock, test } from 'claude-code/testing'

const NOW = 1_800_000_000_000
const MB = 1024 * 1024

test('the band shows the servers this session keeps on, read shortly after a command', async ($, on) => {
  mock.env(on, { USERPROFILE: 'C:\\Users\\me' })
  const clock = mock.clock(on, { now: NOW })
  const session = JSON.stringify({ pid: 50, sessionId: 'me', cwd: 'C:\\shop', startedAt: 0, entrypoint: 'cli', name: 'shop', status: 'busy', statusUpdatedAt: 0 })
  const claude = { i: 50, p: 1, n: 'claude.exe', w: 300 * MB, c: 'claude' }
  const server = [
    { i: 52, p: 50, n: 'bash.exe', w: 10 * MB, c: 'bash -c "npx http-server -p 8099"' },
    { i: 53, p: 52, n: 'node.exe', w: 40 * MB, c: 'node C:\\npm-cache\\_npx\\1\\node_modules\\http-server\\bin\\http-server -p 8099' },
  ]
  let procs = [claude, ...server]
  let reads = 0

  // Beneath the plugin, the test stands for Claude Code's own empty band.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Text } = $.ui.resolve(e as never) as { Text: (p: object) => never }
    return Text({ key: 'empty', children: [''] })
  })
  on('session.id', async () => ({ value: 'me' }))
  on('session.cwd', async () => ({ value: 'C:\\shop' }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { tokens: 84_000, window: 200_000, percent: 42 }, rateLimits: [] } as never }))
  on('session.model', async () => ({ value: 'claude-opus-5-5' }))
  on('fs.list', async () => ({ value: [{ name: '50.json', kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }] }))
  on('fs.read', async () => ({ value: session }))
  on('process.run', async ($, e) => {
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'powershell') {
      reads += 1
      return out(JSON.stringify({ procs, tails: {} }))
    }
    if (e.argv[0] === 'netstat') return out(procs.some(p => p.i === 53) ? '  TCP    0.0.0.0:8099    0.0.0.0:0    LISTENING    53' : '')
    return out('')
  })
  on('tool.call', { tool: 'Bash' }, async () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)

  const bandText = async () => {
    const ui = await $.ui.mount({
      plugin: 'dev-deck-mod',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100, scroll: { offset: 0, bodyRows: 3 } } as never,
    })
    const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')
    await ui.unmount()
    return text
  }

  // Claude starts the server; two commands close together make one read.
  await $.tool.call({ tool: 'Bash', command: 'npx http-server -p 8099' } as never)
  await $.tool.call({ tool: 'Bash', command: 'echo started' } as never)
  expect(await bandText()).toBe('')
  // (The guard read once already, seeing a server start: the band's reads are counted from here.)
  const before = reads
  await clock.advance(3_000)
  expect(reads - before).toBe(1)
  expect(await bandText()).toBe('http-server :8099 · 350 MB · ctx 42%')

  // The server stops; after the next command the band has nothing to say.
  procs = [claude]
  await $.tool.call({ tool: 'Bash', command: 'git status' } as never)
  await clock.advance(3_000)
  expect(await bandText()).toBe('')
})

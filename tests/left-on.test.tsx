import { expect, mock, test } from 'claude-code/testing'

const NOW = 1_800_000_000_000

test('an answer that started a server ends with a line saying it stays on; one that did not, without', async ($, on) => {
  mock.env(on, { USERPROFILE: 'C:\\Users\\me' })
  const clock = mock.clock(on, { now: NOW })
  const session = JSON.stringify({ pid: 50, sessionId: 'me', cwd: 'C:\\shop', startedAt: 0, entrypoint: 'cli', name: 'shop', status: 'busy', statusUpdatedAt: 0 })
  const claude = { i: 50, p: 1, n: 'claude.exe', w: 1, c: 'claude', s: NOW - 3_600_000 }
  // A server from an earlier answer, an hour ago.
  const old = { i: 60, p: 50, n: 'node.exe', w: 1, c: 'node C:\\shop\\node_modules\\vite\\bin\\vite.js', s: NOW - 3_000_000 }
  let procs = [claude, old]
  let listening: Record<number, number> = { 60: 5173 }
  const logs: string[] = []

  on('session.id', async () => ({ value: 'me' }))
  on('session.cwd', async () => ({ value: 'C:\\shop' }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { tokens: 1, window: 200_000, percent: 1 }, rateLimits: [] } as never }))
  on('session.model', async () => ({ value: 'claude-opus-5-5' }))
  on('ui.log', async ($, e) => {
    logs.push(String((e as { text?: unknown }).text))
    return { value: undefined } as never
  })
  on('fs.list', async () => ({ value: [{ name: '50.json', kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }] }))
  on('fs.read', async () => ({ value: session }))
  on('process.run', async ($, e) => {
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'powershell') return out(JSON.stringify({ procs, tails: {} }))
    if (e.argv[0] === 'netstat') {
      return out(Object.entries(listening).map(([pid, port]) => `  TCP    0.0.0.0:${port}    0.0.0.0:0    LISTENING    ${pid}`).join('\r\n'))
    }
    return out('')
  })
  on('tool.call', { tool: 'Bash' }, async () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
  on('turn.start', async ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: '' }) as never)

  // An answer in which Claude starts http-server.
  await $.turn.start({ text: 'go', turnId: 't' } as never)
  procs = [...procs, { i: 70, p: 50, n: 'node.exe', w: 1, c: 'node C:\\npm-cache\\_npx\\1\\node_modules\\http-server\\bin\\http-server -p 8099', s: NOW + 500 }]
  listening = { ...listening, 70: 8099 }
  await $.tool.call({ tool: 'Bash', command: 'npx http-server -p 8099' } as never)
  await $.turn.complete({ reason: 'end_turn' } as never)
  await clock.advance(3_000)
  expect(logs).toEqual(['http-server :8099 resta acceso'])

  // The next answer runs a command but starts nothing: no line, though both servers are still up.
  await clock.advance(10_000)
  await $.turn.start({ text: 'go', turnId: 't' } as never)
  await $.tool.call({ tool: 'Bash', command: 'git status' } as never)
  await $.turn.complete({ reason: 'end_turn' } as never)
  await clock.advance(3_000)
  expect(logs).toEqual(['http-server :8099 resta acceso'])
})

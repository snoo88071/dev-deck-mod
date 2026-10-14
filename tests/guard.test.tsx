import { describe, expect, mock, test } from 'claude-code/testing'

import { commandFolder, reuseNote, runningServer, serverStart } from '../hooks/engine/guard'
import { treeOf } from '../hooks/engine/procs'
import type { Proc } from '../hooks/engine/procs'
import type { LiveSession } from '../types'

const p = (pid: number, ppid: number, name: string, cmd: string): Proc => ({ pid, ppid, name, ram: 1, cmd })
const SHOP = 'C:\\Users\\me\\Desktop\\shop'

describe('a command that starts a dev server', () => {
  test('the usual ones, with their port when they give it', () => {
    expect(serverStart('npm run dev')).toEqual({})
    expect(serverStart('cd shop && pnpm dev --port 3001')).toEqual({ port: 3001 })
    expect(serverStart('npx http-server -p 8099')).toEqual({ port: 8099 })
    expect(serverStart('python -m http.server 8000')).toEqual({ port: 8000 })
    expect(serverStart('npm start')).toEqual({})
    expect(serverStart('npx next dev')).toEqual({})
    expect(serverStart('npx tauri dev')).toEqual({})
  })

  test('not a build, a test or an install', () => {
    expect(serverStart('npm run build')).toBeUndefined()
    expect(serverStart('npx vite build')).toBeUndefined()
    expect(serverStart('npm test')).toBeUndefined()
    expect(serverStart('npm install vite')).toBeUndefined()
    expect(serverStart('git status')).toBeUndefined()
  })

  test('the folder it runs in', () => {
    expect(commandFolder('npm run dev', SHOP)).toBe(SHOP)
    expect(commandFolder('cd web && npm run dev', SHOP)).toBe(SHOP + '\\web')
    expect(commandFolder('cd "D:\\work\\blog" && npm start', SHOP)).toBe('D:\\work\\blog')
    expect(commandFolder('cd /c/Users/me/blog && npm start', SHOP)).toBe('C:\\Users\\me\\blog')
  })
})

describe('a server already running', () => {
  const live: LiveSession[] = [{ pid: 50, sessionId: 's', name: 'shop', cwd: SHOP, status: 'busy', startedAt: 0 }]
  const procs = [
    p(1, 0, 'explorer.exe', 'C:\\WINDOWS\\Explorer.EXE'),
    p(2, 1, 'WindowsTerminal.exe', 'wt'),
    // Started by hand in a terminal, in the project.
    p(10, 2, 'cmd.exe', 'cmd /c npm run dev'),
    p(11, 10, 'node.exe', `"node" "${SHOP}\\node_modules\\.bin\\..\\vite\\bin\\vite.js"`),
    // A session in the project, with an MCP server listening and an http-server.
    p(50, 2, 'claude.exe', 'claude'),
    p(51, 50, 'node.exe', 'node C:/Users/me/.claude/plugins/cache/dev-deck/dev-deck/0.2.0/mcp/dist/server.mjs'),
    p(52, 50, 'bash.exe', 'bash -c "npx http-server -p 8099"'),
    p(53, 52, 'node.exe', 'node C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\1\\node_modules\\http-server\\bin\\http-server -p 8099'),
    // Something else entirely, on 3000.
    p(70, 2, 'node.exe', 'node D:\\other\\server.js'),
  ]
  const tree = treeOf(procs)

  test('one whose command line names the project: the branch never reaches the terminal', () => {
    // The highest process naming the project: its cmd wrapper exits with it.
    const found = runningServer({}, SHOP, tree, new Map([[11, [5173]]]), [])
    expect(found).toEqual({ pid: 11, label: 'vite', ports: [5173], why: 'project' })
  })

  test('one under a session open in the project, not its MCP server', () => {
    expect(runningServer({}, SHOP, tree, new Map([[51, [7000]]]), live)).toBeUndefined()
    expect(runningServer({}, SHOP, tree, new Map([[53, [8099]]]), live)).toMatchObject({ pid: 52, label: 'http-server', why: 'project' })
  })

  test('the port asked for, whoever holds it: only that process', () => {
    expect(runningServer({ port: 3000 }, SHOP, tree, new Map([[70, [3000]]]), [])).toEqual({ pid: 70, label: 'server.js', ports: [3000], why: 'port' })
    expect(runningServer({ port: 4000 }, SHOP, tree, new Map([[70, [3000]]]), [])).toBeUndefined()
  })

  test('what Claude reads on reuse', () => {
    expect(reuseNote({ pid: 52, label: 'http-server', ports: [8099], why: 'project' })).toContain('http://localhost:8099')
  })
})

describe('the question, and each answer', () => {
  const session = JSON.stringify({ pid: 50, sessionId: 's', cwd: SHOP, startedAt: 0, entrypoint: 'cli', name: 'shop', status: 'busy' })
  const procs = [
    { i: 50, p: 2, n: 'claude.exe', w: 1, c: 'claude' },
    { i: 52, p: 50, n: 'bash.exe', w: 1, c: 'bash -c "npx http-server -p 8099"' },
    { i: 53, p: 52, n: 'node.exe', w: 1, c: 'node C:\\npm-cache\\_npx\\1\\node_modules\\http-server\\bin\\http-server -p 8099' },
  ]

  /** A session where http-server runs on 8099, answering the question with `answer`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const world = (on: any, answer: string | Error) => {
    const log = { asked: [] as string[], killed: [] as string[][], ran: [] as string[] }
    mock.env(on, { USERPROFILE: 'C:\\Users\\me' })
    on('session.cwd', async () => ({ value: SHOP }))
    on('fs.list', async () => ({ value: [{ name: '50.json', kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }] }))
    on('fs.read', async () => ({ value: session }))
    on('process.run', async ($: unknown, e: { argv: string[] }) => {
      const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
      if (e.argv[0] === 'powershell') return out(JSON.stringify({ procs, tails: {} }))
      if (e.argv[0] === 'netstat') return out('  TCP    0.0.0.0:8099    0.0.0.0:0    LISTENING    53')
      if (e.argv[0] === 'taskkill') log.killed.push(e.argv)
      return out('')
    })
    // $.ui.ask is a call of the AskUserQuestion tool: answered here as the dialog would.
    on('tool.call', { tool: 'AskUserQuestion' }, async ($: unknown, e: { questions: { question: string }[] }) => {
      const q = e.questions[0]?.question ?? ''
      log.asked.push(q)
      if (answer instanceof Error) return { deny: 'dismissed' }
      return { result: { questions: e.questions, answers: { [q]: answer } } } as never
    })
    on('tool.call', { tool: 'Bash' }, async ($: unknown, e: { command: string }) => {
      log.ran.push(e.command)
      return { result: { stdout: 'started', stderr: '', interrupted: false } } as never
    })
    return log
  }

  test('Riusa quello: nothing starts, Claude reads where the server is', async ($, on) => {
    const log = world(on, 'Riusa quello')
    const r = await $.tool.call({ tool: 'Bash', command: 'npx http-server -p 8099' } as never)
    expect(log.asked[0]).toContain('La porta 8099 è già presa da http-server')
    expect(log.ran).toEqual([])
    expect(JSON.stringify(r)).toContain('http://localhost:8099')
  })

  test('Riavvia: the old tree closes, then the command starts', async ($, on) => {
    const log = world(on, 'Riavvia')
    await $.tool.call({ tool: 'Bash', command: 'npx http-server -p 8099' } as never)
    expect(log.killed).toEqual([['taskkill', '/PID', '52', '/T', '/F']])
    expect(log.ran).toEqual(['npx http-server -p 8099'])
  })

  test('dismissed: the command starts as asked', async ($, on) => {
    const log = world(on, new Error('dismissed'))
    await $.tool.call({ tool: 'Bash', command: 'npx http-server -p 8099' } as never)
    expect(log.asked).toHaveLength(1)
    expect(log.ran).toEqual(['npx http-server -p 8099'])
  })

  test('Lancia lo stesso: the command starts as asked', async ($, on) => {
    const log = world(on, 'Lancia lo stesso')
    await $.tool.call({ tool: 'Bash', command: 'npm run dev' } as never)
    expect(log.asked).toHaveLength(1)
    expect(log.killed).toEqual([])
    expect(log.ran).toEqual(['npm run dev'])
  })

  test('a command that starts no server is never held', async ($, on) => {
    const log = world(on, 'Riusa quello')
    await $.tool.call({ tool: 'Bash', command: 'npm run build' } as never)
    expect(log.asked).toEqual([])
    expect(log.ran).toEqual(['npm run build'])
  })
})

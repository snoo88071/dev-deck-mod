import { describe, expect, mock, test } from 'claude-code/testing'

import { batches, byDay, dayLabel, parseTranscript, resumeArgv, search } from '../hooks/engine/history'
import { setLang } from '../hooks/engine/i18n'
import type { PastSession } from '../types'

const NOW = new Date(2026, 9, 14, 12, 0).getTime()
const HOUR = 3_600_000

/** A typed prompt as a transcript writes it. */
const prompt = (text: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'user',
    message: { role: 'user', content: text },
    cwd: 'C:\\Users\\me\\Desktop\\shop',
    gitBranch: 'main',
    entrypoint: 'cli',
    timestamp: new Date(NOW - 3 * HOUR).toISOString(),
    ...over,
  })
const title = (t: string) => JSON.stringify({ type: 'ai-title', aiTitle: t, sessionId: 'x' })

const past = (over: Partial<PastSession>): PastSession => ({
  sessionId: 'id',
  cwd: 'C:\\Users\\me\\Desktop\\shop',
  branch: 'main',
  title: 'A title',
  prompts: [],
  startedAt: NOW - 2 * HOUR,
  lastAt: NOW - HOUR,
  ...over,
})

describe('reading a transcript', () => {
  test('a terminal session: folder, branch, Claude title, typed prompts', () => {
    const lines = [prompt('fix the cart total'), title('Cart total fix'), prompt('<command-name>/clear</command-name>'), prompt('now the tests')]
    const s = parseTranscript('abc', lines.join('\n'), NOW - HOUR)
    expect(s?.cwd).toBe('C:\\Users\\me\\Desktop\\shop')
    expect(s?.branch).toBe('main')
    expect(s?.title).toBe('Cart total fix')
    expect(s?.prompts).toEqual(['fix the cart total', 'now the tests'])
    expect(s?.lastAt).toBe(NOW - HOUR)
    expect(s?.startedAt).toBe(NOW - 3 * HOUR)
  })

  test('the first prompt stands in for a missing title', () => {
    expect(parseTranscript('abc', prompt('  fix\n the   cart '), NOW)?.title).toBe('fix the cart')
  })

  test('not a terminal session, or nothing typed: nothing to show', () => {
    expect(parseTranscript('abc', prompt('hi', { entrypoint: 'claude-vscode' }), NOW)).toBeUndefined()
    expect(parseTranscript('abc', prompt('skill text', { isMeta: true }), NOW)).toBeUndefined()
    expect(parseTranscript('abc', title('Only a title'), NOW)).toBeUndefined()
  })

  test('a line cut short is skipped, the rest still reads', () => {
    expect(parseTranscript('abc', prompt('kept') + '\n{"type":"user","mess', NOW)?.prompts).toEqual(['kept'])
  })
})

describe('finding and grouping', () => {
  const list = [
    past({ sessionId: 'a', title: 'Cart total fix', prompts: ['the VAT is wrong'] }),
    past({ sessionId: 'b', title: 'Blog layout', cwd: 'C:\\Users\\me\\Desktop\\blog', lastAt: NOW - 30 * HOUR }),
  ]

  test('every word has to be there, in the title, a prompt or the folder', () => {
    expect(search(list, 'vat').map(s => s.sessionId)).toEqual(['a'])
    expect(search(list, 'cart vat').map(s => s.sessionId)).toEqual(['a'])
    expect(search(list, 'cart blog')).toEqual([])
    expect(search(list, 'BLOG').map(s => s.sessionId)).toEqual(['b'])
    expect(search(list, '  ')).toHaveLength(2)
  })

  test('newest first, one heading per day', () => {
    setLang('it')
    const groups = byDay(list, NOW)
    expect(groups.map(g => g.day)).toEqual(['oggi', 'ieri'])
    expect(dayLabel(new Date(2026, 9, 5, 9).getTime(), NOW)).toBe('lun 5 ott')
  })

  test('long path lists split under the command-line limit', () => {
    const paths = Array.from({ length: 10 }, (_, i) => 'C:\\p\\' + 'x'.repeat(90) + i)
    const runs = batches(paths, 300)
    expect(runs.flat()).toEqual(paths)
    for (const run of runs) expect(run.join('   ').length).toBeLessThan(300)
  })

  test('resume opens a tab in the folder', () => {
    expect(resumeArgv('C:\\shop', 'abc')).toEqual(['wt', '-w', '0', 'nt', '-d', 'C:\\shop', 'claude', '--resume', 'abc'])
  })
})

test('History: search, then Enter on a row resumes it in a new tab', async ($, on) => {
  mock.env(on, { DEVDECK_LANG: 'it', USERPROFILE: 'C:\\Users\\me' })
  mock.clock(on, { now: NOW })
  mock.store(on)
  const root = 'C:\\Users\\me\\.claude\\projects'
  const shop = root + '\\C--shop\\aaa.jsonl'
  const blog = root + '\\C--blog\\bbb.jsonl'
  const tool = root + '\\C--shop\\ccc.jsonl'
  const transcripts: Record<string, string> = {
    [shop]: [prompt('fix the cart total'), title('Cart total fix')].join('\n'),
    [blog]: [prompt('new layout', { cwd: 'C:\\Users\\me\\Desktop\\blog' }), title('Blog layout')].join('\n'),
  }
  const launched: string[][] = []

  on('session.id', async () => ({ value: 'me' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.panes', async () => ({ value: [] }))
  on('fs.exists', async () => ({ value: true }))
  on('fs.read', async () => ({ value: '' }))
  on('fs.list', async ($, e) => {
    const entry = (name: string, kind: 'file' | 'dir') => ({ name, kind, size: 10, mtimeMs: NOW - HOUR, isLink: false })
    if (e.path === root) return { value: [entry('C--shop', 'dir'), entry('C--blog', 'dir')] }
    if (e.path === root + '\\C--shop') return { value: [entry('aaa.jsonl', 'file'), entry('ccc.jsonl', 'file'), entry('aaa', 'dir')] }
    if (e.path === root + '\\C--blog') return { value: [entry('bbb.jsonl', 'file')] }
    return { value: [] }
  })
  on('process.run', async ($, e) => {
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const [cmd, ...args] = e.argv
    if (cmd === 'tasklist') return out('')
    if (cmd === 'findstr' && args[0] === '/m') return out([shop, blog].filter(p => args.includes(p)).join('\r\n'))
    if (cmd === 'findstr') return out(transcripts[args.at(-1) ?? ''] ?? '', 0)
    if (cmd === 'wt') launched.push([...e.argv])
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

  await ui.press({ key: 'tab-history' })
  expect(await ui.find({ key: 'aaa' })).toBeDefined()
  expect(await ui.find({ key: 'bbb' })).toBeDefined()
  expect(await ui.find({ key: 'ccc' })).toBeUndefined()

  await ui.input({ key: 'search', text: 'cart', kind: 'change' })
  expect(await ui.find({ key: 'aaa' })).toBeDefined()
  expect(await ui.find({ key: 'bbb' })).toBeUndefined()

  await ui.press({ key: 'aaa' })
  expect(launched).toEqual([['wt', '-w', '0', 'nt', '-d', 'C:\\Users\\me\\Desktop\\shop', 'claude', '--resume', 'aaa']])
})

test('resume falls back when Windows Terminal fails, and says why when nothing opens', async ($, on) => {
  mock.env(on, { DEVDECK_LANG: 'it', USERPROFILE: 'C:\\Users\\me' })
  mock.clock(on, { now: NOW })
  mock.store(on)
  const root = 'C:\\Users\\me\\.claude\\projects'
  const shop = root + '\\C--shop\\aaa.jsonl'
  const tried: string[][] = []
  const toasts: string[] = []
  let opens = 1

  on('session.id', async () => ({ value: 'me' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.panes', async () => ({ value: [] }))
  on('ui.toast', async ($, e) => {
    toasts.push(String((e as { text?: unknown }).text))
    return { value: undefined } as never
  })
  on('fs.exists', async () => ({ value: true }))
  on('fs.read', async () => ({ value: '' }))
  on('fs.list', async ($, e) => {
    const entry = (name: string, kind: 'file' | 'dir') => ({ name, kind, size: 10, mtimeMs: NOW - HOUR, isLink: false })
    if (e.path === root) return { value: [entry('C--shop', 'dir')] }
    if (e.path === root + '\\C--shop') return { value: [entry('aaa.jsonl', 'file')] }
    return { value: [] }
  })
  on('process.run', async ($, e) => {
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode ? 'no' : '', isStdoutTruncated: false, isStderrTruncated: false } })
    const [cmd, ...args] = e.argv
    if (cmd === 'findstr' && args[0] === '/m') return out(shop)
    if (cmd === 'findstr') return out(prompt('fix the cart total'))
    if (cmd === 'wt' || (cmd === 'cmd' && args.includes('wt')) || (cmd === 'cmd' && args.includes('/k'))) {
      tried.push([...e.argv])
      if (tried.length > opens) return out('', 0)
      if (cmd === 'wt') throw new Error('spawn wt ENOENT')
      return out('', 1)
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
  await ui.press({ key: 'tab-history' })

  // wt can't start: the same command goes through `start`.
  await ui.press({ key: 'aaa' })
  expect(tried.map(a => a.slice(0, 4))).toEqual([
    ['wt', '-w', '0', 'nt'],
    ['cmd', '/c', 'start', ''],
  ])
  expect(toasts).toEqual([])

  // Nothing opens: the toast says why.
  tried.length = 0
  opens = 99
  await ui.press({ key: 'aaa' })
  expect(tried).toHaveLength(3)
  expect(toasts[0]).toContain('Windows Terminal non si è aperto')
  expect(toasts[0]).toContain('cmd exit 1')
})

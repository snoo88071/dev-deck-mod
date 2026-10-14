import { describe, expect, mock, test } from 'claude-code/testing'

import { DONE_MS, justFinished, lastTitle, shownState } from '../hooks/engine/sessions'
import type { LiveSession } from '../types'

const NOW = 1_800_000_000_000

const live = (id: string, status: string, statusSince = NOW): LiveSession => ({
  pid: 1,
  sessionId: id,
  name: id,
  cwd: 'C:\\x',
  status,
  statusSince,
  startedAt: 0,
})

describe('the state a row shows', () => {
  test('at work, finished for ten minutes after it stops, then idle', () => {
    expect(shownState(live('a', 'busy'), NOW)).toBe('busy')
    expect(shownState(live('a', 'idle', NOW - 60_000), NOW)).toBe('done')
    expect(shownState(live('a', 'idle', NOW - DONE_MS), NOW)).toBe('idle')
    expect(shownState(live('a', 'idle', 0), NOW)).toBe('idle')
  })

  test('finished means busy at the last read, idle now', () => {
    const before = new Map([['a', 'busy'], ['b', 'idle'], ['c', 'busy']])
    const now = [live('a', 'idle'), live('b', 'idle'), live('c', 'busy'), live('d', 'idle')]
    expect(justFinished(before, now).map(s => s.sessionId)).toEqual(['a'])
  })

  test("the last title in a transcript's aiTitle lines", () => {
    const lines = ['{"type":"ai-title","aiTitle":"First try"}', '{"type":"ai-title","aiTit', '{"type":"ai-title","aiTitle":"Cart total fix"}'].join('\r\n')
    expect(lastTitle(lines)).toBe('Cart total fix')
    expect(lastTitle('')).toBeUndefined()
  })
})

test('the pane shows titles, and a toast when another session finishes', async ($, on) => {
  mock.env(on, { USERPROFILE: 'C:\\Users\\me' })
  const clock = mock.clock(on, { now: NOW })
  const file = (pid: number, id: string, status: string, since: number) =>
    JSON.stringify({ pid, sessionId: id, cwd: 'C:\\Users\\me\\Desktop\\shop', startedAt: 0, entrypoint: 'cli', name: id + '-4b', status, statusUpdatedAt: since })
  const files: Record<string, string> = {
    '1.json': file(1, 'me', 'busy', NOW),
    '2.json': file(2, 'other', 'busy', NOW - 60_000),
  }
  const toasts: string[] = []

  on('session.id', async () => ({ value: 'me' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.panes', async () => ({ value: [] }))
  on('ui.toast', async ($, e) => {
    toasts.push(String((e as { text?: unknown }).text ?? JSON.stringify(e)))
    return { value: undefined } as never
  })
  on('fs.list', async () => ({ value: Object.keys(files).map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })) }))
  on('fs.read', async ($, e) => ({ value: files[e.path.split(/[\\/]/).pop() ?? ''] ?? '' }))
  on('process.run', async ($, e) => {
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const [cmd, ...args] = e.argv
    if (cmd === 'powershell') return out(JSON.stringify({ procs: [1, 2].map(i => ({ i, p: 0, n: 'claude.exe', w: 1, c: 'claude' })), tails: {} }))
    if (cmd === 'findstr' && args[0] === '/c:"aiTitle"') {
      return out(args[1]?.endsWith('other.jsonl') ? '{"type":"ai-title","aiTitle":"Cart total fix"}' : '')
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
  expect(await texts()).toContain('Cart total fix')
  expect(await texts()).toContain('me-4b')
  expect(toasts).toEqual([])

  // The other session finishes its answer: the next read sees it idle.
  files['2.json'] = file(2, 'other', 'idle', NOW + 1_000)
  await clock.advance(2_000)
  expect(toasts).toEqual(['Cart total fix ha finito'])
  expect(await texts()).toContain('finito')
})

import { describe, expect, mock, test } from 'claude-code/testing'

import { parseChapters, scrollId, textKey } from '../hooks/engine/chapters'

const NOW = 1_800_000_000_000

const typed = (uuid: string, text: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'user', uuid, timestamp: new Date(NOW).toISOString(), message: { role: 'user', content: text }, ...over })

describe('the chapters of a conversation', () => {
  test("the person's messages in order, not commands, skills or repeats", () => {
    const lines = [
      typed('u1', 'fix the cart total'),
      typed('u2', '<command-name>/clear</command-name>'),
      typed('u3', 'skill text', { isMeta: true }),
      typed('u4', 'now the tests'),
      typed('u4', 'now the tests'),
      '{"type":"user","uuid":"u5","mess',
    ].join('\r\n')
    expect(parseChapters(lines).map(c => [c.uuid, c.text])).toEqual([
      ['u1', 'fix the cart total'],
      ['u4', 'now the tests'],
    ])
  })

  test('where to scroll: the id it was drawn under, else the transcript one', () => {
    const ch = { uuid: 'u1', at: 0, text: 'fix  the\ncart total' }
    expect(scrollId(ch, new Map())).toBe('u1')
    expect(scrollId(ch, new Map([[textKey('fix the cart total'), 'msg-7']]))).toBe('msg-7')
  })
})

test('Capitoli: tab 3 lists the messages; a press that cannot scroll says so', async ($, on) => {
  mock.env(on, { USERPROFILE: 'C:\\Users\\me' })
  mock.clock(on, { now: NOW })
  const session = JSON.stringify({ pid: 1, sessionId: 'me', cwd: 'C:\\Users\\me\\Desktop\\shop', startedAt: 0, entrypoint: 'cli', name: 'shop', status: 'idle', statusUpdatedAt: 0 })
  const toasts: string[] = []

  // Beneath the plugin, the test stands for Claude Code drawing a message.
  on('ui.render', { component: 'UserMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e as never) as { Text: (p: object) => never }
    return Text({ children: ['message'] })
  })
  on('session.id', async () => ({ value: 'me' }))
  on('session.cwd', async () => ({ value: 'C:\\Users\\me\\Desktop\\shop' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.panes', async () => ({ value: [] }))
  on('ui.toast', async ($, e) => {
    toasts.push(String((e as { text?: unknown }).text))
    return { value: undefined } as never
  })
  on('fs.list', async () => ({ value: [{ name: '1.json', kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }] }))
  on('fs.read', async () => ({ value: session }))
  on('fs.stat', async () => ({ value: { kind: 'file', size: 10, mtimeMs: NOW, isLink: false } as never }))
  on('process.run', async ($, e) => {
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const [cmd, ...args] = e.argv
    if (cmd === 'powershell') return out(JSON.stringify({ procs: [{ i: 1, p: 0, n: 'claude.exe', w: 1, c: 'claude' }], tails: {} }))
    if (cmd === 'findstr' && args[0] === '/c:"role":"user","content":"') {
      expect(args[1]).toBe('C:\\Users\\me\\.claude\\projects\\C--Users-me-Desktop-shop\\me.jsonl')
      return out([typed('u1', 'fix the cart total'), typed('u2', 'now the tests')].join('\r\n'))
    }
    return out('')
  })

  await $.command.run({ command: 'deck', args: '' } as never)
  // Claude Code draws the first message under its own id.
  await $.ui.mount({
    plugin: 'dev-deck-mod',
    surface: 'terminal',
    component: 'UserMessage',
    requestId: 'msg-7',
    props: { text: 'fix the cart total', origin: { kind: 'composer' }, isExpanded: false } as never,
  })
  const ui = await $.ui.mount({
    plugin: 'dev-deck-mod',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'deck',
    props: { title: 'Dev Deck', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 20 } } as never,
  })

  await ui.press({ key: 'tab-chapters' })
  expect(await ui.find({ key: 'ch-u1' })).toBeDefined()
  expect(await ui.find({ key: 'ch-u2' })).toBeDefined()

  // The kit has no conversation to scroll: a press that can't bring the message back says so.
  await ui.press({ key: 'ch-u1' })
  expect(toasts).toEqual(['Questo messaggio non è più nella conversazione'])
})

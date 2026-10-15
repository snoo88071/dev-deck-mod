import { expect, mock, test } from 'claude-code/testing'

const NOW = new Date(2026, 9, 14, 12, 0).getTime()
const HOUR = 3_600_000

test('History: days in blue, sentence case; the focused row reads whole; Enter in the field says "vai"', async ($, on) => {
  mock.env(on, { DEVDECK_LANG: 'it', USERPROFILE: 'C:\\Users\\me' })
  mock.clock(on, { now: NOW })
  mock.store(on)
  const root = 'C:\\Users\\me\\.claude\\projects'
  const shop = root + '\\C--shop\\aaa.jsonl'
  const prompt = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: 'fix the cart total' },
    cwd: 'C:\\Users\\me\\Desktop\\shop',
    entrypoint: 'cli',
    timestamp: new Date(NOW - 2 * HOUR).toISOString(),
  })

  on('session.id', async () => ({ value: 'me' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.panes', async () => ({ value: [] }))
  // Beneath the plugin, the test stands for the engine moving the focus.
  on('ui.focus', async () => ({}) as never)
  on('fs.read', async () => ({ value: '' }))
  on('fs.list', async ($$, e) => {
    const entry = (name: string, kind: 'file' | 'dir') => ({ name, kind, size: 10, mtimeMs: NOW - HOUR, isLink: false })
    if (e.path === root) return { value: [entry('C--shop', 'dir')] }
    if (e.path === root + '\\C--shop') return { value: [entry('aaa.jsonl', 'file')] }
    return { value: [] }
  })
  on('process.run', async ($$, e) => {
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const [cmd, ...args] = e.argv
    if (cmd === 'findstr' && args[0] === '/m') return out(shop)
    if (cmd === 'findstr') return out(prompt)
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

  expect((await ui.find({ type: 'Text', text: 'Oggi' }))?.props).toMatchObject({ bold: true, color: 'suggestion' })
  expect((await ui.find({ key: 'search' }))?.props.submitLabel).toBe('vai')

  const tail = async () => (await ui.findAll({ type: 'Text', text: /11:00/ }))[0]?.props
  expect((await tail())?.inverse).toBeFalsy()
  // The event as the engine raises it when the person tabs onto the row.
  await $.ui.focus({ component: 'Pane', requestId: 'deck', plugin: 'dev-deck-mod', element: 'aaa', key: 'aaa', origin: { kind: 'person' } } as never)
  expect((await tail())?.inverse).toBe(true)
})

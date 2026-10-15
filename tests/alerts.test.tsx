import { describe, expect, mock, test } from 'claude-code/testing'

import { alertsFor } from '../hooks/engine/alerts'
import type { Presence } from '../hooks/engine/alerts'

const NOW = 1_800_000_000_000
const p = (state: Presence['state'], label: string, at: number): Presence => ({ state, label, at })

describe('who the band speaks of, and where', () => {
  const live = new Set(['me', 'blog', 'shop', 'docs'])

  test('the others waiting or done, waiting first; not one at work, not one seen, not a closed one', () => {
    const presences = {
      me: p('done', 'Me', NOW),
      blog: p('done', 'Blog', NOW - 1_000),
      shop: p('waiting', 'Shop', NOW - 5_000),
      docs: p('busy', 'Docs', NOW - 2_000),
      gone: p('waiting', 'Gone', NOW),
    }
    const { show, alerts } = alertsFor('me', presences, { me: NOW - 100 }, live)
    expect(show).toBe(true)
    expect(alerts.map(a => [a.label, a.state])).toEqual([
      ['Shop', 'waiting'],
      ['Blog', 'done'],
    ])
    // Typing in blog after it was done: seen.
    expect(alertsFor('me', presences, { me: NOW - 100, blog: NOW }, live).alerts.map(a => a.label)).toEqual(['Shop'])
  })

  test('only the session typed in last shows it; with no prompts anywhere, every one does', () => {
    const presences = { blog: p('done', 'Blog', NOW - 1_000) }
    expect(alertsFor('me', presences, { me: NOW - 100, shop: NOW }, live).show).toBe(false)
    expect(alertsFor('me', presences, {}, live).show).toBe(true)
  })
})

/** A store in memory the test can change, as the other sessions would. */
const storeOn = (on: any, data: Map<string, unknown>) => {
  on('store.get', async ($: unknown, e: { key: string }) => ({ value: data.get(e.key) }))
  on('store.set', async ($: unknown, e: { key: string; value: unknown }) => {
    data.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', async ($: unknown, e: { key: string }) => {
    data.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', async () => ({ value: [...data.keys()] }))
}

/** Two CLI sessions open: this one ("me", pid 1) and "blog" (pid 2). */
const twoSessions = (on: any) => {
  const file = (pid: number, id: string) =>
    JSON.stringify({ pid, sessionId: id, cwd: 'C:\\Users\\me\\Desktop\\' + id, startedAt: 0, entrypoint: 'cli', name: id + '-4b', status: 'idle', statusUpdatedAt: 0 })
  const files: Record<string, string> = { '1.json': file(1, 'me'), '2.json': file(2, 'blog') }
  on('session.id', async () => ({ value: 'me' }))
  on('fs.list', async () => ({ value: Object.keys(files).map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })) }))
  on('fs.read', async ($: unknown, e: { path: string }) => ({ value: files[e.path.split(/[\\/]/).pop() ?? ''] ?? '' }))
  on('process.run', async ($: unknown, e: { argv: string[] }) => {
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'findstr' && e.argv[1] === '/c:"aiTitle"') return out('{"type":"ai-title","aiTitle":"Cart total fix"}')
    return out('')
  })
  on('turn.start', async ($: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: '' }) as never)
}

test('this session says when it waits, works and is done', async ($, on) => {
  mock.env(on, { DEVDECK_LANG: 'it', USERPROFILE: 'C:\\Users\\me' })
  mock.clock(on, { now: NOW })
  const data = new Map<string, unknown>()
  storeOn(on, data)
  twoSessions(on)
  on('tool.check', async () => ({ decision: 'ask' }) as never)
  on('tool.call', { tool: 'Edit' }, async () => ({ result: {} }) as never)

  await $.turn.start({ text: 'go', turnId: 't' } as never)
  expect((data.get('presence:me') as Presence).state).toBe('busy')

  await $.tool.check({ tool: 'Edit', input: {} } as never)
  expect((data.get('presence:me') as Presence).state).toBe('waiting')

  await $.tool.call({ tool: 'Edit', file_path: 'a', old_string: 'x', new_string: 'y' } as never)
  expect((data.get('presence:me') as Presence).state).toBe('busy')

  await $.turn.complete({ reason: 'end_turn' } as never)
  expect(data.get('presence:me')).toMatchObject({ state: 'done', label: 'Cart total fix' })
})

test('above the prompt: another session waiting, then done, then seen', async ($, on) => {
  mock.env(on, { DEVDECK_LANG: 'it', USERPROFILE: 'C:\\Users\\me' })
  const clock = mock.clock(on, { now: NOW })
  const data = new Map<string, unknown>([
    ['presence:blog', p('waiting', 'Blog layout', NOW - 1_000)],
    ['input:me', NOW - 5_000],
    ['input:blog', NOW - 60_000],
  ])
  storeOn(on, data)
  twoSessions(on)
  on('ui.render', { component: 'AbovePrompt' }, async ($$, e) => {
    const { Text } = $$.ui.resolve(e as never) as { Text: (p: object) => never }
    return Text({ key: 'empty', children: [''] })
  })
  const band = async () => {
    const ui = await $.ui.mount({
      plugin: 'dev-deck-mod',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100, scroll: { offset: 0, bodyRows: 3 } } as never,
    })
    const text = (await ui.findAll({ type: 'Text' })).map(x => x.text).join(' | ')
    await ui.unmount()
    return text
  }

  // The first event in this session starts reading the others.
  await $.turn.start({ text: 'go', turnId: 't' } as never)
  expect(await band()).toBe('⏳ Blog layout ti aspetta')

  data.set('presence:blog', p('done', 'Blog layout', NOW + 1_000))
  await clock.advance(3_000)
  expect(await band()).toBe('✓ Blog layout ha finito')

  // The person goes to blog and types there: seen, and this is no longer the session they're in.
  data.set('input:blog', NOW + 4_000)
  await clock.advance(3_000)
  expect(await band()).toBe('')
})

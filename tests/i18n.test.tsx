import { describe, expect, mock, test } from 'claude-code/testing'

import { DICTS, LANGS, regLanguage, resolveLang } from '../hooks/engine/i18n'

describe('the dictionaries', () => {
  const keys = Object.keys(DICTS.en).sort()
  const holes = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()

  for (const lang of LANGS) {
    test(`${lang}: every key, with the same {placeholders} as English`, () => {
      const dict = DICTS[lang]
      expect(Object.keys(dict).sort()).toEqual(keys)
      for (const key of keys) expect(holes(dict[key as keyof typeof dict]!)).toEqual(holes(DICTS.en[key as keyof typeof DICTS.en]!))
      expect(dict.weekdays!.split(' ')).toHaveLength(7)
      expect(dict.months!.split(' ')).toHaveLength(12)
    })
  }
})

describe('which language', () => {
  test('from a tag to a language the mod speaks, English otherwise', () => {
    expect(resolveLang('it-IT')).toBe('it')
    expect(resolveLang('pt_BR')).toBe('pt')
    expect(resolveLang('de-DE')).toBe('en')
    expect(resolveLang(undefined)).toBe('en')
  })

  test("from reg query's output", () => {
    const multi = '\r\nHKEY_CURRENT_USER\\Control Panel\\Desktop\r\n    PreferredUILanguages    REG_MULTI_SZ    it-IT\\0en-US\r\n'
    expect(regLanguage(multi)).toBe('it-IT')
    expect(regLanguage('    LocaleName    REG_SZ    fr-FR\r\n')).toBe('fr-FR')
    expect(regLanguage('ERROR: The system was unable to find the specified registry key or value.')).toBeUndefined()
  })
})

/** A session with the pane's tabs to read, its language from `env` or from the registry's `reg`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tabsIn = async ($: any, on: any, env: Record<string, string>, reg: string) => {
  mock.env(on, { USERPROFILE: 'C:\\Users\\me', ...env })
  mock.clock(on, { now: 1_800_000_000_000 })
  on('session.id', async () => ({ value: 'me' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.panes', async () => ({ value: [] }))
  on('fs.list', async () => ({ value: [] }))
  on('process.run', async ($$: unknown, e: { argv: string[] }) => {
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'reg' && e.argv[2]?.endsWith('Desktop')) return out(reg)
    if (e.argv[0] === 'powershell') return out(JSON.stringify({ procs: [{ i: 1, p: 0, n: 'x.exe', w: 1, c: '' }], tails: {} }))
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
  return [(await ui.find({ key: 'tab-open' }))?.props.label, (await ui.find({ key: 'tab-history' }))?.props.label, (await ui.find({ key: 'tab-chapters' }))?.props.label]
}

test('DEVDECK_LANG=en: the pane in English', async ($, on) => {
  expect(await tabsIn($, on, { DEVDECK_LANG: 'en' }, '    PreferredUILanguages    REG_MULTI_SZ    it-IT')).toEqual(['Open', 'History', 'Chapters'])
})

test("no DEVDECK_LANG: Windows' language, from the registry", async ($, on) => {
  expect(await tabsIn($, on, {}, '    PreferredUILanguages    REG_MULTI_SZ    it-IT\\0en-US')).toEqual(['Aperte', 'Storico', 'Capitoli'])
})

test('DEVDECK_LANG=fr: the pane in French', async ($, on) => {
  expect(await tabsIn($, on, { DEVDECK_LANG: 'fr' }, '')).toEqual(['Ouvertes', 'Historique', 'Chapitres'])
})

test('a language the mod lacks: English', async ($, on) => {
  expect(await tabsIn($, on, {}, '    PreferredUILanguages    REG_MULTI_SZ    de-DE')).toEqual(['Open', 'History', 'Chapters'])
})

test('the guard in English knows its own answers', async ($, on) => {
  mock.env(on, { DEVDECK_LANG: 'en', USERPROFILE: 'C:\\Users\\me' })
  const session = JSON.stringify({ pid: 50, sessionId: 's', cwd: 'C:\\shop', startedAt: 0, entrypoint: 'cli', name: 'shop', status: 'busy', statusUpdatedAt: 0 })
  const asked: string[] = []
  const ran: string[] = []
  on('session.cwd', async () => ({ value: 'C:\\shop' }))
  on('fs.list', async () => ({ value: [{ name: '50.json', kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }] }))
  on('fs.read', async () => ({ value: session }))
  on('process.run', async ($$, e) => {
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'powershell') {
      const procs = [
        { i: 50, p: 2, n: 'claude.exe', w: 1, c: 'claude' },
        { i: 53, p: 50, n: 'node.exe', w: 1, c: 'node C:\\npm-cache\\_npx\\1\\node_modules\\http-server\\bin\\http-server -p 8099' },
      ]
      return out(JSON.stringify({ procs, tails: {} }))
    }
    if (e.argv[0] === 'netstat') return out('  TCP    0.0.0.0:8099    0.0.0.0:0    LISTENING    53')
    return out('')
  })
  on('tool.call', { tool: 'AskUserQuestion' }, async ($$, e: { questions: { question: string }[] }) => {
    const q = e.questions[0]?.question ?? ''
    asked.push(q)
    return { result: { questions: e.questions, answers: { [q]: 'Reuse it' } } } as never
  })
  on('tool.call', { tool: 'Bash' }, async ($$, e: { command: string }) => {
    ran.push(e.command)
    return { result: { stdout: '', stderr: '', interrupted: false } } as never
  })

  const r = await $.tool.call({ tool: 'Bash', command: 'npx http-server -p 8099' } as never)
  expect(asked).toEqual(['Port 8099 is already taken by http-server (:8099). What should I do?'])
  expect(ran).toEqual([])
  // What Claude reads stays English whatever the language: it was English all along.
  expect(JSON.stringify(r)).toContain('The person chose to reuse it')
})

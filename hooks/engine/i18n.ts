/**
 * The mod's language: Windows' display language when the mod has it, English otherwise, as Dev
 * Deck does, so the two agree. What Claude reads (the guard's note) stays English.
 */

export const LANGS = ['en', 'it', 'es', 'fr', 'pt'] as const
export type Lang = (typeof LANGS)[number]

/** From a BCP 47 tag (`it-IT`, `pt-BR`, `de`) to a language the mod speaks. */
export function resolveLang(tag: string | undefined): Lang {
  const primary = (tag ?? '').trim().split(/[-_]/)[0]!.toLowerCase()
  return (LANGS as readonly string[]).includes(primary) ? (primary as Lang) : 'en'
}

/** The first language in `reg query` output for PreferredUILanguages or LocaleName. */
export function regLanguage(out: string): string | undefined {
  return /REG_(?:MULTI_)?SZ\s+([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)*)/.exec(out)?.[1]
}

const en = {
  tabOpen: 'Open',
  tabHistory: 'History',
  tabChapters: 'Chapters',
  noOpenSessions: 'No Claude Code CLI session open',
  orphans: 'Orphans',
  stop: 'Stop',
  sure: 'Sure?',
  search: 'Search',
  searchPlaceholder: 'title, prompt, folder',
  noMessages: 'No messages yet',
  stateBusy: 'at work',
  stateDone: 'done',
  stateIdle: 'idle',
  finished: '{name} is done',
  leftOnOne: '{names} stays on',
  leftOnMany: '{names} stay on',
  guardPort: 'Port {port} is already taken by {label} ({where}). What should I do?',
  guardProject: '{label} is already running for this project ({where}). What should I do?',
  guardHeader: 'Server',
  reuse: 'Reuse it',
  restart: 'Restart',
  launch: 'Start anyway',
  goneMessage: 'This message is no longer in the conversation',
  noFolder: 'Folder not found: {path}',
  noTerminal: "Windows Terminal didn't open",
  commandDescription: 'Your Claude Code CLI sessions, in a pane',
  today: 'today',
  yesterday: 'yesterday',
  weekdays: 'Sun Mon Tue Wed Thu Fri Sat',
  months: 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec',
}

export type Key = keyof typeof en

const it: Record<Key, string> = {
  tabOpen: 'Aperte',
  tabHistory: 'Storico',
  tabChapters: 'Capitoli',
  noOpenSessions: 'Nessuna sessione CLI di Claude Code aperta',
  orphans: 'Orfani',
  stop: 'Spegni',
  sure: 'Sicuro?',
  search: 'Cerca',
  searchPlaceholder: 'titolo, prompt, cartella',
  noMessages: 'Ancora nessun messaggio',
  stateBusy: 'al lavoro',
  stateDone: 'finito',
  stateIdle: 'ferma',
  finished: '{name} ha finito',
  leftOnOne: '{names} resta acceso',
  leftOnMany: '{names} restano accesi',
  guardPort: 'La porta {port} è già presa da {label} ({where}). Cosa faccio?',
  guardProject: 'Per questo progetto è già acceso {label} ({where}). Cosa faccio?',
  guardHeader: 'Server',
  reuse: 'Riusa quello',
  restart: 'Riavvia',
  launch: 'Lancia lo stesso',
  goneMessage: 'Questo messaggio non è più nella conversazione',
  noFolder: 'Cartella non trovata: {path}',
  noTerminal: 'Windows Terminal non si è aperto',
  commandDescription: 'Le tue sessioni CLI di Claude Code, in un pannello',
  today: 'oggi',
  yesterday: 'ieri',
  weekdays: 'dom lun mar mer gio ven sab',
  months: 'gen feb mar apr mag giu lug ago set ott nov dic',
}

/** Each language's words; one that misses a key says it in English. */
export const DICTS: Record<Lang, Partial<Record<Key, string>>> = { en, it, es: {}, fr: {}, pt: {} }

let current: Lang = 'en'

export function setLang(lang: Lang): void {
  current = lang
}

export function getLang(): Lang {
  return current
}

/** The words for `key` in the mod's language, `{name}` filled from `vars`. */
export function t(key: Key, vars: Record<string, string | number> = {}): string {
  const text = DICTS[current][key] ?? en[key]
  return text.replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? String(vars[name]) : all))
}

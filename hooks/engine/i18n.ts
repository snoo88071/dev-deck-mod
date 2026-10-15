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
  waiting: '{name} is waiting for you',
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
  waiting: '{name} ti aspetta',
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

const es: Record<Key, string> = {
  tabOpen: 'Abiertas',
  tabHistory: 'Historial',
  tabChapters: 'Capítulos',
  noOpenSessions: 'No hay sesiones CLI de Claude Code abiertas',
  orphans: 'Huérfanos',
  stop: 'Detener',
  sure: '¿Seguro?',
  search: 'Buscar',
  searchPlaceholder: 'título, prompt, carpeta',
  noMessages: 'Aún no hay mensajes',
  stateBusy: 'trabajando',
  stateDone: 'terminada',
  stateIdle: 'inactiva',
  finished: '{name} ha terminado',
  waiting: '{name} te espera',
  leftOnOne: '{names} sigue encendido',
  leftOnMany: '{names} siguen encendidos',
  guardPort: 'El puerto {port} ya lo usa {label} ({where}). ¿Qué hago?',
  guardProject: 'Para este proyecto ya está encendido {label} ({where}). ¿Qué hago?',
  guardHeader: 'Servidor',
  reuse: 'Usar ese',
  restart: 'Reiniciar',
  launch: 'Iniciar igualmente',
  goneMessage: 'Este mensaje ya no está en la conversación',
  noFolder: 'Carpeta no encontrada: {path}',
  noTerminal: 'Windows Terminal no se abrió',
  commandDescription: 'Tus sesiones CLI de Claude Code, en un panel',
  today: 'hoy',
  yesterday: 'ayer',
  weekdays: 'dom lun mar mié jue vie sáb',
  months: 'ene feb mar abr may jun jul ago sep oct nov dic',
}

const fr: Record<Key, string> = {
  tabOpen: 'Ouvertes',
  tabHistory: 'Historique',
  tabChapters: 'Chapitres',
  noOpenSessions: 'Aucune session CLI Claude Code ouverte',
  orphans: 'Orphelins',
  stop: 'Arrêter',
  sure: 'Sûr ?',
  search: 'Chercher',
  searchPlaceholder: 'titre, prompt, dossier',
  noMessages: 'Pas encore de messages',
  stateBusy: 'au travail',
  stateDone: 'terminée',
  stateIdle: 'inactive',
  finished: '{name} a terminé',
  waiting: '{name} vous attend',
  leftOnOne: '{names} reste allumé',
  leftOnMany: '{names} restent allumés',
  guardPort: 'Le port {port} est déjà pris par {label} ({where}). Que faire ?',
  guardProject: '{label} tourne déjà pour ce projet ({where}). Que faire ?',
  guardHeader: 'Serveur',
  reuse: 'Garder celui-là',
  restart: 'Redémarrer',
  launch: 'Lancer quand même',
  goneMessage: "Ce message n'est plus dans la conversation",
  noFolder: 'Dossier introuvable : {path}',
  noTerminal: "Windows Terminal ne s'est pas ouvert",
  commandDescription: 'Vos sessions CLI Claude Code, dans un panneau',
  today: "aujourd'hui",
  yesterday: 'hier',
  weekdays: 'dim lun mar mer jeu ven sam',
  months: 'janv févr mars avr mai juin juil août sept oct nov déc',
}

// Brazilian Portuguese, as in Dev Deck.
const pt: Record<Key, string> = {
  tabOpen: 'Abertas',
  tabHistory: 'Histórico',
  tabChapters: 'Capítulos',
  noOpenSessions: 'Nenhuma sessão CLI do Claude Code aberta',
  orphans: 'Órfãos',
  stop: 'Parar',
  sure: 'Certeza?',
  search: 'Buscar',
  searchPlaceholder: 'título, prompt, pasta',
  noMessages: 'Ainda não há mensagens',
  stateBusy: 'trabalhando',
  stateDone: 'concluída',
  stateIdle: 'inativa',
  finished: '{name} terminou',
  waiting: '{name} está esperando você',
  leftOnOne: '{names} continua ligado',
  leftOnMany: '{names} continuam ligados',
  guardPort: 'A porta {port} já está em uso por {label} ({where}). O que eu faço?',
  guardProject: 'Para este projeto já está ligado {label} ({where}). O que eu faço?',
  guardHeader: 'Servidor',
  reuse: 'Usar esse',
  restart: 'Reiniciar',
  launch: 'Iniciar mesmo assim',
  goneMessage: 'Esta mensagem não está mais na conversa',
  noFolder: 'Pasta não encontrada: {path}',
  noTerminal: 'O Windows Terminal não abriu',
  commandDescription: 'Suas sessões CLI do Claude Code, em um painel',
  today: 'hoje',
  yesterday: 'ontem',
  weekdays: 'dom seg ter qua qui sex sáb',
  months: 'jan fev mar abr mai jun jul ago set out nov dez',
}

/** Each language's words; one that misses a key says it in English. */
export const DICTS: Record<Lang, Partial<Record<Key, string>>> = { en, it, es, fr, pt }

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

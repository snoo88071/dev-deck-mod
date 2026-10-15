/**
 * Telling one CLI session what the others are up to. Each session writes its own state to the mod's
 * store, which every session on the machine shares; the band reads them all.
 */

/** What a session says about itself. */
export type Presence = {
  state: 'busy' | 'waiting' | 'done'
  /** How the band names it: Claude's title when there is one, else the session's name. */
  label: string
  /** When the state began, in milliseconds since the epoch. */
  at: number
}

/** One line of the band: a session that is waiting for you, or done. */
export type Alert = { sessionId: string; label: string; state: 'waiting' | 'done' }

export const PRESENCE = 'presence:'
export const INPUT = 'input:'

/**
 * Whether this session is the one to show the band, and what it shows. The band goes to the session
 * the person typed in last, so three open terminals don't say the same thing three times; one that
 * never had a prompt shows it only while none has. An entry goes once the person types in that
 * session after it began, or the session goes back to work.
 */
export function alertsFor(
  me: string,
  presences: Readonly<Record<string, Presence>>,
  inputs: Readonly<Record<string, number>>,
  live: ReadonlySet<string>,
): { show: boolean; alerts: Alert[] } {
  const latest = Math.max(0, ...[...live].map(id => inputs[id] ?? 0))
  const show = latest === 0 || (inputs[me] ?? 0) === latest
  const alerts: (Alert & { at: number })[] = []
  for (const [id, p] of Object.entries(presences)) {
    if (id === me || !live.has(id) || p.state === 'busy') continue
    if ((inputs[id] ?? 0) >= p.at) continue
    alerts.push({ sessionId: id, label: p.label, state: p.state, at: p.at })
  }
  // Waiting first: Claude is stuck until you answer. Then the newest.
  alerts.sort((a, b) => (a.state === b.state ? b.at - a.at : a.state === 'waiting' ? -1 : 1))
  return { show, alerts: alerts.map(({ at: _at, ...a }) => a) }
}

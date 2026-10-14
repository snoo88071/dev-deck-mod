/** How long since `from`, in the two largest units: `45s`, `12m`, `2h 14m`, `3d 5h`. */
export function since(from: number, now: number): string {
  const s = Math.max(0, Math.floor((now - from) / 1000))
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60)
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h ' + (m % 60) + 'm'
  return Math.floor(h / 24) + 'd ' + (h % 24) + 'h'
}

/** A folder with the home folder written as `~`, whatever the slashes and the drive letter's case. */
export function shortPath(path: string, home: string): string {
  if (!home) return path
  const norm = (p: string) => p.replace(/\//g, '\\').toLowerCase()
  const h = norm(home).replace(/\\$/, '')
  return norm(path).startsWith(h + '\\') || norm(path) === h ? '~' + path.slice(h.length) : path
}

/** `text` on one line in exactly `width` cells: cut at the end with `…`, or padded. */
export function fit(text: string, width: number): string {
  const one = text.replace(/\s+/g, ' ').trim()
  const chars = [...one]
  if (chars.length <= width) return one + ' '.repeat(width - chars.length)
  return chars.slice(0, Math.max(0, width - 1)).join('') + '…'
}

/** `text` in exactly `width` cells, cut at the start: the end of a path is the part that tells. */
export function fitStart(text: string, width: number): string {
  const chars = [...text]
  if (chars.length <= width) return text + ' '.repeat(width - chars.length)
  return '…' + chars.slice(chars.length - Math.max(0, width - 1)).join('')
}

/** The word for a session's state. */
export function statusLabel(status: string): string {
  if (status === 'busy') return 'al lavoro'
  if (status === 'idle') return 'ferma'
  return status || '?'
}

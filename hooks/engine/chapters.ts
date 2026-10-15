import type { Chapter } from '../../types'
import { typedPrompt } from './history'

/**
 * The chapters of a conversation: each message the person typed, in order, from findstr's output
 * of the transcript's plain-text user lines.
 */
export function parseChapters(lines: string): Chapter[] {
  const out: Chapter[] = []
  const seen = new Set<string>()
  for (const raw of lines.split(/\r?\n/)) {
    if (raw === '') continue
    let line: Record<string, unknown>
    try {
      line = JSON.parse(raw)
    } catch {
      continue
    }
    const text = typedPrompt(line)
    const uuid = typeof line.uuid === 'string' ? line.uuid : ''
    if (!text || !uuid || seen.has(uuid)) continue
    seen.add(uuid)
    out.push({ uuid, at: typeof line.timestamp === 'string' ? Date.parse(line.timestamp) || 0 : 0, text })
  }
  return out
}

/** The key a drawn message and a transcript line share: the start of the text, spaces folded. */
export function textKey(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 120)
}

/**
 * Where to scroll for a chapter: the id Claude Code drew that message under, when the mod saw it
 * drawn; else the transcript's own id for the line.
 */
export function scrollId(chapter: Chapter, drawn: ReadonlyMap<string, string>): string {
  return drawn.get(textKey(chapter.text)) ?? chapter.uuid
}

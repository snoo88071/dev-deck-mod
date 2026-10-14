/** One open Claude Code CLI session, as the pane draws it. */
export type LiveSession = {
  pid: number
  sessionId: string
  name: string
  cwd: string
  /** `busy` while Claude works, `idle` while it waits for you; whatever else the file says, as it says it. */
  status: string
  startedAt: number
}

/** A past CLI session, from its transcript: what a History row shows and what the search reads. */
export type PastSession = {
  sessionId: string
  cwd: string
  branch: string
  /** The title Claude Code wrote, or the first prompt. */
  title: string
  /** The prompts typed, cut short: the first and the last ones when there are many. */
  prompts: string[]
  startedAt: number
  /** The transcript's last write. */
  lastAt: number
}

/** The pane's tabs. */
export type DeckTab = 'open' | 'history'

declare module 'claude-code' {
  interface PluginState {
    'dev-deck-mod': {
      sessions: LiveSession[]
      tab: DeckTab
      history: PastSession[]
      query: string
      /** True while the history is being read for the first time. */
      isScanning: boolean
    }
  }
}

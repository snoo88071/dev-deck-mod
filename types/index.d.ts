/** One open Claude Code CLI session, as the pane draws it. */
export type LiveSession = {
  pid: number
  sessionId: string
  name: string
  cwd: string
  /** `busy` while Claude works, `idle` while it waits for you; whatever else the file says, as it says it. */
  status: string
  /** When the status last changed, as the file says; 0 when it doesn't. */
  statusSince: number
  startedAt: number
  /** The title Claude Code wrote in the transcript, once there is one. */
  title?: string
}

/** Something an open session started directly, with everything under it. */
export type Branch = {
  /** The process the session started: Stop closes it and its tree. */
  pid: number
  label: string
  /** TCP ports anything in the branch listens on. */
  ports: number[]
  /** Bytes in memory, the whole branch. */
  ram: number
}

/** What an open session holds, from the last read of the processes. */
export type SessionLoad = {
  /** Bytes in memory: claude itself and everything under it. */
  ram: number
  branches: Branch[]
  /** Percent of the context window, when the transcript says. */
  context?: number
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
      /** By session id. */
      loads: Record<string, SessionLoad>
      /** The branch whose Stop was pressed once, waiting for the second press. */
      armed: number
      tab: DeckTab
      history: PastSession[]
      query: string
      /** True while the history is being read for the first time. */
      isScanning: boolean
    }
  }
}

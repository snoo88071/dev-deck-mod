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

declare module 'claude-code' {
  interface PluginState {
    'dev-deck-mod': {
      sessions: LiveSession[]
    }
  }
}

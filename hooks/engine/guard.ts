import type { LiveSession } from '../../types'
import { labelOf, subtree } from './procs'
import type { Proc, Tree } from './procs'

/** A command that starts a dev server, and the port it asks for when it says. */
export type ServerStart = { port?: number }

const STARTS = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview)\b/i,
  // As the command itself, not as an argument (`npm install vite`).
  /(?:^|&&|;|\|\||\b(?:npx|pnpx|bunx)\s)\s*(?:vite|http-server|live-server)\b(?!\s+build)/i,
  /\b(?:next|nuxt|nuxi|astro|remix)\s+dev\b/i,
  /\bnpx\s+serve\b/i,
  /\bpython[\d.]*(?:\.exe)?\s+-m\s+http\.server\b/i,
  /\buvicorn\b/i,
  /\btauri\s+dev\b/i,
]

/** Whether a shell command starts a dev server; `undefined` when it doesn't. */
export function serverStart(command: string): ServerStart | undefined {
  if (!STARTS.some(r => r.test(command))) return undefined
  const port =
    /(?:-p|--port)[\s=]+(\d{2,5})\b/.exec(command)?.[1] ??
    /\bPORT=(\d{2,5})\b/.exec(command)?.[1] ??
    /http\.server\s+(\d{2,5})\b/.exec(command)?.[1]
  return port ? { port: Number(port) } : {}
}

/** The folder a command runs in: a leading `cd <dir> &&` moves it from the session's. */
export function commandFolder(command: string, cwd: string): string {
  const m = /^\s*cd\s+(?:\/d\s+)?("([^"]+)"|'([^']+)'|(\S+))\s*(?:&&|;)/i.exec(command)
  const dir = m?.[2] ?? m?.[3] ?? m?.[4]
  if (!dir) return cwd
  if (/^[a-z]:[\\/]/i.test(dir)) return dir
  // Git Bash spells C:\x as /c/x.
  const bash = /^\/([a-z])\/(.*)$/i.exec(dir)
  if (bash) return bash[1]!.toUpperCase() + ':\\' + bash[2]!.replace(/\//g, '\\')
  return cwd.replace(/[\\/]+$/, '') + '\\' + dir.replace(/\//g, '\\')
}

/** A server already running that the new one would double. */
export type RunningServer = { pid: number; label: string; ports: number[]; why: 'project' | 'port' }

const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

/**
 * The server a new start would double: one listening whose command line holds the project's
 * folder, or one listening under a session open in that folder (MCP servers aside), or whatever
 * holds the port the command asks for.
 */
export function runningServer(
  start: ServerStart,
  folder: string,
  tree: Tree,
  ports: Map<number, number[]>,
  live: readonly LiveSession[],
): RunningServer | undefined {
  const dir = norm(folder)
  const ancestors = (pid: number): Proc[] => {
    const chain: Proc[] = []
    const seen = new Set<number>()
    let p = tree.byPid.get(pid)
    while (p && !seen.has(p.pid)) {
      seen.add(p.pid)
      chain.push(p)
      p = tree.byPid.get(p.ppid)
    }
    return chain
  }
  const sessionsHere = new Set(live.filter(s => norm(s.cwd) === dir).map(s => s.pid))

  for (const [pid, open] of ports) {
    const chain = ancestors(pid)
    if (chain.length === 0) continue
    // The branch, what Restart closes: up to a Claude session in that folder when there is one;
    // else up to the highest process naming the project, never further (the desktop's shell
    // and the terminal sit above); else the listening process alone.
    const sessionAt = chain.findIndex(p => sessionsHere.has(p.pid))
    let top = chain[0]!
    if (sessionAt > 0) top = chain[sessionAt - 1]!
    else for (const p of chain) if (norm(p.cmd).includes(dir + '\\')) top = p
    const procs = subtree(top.pid, tree.children, tree.byPid)
    const label = labelOf(procs)
    if (start.port !== undefined && open.includes(start.port)) return { pid: top.pid, label, ports: open, why: 'port' }
    const inProject = chain.some(p => norm(p.cmd).includes(dir + '\\'))
    const underSession = sessionAt > 0 && !/mcp/i.test(label) && !procs.some(p => /plugins[\\/]cache/i.test(p.cmd))
    if (inProject || underSession) return { pid: top.pid, label, ports: open, why: 'project' }
  }
  return undefined
}

/** What Claude reads when the person chose to reuse the running server. */
export function reuseNote(s: RunningServer): string {
  const where = s.ports.map(p => `http://localhost:${p}`).join(', ')
  return `A dev server is already running for this (${s.label}, pid ${s.pid}, ${where}). The person chose to reuse it: don't start another one, use ${where}.`
}

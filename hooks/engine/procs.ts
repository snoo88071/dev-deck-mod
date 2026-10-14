import type { Branch } from '../../types'

/** One process as Windows reports it. */
export type Proc = { pid: number; ppid: number; name: string; ram: number; cmd: string }

/** What `Get-CimInstance Win32_Process` printed as JSON, each row `{ i, p, n, w, c }`. */
export function parseProcs(json: string): Proc[] {
  let rows: unknown
  try {
    rows = JSON.parse(json)
  } catch {
    return []
  }
  const list = Array.isArray(rows) ? rows : [rows]
  const procs: Proc[] = []
  for (const r of list) {
    if (typeof r !== 'object' || r === null) continue
    const o = r as Record<string, unknown>
    if (typeof o.i !== 'number' || typeof o.p !== 'number') continue
    procs.push({ pid: o.i, ppid: o.p, name: String(o.n ?? ''), ram: Number(o.w) || 0, cmd: typeof o.c === 'string' ? o.c : '' })
  }
  return procs
}

/** The TCP ports each pid listens on, from `netstat -ano -p TCP`. */
export function parseNetstat(text: string): Map<number, number[]> {
  const ports = new Map<number, number[]>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line)
    if (!m) continue
    const port = Number(m[1])
    const pid = Number(m[2])
    const list = ports.get(pid) ?? []
    if (!list.includes(port)) list.push(port)
    ports.set(pid, list)
  }
  for (const list of ports.values()) list.sort((a, b) => a - b)
  return ports
}

/** Wrappers that only start something else: a branch is named after what they start. */
const WRAPPERS = new Set(['cmd.exe', 'conhost.exe', 'bash.exe', 'sh.exe', 'powershell.exe', 'pwsh.exe', 'npx.exe', 'npm.exe'])

/** What a command line runs, in a word: a package, a plugin, a script. */
function nameIn(cmd: string): string | undefined {
  // `npx ^"pkg^"` (through cmd) or `npx-cli.js" "pkg`
  const npx = /npx(?:-cli\.js)?["^\s]+((?:@[\w.-]+\/)?[\w.-]+)(?:@[\w.-]+)?/i.exec(cmd)
  if (npx?.[1] && npx[1] !== 'cli') return npx[1]
  const plugin = /plugins[\\/]cache[\\/][^\\/]+[\\/]([^\\/]+)[\\/]/i.exec(cmd)
  if (plugin?.[1]) return plugin[1]
  // npm starts a tool as `node_modules\.bin\..\vite\bin\vite.js`: the package follows the `..`.
  const pkgs = [...cmd.matchAll(/node_modules[\\/]+(?:\.bin[\\/]+)?(?:\.\.[\\/]+)?((?:@[^\\/"\s]+[\\/]+)?[^\\/"\s]+)/gi)]
    .map(m => (m[1] ?? '').replace(/\\+/g, '/').replace(/^\.\.\/+/, ''))
    .filter(p => p && p !== 'npm' && p !== '..' && !p.startsWith('.'))
  if (pkgs.length > 0) return pkgs[pkgs.length - 1]!.replace(/\.(c|m)?js$/, '')
  const script = /(?:^|[\s"\\/])([\w.-]+\.(?:mjs|cjs|js|ts|py))(?=["\s]|$)/i.exec(cmd)
  if (script?.[1]) return script[1]
  return undefined
}

/** A branch's name: the first process in it that says what it runs, else its root's name. */
export function labelOf(procs: readonly Proc[]): string {
  for (const p of procs) {
    if (WRAPPERS.has(p.name.toLowerCase()) && !/npx/i.test(p.cmd)) continue
    const name = nameIn(p.cmd)
    if (name) return name
  }
  for (const p of procs) {
    const name = nameIn(p.cmd)
    if (name) return name
  }
  const first = procs.find(p => !WRAPPERS.has(p.name.toLowerCase())) ?? procs[0]
  return (first?.name ?? '?').replace(/\.exe$/i, '')
}

/** `pid` and everything under it, the root first, each process once. */
export function subtree(pid: number, children: Map<number, Proc[]>, byPid: Map<number, Proc>): Proc[] {
  const out: Proc[] = []
  const seen = new Set<number>()
  const walk = (p: Proc) => {
    if (seen.has(p.pid)) return
    seen.add(p.pid)
    out.push(p)
    for (const c of children.get(p.pid) ?? []) if (c.pid !== p.pid) walk(c)
  }
  const root = byPid.get(pid)
  if (root) walk(root)
  return out
}

export type Tree = { byPid: Map<number, Proc>; children: Map<number, Proc[]> }

export function treeOf(procs: readonly Proc[]): Tree {
  const byPid = new Map<number, Proc>()
  const children = new Map<number, Proc[]>()
  for (const p of procs) {
    byPid.set(p.pid, p)
    const list = children.get(p.ppid) ?? []
    list.push(p)
    children.set(p.ppid, list)
  }
  return { byPid, children }
}

/**
 * What a session holds: its own memory plus everything under it, and one branch per process it
 * started directly, the ones listening on a port first, then by memory.
 */
export function sessionLoad(pid: number, tree: Tree, ports: Map<number, number[]>): { ram: number; branches: Branch[] } {
  const root = tree.byPid.get(pid)
  if (!root) return { ram: 0, branches: [] }
  let ram = root.ram
  const branches: Branch[] = []
  for (const child of tree.children.get(pid) ?? []) {
    if (child.pid === pid) continue
    const procs = subtree(child.pid, tree.children, tree.byPid)
    const branchRam = procs.reduce((sum, p) => sum + p.ram, 0)
    ram += branchRam
    // A console host alone is Windows' own, not something the session runs.
    if (procs.every(p => p.name.toLowerCase() === 'conhost.exe')) continue
    const open = [...new Set(procs.flatMap(p => ports.get(p.pid) ?? []))].sort((a, b) => a - b)
    branches.push({ pid: child.pid, label: labelOf(procs), ports: open, ram: branchRam })
  }
  branches.sort((a, b) => (b.ports.length > 0 ? 1 : 0) - (a.ports.length > 0 ? 1 : 0) || b.ram - a.ram)
  return { ram, branches }
}

/** The tokens of a transcript's last answer, and its model: the context the session holds now. */
export function lastUsage(text: string): { tokens: number; model: string } | undefined {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i]
    if (!raw || !raw.includes('"usage"')) continue
    try {
      const line = JSON.parse(raw)
      const u = line?.message?.usage
      if (line?.type !== 'assistant' || !u) continue
      const tokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0)
      return { tokens, model: String(line.message.model ?? '') }
    } catch {
      // The first line of a tail read starts mid-line.
    }
  }
  return undefined
}

/**
 * Percent of the context window. The window is known only for the session the mod runs in: the
 * same model gets the same window, any other 200k, or 1M once the tokens are past 200k.
 */
export function contextPercent(tokens: number, model: string, own: { model: string; window: number } | undefined): number {
  let window = own && own.model.replace(/\[.*\]$/, '') === model ? own.window : 200_000
  if (tokens > window) window = 1_000_000
  return Math.min(100, Math.round((tokens / window) * 100))
}

/** The folder Claude Code keeps a session's transcript in: the path with every other character a dash. */
export function projectFolder(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

/** `118 MB`, `1.4 GB`. */
export function bytes(n: number): string {
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(1) + ' GB'
  return Math.round(n / 1024 ** 2) + ' MB'
}

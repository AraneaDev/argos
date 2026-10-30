/**
 * A port over plain values for the mod's specs: the cells as `INITIAL` sets
 * them (or as the spec seeds them), a clock whose timers run only when the
 * spec says, files by path, and a process runner the spec answers. Every
 * process run and pane opened is recorded.
 */
import type { Port } from '../port'
import { INITIAL } from '../state'

export const PLUGIN_ROOT = '/plugin'
export const ENV_PATH = `${PLUGIN_ROOT}/hooks/argos.env.json`
export const ENV = { node: '/usr/bin/node', cli: '/opt/argos/dist/cli.js', config: '/home/tim/work/config.ini' }

type Ran = { exitCode: number; stdout: string; stderr?: string; isStdoutTruncated?: boolean }
type Runner = (argv: readonly string[], init?: { timeoutMs?: number }) => Ran | Promise<Ran>

export function fakePort(options: { files?: Record<string, string>; run?: Runner; cells?: Partial<typeof INITIAL> } = {}) {
  const files = new Map(Object.entries(options.files ?? { [ENV_PATH]: JSON.stringify(ENV) }))
  const values = new Map<string, unknown>(Object.entries({ ...structuredClone(INITIAL), ...options.cells }))
  const timers: { at: number; run: () => void; cancelled: boolean }[] = []
  const runs: { argv: string[]; timeoutMs: number | undefined }[] = []
  const reads: string[] = []
  const opened: string[] = []
  const openedWith: Record<string, unknown>[] = []
  const closed: string[] = []
  const panes = new Set<string>()
  const registered: string[] = []
  let refuseRegister = false
  let now = 0
  const state = new Proxy(
    {},
    {
      get: (_, key: string) => ({
        read: async () => values.get(key),
        update: async (change: (v: unknown) => unknown) => {
          values.set(key, change(values.get(key)))
          return values.get(key)
        },
      }),
    },
  )
  const io = {
    clock: {
      now: async () => now,
      after: (ms: number, run: () => void) => {
        const timer = { at: now + ms, run, cancelled: false }
        timers.push(timer)
        return { cancel: () => void (timer.cancelled = true) }
      },
      every: () => ({ cancel: () => undefined }),
    },
    ui: {
      log: async () => undefined,
      toast: async () => undefined,
      copy: async () => ({ isCopied: true }),
      focus: async () => ({}),
      scroll: async () => ({}),
      invalidate: async () => undefined,
      panes: async () => [...panes].map(id => ({ id })),
      open: async (args: { id: string }) => {
        opened.push(args.id)
        openedWith.push({ ...args })
        panes.add(args.id)
        return { isPlaced: true }
      },
      close: async (args: { id: string }) => {
        closed.push(args.id)
        panes.delete(args.id)
      },
    },
    session: { root: async () => '/work', id: async () => 'session-1' },
    process: {
      run: async (argv: readonly string[], init?: { timeoutMs?: number }) => {
        runs.push({ argv: [...argv], timeoutMs: init?.timeoutMs })
        const ran = await (options.run ?? (() => ({ exitCode: 0, stdout: '[]' })))(argv, init)
        return { stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...ran }
      },
    },
    fs: {
      read: async (path: string) => {
        reads.push(path)
        const text = files.get(path)
        if (text === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
        return text
      },
    },
    store: { get: async () => undefined, set: async () => undefined },
    command: {
      register: async (args: { name: string }) => {
        if (refuseRegister) throw new Error('no session is bound')
        registered.push(args.name)
        return { command: args.name }
      },
    },
    prompt: { fill: async () => ({ isFilled: true }) },
    plugin: { root: PLUGIN_ROOT },
    state,
  } as unknown as Port
  /** Runs every timer due within `ms`, and what they schedule in turn, then lets what they started settle. */
  const advance = async (ms = 0) => {
    now += ms
    const settle = () => new Promise(resolve => setTimeout(resolve, 0))
    for (let due = timers.find(t => !t.cancelled && t.at <= now); due !== undefined; due = timers.find(t => !t.cancelled && t.at <= now)) {
      due.cancelled = true
      due.run()
      await settle()
    }
    await settle()
  }
  return {
    io,
    values,
    runs,
    reads,
    opened,
    openedWith,
    closed,
    registered,
    advance,
    refuse: (on: boolean) => void (refuseRegister = on),
    pending: () => timers.filter(t => !t.cancelled).length,
  }
}

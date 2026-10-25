/**
 * The reads the pane draws from, keyed to what it shows ({@link LOADERS}),
 * all started through one keyed loader. Each runs on a timer, never inside a
 * render, and stores its answer only while it is still the one wanted.
 */
import type { ConnectionsState, SchemaState } from '../../types'
import type { ConnectionView, SchemaView } from '../lib/contract'
import { parseConnections, parseSchema } from '../lib/parse'
import { cliEnv, runCli } from './cli'
import type { CliAnswer } from './cli'
import type { Cell, Port } from './port'
import { mod } from './state'

/**
 * One kind of read the pane draws from: what it is a read of now (`want`,
 * null when there is nothing to read), whether the cell already holds that
 * or is reading it (`holds`), the cell while it reads (`loading`), the CLI
 * command it runs (`args`, within `timeoutMs`) and how the answer is parsed,
 * and the cell once the answer lands (`landed`), left as it is when the cell
 * has moved on to something else meanwhile.
 *
 * `flight` keeps a read already on its way from starting a second (its cell
 * can move to another value and back within one read); `debounceMs` waits
 * that long after the last request (a run of presses is one read);
 * `prepare` runs as the read starts.
 */
export type Loader<S, W, P> = {
  cell: (io: Port) => Cell<S | null>
  want: (io: Port) => Promise<W | null>
  holds: (current: S | null, want: W) => boolean
  loading: (current: S | null, want: W) => S
  args: (io: Port, want: W) => Promise<string[]>
  parse: (raw: unknown) => P | null
  timeoutMs?: number
  landed: (current: S | null, want: W, answer: CliAnswer<P>) => S | null
  flight?: { key: (want: W) => string; same: (current: S | null, want: W) => boolean }
  debounceMs?: number
  prepare?: (io: Port, want: W) => Promise<void>
  /** Runs once the answer is stored, whatever it was. */
  after?: (io: Port) => Promise<void>
}

/** Every read the pane draws from that is keyed to what it shows, by name. Each runs on a timer, never in a render. */
export const LOADERS = {
  /**
   * The connections config.ini names, read again on every open of the pane
   * (`ask`). The last list stays on show while a later read runs, and when it
   * fails, beside the reason.
   */
  connections: {
    cell: io => io.state.connections,
    want: async () => (mod.loads.connectionsAsk === 0 ? null : { ask: mod.loads.connectionsAsk }),
    holds: (c, w) => c !== null && c.ask === w.ask,
    loading: (c, w): ConnectionsState => ({ ask: w.ask, phase: 'loading', answer: c?.answer ?? null, failure: null }),
    args: async () => ['connections'],
    parse: parseConnections,
    landed: (c, w, answer): ConnectionsState | null =>
      c === null || c.ask !== w.ask ? c : answer.ok ? { ask: w.ask, phase: 'done', answer: answer.value, failure: null } : { ask: w.ask, phase: 'done', answer: c.answer, failure: answer.reason },
    // The header names the config.ini the CLI reads, from the paths the install wrote.
    prepare: async io => {
      const env = await cliEnv(io)
      await io.state.config.update(() => (env.ok ? env.value.config : null))
    },
    // The first connection is the one the Schema and Editor tabs work on until another is picked; the Schema tab, if open, reads it.
    after: async io => {
      const list = (await io.state.connections.read())?.answer
      const first = list?.[0]?.name
      if (first === undefined) return
      const view = await io.state.view.update(v => (v.db !== null && list!.some(c => c.name === v.db) ? v : { ...v, db: first }))
      if (view.tab === 'schema') await request(io, 'schema')
    },
  } satisfies Loader<ConnectionsState, { ask: number }, ConnectionView[]>,
  /**
   * The schema of the connection the Schema tab works on, read from the
   * CLI's cache; `r` asks again from the database (`--refresh`, once). The
   * schema of another connection is never shown while this one reads.
   */
  schema: {
    cell: io => io.state.schema,
    want: async io => {
      const db = (await io.state.view.read()).db
      return db === null ? null : { db, ask: mod.loads.schemaAsk, fresh: mod.loads.schemaFresh === db }
    },
    holds: (s, w) => s !== null && s.db === w.db && s.ask === w.ask,
    loading: (s, w): SchemaState => ({ db: w.db, ask: w.ask, phase: 'loading', answer: s?.db === w.db ? s.answer : null, failure: null }),
    args: async (_io, w) => {
      if (w.fresh) mod.loads.schemaFresh = null
      return ['schema', w.db, ...(w.fresh ? ['--refresh'] : [])]
    },
    parse: parseSchema,
    // A refresh reads the database: it may take longer than a cached read.
    timeoutMs: 120_000,
    landed: (s, w, answer): SchemaState | null =>
      s === null || s.db !== w.db || s.ask !== w.ask ? s : answer.ok ? { db: w.db, ask: w.ask, phase: 'done', answer: answer.value, failure: null } : { db: w.db, ask: w.ask, phase: 'done', answer: s.answer, failure: answer.reason },
    flight: { key: w => `schema:${w.db}:${w.ask}`, same: (s, w) => s !== null && s.db === w.db && s.ask === w.ask },
  } satisfies Loader<SchemaState, { db: string; ask: number; fresh: boolean }, SchemaView>,
}

/** The name of a read in {@link LOADERS}. */
export type LoaderKey = keyof typeof LOADERS

/** Any loader, as the keyed functions below drive it. */
type AnyLoader = Loader<unknown, unknown, unknown>

/**
 * Starts the read `key` names unless the mod is off, there is nothing to
 * read, or its cell already holds or is reading what is wanted. The read
 * itself runs on a timer once this has resolved, never inside a render.
 */
export async function request(io: Port, key: LoaderKey): Promise<void> {
  if (mod.session.disabled) return
  const loader = LOADERS[key] as unknown as AnyLoader
  const want = await loader.want(io)
  if (want === null) return
  const cell = loader.cell(io)
  // Checked and set with no await between, so two presses in the same tick cannot both start one.
  const flight = loader.flight?.key(want)
  if (flight !== undefined) {
    if (mod.loads.fetching.has(flight)) {
      if (!loader.flight!.same(await cell.read(), want)) await cell.update(c => loader.loading(c, want))
      return
    }
    mod.loads.fetching.add(flight)
  }
  if (loader.holds(await cell.read(), want)) {
    if (flight !== undefined) mod.loads.fetching.delete(flight)
    return
  }
  await cell.update(c => loader.loading(c, want))
  const run = () => void load(io, loader, want, flight).catch(() => undefined)
  if (loader.debounceMs === undefined) {
    io.clock.after(0, run)
    return
  }
  mod.loads.timers.get(key)?.cancel()
  mod.loads.timers.set(
    key,
    io.clock.after(loader.debounceMs, () => {
      mod.loads.timers.delete(key)
      run()
    }),
  )
}

/** One read: its answer is stored only while the cell still wants it ({@link Loader}`.landed`). */
async function load(io: Port, loader: AnyLoader, want: unknown, flight: string | undefined): Promise<void> {
  if (mod.session.disabled) return
  try {
    await loader.prepare?.(io, want)
    const answer = await runCli(io, await loader.args(io, want), loader.parse, loader.timeoutMs)
    await loader.cell(io).update(c => loader.landed(c, want, answer))
    await loader.after?.(io)
  } finally {
    // A lost write leaves the loading line; the next request asks again.
    if (flight !== undefined) mod.loads.fetching.delete(flight)
  }
}

/** Reads the connections again: every open of the pane asks for them anew. */
export async function reloadConnections(io: Port): Promise<void> {
  mod.loads.connectionsAsk++
  await request(io, 'connections')
}

/** Reads the schema of the connection the Schema tab works on, unless it already holds it. */
export const requestSchema = (io: Port): Promise<void> => request(io, 'schema')

/** `r`: the schema of the connection read again, from the database. */
export async function refreshSchema(io: Port): Promise<void> {
  const db = (await io.state.view.read()).db
  if (db === null) return
  mod.loads.schemaFresh = db
  mod.loads.schemaAsk++
  await request(io, 'schema')
}

/**
 * The reads the pane draws from, keyed to what it shows ({@link LOADERS}),
 * all started through one keyed loader. Each runs on a timer, never inside a
 * render, and stores its answer only while it is still the one wanted.
 */
import type { ConnectionsState, HistoryState, PinsState, ResultState, SchemaState } from '../../types'
import type { ConnectionView, JournalEntry, Pin, SchemaView, SpoolPage } from '../lib/contract'
import { parseConnections, parseHistory, parsePins, parseSchema, parseSpoolPage } from '../lib/parse'
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

/** How many journal entries one page of the history holds. */
export const HISTORY_PAGE = 50
/** How many rows of a result one page holds. */
export const RESULT_PAGE = 200

/** The entry the Queries marker is on, with the history it is in; null when the journal has not been read or is empty. */
export async function selectedEntry(io: Port): Promise<JournalEntry | null> {
  const list = (await io.state.history.read())?.answer
  if (list == null) return null
  const at = (await io.state.view.read()).marker.queries
  return list[Math.min(Math.max(0, at), list.length - 1)] ?? null
}

/** The journal after a read of its newest page lands: that page, then the older entries already read that it does not repeat. */
function mergedHistory(h: HistoryState, before: string | null, page: JournalEntry[]): { answer: JournalEntry[]; more: boolean } {
  const old = h.answer ?? []
  const ids = new Set(old.map(e => e.id))
  if (before !== null) return { answer: [...old, ...page.filter(e => !ids.has(e.id))], more: page.length >= HISTORY_PAGE }
  const fresh = new Set(page.map(e => e.id))
  const oldest = page[page.length - 1]
  const older = oldest === undefined ? [] : old.filter(e => !fresh.has(e.id) && e.at <= oldest.at)
  return { answer: [...page, ...older], more: older.length > 0 ? h.more : page.length >= HISTORY_PAGE }
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
  /**
   * The journal, newest first: the newest page on an open, after a query of
   * Claude's or a rerun (which keeps the older pages already read), and the
   * page of older entries after the last one read as the list scrolls.
   */
  history: {
    cell: io => io.state.history,
    want: async () => (mod.loads.historyAsk === 0 ? null : { ask: mod.loads.historyAsk, before: mod.loads.historyBefore }),
    holds: (h, w) => h !== null && h.ask === w.ask,
    loading: (h, w): HistoryState => ({ ask: w.ask, phase: 'loading', answer: h?.answer ?? null, more: h?.more ?? false, failure: null }),
    args: async (_io, w) => ['history', '--limit', String(HISTORY_PAGE), ...(w.before === null ? [] : ['--before', w.before])],
    parse: parseHistory,
    landed: (h, w, answer): HistoryState | null => {
      if (h === null || h.ask !== w.ask) return h
      if (!answer.ok) return { ...h, phase: 'done', failure: answer.reason }
      return { ask: w.ask, phase: 'done', ...mergedHistory(h, w.before, answer.value), failure: null }
    },
    // The marker stays on the entry it was on, however many arrived above it; a query just run is the newest, selected.
    after: async io => {
      const list = (await io.state.history.read())?.answer
      if (list == null) return
      const newest = mod.loads.selectNewest
      mod.loads.selectNewest = false
      const kept = mod.loads.selectedId === null ? -1 : list.findIndex(e => e.id === mod.loads.selectedId)
      const view = await io.state.view.update(v => {
        const at = newest ? 0 : kept >= 0 ? kept : Math.min(v.marker.queries, Math.max(0, list.length - 1))
        return at === v.marker.queries ? v : { ...v, marker: { ...v.marker, queries: at } }
      })
      mod.loads.selectedId = list[view.marker.queries]?.id ?? null
      if (view.tab === 'queries') await request(io, 'result')
    },
  } satisfies Loader<HistoryState, { ask: number; before: string | null }, JournalEntry[]>,
  /** The pins, read again after each pin or unpin and on every open. */
  pins: {
    cell: io => io.state.pins,
    want: async () => (mod.loads.pinsAsk === 0 ? null : { ask: mod.loads.pinsAsk }),
    holds: (p, w) => p !== null && p.ask === w.ask,
    loading: (p, w): PinsState => ({ ask: w.ask, phase: 'loading', answer: p?.answer ?? null, failure: null }),
    args: async () => ['pins'],
    parse: parsePins,
    landed: (p, w, answer): PinsState | null =>
      p === null || p.ask !== w.ask ? p : answer.ok ? { ask: w.ask, phase: 'done', answer: answer.value, failure: null } : { ask: w.ask, phase: 'done', answer: p.answer, failure: answer.reason },
  } satisfies Loader<PinsState, { ask: number }, Pin[]>,
  /**
   * One page of the selected entry's result, while the Queries tab is open:
   * only an entry that ran and kept a spool has one.
   */
  result: {
    cell: io => io.state.result,
    want: async io => {
      if ((await io.state.view.read()).tab !== 'queries') return null
      const entry = await selectedEntry(io)
      if (entry === null || entry.outcome !== 'ok' || entry.spool === null) return null
      return { id: entry.id, offset: mod.loads.result.id === entry.id ? mod.loads.result.offset : 0 }
    },
    holds: (r, w) => r !== null && r.id === w.id && r.offset === w.offset,
    loading: (r, w): ResultState => ({ id: w.id, offset: w.offset, phase: 'loading', page: r?.id === w.id ? r.page : null, failure: null }),
    args: async (_io, w) => ['result', w.id, '--offset', String(w.offset), '--limit', String(RESULT_PAGE)],
    parse: parseSpoolPage,
    landed: (r, w, answer): ResultState | null =>
      r === null || r.id !== w.id || r.offset !== w.offset
        ? r
        : answer.ok
          ? { id: w.id, offset: w.offset, phase: 'done', page: answer.value, failure: null }
          : { id: w.id, offset: w.offset, phase: 'done', page: null, failure: answer.reason },
    flight: { key: w => `result:${w.id}:${w.offset}`, same: (r, w) => r !== null && r.id === w.id && r.offset === w.offset },
  } satisfies Loader<ResultState, { id: string; offset: number }, SpoolPage>,
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

/** An open of the pane (or a rerun): the newest page of the journal and the pins are read again. */
export async function reloadQueries(io: Port): Promise<void> {
  mod.loads.historyAsk++
  mod.loads.historyBefore = null
  mod.loads.pinsAsk++
  await request(io, 'history')
  await request(io, 'pins')
}

/** The Queries tab opened: reads the journal if it never was, else the selected entry's result. */
export async function requestQueries(io: Port): Promise<void> {
  if ((await io.state.history.read()) === null) await reloadQueries(io)
  else await request(io, 'result')
}

/**
 * Claude ran a query: the newest page is read again and, when the pane is on
 * Queries, the newest entry selected. Nothing is read before the pane was
 * first opened this session; opening it reads the journal anyway.
 */
export async function liveFeed(io: Port): Promise<void> {
  if (mod.session.disabled || mod.loads.connectionsAsk === 0) return
  mod.loads.selectNewest = (await io.state.view.read()).tab === 'queries'
  mod.loads.historyAsk++
  mod.loads.historyBefore = null
  await request(io, 'history')
}

/** The list reached its end: the page of entries older than the last one read, if any remain. */
export async function moreHistory(io: Port): Promise<void> {
  const h = await io.state.history.read()
  const last = h?.answer?.[h.answer.length - 1]
  if (h === null || !h.more || h.phase === 'loading' || last === undefined) return
  mod.loads.historyAsk++
  mod.loads.historyBefore = last.id
  await request(io, 'history')
}

/** A pin or unpin was made: the pins are read again. */
export async function reloadPins(io: Port): Promise<void> {
  mod.loads.pinsAsk++
  await request(io, 'pins')
}

/** Reads page `offset` of the selected entry's result. */
export async function showResultPage(io: Port, offset: number): Promise<void> {
  const entry = await selectedEntry(io)
  if (entry === null) return
  mod.loads.result = { id: entry.id, offset: Math.max(0, offset) }
  await request(io, 'result')
}

/** The tools of the Argos MCP server that run a query (the server is registered as `serverName`, `argos` by default). */
export const isQueryTool = (tool: unknown, serverName: unknown = 'argos'): boolean =>
  typeof tool === 'string' && typeof serverName === 'string' && ['sql_query', 'sql_batch_query', 'sql_analyze_performance'].some(name => tool === `mcp__${serverName}__${name}`)

/**
 * The pane's layout: every row it draws, fitted to the columns it has.
 *
 * Pure: the mod's state in ({@link PaneModel}), rows of styled segments out.
 * The render hook only turns segments into elements, so every decision about
 * width, order and colour is made here and tested here. The header and the
 * footer come from `chrome.ts`, the cards and the grid from `cards.ts`, the
 * stat tiles from `tiles.ts`; each tab's cards are dispatched from
 * {@link tabArrangement}.
 */
import type { ConnectionsState, HistoryState, PaneTab, PinsState, ResultState, SchemaState, View } from '../../types'
import type { Arrangement, Block, Section } from './cards'
import { arrange, scrolledTo } from './cards'
import { footerRows, homeShort, padded, padOf, tabRows, titleRow } from './chrome'
import type { FooterKey, Pill } from './chrome'
import type { ConnectionView, JournalEntry } from './contract'
import { CARD_ICON } from './marks'
import { CHIP_BG, engineColour, FAINT, STAT_HUES, STATUS_COLOURS } from './palette'
import { blank, button, clip, dimRow, rowsHeight, rowWidth, tintedRow } from './rows'
import { pinOf, queriesArrangement, RESULT_GONE } from './queries-view'
import { filteredList, schemaArrangement } from './schema-view'
import { tierOf } from './table'
import type { Tier } from './table'
import { formatAge, padEnd } from './text'
import { tilesBlock } from './tiles'
import type { Stat } from './tiles'
import type { Row, Segment } from './types'

/** Everything the pane draws, read from state once per render. */
export type PaneModel = {
  /** The config.ini the CLI reads, as the install wrote it. */
  config: string | null
  connections: ConnectionsState | null
  /** The schema of the connection the Schema tab works on. */
  schema: SchemaState | null
  /** The journal, newest first, as far as it has been read. */
  history: HistoryState | null
  pins: PinsState | null
  /** The result of the entry the Queries tab selected, as last read. */
  result: ResultState | null
  view: View
  /** When this session began, in milliseconds on the mod's clock; null when unknown. */
  since: number | null
  /** The mod's clock, in milliseconds: what ages are counted from. */
  now: number
  /** Whether plain Buttons are drawn as text (`1: label`): the terminal. */
  terminal: boolean
}

/** The view a pane opens on: the Queries tab, every marker on its first row. */
export const INITIAL_VIEW: View = {
  tab: 'queries',
  marker: { queries: 0, schema: 0, editor: 0, connections: 0 },
  scroll: {},
  db: null,
  filter: '',
  filtering: false,
}

/** A pane this many rows tall or shorter keeps its header tight: no blank rows around it. */
export const SHORT_PANE = 24

/**
 * `after`, keeping the windows the wheel scrolled only while the view stands
 * as it was: once the tab or the open tab's marker moves, each list goes
 * back to the window round the marker.
 */
export function withScrollsKept(before: View, after: View): View {
  const stood = before.tab === after.tab && before.db === after.db && before.marker[before.tab] === after.marker[after.tab] && before.filter === after.filter
  return stood || Object.keys(after.scroll).length === 0 ? after : { ...after, scroll: {} }
}

/** The schema on show for the connection `db`: a schema read for another connection is no answer for this one. */
export const schemaFor = (schema: SchemaState | null, db: string | null): SchemaState | null => (schema !== null && db !== null && schema.db !== db ? null : schema)

/** How many rows the marker walks on `tab`. */
export function walkable(tab: PaneTab, connections: ConnectionsState | null, schema: SchemaState | null = null, filter = '', history: HistoryState | null = null): number {
  if (tab === 'queries') return history?.answer?.length ?? 0
  if (tab === 'schema') return schema?.answer == null ? 0 : filteredList(schema.answer, filter).length
  return tab === 'connections' ? (connections?.answer?.length ?? 0) : 0
}

/** The header's pill: what the pane is, or that its connections are being read or could not be. */
function pillOf(model: PaneModel): Pill {
  if (model.view.tab === 'schema') return schemaPill(model)
  if (model.view.tab === 'queries') {
    const h = model.history
    if (h?.failure != null && h.answer === null) return { text: 'unavailable', tone: 'warn' }
    if (h === null || (h.phase === 'loading' && h.answer === null)) return { text: 'reading…', tone: 'accent' }
    return { text: 'read-only pane', tone: 'ok' }
  }
  const c = model.connections
  if (c?.failure !== null && c?.failure !== undefined && c.answer === null) return { text: 'unavailable', tone: 'warn' }
  if (c?.phase === 'loading' && c.answer === null) return { text: 'reading…', tone: 'accent' }
  return { text: 'read-only pane', tone: 'ok' }
}

/** The Schema tab's pill: how fresh the schema on show is, or that it is being read or could not be. */
function schemaPill(model: PaneModel): Pill {
  const s = schemaFor(model.schema, model.view.db)
  if (s === null || s.phase === 'loading') return { text: 'reading…', tone: 'accent' }
  if (s.answer === null) return { text: 'unavailable', tone: 'warn' }
  const at = s.answer.capturedAt === null ? Number.NaN : Date.parse(s.answer.capturedAt)
  if (Number.isNaN(at)) return { text: 'never captured', tone: 'warn' }
  const age = model.now - at
  return { text: `captured ${formatAge(age)} ago`, tone: age < DAY ? 'ok' : 'warn' }
}

/** A schema captured longer ago than this is stale in the pill. */
const DAY = 86_400_000

/** The cells a connection card's labels take. */
const LABEL = 8

/** One labelled line of a connection card. */
const line = (label: string, value: Segment[]): Segment[] => [{ text: padEnd(label, LABEL), dim: true }, ...value]

/** When the schema was captured, as a card says it. */
function capturedOf(at: string | null, now: number): Segment[] {
  const t = at === null ? Number.NaN : Date.parse(at)
  return Number.isNaN(t) ? [{ text: 'never captured', dim: true }] : [{ text: `captured ${formatAge(now - t)} ago` }]
}

/**
 * One connection as a card: its name in the title, then its engine (a chip in
 * its colour), host, tunnel, access, whether MCP may change its config, and
 * when its schema was captured. The marked card is tinted, its first line
 * carrying the marker and the press that marks it.
 */
function connectionBlock(c: ConnectionView, i: number, marked: boolean, now: number): Block {
  return {
    key: `connection-${i}`,
    make: (inner): Section => {
      const colour = engineColour(c.type)
      const tunnel = [c.ssh ? 'SSH' : '', c.ssl ? 'SSL' : ''].filter(t => t !== '').join(' · ')
      const lines: Segment[][] = [
        line('engine', [{ text: ` ${c.type} `, ...(colour === undefined ? { dim: true } : { color: colour }), bg: CHIP_BG }]),
        line('host', c.host === null ? [{ text: 'local', dim: true }] : [{ text: c.host }]),
        line('tunnel', tunnel === '' ? [{ text: 'none', dim: true }] : [{ text: tunnel }]),
        line('access', c.selectOnly ? [{ text: 'SELECT_ONLY', color: STATUS_COLOURS.ok }] : [{ text: 'full access', color: STATUS_COLOURS.warn }]),
        line('MCP', [{ text: `configurable: ${c.mcpConfigurable ? 'yes' : 'no'}`, ...(c.mcpConfigurable ? {} : { dim: true }) }]),
        line('schema', capturedOf(c.schemaCapturedAt, now)),
      ]
      const body = lines.map((segments, n) => {
        const [label, ...rest] = segments
        // The first line's label is the press that marks the card; the marker stands before it.
        const lead: Segment[] = n === 0 ? [{ text: marked ? '›' : ' ', bold: true }, button(`row:${i}`, label!.text, undefined, { dim: true })] : [{ text: ' ' }, label!]
        return tintedRow(`connection-${i}-${n}`, clip([...lead, ...rest], inner), marked, { columns: inner })
      })
      return { key: `connection-${i}`, title: c.name, glyph: CARD_ICON.connection, body }
    },
  }
}

/** The Connections tab's figures: how many, how many select-only, with full access, tunnelled, with a schema captured. */
function connectionStats(list: ConnectionView[]): Stat[] {
  const count = (pick: (c: ConnectionView) => boolean) => String(list.filter(pick).length)
  return [
    { key: 'connections', label: list.length === 1 ? 'connection' : 'connections', value: String(list.length), hue: STAT_HUES.connections },
    { key: 'select-only', label: 'select-only', value: count(c => c.selectOnly), hue: STAT_HUES.selectOnly },
    { key: 'full', label: 'full access', value: count(c => !c.selectOnly), ...(list.some(c => !c.selectOnly) ? { tone: 'warn' as const } : { hue: STAT_HUES.selectOnly }) },
    { key: 'tunnels', label: 'over SSH', value: count(c => c.ssh), hue: STAT_HUES.tunnels },
    { key: 'captured', label: 'captured', value: count(c => c.schemaCapturedAt !== null), hue: STAT_HUES.captured },
  ]
}

/** A card that says one thing, dim. */
function noticeBlock(key: string, title: string, text: string): Block {
  return { key, make: (inner): Section => ({ key, title, body: [dimRow(`${key}-line`, `   ${text}`, inner)] }) }
}

/**
 * The Connections tab: the figures across the top, then one card per
 * connection, two to a grid row when wide, one column narrower.
 */
function connectionsArrangement(model: PaneModel, selected: number, tier: Tier): Arrangement {
  const c = model.connections
  const list = c?.answer ?? null
  if (list === null) return c?.failure === null || c?.failure === undefined ? { left: [noticeBlock('connections-wait', 'Connections', 'reading connections…')] } : { left: [] }
  const where = model.config === null ? 'config.ini' : homeShort(model.config)
  if (list.length === 0) return { left: [noticeBlock('connections-none', 'Connections', `no connections in ${where}`)] }
  const cards = list.map((conn, i) => connectionBlock(conn, i, i === selected, model.now))
  const pairs: Block[][] = []
  for (let i = 0; i < cards.length; i += 2) pairs.push(cards.slice(i, i + 2))
  // The tiles collapse to a line when narrow: they are laid out for the pane's own tier.
  const tiles = tilesBlock(connectionStats(list), tier)
  return { top: [tiles], left: cards, rows: pairs, order: [tiles, ...cards] }
}

/** How the connection `db` is reached, as the Schema tab's engine tile says it; undefined when direct. */
function tunnelOf(model: PaneModel, db: string): string | undefined {
  const c = model.connections?.answer?.find(conn => conn.name === db)
  const tunnel = [c?.ssh ? 'SSH' : '', c?.ssl ? 'SSL' : ''].filter(t => t !== '').join(' · ')
  return tunnel === '' ? undefined : tunnel
}

/** The Schema tab: the schema of the connection picked, or why there is none to show yet. */
function schemaTabArrangement(model: PaneModel, selected: number, tier: Tier): Arrangement {
  const s = schemaFor(model.schema, model.view.db)
  if (model.view.db === null && (model.connections?.answer?.length ?? 0) === 0) return { left: [noticeBlock('schema', 'Schema', model.connections?.answer === null ? 'reading connections…' : 'no connections to read a schema from')] }
  if (s?.answer == null) return { left: [noticeBlock('schema', 'Schema', s?.failure != null ? 'no schema to show' : `reading the schema of ${s?.db ?? model.view.db ?? 'the connection'}…`)] }
  const tunnel = tunnelOf(model, s.db)
  return schemaArrangement(s.answer, selected, tier, { filter: model.view.filter, filtering: model.view.filtering, ...(tunnel === undefined ? {} : { tunnel }) })
}

/** The result page on show for `entry`: the one read for it, else why there is none. */
export function resultOf(result: ResultState | null, entry: JournalEntry | undefined): { page: ResultState['page']; note?: string } {
  if (entry === undefined) return { page: null }
  if (entry.outcome !== 'ok') return { page: null, note: 'no result' }
  if (entry.spool === null) return { page: null, note: RESULT_GONE }
  if (result === null || result.id !== entry.id) return { page: null, note: 'reading the result…' }
  if (result.page !== null) return { page: result.page }
  if (result.failure === null) return { page: null, note: 'reading the result…' }
  // The journal says the result was kept, the spool says it is gone: evicted since.
  return { page: null, note: result.failure.startsWith('No spooled result') ? RESULT_GONE : result.failure }
}

/** The Queries tab: the journal and the selected entry's result, or why there is none to show yet. */
function queriesTabArrangement(model: PaneModel, selected: number, tier: Tier): Arrangement {
  const h = model.history
  if (h?.answer == null) return { left: h?.failure != null ? [] : [noticeBlock('history', 'History', 'reading the journal…')] }
  const entry = h.answer[selected]
  const shown = resultOf(model.result, entry)
  return queriesArrangement(
    {
      pins: model.pins?.answer ?? [],
      history: h.answer,
      selected,
      result: shown.page,
      ...(shown.note === undefined ? {} : { resultNote: shown.note }),
      now: model.now,
      ...(model.since === null ? {} : { since: model.since }),
      connections: model.connections?.answer?.length ?? 0,
    },
    tier,
  )
}

/** The open tab's cards. The Editor tab is drawn by the task that brings its data. */
function tabArrangement(model: PaneModel, selected: number, tier: Tier): Arrangement {
  if (model.view.tab === 'connections') return connectionsArrangement(model, selected, tier)
  if (model.view.tab === 'schema') return schemaTabArrangement(model, selected, tier)
  if (model.view.tab === 'queries') return queriesTabArrangement(model, selected, tier)
  return { left: [noticeBlock(model.view.tab, 'Editor', 'nothing to show here yet')] }
}

/** The keys the footer offers on the Queries tab: what can be done to the selected entry. */
function queriesKeys(model: PaneModel): FooterKey[] {
  const list = model.history?.answer ?? []
  const entry = list[Math.min(Math.max(0, model.view.marker.queries), Math.max(0, list.length - 1))]
  if (entry === undefined) return []
  const page = resultOf(model.result, entry).page
  return [
    ...(list.length > 1 ? [{ id: 'down', hotkey: 'j', label: '↓', move: true as const }, { id: 'up', hotkey: 'k', label: '↑', move: true as const }] : []),
    { id: 'rerun', hotkey: 'r', label: 'rerun' },
    { id: 'edit', hotkey: 'e', label: 'open in Editor' },
    { id: 'pin', hotkey: 'p', label: pinOf(model.pins?.answer ?? [], entry) === undefined ? 'pin' : 'unpin' },
    { id: 'copy', hotkey: 'c', label: 'copy' },
    ...(entry.source === 'pane' ? [{ id: 'send', hotkey: 's', label: 'send to Claude' }] : []),
    ...(page !== null && page.offset + page.rows.length < page.total ? [{ id: 'more-rows', hotkey: 'm', label: 'more rows' }] : []),
    ...(page !== null && page.offset > 0 ? [{ id: 'back-rows', hotkey: 'b', label: 'earlier rows' }] : []),
  ]
}

/** The keys the footer offers on the open tab. */
function footerKeys(model: PaneModel): FooterKey[] {
  const { tab, filter } = model.view
  const schema = schemaFor(model.schema, model.view.db)
  if (tab === 'queries') return queriesKeys(model)
  const moves: FooterKey[] = walkable(tab, model.connections, schema, filter, model.history) > 1 ? [{ id: 'down', hotkey: 'j', label: '↓', move: true }, { id: 'up', hotkey: 'k', label: '↑', move: true }] : []
  if (tab !== 'schema') return moves
  const shown = schema?.answer != null
  return [
    ...moves,
    ...((model.connections?.answer?.length ?? 0) > 1 ? [{ id: 'next', hotkey: 'n', label: 'next connection' }] : []),
    ...(shown ? [{ id: 'query', hotkey: 'q', label: 'query' }, { id: 'copy-create', hotkey: 'c', label: 'copy CREATE' }, { id: 'filter', hotkey: 'f', label: 'filter' }] : []),
    ...(schema === null ? [] : [{ id: 'refresh', hotkey: 'r', label: 'refresh' }]),
  ]
}

/**
 * The pane laid out: its rows from the header down (`body`) and the footer
 * bar (`footer`). When the two fit the height, the body is filled with blank
 * rows so the bar sits at the bottom of the pane; when they do not
 * (`pinned`), the bar is drawn over the window's last rows wherever the pane
 * is scrolled to, and the body ends in as many blank rows as the bar has.
 *
 * The header has room around it: a blank row above the name and another
 * between it and the tabs, then a blank row and a rule before the first
 * card. Narrow, the row above the name goes; on a short pane (24 rows or
 * fewer) the blank rows go first. A failure (the CLI could not be run, or
 * said why not) is one dim line under the header.
 */
export function paneLayout(model: PaneModel, columns: number, height: number): { body: Row[]; footer: Row[]; pinned: boolean } {
  const width = Math.max(1, columns)
  const tier = tierOf(width)
  const short = height <= SHORT_PANE
  const pad = padOf(tier)
  const inner = Math.max(1, width - 2 * pad)
  const selected = Math.min(Math.max(0, model.view.marker[model.view.tab]), Math.max(0, walkable(model.view.tab, model.connections, schemaFor(model.schema, model.view.db), model.view.filter, model.history) - 1))
  const rows: Row[] = []
  if (!short && tier !== 'narrow') rows.push(blank('head-top'))
  rows.push(padded(titleRow({ connections: model.connections?.answer ?? [], pill: pillOf(model), config: model.config }, inner, tier, width), pad, width))
  if (!short) rows.push(blank('head-gap'))
  rows.push(...tabRows(model.view.tab, inner, model.terminal, tier === 'narrow').map(row => padded(row, pad, width)))
  if (!short) rows.push(blank('head-end'))
  rows.push({ key: 'head-rule', segments: [{ text: '─'.repeat(width), color: FAINT }] })
  const failure = model.connections?.failure ?? (model.view.tab === 'schema' ? (schemaFor(model.schema, model.view.db)?.failure ?? null) : model.view.tab === 'queries' ? (model.history?.failure ?? model.pins?.failure ?? null) : null)
  if (failure !== null) rows.push(padded(dimRow('failure', failure, inner), pad, width))
  const bar = footerRows(footerKeys(model), width)
  const footer = [...(short ? [] : [blank('gap-keys')]), ...bar]
  const room = height - rows.length - footer.length
  // The connection cards keep their own height: stretched to the foot, a grid row of two would stand hollow.
  rows.push(...arrange(scrolledTo(tabArrangement(model, selected, tier), model.view.scroll), width, room, model.view.tab !== 'connections'))
  const body = rows.map(row => (rowWidth(row) <= width ? row : { ...row, segments: clip(row.segments, width) }))
  const fill = height - rowsHeight(body) - footer.length
  if (fill >= 0) return { body: [...body, ...Array.from({ length: fill }, (_, i) => blank(`fill-${i}`))], footer, pinned: false }
  return { body, footer, pinned: true }
}

/** Every row the pane draws, the footer last: {@link paneLayout}'s body and footer as one list. */
export function paneRows(state: PaneModel, columns: number, rows: number): Row[] {
  const laid = paneLayout(state, columns, rows)
  return [...laid.body, ...laid.footer]
}


/**
 * The Queries tab's cards: the figures across the top; on the left the pins
 * and the history of every query Claude and the person ran (newest first,
 * all sessions); on the right the selected entry's SQL and its result grid.
 *
 * Pure: the journal in, rows out. The marker walks the history.
 */
import type { Arrangement, Block, Section } from './cards'
import { arrange, noteOf, scrolledTo, windowedTable } from './cards'
import type { JournalEntry, Pin, SchemaChange, SpoolPage } from './contract'
import { gridRows, gridWindow } from './grid'
import { CARD_ICON, mark, OUTCOME, SEVERITY, SOURCE } from './marks'
import { ACCENT, CHIP_BG, STAT_HUES, STATUS_COLOURS } from './palette'
import { button, clip, dimRow, walkedRow } from './rows'
import { tierOf } from './table'
import type { Tier } from './table'
import { cells, fit, formatAge, grouped, padEnd, spaces } from './text'
import { tilesBlock } from './tiles'
import type { Stat } from './tiles'
import type { Row, Segment } from './types'

/** What the Queries tab draws. */
export type QueriesModel = {
  pins: Pin[]
  /** Every entry read so far, newest first. */
  history: JournalEntry[]
  /** The index in `history` the marker is on. */
  selected: number
  /** The selected entry's result page; null when there is none to show. */
  result: SpoolPage | null
  /** What the result card says instead of a grid: the result is being read, no longer kept, or could not be read. */
  resultNote?: string
  /** The mod's clock, in milliseconds: what ages are counted from. */
  now?: number
  /** When this session began, in milliseconds: the queries since are "this session". */
  since?: number
  connections?: number
}

/** Said in the result card for an entry whose spool is gone. */
export const RESULT_GONE = 'result no longer kept — r to rerun'

/** SQL on one line: its whitespace collapsed. */
const oneLine = (sql: string): string => sql.replace(/\s+/g, ' ').trim()

/** How old an entry is, as `3m`; empty when the clock or the time is unknown. */
function ageOf(entry: JournalEntry, now: number | undefined): string {
  const at = Date.parse(entry.at)
  return now === undefined || Number.isNaN(at) ? '' : formatAge(now - at)
}

/** `12 rows · 34ms · 3m`: whatever of the three the entry has. */
function metaOf(entry: JournalEntry, now: number | undefined): string {
  const rows = entry.rowCount === null ? [] : [`${grouped(entry.rowCount)} ${entry.rowCount === 1 ? 'row' : 'rows'}`]
  const took = entry.durationMs === null ? [] : [`${grouped(Math.round(entry.durationMs))}ms`]
  const age = ageOf(entry, now)
  return [...rows, ...took, ...(age === '' ? [] : [age])].join(' · ')
}

/** Whether `entry` is pinned: a pin of the same SQL on the same connection, or one that was last run as it. */
export function pinOf(pins: readonly Pin[], entry: JournalEntry | undefined): Pin | undefined {
  return entry === undefined ? undefined : pins.find(p => p.lastJournalId === entry.id || (p.database === entry.database && oneLine(p.sql) === oneLine(entry.sql)))
}

/** One schema change as a few words. */
function changeText(c: SchemaChange): string {
  switch (c.kind) {
    case 'table-added':
      return `${c.table} added`
    case 'table-dropped':
      return `${c.table} dropped`
    case 'column-added':
      return `${c.table}.${c.column} added`
    case 'column-dropped':
      return `${c.table}.${c.column} dropped`
    case 'column-changed':
      return `${c.table}.${c.column} ${c.from} → ${c.to}`
  }
}

function stats(model: QueriesModel): Stat[] {
  const blocked = model.history.filter(e => e.outcome === 'blocked').length
  const changes = model.history.reduce((n, e) => n + (e.schemaChange?.length ?? 0), 0)
  const fresh = model.since === undefined ? 0 : model.history.filter(e => Date.parse(e.at) >= model.since!).length
  return [
    { key: 'queries', label: model.since === undefined ? 'queries' : `queries · +${fresh} session`, value: grouped(model.history.length), hue: STAT_HUES.queries },
    { key: 'pinned', label: 'pinned', value: String(model.pins.length), hue: STAT_HUES.pinned },
    { key: 'blocked', label: 'blocked', value: String(blocked), ...(blocked > 0 ? { tone: 'warn' as const } : { hue: STAT_HUES.blocked }) },
    { key: 'changes', label: 'schema changes', value: String(changes), ...(changes > 0 ? { tone: 'warn' as const } : { hue: STAT_HUES.changes }) },
    { key: 'connections', label: model.connections === 1 ? 'connection' : 'connections', value: String(model.connections ?? 0), hue: STAT_HUES.connections },
  ]
}

/** The tag a row carries for who ran the entry. */
const tagOf = (entry: JournalEntry): { glyph: Segment; word: string } =>
  entry.source === 'claude' ? { glyph: mark(SOURCE.claude), word: 'claude' } : { glyph: mark(SOURCE.you), word: 'you' }

/** The Pinned card: a row per pin; a press selects the entry it was last run as, when the history holds it. */
function pinnedBlock(model: QueriesModel): Block {
  const { pins } = model
  return {
    key: 'pinned',
    grow: { length: pins.length, min: 2 },
    make: (inner, limit, scrolled): Section => {
      const { rows, window } = windowedTable('pinned-window', pins, { columns: inner, limit, scrolled }, (shown, start) =>
        shown.map((p, n) => {
          const label = p.name ?? oneLine(p.sql)
          const segments: Segment[] = [{ text: ' ' }, button(`pin:${start + n}`, `${CARD_ICON.pinned} ${label}`, undefined, { color: ACCENT }), { text: `  ${p.database}  `, dim: true }, { text: p.name === null ? '' : oneLine(p.sql), dim: true }]
          return { key: `pin-${start + n}`, segments: clip(segments, inner) }
        }),
      )
      return { key: 'pinned', title: 'Pinned', note: noteOf(`${pins.length}`), body: rows, empty: 'none', ...(pins.length === 0 ? {} : { window }) }
    },
  }
}

/** One history row: marker, outcome, who ran it, the connection, the SQL (the reason for a refused one) and, when there is room, the figures. */
function historyRow(entry: JournalEntry, i: number, marked: boolean, pinned: boolean, model: QueriesModel, inner: number): Row {
  const tag = tagOf(entry)
  const blocked = entry.outcome === 'blocked'
  const failed = entry.outcome === 'error'
  const alert = blocked || failed
  const outcome = mark(OUTCOME[entry.outcome])
  const who = button(`row:${i}`, padEnd(tag.word, 6), undefined, tag.glyph.color === undefined ? {} : { color: tag.glyph.color })
  const chip = ` ${fit(entry.database, 12)} `
  const meta = metaOf(entry, model.now)
  const head: Segment[] = [{ text: ' ' }, outcome, { text: pinned ? CARD_ICON.pinned : ' ', color: ACCENT }, { text: ' ' }, tag.glyph, { text: ' ' }, who, { text: ' ' }, { text: chip, bg: CHIP_BG, dim: true }, { text: ' ' }]
  const used = 1 + cells(head.map(s => s.text).join(''))
  const metaRoom = inner - used >= 24 + cells(meta) + 1 ? cells(meta) + 1 : 0
  const textRoom = Math.max(1, inner - used - metaRoom)
  const text = alert ? `${blocked ? 'blocked' : 'error'}: ${entry.reason ?? oneLine(entry.sql)}` : oneLine(entry.sql)
  const body = fit(text, textRoom)
  const tail: Segment[] = metaRoom > 0 ? [{ text: spaces(textRoom - cells(body)) }, { text: ` ${meta}`, dim: true }] : []
  return walkedRow(`history-${i}`, marked, [...head, alert ? { text: body, color: STATUS_COLOURS.alert } : { text: body }, ...tail], inner)
}

/** The History card: every entry read, newest first, the marked one tinted. */
function historyBlock(model: QueriesModel): Block {
  const { history, selected } = model
  return {
    key: 'history',
    grow: { length: history.length, min: 4 },
    make: (inner, limit, scrolled): Section => {
      const { rows, window } = windowedTable('history-window', history, { columns: inner, limit, local: selected, scrolled, walk: 0 }, (shown, start) =>
        shown.map((e, n) => historyRow(e, start + n, start + n === selected, pinOf(model.pins, e) !== undefined, model, inner)),
      )
      return { key: 'history', title: 'History', ...(history.length === 0 ? {} : { note: noteOf('all sessions · newest first') }), body: rows, empty: 'no queries yet', ...(history.length === 0 ? {} : { window }) }
    },
  }
}

/** `text` wrapped hard at `width` cells, one row per line of it, at most `most` rows (the last ends in `…`). */
function wrapped(text: string, width: number, most: number): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    let rest = line.replace(/\t/g, '  ').trimEnd()
    for (;;) {
      let cut = 0
      let w = 0
      for (const ch of rest) {
        const c = cells(ch)
        if (w + c > width) break
        w += c
        cut += ch.length
      }
      // A character wider than the whole width still goes somewhere.
      if (cut === 0 && rest.length > 0) cut = String.fromCodePoint(rest.codePointAt(0)!).length
      out.push(rest.slice(0, cut))
      rest = rest.slice(cut)
      if (rest.length === 0 || out.length > most) break
    }
    if (out.length > most) break
  }
  return out.length > most ? [...out.slice(0, most - 1), fit(`${out[most - 1] ?? ''}…`, width)] : out
}

/** The SQL card of the selected entry: the SQL wrapped, the reason it was refused, the schema changes it found, who ran it. */
function queryBlock(entry: JournalEntry, model: QueriesModel): Block {
  return {
    key: 'query',
    make: (inner): Section => {
      const tag = tagOf(entry)
      const body: Row[] = wrapped(entry.sql.trim(), Math.max(1, inner - 1), 12).map((line, n) => ({ key: `sql-${n}`, segments: [{ text: ` ${line}` }] }))
      if (entry.outcome !== 'ok' && entry.reason !== undefined) body.push({ key: 'reason', segments: clip([{ text: ' ' }, mark(OUTCOME[entry.outcome], ' '), { text: entry.reason, color: STATUS_COLOURS.alert }], inner) })
      const changes = entry.schemaChange ?? []
      if (changes.length > 0) {
        const shown = changes.slice(0, 3).map(changeText).join(', ')
        const more = changes.length > 3 ? ` +${changes.length - 3} more` : ''
        body.push({ key: 'schema-change', segments: clip([{ text: ' ' }, mark(SEVERITY.warn, ' '), { text: `schema changed: ${shown}${more}`, color: STATUS_COLOURS.warn }], inner) })
      }
      const meta = metaOf(entry, model.now)
      body.push(dimRow('query-meta', ` ${tag.word} · ${entry.database}${meta === '' ? '' : ` · ${meta}`}`, inner))
      return { key: 'query', title: 'Query', body }
    },
  }
}

/** The Result card: the grid of the page read, or a line saying why there is none. */
function resultBlock(model: QueriesModel, entry: JournalEntry | undefined): Block {
  const page = model.result
  return {
    key: 'result',
    ...(page === null ? {} : { grow: { length: page.rows.length, min: 4 } }),
    make: (inner, limit, scrolled): Section => {
      if (page === null) {
        const note = model.resultNote ?? (entry === undefined ? 'select an entry' : entry.outcome === 'ok' && entry.spool === null ? RESULT_GONE : 'no result')
        return { key: 'result', title: 'Result', body: [dimRow('result-note', ` ${note}`, inner)] }
      }
      // The list limit counts rows of the grid; the header and the `more` line come on top.
      const room = limit + 2
      const window = gridWindow(page, room, scrolled)
      const first = page.offset + 1
      const note = `${grouped(first)}–${grouped(page.offset + page.rows.length)} of ${grouped(page.total)}${page.truncated ? ' · truncated' : ''}`
      return { key: 'result', title: 'Result', note: noteOf(note), body: gridRows(page, Math.max(1, inner - 1), room, scrolled).map(row => ({ ...row, segments: [{ text: ' ' }, ...row.segments] })), window }
    },
  }
}

/**
 * The Queries tab's cards: figures across the top; pins above the history on
 * the left, the SQL above the result on the right (stacked in that order when
 * not wide).
 */
export function queriesArrangement(model: QueriesModel, tier: Tier): Arrangement {
  const tiles = tilesBlock(stats(model), tier)
  const entry = model.history[Math.min(Math.max(0, model.selected), Math.max(0, model.history.length - 1))]
  const pinned = pinnedBlock(model)
  const history = historyBlock(model)
  if (entry === undefined) return { top: [tiles], left: [pinned, history], order: [tiles, pinned, history] }
  const query = queryBlock(entry, model)
  const result = resultBlock(model, entry)
  return { top: [tiles], left: [pinned, history], right: [query, result], split: 0.45, order: [tiles, pinned, history, query, result] }
}

/**
 * The Queries tab's rows in `columns` cells and `room` rows at `tier`: the
 * lists cut to windows round the marker, or where the wheel left them
 * (`scroll`, by card key).
 */
export function queriesRows(model: QueriesModel, columns: number, tier: Tier, room: number, scroll: Record<string, number>): Row[] {
  const at = { ...model, selected: Math.min(Math.max(0, model.selected), Math.max(0, model.history.length - 1)) }
  return arrange(scrolledTo(queriesArrangement(at, tier), scroll), columns, room, true, tier === tierOf(columns) ? undefined : tier)
}

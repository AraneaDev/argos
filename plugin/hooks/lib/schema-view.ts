/**
 * The Schema tab's cards for one connection's schema: the figures across the
 * top, the tables (and views) as a list, and beside it (stacked when
 * narrower) the selected table's columns and its relations.
 *
 * Pure: a `SchemaView` in, rows out. The marker walks {@link filteredList}.
 */
import type { Arrangement, Block, Section } from './cards'
import { arrange, noteOf, scrolledTo, windowedTable } from './cards'
import type { SchemaChange, SchemaView, TableInfo } from './contract'
import { KEY, mark } from './marks'
import { engineColour, STAT_HUES, STATUS_COLOURS } from './palette'
import { button, clip, dimRow, walkedRow } from './rows'
import { tierOf } from './table'
import type { Tier } from './table'
import { fit, grouped, padEnd, padStart, spaces } from './text'
import { tilesBlock } from './tiles'
import type { Stat } from './tiles'
import type { Row, Segment } from './types'

/** What a schema's cards take besides the schema. */
export type SchemaOptions = {
  /** The table filter: names holding this text (any case) are listed. */
  filter?: string
  /** Whether the filter's field is open. */
  filtering?: boolean
  /** How the connection is reached (`SSH`, `SSL`, `SSH · SSL`); direct when absent. */
  tunnel?: string
}

/** The tables and then the views whose names hold `filter`: the list the marker walks. */
export function filteredList(view: SchemaView, filter = ''): TableInfo[] {
  const wanted = filter.trim().toLowerCase()
  return [...view.tables, ...view.views].filter(t => wanted === '' || t.name.toLowerCase().includes(wanted))
}

/** The SQL the `q` key puts in the Editor: a hundred rows of the table, in the engine's dialect. */
export function sqlOf(table: string, engine: string): string {
  return engine === 'mssql' ? `SELECT TOP 100 * FROM ${table}` : `SELECT * FROM ${table} LIMIT 100`
}

/** A `CREATE TABLE` sketch of a table from the columns captured, for the `c` key. */
export function sketchOf(table: TableInfo): string {
  const columns = table.columns.map(c => `  ${c.name} ${c.type}${c.nullable ? '' : ' NOT NULL'}${c.default === null || c.default === undefined ? '' : ` DEFAULT ${String(c.default)}`}`)
  const keys = table.primary_key !== undefined && table.primary_key.length > 0 ? [`  PRIMARY KEY (${table.primary_key.join(', ')})`] : []
  const links = (table.foreign_keys ?? []).map(f => `  FOREIGN KEY (${f.column}) REFERENCES ${f.references.table} (${f.references.column})`)
  return `CREATE TABLE ${table.name} (\n${[...columns, ...keys, ...links].join(',\n')}\n);`
}

/** The tables the last check touched (a dropped one is not in the list), and the columns it added as `table.column`. */
function changesOf(changes: SchemaChange[] | null): { tables: Set<string>; added: Set<string> } {
  const list = changes ?? []
  return {
    tables: new Set(list.filter(c => c.kind !== 'table-dropped').map(c => c.table)),
    added: new Set(list.flatMap(c => (c.kind === 'column-added' ? [`${c.table}.${c.column}`] : []))),
  }
}

/** A card that says one thing, dim. */
function notice(key: string, title: string, text: string): Block {
  return { key, make: (inner): Section => ({ key, title, body: [dimRow(`${key}-line`, `   ${text}`, inner)] }) }
}

function stats(view: SchemaView, options: SchemaOptions): Stat[] {
  const everything = [...view.tables, ...view.views]
  const changed = new Set((view.lastChange ?? []).map(c => c.table)).size
  const colour = engineColour(view.type)
  return [
    { key: 'engine', label: options.tunnel ?? 'direct', value: view.type, ...(colour === undefined ? {} : { hue: colour }) },
    { key: 'tables', label: view.tables.length === 1 ? 'table' : 'tables', value: grouped(view.tables.length), hue: STAT_HUES.tables },
    { key: 'views', label: view.views.length === 1 ? 'view' : 'views', value: grouped(view.views.length), hue: STAT_HUES.views },
    { key: 'columns', label: 'columns', value: grouped(everything.reduce((n, t) => n + t.columns.length, 0)), hue: STAT_HUES.columns },
    { key: 'changed', label: 'changed', value: String(changed), ...(changed > 0 ? { tone: 'warn' as const } : { hue: STAT_HUES.changes }) },
  ]
}

/** The Tables card: a row per table (name, rows estimated, `● changed`), the marked one tinted, the filter above them. */
function tablesBlock(view: SchemaView, list: TableInfo[], selected: number, options: SchemaOptions): Block {
  const changed = changesOf(view.lastChange).tables
  const filter = options.filter ?? ''
  const total = view.tables.length + view.views.length
  const estimate = (t: TableInfo): string => (t.type === 'view' || t.row_estimate === null || t.row_estimate === undefined ? '' : grouped(t.row_estimate))
  const estW = Math.min(10, Math.max(0, ...list.map(t => estimate(t).length)))
  const anyChanged = list.some(t => changed.has(t.name))
  return {
    key: 'tables',
    grow: { length: list.length, min: 4 },
    make: (inner, limit, scrolled): Section => {
      const head: Row[] = []
      if (options.filtering === true) head.push({ key: 'filter-row', segments: [{ text: '   filter: ', dim: true }, { text: filter, field: { id: 'filter', value: filter, placeholder: 'part of a name' } }] })
      else if (filter !== '') head.push(dimRow('filter-row', `   filter "${filter}" · ${list.length} of ${total}`, inner))
      // A marker cell, the name, a gap, the estimate and the mark; the mark spells itself out only where the name keeps some room.
      const spare = inner - 1 - (estW === 0 ? 0 : estW + 1)
      const word = anyChanged && spare - ' ● changed'.length >= 12
      const markW = !anyChanged ? 0 : word ? ' ● changed'.length : 2
      const nameW = Math.max(1, spare - markW)
      const { rows, window } = windowedTable('tables-window', list, { columns: inner, limit, local: selected, scrolled, walk: 0 }, (shown, start) =>
        shown.map((t, n) => {
          const i = start + n
          const segments: Segment[] = [button(`row:${i}`, fit(t.name, nameW), undefined, t.type === 'view' ? { dim: true } : {}), { text: spaces(nameW - Math.min(nameW, [...t.name].length)) }]
          if (estW > 0) segments.push({ text: ` ${padStart(estimate(t), estW)}`, dim: t.type === 'view' })
          if (anyChanged) segments.push(changed.has(t.name) ? { text: word ? ' ● changed' : ' ●', color: STATUS_COLOURS.warn } : { text: spaces(markW) })
          return walkedRow(`table-${i}`, i === selected, segments, inner)
        }),
      )
      const body = list.length === 0 ? [dimRow('tables-none', `   no table matches "${filter}"`, inner)] : rows
      return { key: 'tables', title: 'Tables', note: noteOf('rows est.'), body: [...head, ...body], ...(list.length === 0 ? {} : { window }) }
    },
  }
}

/** The selected table's columns: key mark, name, type (with what a foreign key points at), null, default. */
function columnsBlock(view: SchemaView, table: TableInfo): Block {
  const added = changesOf(view.lastChange).added
  const keyed = new Set(table.primary_key ?? [])
  const links = new Map((table.foreign_keys ?? []).map(f => [f.column, `${f.references.table}.${f.references.column}`]))
  const nameW = Math.min(24, Math.max(4, ...table.columns.map(c => [...c.name].length)))
  const typeOf = (c: TableInfo['columns'][number]): string => (links.has(c.name) ? `${c.type} → ${links.get(c.name)}` : c.type)
  const typeW = Math.max(4, ...table.columns.map(c => [...typeOf(c)].length))
  const defaultOf = (c: TableInfo['columns'][number]): string => (c.default === null || c.default === undefined ? '' : `default ${String(c.default)}`)
  return {
    key: 'columns',
    grow: { length: table.columns.length, min: 4 },
    make: (inner, limit, scrolled): Section => {
      // The key mark and the + take four cells; the default goes first when the row is too wide, then null.
      const fixed = 4 + nameW + 1
      const withNull = fixed + typeW + 1 + 8 <= inner
      const withDefault = withNull && fixed + typeW + 1 + 8 + 1 + Math.max(...table.columns.map(c => [...defaultOf(c)].length)) <= inner
      const typeRoom = Math.max(1, inner - fixed - (withNull ? 9 : 0))
      const { rows, window } = windowedTable('columns-window', table.columns, { columns: inner, limit, scrolled }, (shown, start) =>
        shown.map((c, n) => {
          const key: Segment = keyed.has(c.name) || c.key === 'PRI' ? mark(KEY.primary) : links.has(c.name) ? mark(KEY.foreign) : { text: '  ' }
          const plus: Segment = added.has(`${table.name}.${c.name}`) ? mark(KEY.added) : { text: ' ' }
          const segments: Segment[] = [{ text: ' ' }, key, plus, { text: ` ${padEnd(fit(c.name, nameW), nameW)} ` }, { text: withNull ? padEnd(fit(typeOf(c), Math.min(typeW, typeRoom)), Math.min(typeW, typeRoom)) : fit(typeOf(c), typeRoom) }]
          if (withNull) segments.push({ text: ` ${padEnd(c.nullable ? 'null' : 'not null', 8)}`, dim: true })
          if (withDefault && defaultOf(c) !== '') segments.push({ text: ` ${defaultOf(c)}`, dim: true })
          return { key: `column-${start + n}`, segments: clip(segments, inner) }
        }),
      )
      return { key: 'columns', title: table.name, subtitle: table.type === 'view' ? 'view' : 'columns', glyph: '≡', note: noteOf(`${table.columns.length} ${table.columns.length === 1 ? 'column' : 'columns'}`), body: rows, window }
    },
  }
}

/** One relation of the selected table: where it points, or what points at it. */
type Relation = { way: 'out' | 'in'; text: string }

/** The foreign keys of the selected table, then the other tables' that point at it. */
function relationsOf(view: SchemaView, table: TableInfo): Relation[] {
  const out = (table.foreign_keys ?? []).map((f): Relation => ({ way: 'out', text: `${f.column} → ${f.references.table}.${f.references.column}` }))
  const incoming = [...view.tables, ...view.views].flatMap(other =>
    other.name === table.name ? [] : (other.foreign_keys ?? []).filter(f => f.references.table === table.name).map((f): Relation => ({ way: 'in', text: `${other.name}.${f.column} → ${f.references.column}` })),
  )
  return [...out, ...incoming]
}

/** The Relations card: outgoing foreign keys, then the incoming ones from other tables. */
function relationsBlock(view: SchemaView, table: TableInfo): Block {
  const list = relationsOf(view, table)
  const into = list.filter(r => r.way === 'in').length
  return {
    key: 'relations',
    grow: { length: list.length, min: 2 },
    make: (inner, limit, scrolled): Section => {
      const { rows, window } = windowedTable('relations-window', list, { columns: inner, limit, scrolled }, (shown, start) =>
        shown.map((r, n) => ({ key: `relation-${start + n}`, segments: clip([{ text: ' ' }, { text: padEnd(r.way, 4), dim: true }, { text: r.text }], inner) })),
      )
      return { key: 'relations', title: 'Relations', note: noteOf(`${into} in · ${list.length - into} out`), body: rows, empty: 'none', ...(list.length === 0 ? {} : { window }) }
    },
  }
}

/**
 * The Schema tab's cards: figures across the top; the table list on the
 * left, the selected table's columns and relations on the right (stacked in
 * that order when not wide). `selected` indexes {@link filteredList}.
 */
export function schemaArrangement(view: SchemaView, selected: number, tier: Tier, options: SchemaOptions = {}): Arrangement {
  const list = filteredList(view, options.filter)
  const everything = view.tables.length + view.views.length
  const tiles = tilesBlock(stats(view, options), tier)
  if (everything === 0) return { top: [tiles], left: [notice('tables', 'Tables', 'no tables captured')] }
  const at = Math.min(Math.max(0, selected), Math.max(0, list.length - 1))
  const tables = tablesBlock(view, list, at, options)
  const table = list[at]
  if (table === undefined) return { top: [tiles], left: [tables], order: [tiles, tables] }
  const columns = columnsBlock(view, table)
  const relations = relationsBlock(view, table)
  return { top: [tiles], left: [tables], right: [columns, relations], split: 0.4, order: [tiles, tables, columns, relations] }
}

/**
 * The Schema tab's rows in `columns` cells and `room` rows at `tier`: the
 * lists cut to windows round the marker, or where the wheel left them
 * (`scroll`, by card key).
 */
export function schemaRows(view: SchemaView, selected: number, columns: number, tier: Tier, room: number, scroll: Record<string, number>, options: SchemaOptions = {}): Row[] {
  return arrange(scrolledTo(schemaArrangement(view, selected, tier, options), scroll), columns, room, true, tier === tierOf(columns) ? undefined : tier)
}

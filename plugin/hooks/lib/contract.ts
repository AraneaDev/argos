/**
 * What the `argos` CLI prints, as the pane reads it: the shapes of
 * `src/pane/contract.ts` (and the schema types it names), mirrored here
 * because the plugin ships alone and imports nothing from `src/`. Types
 * only; `parse.ts` checks an answer against them.
 */

export type Source = 'claude' | 'pane'
export type Outcome = 'ok' | 'error' | 'blocked'

/** A change the schema check found, as `src/schema/diff.ts` names it. */
export type SchemaChange =
  | { kind: 'table-added' | 'table-dropped'; table: string }
  | { kind: 'column-added'; table: string; column: string; type: string }
  | { kind: 'column-dropped'; table: string; column: string }
  | { kind: 'column-changed'; table: string; column: string; from: string; to: string }

export type ColumnInfo = {
  name: string
  type: string
  nullable: boolean
  default: unknown
  max_length?: number | null
  precision?: number | null
  scale?: number | null
  comment?: string
  key?: string
  extra?: string
}

export type ForeignKey = { column: string; references: { table: string; column: string } }

export type TableInfo = {
  name: string
  type: string
  comment?: string
  columns: ColumnInfo[]
  primary_key?: string[]
  foreign_keys?: ForeignKey[]
  row_estimate?: number | null
}

/** One query in the journal: Claude's or the pane's. */
export type JournalEntry = {
  id: string
  at: string
  source: Source
  database: string
  tool: 'sql_query' | 'sql_batch_query' | 'sql_analyze_performance' | 'pane_query'
  sql: string
  batchId?: string
  durationMs: number | null
  rowCount: number | null
  outcome: Outcome
  reason?: string
  schemaChange?: SchemaChange[]
  spool: string | null
}

/** A page of a spooled result. */
export type SpoolPage = {
  id: string
  fields: string[]
  rows: unknown[][]
  total: number
  offset: number
  truncated: boolean
}

export type Pin = {
  id: string
  name: string | null
  database: string
  sql: string
  createdAt: string
  lastJournalId: string | null
}

/**
 * One configured connection, as `argos connections` lists it: declared in the
 * mod's state contract (`types/index.d.ts`), which must stand alone, since
 * the session state holds it.
 */
export type { ConnectionView } from '../../types'

/** One connection's schema, as `argos schema <db>` prints it. */
export type SchemaView = {
  database: string
  type: string
  capturedAt: string | null
  tables: TableInfo[]
  views: TableInfo[]
  lastChange: SchemaChange[] | null
}

/** What `argos unpin` prints. */
export type Unpinned = { removed: boolean }

/** What every command prints instead when it fails (exit 1). */
export type CliError = { error: string }

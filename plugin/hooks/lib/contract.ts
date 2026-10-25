/**
 * What the `argos` CLI prints, as the pane reads it: the shapes of
 * `src/pane/contract.ts` (and the schema types it names), mirrored here
 * because the plugin ships alone and imports nothing from `src/`. Types
 * only; `parse.ts` checks an answer against them.
 */

import type { SchemaChange } from '../../types'

export type Source = 'claude' | 'pane'
export type Outcome = 'ok' | 'error' | 'blocked'

/** The schema shapes are declared in the mod's state contract, which must stand alone. */
export type { ColumnInfo, ForeignKey, SchemaChange, SchemaView, TableInfo } from '../../types'

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

/** What `argos unpin` prints. */
export type Unpinned = { removed: boolean }

/** What every command prints instead when it fails (exit 1). */
export type CliError = { error: string }

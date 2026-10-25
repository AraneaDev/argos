/**
 * What the `argos` CLI prints, as the pane reads it: the shapes of
 * `src/pane/contract.ts` (and the schema types it names), mirrored here
 * because the plugin ships alone and imports nothing from `src/`. Types
 * only; `parse.ts` checks an answer against them.
 */

export type Source = 'claude' | 'pane'
export type Outcome = 'ok' | 'error' | 'blocked'

/** The schema shapes are declared in the mod's state contract, which must stand alone. */
export type { ColumnInfo, ForeignKey, SchemaChange, SchemaView, TableInfo } from '../../types'

/** The query shapes are declared in the mod's state contract, which must stand alone. */
export type { JournalEntry, Pin, SpoolPage } from '../../types'

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

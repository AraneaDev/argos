/**
 * The Argos mod's type contract: every value it keeps in the session state,
 * under the plugin's name. `register.tsx` declares one atom per key, and
 * `claude plugin validate` holds every key the module names to this list.
 */
/**
 * One configured connection, as `argos connections` lists it (the CLI's
 * `ConnectionView`, src/pane/contract.ts). Declared here, since the session
 * state holds it and this contract must stand alone; `hooks/lib/contract.ts`
 * hands it on with the CLI's other shapes.
 */
export type ConnectionView = {
  name: string
  type: string
  host: string | null
  ssh: boolean
  ssl: boolean
  selectOnly: boolean
  mcpConfigurable: boolean
  schemaCapturedAt: string | null
}

/** A change the schema check found, as the CLI's `src/schema/diff.ts` names it. */
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

/** One connection's schema, as `argos schema <db>` prints it. */
export type SchemaView = {
  database: string
  type: string
  capturedAt: string | null
  tables: TableInfo[]
  views: TableInfo[]
  lastChange: SchemaChange[] | null
}

/** The pane's tabs, in hotkey order. */
export type PaneTab = 'queries' | 'schema' | 'editor' | 'connections'

/**
 * What the pane shows: the open tab, where each tab's marker stands, the
 * first item the wheel scrolled each list to (by its card's key), and the
 * connection the Schema and Editor tabs work on (null until one is picked).
 */
export interface View {
  tab: PaneTab
  marker: Record<PaneTab, number>
  scroll: Record<string, number>
  db: string | null
  /** The Schema tab's table filter: names holding this text are listed ('' lists all). */
  filter: string
  /** Whether the filter's field is open. */
  filtering: boolean
}

/**
 * The connections as `argos connections` last listed them: `ask` is the read
 * it answers (every open of the pane asks again), `answer` the last list read
 * (kept while a later read runs or fails), `failure` why the latest read gave
 * no list, as the pane says it under its header.
 */
export type ConnectionsState = {
  ask: number
  phase: 'loading' | 'done'
  answer: ConnectionView[] | null
  failure: string | null
}

/**
 * The schema of the connection `db` as `argos schema` last printed it: `ask`
 * is the read it answers (a refresh asks again), `answer` the last schema
 * read for `db`, `failure` why the latest read gave none.
 */
export type SchemaState = {
  db: string
  ask: number
  phase: 'loading' | 'done'
  answer: SchemaView | null
  failure: string | null
}

declare module 'claude-code' {
  interface PluginState {
    argos: {
      view: View
      /** Null until the pane was first opened. */
      connections: ConnectionsState | null
      /** The config.ini the CLI reads, as the install wrote it; null until read, or when the plugin was not installed by the CLI. */
      config: string | null
      /** Null until the Schema tab first read a schema. */
      schema: SchemaState | null
      /** The SQL in the Editor tab. */
      draft: string
    }
  }
}

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

/** One query in the journal (the CLI's `JournalEntry`, src/pane/contract.ts): Claude's or the pane's. */
export type JournalEntry = {
  id: string
  at: string
  source: 'claude' | 'pane'
  database: string
  tool: 'sql_query' | 'sql_batch_query' | 'sql_analyze_performance' | 'pane_query'
  sql: string
  batchId?: string
  durationMs: number | null
  rowCount: number | null
  outcome: 'ok' | 'error' | 'blocked'
  reason?: string
  schemaChange?: SchemaChange[]
  /** Claude passed bound parameters: the SQL alone cannot be rerun faithfully. */
  hasParams?: boolean
  spool: string | null
}

/** A page of a spooled result, as `argos result <id>` prints it. */
export type SpoolPage = {
  id: string
  fields: string[]
  rows: unknown[][]
  total: number
  offset: number
  truncated: boolean
}

/** A saved query, as `argos pins` lists it. */
export type Pin = {
  id: string
  name: string | null
  database: string
  sql: string
  createdAt: string
  lastJournalId: string | null
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

/**
 * The journal as `argos history` last listed it, newest first: `ask` is the
 * read it answers (a tool call of Claude's, a rerun or a scroll to older
 * entries asks again), `answer` every entry read so far (kept while a later
 * read runs or fails), `more` whether older entries remain to be paged in.
 */
export type HistoryState = {
  ask: number
  phase: 'loading' | 'done'
  answer: JournalEntry[] | null
  more: boolean
  failure: string | null
}

/** The pins as `argos pins` last listed them. */
export type PinsState = {
  ask: number
  phase: 'loading' | 'done'
  answer: Pin[] | null
  failure: string | null
}

/** The page `offset` of the result of journal entry `id`, as `argos result` last printed it. */
export type ResultState = {
  id: string
  offset: number
  phase: 'loading' | 'done'
  page: SpoolPage | null
  failure: string | null
}

/**
 * The Editor tab's last run: `entry` is the journal entry the CLI printed for
 * it (a refused or failed query comes back as an entry too, with its
 * `reason`), `page` the first page of its rows, `failure` why the CLI gave
 * no entry at all. `running` while the query runs.
 */
export type EditorState = {
  running: boolean
  entry: JournalEntry | null
  page: SpoolPage | null
  failure: string | null
  /** How many runs have started: the SQL field is drawn afresh at each, so the text it holds is the draft again. */
  runs?: number
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
      /** Null until the Queries tab first read the journal. */
      history: HistoryState | null
      /** Null until the Queries tab first read the pins. */
      pins: PinsState | null
      /** The result of the entry the Queries tab has selected; null until one was read. */
      result: ResultState | null
      /** The Editor tab's last run. */
      editor: EditorState
    }
  }
}

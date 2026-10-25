/**
 * What the `argos` CLI printed, checked against the contract (`contract.ts`):
 * each reader takes the parsed JSON and hands back the shape it names, or
 * null when anything in it is not that shape. Pure; never throws.
 */
import type { ColumnInfo, ConnectionView, ForeignKey, JournalEntry, Pin, SchemaChange, SchemaView, SpoolPage, TableInfo, Unpinned } from './contract'

type Check<T> = (raw: unknown) => raw is T

const isObject = (raw: unknown): raw is Record<string, unknown> => typeof raw === 'object' && raw !== null && !Array.isArray(raw)
const isString = (raw: unknown): raw is string => typeof raw === 'string'
const isNumber = (raw: unknown): raw is number => typeof raw === 'number' && Number.isFinite(raw)
const isBoolean = (raw: unknown): raw is boolean => typeof raw === 'boolean'
const orNull =
  <T>(check: Check<T>): Check<T | null> =>
  (raw): raw is T | null =>
    raw === null || check(raw)
/** A field that may be absent; present, it must pass `check`. */
const optional =
  <T>(check: Check<T>): Check<T | undefined> =>
  (raw): raw is T | undefined =>
    raw === undefined || check(raw)
const listOf =
  <T>(check: Check<T>): Check<T[]> =>
  (raw): raw is T[] =>
    Array.isArray(raw) && raw.every(check)
const oneOf =
  <T extends string>(...values: T[]): Check<T> =>
  (raw): raw is T =>
    typeof raw === 'string' && (values as string[]).includes(raw)

/** An object whose every named field passes its check; fields not named are let through. */
const shape =
  <T>(fields: Record<string, Check<unknown>>): Check<T> =>
  (raw): raw is T =>
    isObject(raw) && Object.entries(fields).every(([key, check]) => check(raw[key]))

const isColumn = shape<ColumnInfo>({
  name: isString,
  type: isString,
  nullable: isBoolean,
  max_length: optional(orNull(isNumber)),
  precision: optional(orNull(isNumber)),
  scale: optional(orNull(isNumber)),
  comment: optional(isString),
  key: optional(isString),
  extra: optional(isString),
})

const isForeignKey = shape<ForeignKey>({ column: isString, references: shape({ table: isString, column: isString }) })

const isTable = shape<TableInfo>({
  name: isString,
  type: isString,
  comment: optional(isString),
  columns: listOf(isColumn),
  primary_key: optional(listOf(isString)),
  foreign_keys: optional(listOf(isForeignKey)),
  row_estimate: optional(orNull(isNumber)),
})

const isChange = (raw: unknown): raw is SchemaChange => {
  if (!isObject(raw) || !isString(raw.table)) return false
  if (raw.kind === 'table-added' || raw.kind === 'table-dropped') return true
  if (raw.kind === 'column-added') return isString(raw.column) && isString(raw.type)
  if (raw.kind === 'column-dropped') return isString(raw.column)
  if (raw.kind === 'column-changed') return isString(raw.column) && isString(raw.from) && isString(raw.to)
  return false
}

const isConnection = shape<ConnectionView>({
  name: isString,
  type: isString,
  host: orNull(isString),
  ssh: isBoolean,
  ssl: isBoolean,
  selectOnly: isBoolean,
  mcpConfigurable: isBoolean,
  schemaCapturedAt: orNull(isString),
})

const isSchema = shape<SchemaView>({
  database: isString,
  type: isString,
  capturedAt: orNull(isString),
  tables: listOf(isTable),
  views: listOf(isTable),
  lastChange: orNull(listOf(isChange)),
})

const isEntry = shape<JournalEntry>({
  id: isString,
  at: isString,
  source: oneOf('claude', 'pane'),
  database: isString,
  tool: oneOf('sql_query', 'sql_batch_query', 'sql_analyze_performance', 'pane_query'),
  sql: isString,
  batchId: optional(isString),
  durationMs: orNull(isNumber),
  rowCount: orNull(isNumber),
  outcome: oneOf('ok', 'error', 'blocked'),
  reason: optional(isString),
  schemaChange: optional(listOf(isChange)),
  spool: orNull(isString),
})

const isPage = shape<SpoolPage>({
  id: isString,
  fields: listOf(isString),
  rows: listOf(Array.isArray as Check<unknown[]>),
  total: isNumber,
  offset: isNumber,
  truncated: isBoolean,
})

const isPin = shape<Pin>({
  id: isString,
  name: orNull(isString),
  database: isString,
  sql: isString,
  createdAt: isString,
  lastJournalId: orNull(isString),
})

/** `raw` as `T` when it passes `check`, else null. */
const reader =
  <T>(check: Check<T>) =>
  (raw: unknown): T | null =>
    check(raw) ? raw : null

/** `argos connections`. */
export const parseConnections = reader(listOf(isConnection))
/** `argos schema <db>`. */
export const parseSchema = reader(isSchema)
/** `argos query`: the journal entry of the run. */
export const parseJournalEntry = reader(isEntry)
/** `argos history`. */
export const parseHistory = reader(listOf(isEntry))
/** `argos result <id>`: one page. */
export const parseSpoolPage = reader(isPage)
/** `argos pins`. */
export const parsePins = reader(listOf(isPin))
/** `argos pin`: the pin made. */
export const parsePin = reader(isPin)
/** `argos unpin`. */
export const parseUnpinned = reader(shape<Unpinned>({ removed: isBoolean }))

/** The message of a failure the CLI printed (`{ "error": "..." }`), or null when `raw` is no failure. */
export function parseCliError(raw: unknown): string | null {
  return isObject(raw) && isString(raw.error) ? raw.error : null
}

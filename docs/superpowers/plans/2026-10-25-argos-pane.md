# Argos Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only Claude Code pane (`/argos`) showing connections, schemas, every query Claude runs with its full result, and a query editor — plus schema-change notes for Claude inside the Argos server.

**Architecture:** Three layers, each shippable on its own. (A) The MCP server gains a schema fingerprint check and a journal/spool of every query call under `.argos/` beside `config.ini`. (B) A read-only `argos` CLI (`connections`, `schema`, `query`, `history`, `result`, `pin…`, `install-plugin`) reads the same config and data directory, printing JSON. (C) A Claude Code mod under `plugin/`, built like the Knossos mod (one hooks module, a `Port`, atoms in `register.tsx`, pure layout in `hooks/lib/` ported from Knossos), runs the CLI and draws the pane.

**Tech Stack:** TypeScript (ESM, Node ≥ 20), jest + @swc/jest for `src/`, vitest for `plugin/hooks/`, the Claude Code hooks engine (`claude-code` module, JSX via `h`).

**Spec:** `docs/superpowers/specs/2026-10-25-argos-pane-design.md`

**Prerequisite:** start from `main` after `chore/rebrand-argos` (single `argos` command, `src/cli/commands.ts`, server name `argos`) and `docs/argos-pane-design` are merged. Both add `.superpowers/` to `.gitignore`; keep one copy.

**Reference repo:** `~/Work/AraneaDev/Knossos-MCP` — read `docs/contribute/mod-internals.md` before Phase C; port files from `hooks/lib/`, `hooks/mod/`, `hooks/register.tsx`, `hooks/engine.d.ts`, `tools/jsx-runtime-stub.mjs`.

## Global Constraints

- v1 is read-only: nothing the pane or CLI runs may write. Forced read-only goes through `SecurityManager.validateSelectOnlyQuery(query, dbType)`, never a separate parser.
- Redaction and audit logging apply to pane queries exactly as to Claude's (results come from adapters, which already redact).
- Fingerprint check: at most once per **60 s** per connection, on the connection already open; no background timers; a failing fingerprint query is logged and never fails the user's query; a first capture (no stored fingerprint) reports nothing.
- Full results never go to Claude: `_meta` carries only `{ argos: { journalId, spool, schemaChange? } }`.
- Data directory: `.argos/` beside the `config.ini` in use. Journal, spool and pins live there.
- No new always-on processes; no polling.
- The pane matches the Knossos pane's look: theme keys not fixed colours, section titles with a rule and a blank line below, stat cards spanning the width, `N more ↓` scrolling lists, key-hint footer, narrow widths collapse to one column. The person signs off on side-by-side screenshots.
- Engine limits held by test: text ≤ 90,000 characters (`TEXT_BUDGET`), < 10,000 nodes, < 16 deep, at every pane size.
- Out of scope (v2): editing rows/schema, the band, migration detection.

## Review Focus

1. A huge result (100k rows, wide text) from Claude — spool write must not block or balloon memory beyond what Argos already holds; the pane pages it. Test in Task 5 and Task 13.
2. The MCP server and the CLI appending to `journal.jsonl` at the same time — no interleaved or torn lines. Test in Task 5.
3. A schema cache written before this change (no `fingerprint`) — first check stores the fingerprint silently, never reports "everything changed". Test in Task 3.
4. A pane query that is a write (`DELETE`, `WITH x AS (DELETE …)`, multi-statement) on a full-access connection — refused with the security manager's reason, journaled as `blocked`. Test in Task 8.
5. The pane opened with no `config.ini`, a missing binary, or a CLI error — the pane shows a one-line reason and never throws into the session. Test in Task 11.

---

## Phase A — Server

### Task 1: Schema capture gains keys, relations and row estimates

The Schema tab needs PK/FK markers, relations and row estimates; today `captureSchema` records none of them (Postgres sets `key: ''`).

**Files:**
- Modify: `src/types/database.ts` (`TableInfo`, new `ForeignKey`)
- Modify: `src/database/adapters/{postgresql,mysql,sqlite,mssql}.ts` (`captureSchema`)
- Test: `tests/unit/adapters/schema-relations.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ForeignKey { column: string; references: { table: string; column: string } }
  export interface TableInfo { name: string; type: string; comment?: string; columns: ColumnInfo[];
    primary_key?: string[]; foreign_keys?: ForeignKey[]; row_estimate?: number | null }
  ```
  `ColumnInfo.key` is `'PRI'` for primary-key columns on every engine.

- [ ] **Step 1: Write failing tests** — one `describe` per adapter, using the existing adapter test mocks in `tests/unit/adapters/`: given catalog rows for a table `orders(id PK, customer_id FK → customers.id)`, `captureSchema` yields `primary_key: ['id']`, `foreign_keys: [{ column: 'customer_id', references: { table: 'customers', column: 'id' } }]`, `columns[0].key === 'PRI'`, and `row_estimate` equal to the mocked estimate (Postgres `reltuples`, MySQL `TABLE_ROWS`, MSSQL `sys.partitions.rows`; SQLite `null`).
- [ ] **Step 2: Run** `npx jest tests/unit/adapters/schema-relations.test.ts` — FAIL.
- [ ] **Step 3: Implement** per adapter. Sources: Postgres `information_schema.table_constraints` + `key_column_usage` + `constraint_column_usage`, `pg_class.reltuples`; MySQL `information_schema.KEY_COLUMN_USAGE` (`REFERENCED_TABLE_NAME`), `TABLES.TABLE_ROWS`; SQLite `PRAGMA table_info` (`pk`), `PRAGMA foreign_key_list`; MSSQL `sys.foreign_key_columns`, `sys.indexes is_primary_key`, `sys.partitions`. A negative/unknown estimate becomes `null`.
- [ ] **Step 4: Run** the new test and `npx jest tests/unit/adapters` — PASS.
- [ ] **Step 5: Commit** `feat(schema): capture primary keys, foreign keys and row estimates`

### Task 2: Schema fingerprint and schema diff

**Files:**
- Modify: `src/database/adapters/base.ts` (abstract `fingerprintQuery`), each adapter
- Modify: `src/classes/ConnectionManager.ts` (`schemaFingerprint`)
- Create: `src/schema/diff.ts`
- Modify: `src/types/database.ts` (`DatabaseSchema.fingerprint?: string`)
- Test: `tests/unit/schema/diff.test.ts`, `tests/unit/connection-manager.test.ts` (add cases)

**Interfaces:**
- Produces:
  ```ts
  // base.ts
  abstract fingerprintQuery(): string            // one row, one column named argos_fingerprint (plus optional n)
  // ConnectionManager
  async schemaFingerprint(dbName: string): Promise<string>   // sha256 hex of JSON of the result rows; bypasses QueryCache
  // src/schema/diff.ts
  export type SchemaChange =
    | { kind: 'table-added' | 'table-dropped'; table: string }
    | { kind: 'column-added'; table: string; column: string; type: string }
    | { kind: 'column-dropped'; table: string; column: string }
    | { kind: 'column-changed'; table: string; column: string; from: string; to: string }
  export function diffSchemas(before: DatabaseSchema, after: DatabaseSchema): SchemaChange[]
  export function formatSchemaChanges(changes: SchemaChange[]): string
  ```

Fingerprint SQL (exact):
- SQLite: `SELECT schema_version AS argos_fingerprint FROM pragma_schema_version`
- PostgreSQL: `SELECT md5(string_agg(table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||is_nullable, ',' ORDER BY table_schema, table_name, ordinal_position)) AS argos_fingerprint FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema')`
- MySQL: `SELECT COUNT(*) AS n, SUM(CRC32(CONCAT_WS(':', table_name, column_name, column_type, is_nullable))) AS argos_fingerprint FROM information_schema.columns WHERE table_schema = DATABASE()` (no `GROUP_CONCAT`: its 1024-byte default truncates)
- MSSQL: `SELECT COUNT(*) AS n, CONVERT(varchar(30), MAX(modify_date), 126) AS argos_fingerprint FROM sys.objects WHERE is_ms_shipped = 0`

`formatSchemaChanges` rules: tables and views both count; order as `diffSchemas` returns (tables alphabetically, then columns by position); items: `<t> added`, `<t> dropped`, `<t> + <c> (<type>)`, `<t> - <c>`, `<t>.<c> <from> → <to>`; joined with `; `; after 8 items `; +N more`; prefixed `Schema changed since last look: ` and ended with `.`; empty list → `''`.

- [ ] **Step 1: Write failing tests** in `tests/unit/schema/diff.test.ts`:
  ```ts
  expect(formatSchemaChanges(diffSchemas(before, after)))
    .toBe('Schema changed since last look: orders + shipped_at (timestamptz); legacy_users dropped.')
  ```
  plus: no change → `[]` and `''`; type change → `orders.total numeric → text`; 10 changes → ends `; +2 more.`; a view added counts as `table-added`.
  In `connection-manager.test.ts`: `schemaFingerprint` calls the adapter's `executeQuery` with `fingerprintQuery()` even when `QueryCache` holds a hit for that SQL, and returns the same hash for equal rows, a different one for different rows.
- [ ] **Step 2: Run** both — FAIL.
- [ ] **Step 3: Implement.** `schemaFingerprint` uses `_executeQueryInternal` (no cache, no metrics) and `createHash('sha256')`.
- [ ] **Step 4: Run** — PASS. Also `npm run type-check`.
- [ ] **Step 5: Commit** `feat(schema): fingerprint query per engine and schema diff`

### Task 3: SchemaWatch — the rate-limited check, wired into query tools

**Files:**
- Create: `src/schema/watch.ts`
- Modify: `src/classes/SchemaManager.ts` (store fingerprint on capture; `setFingerprint`)
- Modify: `src/tools/handlers/types.ts` (`ToolHandlerContext.schemaWatch`), `src/classes/SQLMCPServer.ts` (construct it)
- Modify: `src/tools/handlers/query-handlers.ts` (all three handlers)
- Modify: `src/types/mcp.ts` (`_meta.argos`)
- Test: `tests/unit/schema/watch.test.ts`, `tests/unit/tools/` handler tests

**Interfaces:**
- Consumes: Task 2 `schemaFingerprint`, `diffSchemas`, `formatSchemaChanges`.
- Produces:
  ```ts
  export class SchemaWatch {
    constructor(cm: ConnectionManager, sm: SchemaManager, now: () => number = Date.now, intervalMs = 60_000)
    check(dbName: string, config: DatabaseConfig): Promise<SchemaChange[]>   // [] when skipped, unchanged, first seen or failed
  }
  // SchemaManager
  setFingerprint(dbName: string, fingerprint: string): Promise<void>
  // MCPToolResponse
  _meta: { progressToken: null; argos?: { journalId: string | null; spool: string | null; schemaChange?: SchemaChange[] } }
  ```

Behaviour of `check`: skip (return `[]`) if checked < `intervalMs` ago for this db; skip if no connection is open (`cm.isConnected`); no cached schema → `[]`; cached schema without fingerprint → store current, `[]`; fingerprint equal → `[]`; differs → `sm.refreshSchema`, return `diffSchemas(old, new)`; any throw → log warning, `[]`. `captureSchema` stores `fingerprint` (failure → undefined).

Handlers: call `ctx.schemaWatch.check(database, dbConfig)` after security validation and before executing; when non-empty, append `\n` + `formatSchemaChanges(changes)` to the response text and set `_meta.argos.schemaChange`. Batch: once per batch.

- [ ] **Step 1: Write failing tests** (`watch.test.ts`, fake clock): second call within 60 s does not query; after 60 s it does; legacy cache without fingerprint → `[]` and `setFingerprint` called; changed fingerprint → returns the diff and refreshes; fingerprint throws → `[]` and the query still runs (handler test); handler response text ends with the `Schema changed since last look: …` line and `_meta.argos.schemaChange` equals the changes.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Update the existing handler mocks' `_meta` shape (commits 45/46 established it).
- [ ] **Step 4: Run** `npx jest tests/unit` — PASS.
- [ ] **Step 5: Commit** `feat(schema): tell Claude when a connection's schema changed`

### Task 4: Journal, spool and pins store

**Files:**
- Create: `src/pane/contract.ts` (types shared with the CLI JSON), `src/pane/store.ts`
- Test: `tests/unit/pane/store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // contract.ts
  export type Source = 'claude' | 'pane'
  export type Outcome = 'ok' | 'error' | 'blocked'
  export interface JournalEntry { id: string; at: string; source: Source; database: string;
    tool: 'sql_query' | 'sql_batch_query' | 'sql_analyze_performance' | 'pane_query';
    sql: string; batchId?: string; durationMs: number | null; rowCount: number | null;
    outcome: Outcome; reason?: string; schemaChange?: SchemaChange[]; spool: string | null }
  export interface SpoolPage { id: string; fields: string[]; rows: unknown[][]; total: number; offset: number; truncated: boolean }
  export interface Pin { id: string; name: string | null; database: string; sql: string; createdAt: string; lastJournalId: string | null }
  // store.ts
  export function dataDirFor(configPath: string): string        // join(dirname(resolve(configPath)), '.argos')
  export class PaneStore {
    constructor(dir: string, limits?: { spoolBytes?: number; spoolDays?: number; now?: () => number })
    newId(): string                                              // `${Date.now().toString(36)}-${8 hex}`, sorts by time
    append(entry: JournalEntry): Promise<void>
    history(opts: { before?: string; limit?: number }): Promise<JournalEntry[]>   // newest first, default limit 50
    entry(id: string): Promise<JournalEntry | null>
    writeSpool(id: string, result: QueryResult): Promise<string>  // returns spool name `<id>.json`
    readSpool(id: string, offset?: number, limit?: number): Promise<SpoolPage | null>  // default limit 200
    pins(): Promise<Pin[]>; pin(p: Omit<Pin, 'id' | 'createdAt'>): Promise<Pin>; unpin(id: string): Promise<boolean>
    evict(): Promise<number>
  }
  ```

Layout: `.argos/journal.jsonl` (one entry per line, appended with a single `appendFile` write per entry, `flag: 'a'`), `.argos/spool/<id>.json` (`{ fields, rows: unknown[][], truncated }`, written to a temp file then renamed), `.argos/pins.json` (temp + rename). Directory mode `0o700`, files `0o600` (SQL and results may be sensitive). Eviction defaults: `spoolBytes` 200 MB, `spoolDays` 30; oldest first; spools referenced by a pin's `lastJournalId` are kept; runs after each `writeSpool`. `history` reads the file backwards in chunks (no full-file load) and skips unparseable lines.

- [ ] **Step 1: Write failing tests** (temp dir): append → history newest first; `before` pages; a torn last line is skipped; spool round-trips rows as arrays in field order; `readSpool` pages with `total`; eviction removes oldest past the byte cap but keeps a pinned spool; files are `0o600`; **two child processes appending 500 entries each concurrently yield 1000 parseable lines** (Review Focus 2); a 100k-row result spools and `readSpool(id, 99_900, 200)` returns 100 rows (Review Focus 1).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(pane): journal, result spool and pins under .argos/`

### Task 5: Journal Claude's query calls

**Files:**
- Modify: `src/tools/handlers/types.ts` (`ToolHandlerContext.paneStore: PaneStore | null`), `src/classes/SQLMCPServer.ts` (create from `dataDirFor(configPath)` once config loads; `null` if the dir cannot be created)
- Modify: `src/tools/handlers/query-handlers.ts`
- Test: handler tests under `tests/unit/tools/`

**Interfaces:**
- Consumes: Task 4 `PaneStore`, Task 3 `_meta.argos`.

Every call of the three tools appends one entry with `source: 'claude'` — `ok` with `rowCount`, `durationMs` (`result.execution_time_ms`) and a spool; `blocked` (a `SecurityViolationError`) with its sanitized reason and no spool; `error` with the sanitized message. Batch: one entry per statement sharing a `batchId`, each with its own spool. Analyze: entry with `spool: null`. `_meta.argos` = `{ journalId, spool }` (for a batch, the first entry's id). Journal/spool failures are logged and never change the tool's response.

- [ ] **Step 1: Write failing tests**: an ok `sql_query` appends an `ok` entry and returns `_meta.argos.journalId` matching it; a blocked query appends `blocked` with the reason; a batch of 3 appends 3 entries with one `batchId`; `paneStore.append` throwing still returns the normal response; `paneStore: null` works.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `npx jest tests/unit` — PASS.
- [ ] **Step 5: Commit** `feat(pane): journal every query Claude runs, full result spooled`

## Phase B — CLI

### Task 6: CLI core, `argos connections`, `argos schema`

**Files:**
- Create: `src/cli/core.ts`, `src/cli/pane-commands.ts`
- Modify: `src/cli/commands.ts` (new kinds), `src/cli.ts` (dispatch)
- Create: `tests/fixtures/pane-contract/` (written by tests, read by the mod's specs)
- Test: `tests/unit/cli/pane-commands.test.ts`, `tests/unit/cli/commands.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // commands.ts: Command kind adds 'connections' | 'schema' | 'query' | 'history' | 'result' | 'pin' | 'unpin' | 'pins' | 'install-plugin'
  // core.ts
  export interface Core { config: ParsedServerConfig; configPath: string; connectionManager: ConnectionManager;
    securityManager: SecurityManager; schemaManager: SchemaManager; schemaWatch: SchemaWatch; store: PaneStore; close(): Promise<void> }
  export async function openCore(args: string[]): Promise<Core>      // reads --config like resolveConfigPathFromArgv, else loadConfiguration's search
  // contract.ts additions
  export interface ConnectionView { name: string; type: string; host: string | null; ssh: boolean; ssl: boolean;
    selectOnly: boolean; mcpConfigurable: boolean; schemaCapturedAt: string | null }
  export interface SchemaView { database: string; type: string; capturedAt: string | null;
    tables: TableInfo[]; views: TableInfo[]; lastChange: SchemaChange[] | null }
  export type CliError = { error: string }
  // pane-commands.ts — each returns the JSON value printed on stdout
  export async function connections(core: Core): Promise<ConnectionView[]>
  export async function schema(core: Core, db: string, refresh: boolean): Promise<SchemaView>
  ```

Output contract: one JSON value on stdout, exit 0; on failure `{"error": "<sanitized message>"}` on stdout, exit 1. Logger console output off (stdout is the contract). `schema` without `--refresh` uses the cached schema, capturing only when none exists. `lastChange` is the newest `schemaChange` in the journal for that database.

- [ ] **Step 1: Write failing tests** with a temp SQLite db and config: `connections` lists it with `selectOnly` as configured; `schema demo` returns its tables with `primary_key`; unknown db → `{ error }` and exit 1; both outputs written to `tests/fixtures/pane-contract/connections.json` / `schema.json`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Measure latency (spec risk 2).** Time `argos schema <db>` and `argos query <db> --sql 'SELECT 1'` cold, against a local SQLite connection and, if the person has one, an SSH-tunnelled one. Record the numbers in the commit message. Over 2 s for the tunnelled case: stop and raise it with the person before Phase C (the fallback is a long-running read-only `argos pane-server` mode, which would be a new task).
- [ ] **Step 6: Commit** `feat(cli): argos connections and argos schema`

### Task 7: `argos query`, `history`, `result`, pins

**Files:**
- Modify: `src/cli/pane-commands.ts`, `src/cli/commands.ts`, `src/cli.ts`
- Test: `tests/unit/cli/pane-commands.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function query(core: Core, db: string, sql: string): Promise<JournalEntry>
  export async function history(core: Core, before?: string, limit?: number): Promise<JournalEntry[]>
  export async function result(core: Core, id: string, offset?: number, limit?: number): Promise<SpoolPage>
  export async function pin(core: Core, ref: { journalId?: string; db?: string; sql?: string; name?: string }): Promise<Pin>
  export async function unpin(core: Core, id: string): Promise<{ removed: boolean }>
  export async function pins(core: Core): Promise<Pin[]>
  ```
  CLI shapes: `argos query <db> --sql <text>` (or SQL on stdin when `--sql -`), `argos history [--before <id>] [--limit n]`, `argos result <id> [--offset n] [--limit n]`, `argos pin <journalId> [--name <n>]` or `argos pin --db <db> --sql <text> [--name <n>]`, `argos unpin <id>`, `argos pins`.

`query` always validates with `validateSelectOnlyQuery(sql, dbConfig.type)` whatever `select_only` says; refused → journal `blocked` (source `pane`, tool `pane_query`) and print that entry with exit 0 (a refusal is an answer, not a CLI failure). Runs the schema check like the handlers (via `SchemaWatch`) and records `schemaChange`. Rerunning a pin = `query` with its SQL; `pin`'s `lastJournalId` is updated by `query` when the SQL matches a pin exactly.

- [ ] **Step 1: Write failing tests**: `SELECT` journals `ok` with spool and `result` pages it; on a **full-access** connection `DELETE FROM t`, `WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x` and `SELECT 1; DROP TABLE t` each come back `blocked` with a reason and the table is unchanged (Review Focus 4); `history --before` pages; pin/unpin/pins round-trip; fixtures `query.json`, `history.json`, `result.json`, `pins.json` written.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(cli): read-only argos query, history, result and pins`

### Task 8: `argos install-plugin`

**Files:**
- Create: `src/cli/install-plugin.ts`
- Modify: `src/cli/commands.ts`, `src/cli.ts`, `.gitignore` (`.plugin/`)
- Test: `tests/unit/cli/install-plugin.test.ts`

**Interfaces:**
- Produces: `export async function installPlugin(opts: { repoRoot: string; configPath: string; scope: 'user' | 'project' | 'local'; execute: boolean; run?: (argv: string[]) => Promise<number> }): Promise<{ commands: string[][]; outDir: string }>`

Without `--execute`: print the two commands and the config path it would write; change nothing. With it: copy `plugin/` to `<repoRoot>/.plugin/plugins/argos/`, write `<repoRoot>/.plugin/.claude-plugin/marketplace.json` (`{ name: 'argos', plugins: [{ name: 'argos', source: './plugins/argos' }] }`), write `.plugin/plugins/argos/hooks/argos.env.json` = `{ node: process.execPath, cli: <abs dist/cli.js>, config: <abs config path> }`, then run `claude plugin marketplace add <abs .plugin> --scope <scope>` and `claude plugin install argos@argos --scope <scope> --yes`. Config path: `--config`, else `getConfigurationPath()`; must exist and be absolute after resolving.

- [ ] **Step 1: Write failing tests** with a fake `run`: preview writes nothing and returns both commands; execute writes the three files with the right paths and calls `run` twice in order; a missing config → error naming the path.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(cli): argos install-plugin`

## Phase C — The mod

Layout under `plugin/`: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.tsx`, `hooks/engine.d.ts`, `hooks/mod/*.ts(x)`, `hooks/lib/*.ts`, `types/index.d.ts`, plus root `vitest.config.mjs` and `tools/jsx-runtime-stub.mjs`. Scripts: `test:mod` = `vitest run`, `typecheck:mod` = `tsc -p plugin/hooks/tsconfig.json && tsc -p plugin/hooks/tsconfig.spec.json`; add both to `validate`.

### Task 9: Scaffold and port the Knossos layout primitives

**Files:**
- Create: `plugin/.claude-plugin/plugin.json` (name `argos`, displayName `Argos`, `userConfig`: `enabled` boolean default true, `openPaneOnStart` boolean default false, `serverName` string default `"argos"`), `plugin/hooks/hooks.json` (`{ "hooks": {}, "modules": ["./register.tsx"] }`), `plugin/hooks/engine.d.ts` (copy), `plugin/hooks/tsconfig*.json`, `vitest.config.mjs`, `tools/jsx-runtime-stub.mjs` (copy)
- Port to `plugin/hooks/lib/` with their Knossos specs: `types.ts`, `text.ts`, `rows.ts`, `palette.ts`, `marks.ts`, `table.ts`, `chips.ts`, `gauge.ts`, `cards.ts`, `printable.ts`, `themes.ts`
- Modify: `package.json` (devDeps `vitest`, `typescript` already present; scripts)

Porting rule: keep layout primitives and constants verbatim (`Tier`, `MEDIUM_MIN 80`, `MEDIUM_MAX 130`, `GRID_GAP`, `LIST_SOFT`, `Section`, `topRow`, `cardRows`, `stackRows`, `besideRows`, `windowOf`, `moreRows`, `fitBlocks`, `arrange`, `gridColumns`, `HEADING/SECONDARY/FAINT/ACCENT`, `SELECTED_BG`, `CARD_BG`); drop Knossos-only parts (boundary hues, `editor`, `paths`, component `displayName`/`shortName`, Knossos `KIND`/`REACH`/`CERTAINTY` marks) and the spec cases that test them. Add Argos marks in `marks.ts`: `SOURCE` (`claude`, `you`), `OUTCOME` (`ok`, `blocked`, `error`), `KEY` (`PK`, `FK`, `+` new column), `CARD_ICON` for `pinned ★`, `history ≡`, `result ◇`, `tables ▦`, `relations ⇄`, `query ›_`. Engine colours: one chip hue per engine (`postgresql`, `mysql`, `sqlite`, `mssql`) in `palette.ts`.

- [ ] **Step 1: Copy the files and their specs; delete the Knossos-only exports and cases.**
- [ ] **Step 2: Run** `npm run test:mod && npm run typecheck:mod` — PASS (ported specs are the tests for this task).
- [ ] **Step 3: Commit** `feat(plugin): scaffold the Argos mod and port Knossos layout primitives`

### Task 10: Port, state, CLI runner, chrome, Connections tab, `/argos`

**Files:**
- Create: `plugin/hooks/register.tsx`, `plugin/hooks/mod/{port,state,cli,loaders,actions,render,session}.ts(x)`, `plugin/hooks/lib/{chrome,layout,contract,parse}.ts`, `plugin/types/index.d.ts`
- Create: `plugin/hooks/register.test.ts` (run with `claude plugin test`)
- Test: `plugin/hooks/lib/{chrome,parse}.spec.ts`, `plugin/hooks/mod/{cli,loaders,actions}.spec.ts`

**Interfaces:**
- Consumes: Task 6/7 JSON (types mirrored in `lib/contract.ts`; `parse.ts` validates each shape and returns `null` on mismatch), fixtures in `tests/fixtures/pane-contract/`.
- Produces:
  ```ts
  // mod/cli.ts
  export type CliAnswer<T> = { ok: true; value: T } | { ok: false; reason: string }
  export async function runCli<T>(io: Port, args: string[], parse: (raw: unknown) => T | null, timeoutMs?: number): Promise<CliAnswer<T>>
  // reads hooks/argos.env.json once; runs [node, cli, ...args, '--config', config] via io.process.run; never throws
  // types/index.d.ts
  export type PaneTab = 'queries' | 'schema' | 'editor' | 'connections'
  export interface View { tab: PaneTab; marker: Record<PaneTab, number>; scroll: Record<string, number>; db: string | null }
  // lib/chrome.ts
  export function titleRow(input: { connections: ConnectionView[]; pill: { text: string; tone: 'ok' | 'warn' | 'accent' } }, columns: number, tier: Tier): Row
  export function tabRows(active: PaneTab, columns: number, terminal: boolean): Row[]
  export function footerRows(keys: { hotkey: string; label: string }[], columns: number): Row[]
  // lib/layout.ts
  export function paneRows(state: PaneModel, columns: number, rows: number): Row[]   // dispatches per tab
  ```

Follow `mod-internals.md` exactly: atoms declared in `register.tsx` under plugin name `argos`; `portOf($)` per dispatch with one arrow per call (`clock`, `ui`, `session`, `process`, `fs`, `store`, `prompt`, `plugin`); reads only via the keyed loader on a timer, never inside a render; a press table `PRESSES` keyed up to the first colon (`tab:<id>`, `row:<n>`, `rerun`, `pin`, `copy`, `send`, `edit`, `run`). `command.run` `argos` toggles the pane (retry registration as Knossos does). `openPaneOnStart` opens it at session start. Every open reloads `connections`. Tabs: Queries, Schema, Editor, Connections; hotkeys `1`–`4`. Header: `argos` bold, config location dim (`~`-shortened), one chip per connection coloured by engine, width gauge, pill. Connections tab: one card per connection — name, engine, host, SSH/SSL, `SELECT_ONLY` or `full access`, MCP-configurable, schema captured age.

Failure line (Review Focus 5): no `argos.env.json` → `argos: plugin not installed by argos install-plugin`; binary missing/timeout → `argos: could not run the argos CLI (<reason>)`; `{ error }` → that message. Shown as one dim row under the header; the session never sees a throw.

- [ ] **Step 1: Write failing tests**: `parse` accepts every fixture and rejects a mutated one; `runCli` returns `{ ok: false }` for missing env file, non-zero exit with `{error}`, and garbage stdout; `tabRows` marks the active tab with `TAB_BG`; `titleRow` drops the gauge first, then chips, as width shrinks; Connections layout shows `SELECT_ONLY` for a select-only fixture; `register.test.ts` mounts the pane after `/argos` and finds the four tab labels.
- [ ] **Step 2: Run** `npm run test:mod` — FAIL. **Step 3: Implement.** **Step 4: Run** `npm run test:mod && npm run typecheck:mod && claude plugin test plugin` — PASS.
- [ ] **Step 5: Commit** `feat(plugin): /argos pane chrome and Connections tab`

### Task 11: Schema tab

**Files:**
- Create: `plugin/hooks/lib/schema-view.ts`; modify `mod/loaders.ts` (`schema` loader keyed by db), `mod/actions.ts`
- Test: `plugin/hooks/lib/schema-view.spec.ts`

**Interfaces:**
- Produces: `export function schemaRows(view: SchemaView, selected: number, columns: number, tier: Tier, room: number, scroll: Record<string, number>): Row[]`

Cards: engine/tunnel, tables, views, columns, changed (count of tables in `lastChange`). Left block **Tables** (`▦`, note `rows est.`), each with `row_estimate` grouped (`18,402`), changed tables marked `● changed`. Right block: the selected table — columns with `PK`/`FK` mark, type (`bigint → customers.id` for FKs), null, default; columns added in `lastChange` marked `+`. Then **Relations** (`⇄`, note `N in · M out`): outgoing from `foreign_keys`, incoming from other tables' `foreign_keys`. `tab` cycles connections; `q` puts `SELECT * FROM <table> LIMIT 100` (dialect: `TOP 100` for mssql) in the Editor; `c` copies a `CREATE TABLE` sketch from the captured columns; `f` filters tables. Narrow tier stacks the blocks.

- [ ] **Step 1: Write failing tests** against `schema.json` fixture: PK row shows `PK`, FK row shows `→ customers.id`; changed table carries `● changed`; relations count matches; 60 tables at 30 rows shows `N more ↓`; narrow tier yields one column.
- [ ] **Step 2–4:** run (FAIL), implement, run `npm run test:mod` (PASS).
- [ ] **Step 5: Commit** `feat(plugin): Schema tab`

### Task 12: Queries tab and the live feed

**Files:**
- Create: `plugin/hooks/lib/queries-view.ts`, `plugin/hooks/lib/grid.ts`; modify `register.tsx` (`tool.call`), `mod/loaders.ts` (`history`, `result`, `pins`), `mod/actions.ts`
- Test: `plugin/hooks/lib/{queries-view,grid}.spec.ts`, `plugin/hooks/mod/actions.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export function gridRows(page: SpoolPage, columns: number, room: number, scroll: number): Row[]   // shared with the Editor
  export function queriesRows(model: { pins: Pin[]; history: JournalEntry[]; selected: number; result: SpoolPage | null }, columns: number, tier: Tier, room: number, scroll: Record<string, number>): Row[]
  ```

`tool.call` (one unmatched handler; filter at runtime on `mcp__${options.serverName}__sql_query|sql_batch_query|sql_analyze_performance`): after `next(e)`, request the `history` loader; when the pane is on Queries, select the newest entry. It adds nothing to the model's context and does not depend on `_meta` reaching the hook. Cards: queries (+ this session), pinned, blocked, schema changes, connections. Left: **Pinned** then **History** (`all sessions`, `newest first`), rows tagged `claude`/`you`, connection chip, `N rows · Xms · age`; blocked rows in the alert tone with the reason. Right: the SQL (wrapped), a schema-change line in the warn tone, the grid. Grid: column widths from header and the first visible rows, capped so the grid fits; cells clipped with `…`; `null` → `NULL` dim; redacted values shown as the adapter wrote them. History pages in by 50 as the list scrolls (`before`); results page by 200. Keys: `r` rerun (CLI `query`), `e` open in Editor, `p` pin/unpin, `c` copy (cycles markdown → CSV → JSON on repeat presses within 2 s, toast names the format), `s` send — only on `you` rows. Evicted spool → `result no longer kept — r to rerun`.

- [ ] **Step 1: Write failing tests**: `gridRows` with 40 columns at width 100 stays ≤ 100 cells per row; 10k-character cell is clipped; history fixture renders `claude` and `you` tags and a blocked row with its reason; `s` absent on a `claude` row; a `tool.call` for `mcp__argos__sql_query` triggers one `history` read (loader spec with a fake port), a call to another tool triggers none.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(plugin): Queries tab with live feed, pins, rerun and copy`

### Task 13: Editor tab and send to Claude

**Files:**
- Create: `plugin/hooks/lib/editor-view.ts`, `plugin/hooks/lib/clip.ts`; modify `mod/actions.ts`, `mod/state.ts` (`fieldKey('sql')`)
- Test: `plugin/hooks/lib/{editor-view,clip}.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export function toMarkdown(page: SpoolPage, maxRows: number, maxChars: number): string
  export function toCsv(page: SpoolPage): string
  export function toJson(page: SpoolPage): string
  export function sendText(entry: JournalEntry, page: SpoolPage): string   // SQL fenced, connection, markdown table capped at 50 rows / 8,000 chars, '… N more rows' when cut
  ```

Connection picker (cycles with `tab`), a text field under `field:sql` (focus via `fieldKey`, on a timer after the press, as in Knossos), `enter` runs through CLI `query`, result grid via `gridRows`. A refused write shows the reason in the alert tone. `c` copy, `p` pin (name prompt optional), `s` send. **Send:** before implementing, check the engine's prompt API in the `plugin-authoring` skill reference: if it can place text in the composer without submitting, use that; if it can only submit a turn, stop and ask the person whether send may start a turn.

- [ ] **Step 1: Write failing tests**: `toCsv` quotes commas/quotes/newlines; `toMarkdown` escapes `|`; `sendText` of 120 rows ends with `… 70 more rows`; editor shows the refusal for a `blocked` entry.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(plugin): Editor tab, copy formats and send to Claude`

### Task 14: Engine limits, docs, look sign-off

**Files:**
- Modify: `plugin/hooks/mod/render.tsx` (`TEXT_BUDGET` 90,000, `SHORT_ROWS` 16, drop to fewer rows when over, as Knossos's `drawPane`)
- Modify: `plugin/hooks/register.test.ts`
- Create: `docs/claude-code/pane.md`; modify `README.md` (pane section, `argos install-plugin`)

- [ ] **Step 1: Write failing tests** in `register.test.ts`: every tab at pane widths 60, 100, 160 and heights 20, 50, with fixtures scaled to 5,000 history entries, 300 tables and a 200×60 result page, stays under 90,000 characters, 10,000 nodes and depth 16.
- [ ] **Step 2–4:** run (FAIL), implement, run `npm run validate && npm run test:mod && claude plugin test plugin` (PASS).
- [ ] **Step 5: Look sign-off.** Install with `argos install-plugin --execute`, open `/argos` and `/knossos` at the same width in dark and light themes, capture each Argos tab beside a Knossos tab, and show the person. Fix what they flag before merging.
- [ ] **Step 6: Commit** `feat(plugin): engine-limit guard and pane docs`

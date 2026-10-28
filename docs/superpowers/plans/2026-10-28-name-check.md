# Name Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an agent's query names a column or table that doesn't exist, Argos either refuses to run it (layer 1: confident wrong columns on known tables) or adds a correction to the database's error (layer 2). Either way the response carries "did you mean" suggestions and the real column list.

**Architecture:** Three pure modules under `src/schema/`:
- `sql-scan.ts` reads a statement into table and column references.
- `name-check.ts` compares those references to the cached `DatabaseSchema` and ranks suggestions.
- `name-hints.ts` recognizes driver "unknown name" errors and formats the correction.

A small orchestrator, `src/tools/handlers/name-check.ts`, captures the schema (time-limited), runs the check, forces a fingerprint re-check before any block, and is called from the three query handlers.

**Tech Stack:** TypeScript 5.9 (ESM, `.js` import suffixes), Jest for `tests/`, Node 24.15+.

**Spec:** `docs/superpowers/specs/2026-10-28-name-check-design.md`

## Global Constraints

- No new runtime dependency. If the hand-written scanner can't pass the must-not-block corpus (Task 3), stop and ask; don't add a SQL parser.
- Layer 1 never blocks on a table name. A table that isn't known only means its columns go unchecked.
- Layer 1 checks only `SELECT`, `WITH … SELECT`, and `EXPLAIN` of those. Everything else passes through it unchanged.
- Corrections contain names and types only, never row data. Caps: 3 tables listed, 40 columns per table, 3 suggestions.
- The existing security validation runs first and is unchanged.
- The check reads only the cached schema plus at most one forced fingerprint check and refresh. It never queries user tables.
- Schema capture before a query is limited to 5000 ms. Past that the query runs unchecked, and the capture continues in the background.
- `name_check` is per connection and defaults to `true`. `false` disables layer 1 only. Layer 2 is always on.
- The pane's `pane_query` is untouched.
- Commits use Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`). Never edit `CHANGELOG.md`; Release Please writes it.
- Before the final commit of each task, `npm run lint:check && npm run format:check && npm run type-check && npm run type-check:tests` must pass.

## Review Focus

1. **Correction text going through `sanitizeMessage`.** It would mangle names: a table named `token` gives `Columns of token: …`, which comes out as `token=[REDACTED]…`. Corrections must be appended *after* sanitizing the driver error, never passed through it. Tested in Task 6.
2. **Case.** Postgres stores names lowercased, so `SELECT Username FROM Users` must not block. Tested in Task 4.
3. **Placeholders read as columns.** `$1`, `?`, `@p1` and `:name` in `WHERE id = $1` must not be read as bare columns. Tested in Task 3.
4. **Schema capture that hangs or fails.** The query must still run, and the first query must wait no more than 5000 ms. Tested in Task 5 with fake timers.
5. **Two first queries at once** must start only one capture. Tested in Task 5.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/schema/sql-scan.ts` (create) | Tokenize one statement; pull out table refs, qualified and bare column refs, CTE names, select aliases, and a `simple` flag. Pure. |
| `src/schema/name-check.ts` (create) | `checkNames` (layer 1 decision) and `suggest` (similarity ranking). Pure. |
| `src/schema/name-hints.ts` (create) | `classifyNameError` (layer 2 detection) and `formatCorrection`. Pure. |
| `src/tools/handlers/name-check.ts` (create) | Orchestrates: ensure schema, check, forced re-check, build the correction. |
| `src/utils/error-handler.ts` (modify) | `NameCheckError`; `sanitizeError` returns its message as is. |
| `src/tools/handlers/journal.ts` (modify) | `NameCheckError` journals as `blocked`. |
| `src/database/adapters/base.ts:192` (modify) | `createError` keeps the original error as `cause`. |
| `src/classes/ConnectionManager.ts:715-800` (modify) | Batch results keep `cause`. |
| `src/schema/watch.ts` (modify) | `check(..., { force })` skips the rate limit. |
| `src/classes/SchemaManager.ts` (modify) | `captureSchemaOnce` dedupes in-flight captures. |
| `src/types/database.ts`, `src/utils/config.ts` (modify) | `name_check` option. |
| `src/tools/handlers/query-handlers.ts` (modify) | Wire both layers into the three tools. |
| `src/tools/handlers/schema-handlers.ts` (modify) | `sql_get_schema` captures on demand. |

---

### Task 1: Keep driver errors, and recognize "unknown name" errors

**Files:**
- Modify: `src/database/adapters/base.ts:192-202`
- Modify: `src/classes/ConnectionManager.ts` (batch `results` element type and the `catch` at about line 778)
- Modify: `src/types/database.ts` (`BatchResult` result element, if it's declared there; follow the type `executeBatch` returns)
- Create: `src/schema/name-hints.ts` (the `classifyNameError` part only)
- Test: `tests/unit/schema/name-hints.test.ts`, `tests/unit/adapters/base-adapter.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type NameErrorKind = 'column' | 'table';
  export interface NameErrorInfo { kind: NameErrorKind; name: string | null } // name without quotes or qualifier
  export function classifyNameError(error: unknown): NameErrorInfo | null;
  ```
  Batch result elements gain `cause?: unknown`.

- [ ] **Step 1: Write the failing tests**

`base-adapter.test.ts`: `it('createError keeps the original error as cause')`. Throw through `createError('x', orig)` and assert `(err as Error).cause === orig`. The message format is unchanged.

`name-hints.test.ts`, `describe('classifyNameError')`, table-driven. Each row builds an `Error` whose `cause` carries the driver shape:

| Driver shape (cause) | Expected |
|---|---|
| pg `{ code: '42703', message: 'column "user_name" does not exist' }` | `{ kind: 'column', name: 'user_name' }` |
| pg `{ code: '42703', message: 'column u.user_name does not exist' }` | `{ kind: 'column', name: 'user_name' }` |
| pg `{ code: '42P01', message: 'relation "userz" does not exist' }` | `{ kind: 'table', name: 'userz' }` |
| mysql `{ errno: 1054, code: 'ER_BAD_FIELD_ERROR', message: "Unknown column 'u.user_name' in 'field list'" }` | column `user_name` |
| mysql `{ errno: 1146, code: 'ER_NO_SUCH_TABLE', message: "Table 'shop.userz' doesn't exist" }` | table `userz` |
| mssql `{ number: 207, message: "Invalid column name 'user_name'." }` | column `user_name` |
| mssql `{ number: 208, message: "Invalid object name 'dbo.userz'." }` | table `userz` |
| sqlite `{ code: 'SQLITE_ERROR', message: 'SQLITE_ERROR: no such column: u.user_name' }` | column `user_name` |
| sqlite `{ code: 'SQLITE_ERROR', message: 'SQLITE_ERROR: no such table: userz' }` | table `userz` |
| no cause, message only: `'postgresql adapter error: Failed to execute PostgreSQL query - column "x" does not exist'` | column `x` (message fallback, used for batch strings) |
| pg `{ code: '42703', message: 'something unparseable' }` | `{ kind: 'column', name: null }` |
| `{ code: '42601', message: 'syntax error' }` | `null` |
| `'not an error'` | `null` |

Also check the `ConnectionManager` batch path in `tests/unit/connection-manager.test.ts`: `it('batch results keep the failing error as cause')`.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/unit/schema/name-hints.test.ts tests/unit/adapters/base-adapter.test.ts tests/unit/connection-manager.test.ts`
Expected: FAIL (module not found / `cause` undefined).

- [ ] **Step 3: Implement**

- `createError` passes `{ cause: originalError }` to `new Error`.
- The batch `catch` pushes `cause: error`.
- `classifyNameError` walks `error` and then `error.cause` (one level). It checks codes first (`42703`/`42P01`, `1054`/`1146` or the `ER_*` names, `number` `207`/`208`), then message regexes as the fallback. It strips quotes and keeps only the last dotted part.

- [ ] **Step 4: Run to verify pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/database/adapters/base.ts src/classes/ConnectionManager.ts src/types src/schema/name-hints.ts tests/unit
git commit -m "feat: keep driver errors and recognize unknown-name errors"
```

---

### Task 2: Correction formatter and suggestions

**Files:**
- Create: `src/schema/name-check.ts` (the `suggest` part only)
- Modify: `src/schema/name-hints.ts` (add `formatCorrection`)
- Test: `tests/unit/schema/name-check.test.ts`, `tests/unit/schema/name-hints.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // name-check.ts
  export function suggest(wrong: string, candidates: string[], max = 3): string[];
  export interface NameProblem {
    name: string;            // the wrong column as written (unquoted)
    table: string | null;    // known table it was qualified with; null for a bare column
    inScope: string[];       // known tables whose columns to list (cache keys)
    statement?: number;      // 0-based batch index, set by the batch handler
  }
  // name-hints.ts
  export function formatCorrection(
    schema: DatabaseSchema,
    problems: Array<NameProblem | { kind: 'table'; name: string | null } | { kind: 'column'; name: string | null; inScope: string[] }>
  ): string;
  ```
  The union lets layer 2 reuse the formatter. Simplify it to one `Correction` type if that reads better, but keep `formatCorrection(schema, items): string`.

- [ ] **Step 1: Write the failing tests**

`suggest`:
- `suggest('user_name', ['id','username','email'])` → `['username']`
- `suggest('custmer_id', ['customer_id','id'])` → first is `'customer_id'`
- `suggest('userz', ['users','orders'])` → `['users']`
- `suggest('order', ['orders','users'])` → `['orders']` (singular/plural)
- `suggest('USERNAME', ['username'])` → `['username']`
- `suggest('foo', ['id','username','created_at'])` → `[]` (no wild guesses)
- at most `max` results

`formatCorrection`, using a fixture schema `users(id integer, username text, email text, created_at timestamp)`, `orders(id, user_id, total, status, created_at)`:
- a qualified problem `{ name:'user_name', table:'users', inScope:['users'] }` gives text that contains `users.user_name`, `Did you mean: username`, and `id (integer), username (text), email (text), created_at (timestamp)`
- a table item `{ kind:'table', name:'userz' }` contains `Did you mean: users` and does **not** list every table's columns
- a table with 45 columns lists 40 and says `5 more` and `sql_get_schema`
- a problem with 5 tables in scope lists 3 tables and mentions `sql_get_schema`
- a problem with `statement: 2` mentions `statement 3` (1-based for people)

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/unit/schema/name-check.test.ts tests/unit/schema/name-hints.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`suggest` normalizes both sides (lowercase, drop `_`, strip one trailing `s`), scores with Levenshtein distance on the normalized forms, and keeps candidates within `max(1, floor(len/3))`, closest first. A normalized exact match scores 0. Columns are looked up in `schema.tables[t] ?? schema.views[t]`.

- [ ] **Step 4: Run to verify pass.** Expected: PASS.

- [ ] **Step 5: Commit** — `feat: format name corrections with suggestions`

---

### Task 3: SQL scanner

**Files:**
- Create: `src/schema/sql-scan.ts`
- Test: `tests/unit/schema/sql-scan.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TableRef { schema: string | null; name: string; quoted: boolean; alias: string | null }
  export interface ColumnRef { qualifier: string | null; name: string; quoted: boolean }
  export interface ScanResult {
    checkable: boolean;        // SELECT / WITH…SELECT / EXPLAIN of those, and the scan placed every token
    simple: boolean;           // single SELECT; no subqueries, CTEs, derived tables, table functions, VALUES, LATERAL, NATURAL
    ctes: string[];
    derivedAliases: string[];  // aliases of subqueries / table functions in FROM
    tables: TableRef[];        // every FROM/JOIN table ref at any depth
    qualified: ColumnRef[];    // x.col anywhere outside strings/comments, not followed by "(" and not 3-part
    bare: ColumnRef[];         // only when simple: at the positions listed in the spec
    selectAliases: string[];
  }
  export function scanSql(sql: string): ScanResult;
  ```

- [ ] **Step 1: Write the failing tests**

Unit cases (assert the fields named):
- `SELECT u.username FROM users u WHERE u.id = 1`: tables `[{name:'users', alias:'u'}]`, qualified `[{qualifier:'u', name:'username'}, {qualifier:'u', name:'id'}]`, `simple: true`
- `SELECT id, username AS n FROM users ORDER BY n`: bare `id`, `username`; selectAliases `['n']`; `n` not in bare
- `SELECT * FROM public.users JOIN orders o ON o.user_id = users.id`: two tables, the first with `schema:'public'`
- `WITH recent AS (SELECT * FROM orders) SELECT r.id FROM recent r`: ctes `['recent']`, `simple:false`, `bare: []`
- `SELECT x FROM (SELECT 1 AS x) d`: derivedAliases `['d']`, `simple:false`
- `SELECT * FROM generate_series(1,3) g`: derivedAliases `['g']`, no table ref
- `EXPLAIN SELECT id FROM users`: `checkable:true`
- `UPDATE users SET x = 1`, `SHOW TABLES`, `PRAGMA table_info(users)`: `checkable:false`
- Not read as columns: `'a.b@c.com'` in a string, `-- u.foo` and `/* u.foo */` in comments, `$1`, `?`, `@p1`, `:name`, `x::int`, `CAST(id AS integer)` (no bare `integer`), `EXTRACT(epoch FROM created_at)` (no bare `epoch`), `CURRENT_DATE`, `INTERVAL '1 day'`, `TRUE`/`NULL`, function names (`count(`, `now(`), `pg_catalog.now()` (dotted then `(`), `data->>'k'`
- quoted: `SELECT "UserName" FROM "Users"` gives `quoted:true` on both; `` `x` `` and `[x]` likewise
- `SELECT a.b.c FROM t`: no qualified ref (3-part)
- `SELECT 1; SELECT 2`: `checkable:false`

- [ ] **Step 2: Run to verify failure.** `npx jest tests/unit/schema/sql-scan.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `scanSql`**

Write a tokenizer that knows about:
- strings (`'…'` with `''` escapes, `E'…'`, `$tag$…$tag$`);
- quoted identifiers (`"…"`, `` `…` ``, `[…]`);
- `--` and `/* */` comments;
- numbers, placeholders, and multi-char operators (`::`, `->`, `->>`, `#>`).

On top of that, walk with a paren-depth stack. Any token the walker can't place sets `checkable:false`; that is the conservative exit. Bare columns are collected only when `simple`. Keep a keyword set for words that are never columns (date parts, type names after `AS` inside `CAST`, literals, `CURRENT_*`).

- [ ] **Step 4: Run to verify pass.** Expected: PASS.

- [ ] **Step 5: Commit** — `feat: scan SQL for table and column references`

---

### Task 4: Layer 1 decision (`checkNames`) with both corpora

**Files:**
- Modify: `src/schema/name-check.ts`
- Test: `tests/unit/schema/name-check.test.ts`

**Interfaces:**
- Consumes: `scanSql`, `ScanResult` (Task 3); `NameProblem`, `suggest` (Task 2).
- Produces:
  ```ts
  export function checkNames(sql: string, schema: DatabaseSchema, defaultSchema: string | null): NameProblem[];
  export function defaultSchemaFor(type: DatabaseTypeString, database: string | undefined): string | null;
  // postgresql → 'public', mssql → 'dbo', mysql → database, sqlite → 'main'
  ```

- [ ] **Step 1: Write the failing tests**

Fixture: tables `users(id, username, email, created_at)` and `orders(id, user_id, total, status, created_at)`, plus view `active_users(id, username)`. Postgres default schema.

`it.each` **must not block** (`checkNames(...)` → `[]`):
```sql
WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM t WHERE n < 5) SELECT n FROM t
SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)
SELECT d.c FROM (SELECT count(*) AS c FROM orders) d
SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at) AS rn FROM orders
SELECT CAST(total AS integer), total::numeric FROM orders
SELECT EXTRACT(epoch FROM created_at) FROM orders WHERE created_at > CURRENT_DATE - INTERVAL '7 days'
SELECT data->>'k' FROM events
SELECT * FROM users u, LATERAL (SELECT * FROM orders o WHERE o.user_id = u.id) x
SELECT * FROM users JOIN orders USING (id)
SELECT * FROM users NATURAL JOIN orders
SELECT * FROM (VALUES (1),(2)) v(n)
SELECT "username" FROM "users"
SELECT Username FROM Users
SELECT username AS who FROM users ORDER BY who
SELECT * FROM analytics.events WHERE events.kind = 'x'
SELECT * FROM information_schema.columns
SELECT * FROM pg_stat_activity
SELECT nosuch FROM my_matview
SELECT * FROM tmp_import WHERE tmp_import.whatever = 1
SELECT * FROM #tmp
SELECT * FROM generate_series(1,3) g WHERE g.g > 1
SELECT username FROM users -- u.nosuch
SELECT username FROM users WHERE email = 'u.nosuch@x.com'
SELECT username FROM users WHERE id = $1 AND email = ? AND username = @p1 AND created_at > :since
SELECT nosuch FROM users JOIN some_unknown_table s ON s.id = users.id
UPDATE users SET nosuch = 1
SHOW TABLES
```
(The `nosuch FROM users JOIN some_unknown_table` row covers the rule that bare columns go unchecked when any table in scope is unknown.)

`it.each` **must block**, with the expected `NameProblem` and first suggestion:
- `SELECT u.user_name FROM users u` → `{ name:'user_name', table:'users' }`, suggest `username`
- `SELECT users.emial FROM users` → `emial` → `email`
- `SELECT user_name FROM users` → `{ name:'user_name', table:null, inScope:['users'] }`
- `SELECT id FROM users WHERE emial = 'x'` → `emial`
- `SELECT o.totl FROM orders o JOIN users u ON u.id = o.user_id` → `totl` on `orders`
- `SELECT a.usrname FROM active_users a` → view columns are checked
- `SELECT u.usrname FROM public.users u` → default-schema qualifier counts as known
- `EXPLAIN SELECT u.user_name FROM users u` → blocked

Plus: `defaultSchemaFor('mysql', 'shop')` is `'shop'`, so `SELECT s.x FROM shop.users s` is checked on MySQL.

- [ ] **Step 2: Run to verify failure.** `npx jest tests/unit/schema/name-check.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `checkNames`**

1. If `!checkable`, return `[]`.
2. Resolve every `TableRef` to a cache key: case-insensitive match against `tables` ∪ `views`, quoted refs exact first. A ref is known only when its schema is `null` or equals `defaultSchema` (case-insensitive), and its name isn't a CTE.
3. Build the qualifier map (alias, or the table name itself). If a qualifier maps to two different tables, drop it.
4. Qualified refs whose qualifier maps to a known table and whose column is missing become problems.
5. Bare refs only when `simple` and every table ref is known.

If the hand-written scanner can't pass this corpus, stop (Global Constraints).

- [ ] **Step 4: Run to verify pass.** Expected: PASS.

- [ ] **Step 5: Commit** — `feat: decide when a query names a column that doesn't exist`

---

### Task 5: Plumbing: config option, forced fingerprint check, deduped time-limited capture, `NameCheckError`

**Files:**
- Modify: `src/types/database.ts` (`DatabaseConfig.name_check?: boolean`, with a one-line comment)
- Modify: `src/utils/config.ts:237-244` (`name_check: config.name_check === undefined ? true : parseBool(config.name_check, 'name_check', name)`)
- Modify: `src/schema/watch.ts` (`check(dbName, config, opts?: { force?: boolean })`)
- Modify: `src/classes/SchemaManager.ts` (`captureSchemaOnce`)
- Modify: `src/utils/error-handler.ts`, `src/tools/handlers/journal.ts`
- Create: `src/tools/handlers/name-check.ts` (`ensureSchema` only, for now)
- Test: `tests/unit/config-validation.test.ts`, `tests/unit/schema/watch.test.ts`, `tests/unit/schema-manager.test.ts`, `tests/unit/tools/name-check.test.ts`, `tests/unit/tools/query-journal.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // watch.ts
  check(dbName: string, config: DatabaseConfig, opts?: { force?: boolean }): Promise<SchemaChange[]>;
  // SchemaManager
  captureSchemaOnce(dbName: string, config: DatabaseConfig): Promise<DatabaseSchema>; // one in flight per db; gets a connection first
  // error-handler.ts
  export class NameCheckError extends SQLMCPError { constructor(message: string, readonly correction: string, details?: Record<string, unknown>) } // code 'NAME_CHECK'
  // tools/handlers/name-check.ts
  export const SCHEMA_CAPTURE_LIMIT_MS = 5000;
  export function ensureSchema(ctx: ToolHandlerContext, database: string, dbConfig: DatabaseConfig): Promise<DatabaseSchema | null>;
  ```

- [ ] **Step 1: Write the failing tests**

- config: `name_check` is missing → `true`; `name_check=false` → `false`; `name_check=maybe` → throws, as other booleans do.
- watch: `it('force runs the fingerprint check inside the 60 s window')`. Call `check` once, advance 1 s, call with `{ force: true }`, and expect `schemaFingerprint` called twice. Force still records the check time.
- SchemaManager: two concurrent `captureSchemaOnce('d', cfg)` calls give one adapter capture and the same resolved schema. After it settles, a new call captures again.
- `ensureSchema` (Jest fake timers):
  - cached → returns it without capturing;
  - capture resolves → returns the schema;
  - capture rejects → returns `null` and logs a warning;
  - capture never resolves → advance 5000 ms → returns `null`, and the pending capture's later rejection doesn't raise an unhandled rejection.
- journal: `journalFailure` with a `NameCheckError` records `outcome: 'blocked'`. `sanitizeError(new NameCheckError('m', 'c'))` returns `'m'` unchanged.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/unit/config-validation.test.ts tests/unit/schema tests/unit/schema-manager.test.ts tests/unit/tools/name-check.test.ts tests/unit/tools/query-journal.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** to the signatures above. `ensureSchema` races `captureSchemaOnce` against a 5000 ms timer, clears the timer when the race settles, and attaches a `.catch` that logs to the losing capture.

- [ ] **Step 4: Run to verify pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit** — `feat: add the name_check option and the plumbing for name checks`

---

### Task 6: Wire both layers into `sql_query` and `sql_analyze_performance`

**Files:**
- Modify: `src/tools/handlers/name-check.ts` (add `preflightNames`, `correctionForError`)
- Modify: `src/tools/handlers/query-handlers.ts` (`handleSqlQuery` about lines 60-153, `handleAnalyzePerformance` about lines 333-401)
- Test: `tests/unit/tools/query-handlers.test.ts`

**Interfaces:**
- Consumes: `checkNames`, `defaultSchemaFor` (Task 4); `formatCorrection`, `classifyNameError` (Tasks 1-2); `ensureSchema`, `NameCheckError`, `check({force})` (Task 5); `scanSql` (Task 3).
- Produces:
  ```ts
  /** null when the query may run; otherwise the problems and any schema changes the forced check found. */
  /** `statement` (0-based batch index) is copied onto each problem before the correction is formatted. */
  export function preflightNames(ctx, database, dbConfig, sql, statement?: number): Promise<{ problems: NameProblem[]; correction: string; schemaChanges: SchemaChange[] } | null>;
  /** '' when the error isn't an unknown-name error or no schema is cached. */
  export function correctionForError(ctx, database, sql, error: unknown): string;
  ```

- [ ] **Step 1: Write the failing tests** in `query-handlers.test.ts`, `describe('name check')`. Give the mock context a real fixture schema (`users`, `orders`):

- `SELECT u.user_name FROM users u`: `executeQuery` is **not** called; `isError` is true; the text contains `Query not run`, `Did you mean: username`, and the `users` column list. The journal (with a fake `paneStore`) records `blocked`.
- The same query with `name_check: false`: `executeQuery` is called.
- Stale guard: the first `checkNames` finds `user_name` missing. `schemaWatch.check` with `{ force: true }` returns a change, and `getSchema` then returns a schema that has `user_name`. The query runs, and the reported schema changes include the forced check's.
- No cached schema: `captureSchemaOnce` (add it to the mock `schemaManager`) is called **before** `executeQuery`.
- Layer 2: `executeQuery` rejects with an error whose `cause` is `{ code: '42703', message: 'column "emial" does not exist' }` (a bare column the scan left unchecked, e.g. inside a CTE). The text contains the sanitized driver error **and then** `Did you mean: email`.
- **Review Focus 1:** a schema with table `token(id, secret)` and query `SELECT t.secrt FROM token t` gives a correction containing `Columns of token` and `secret`, with no `[REDACTED]`.
- `sql_analyze_performance` with `SELECT u.user_name FROM users u`: `analyzePerformance` is not called and the correction is in the text.

- [ ] **Step 2: Run to verify failure.** `npx jest tests/unit/tools/query-handlers.test.ts`. Expected: new tests FAIL.

- [ ] **Step 3: Implement**

In both handlers, after security validation and `schemaWatch.check`:
1. Call `preflightNames`. If it returns a result, merge its `schemaChanges` and throw `NameCheckError(\`it names a column that doesn't exist\`, correction)`.
2. Remove the post-success capture block (`query-handlers.ts:100-110`). `ensureSchema` replaces it.
3. In `catch`: for a `NameCheckError`, the text is ` Query not run on ${database}: ${error.message}\n${error.correction}`. Otherwise, append `correctionForError(...)` after the existing sanitized message. Never pass the correction through `sanitizeMessage`.

`preflightNames` returns `null` when `dbConfig.name_check === false`, when `ensureSchema` gives `null`, or when `checkNames` is empty. Otherwise it runs `schemaWatch.check(db, cfg, { force: true })`, re-reads the schema, and re-checks.

- [ ] **Step 4: Run to verify pass.** Run `npx jest tests/unit/tools`. Expected: PASS, with existing tests unchanged.

- [ ] **Step 5: Commit** — `feat: check column names before running sql_query and analyze`

---

### Task 7: Wire both layers into `sql_batch_query`

**Files:**
- Modify: `src/tools/handlers/query-handlers.ts` (`handleBatchQuery`, about lines 159-325)
- Test: `tests/unit/tools/query-handlers.test.ts`

**Interfaces:**
- Consumes: `preflightNames`, `correctionForError` (Task 6). Batch results' `cause` (Task 1).

- [ ] **Step 1: Write the failing tests**

- A batch `[SELECT id FROM users, SELECT o.totl FROM orders o]`: `executeBatch` not called; the text names `statement 2`; the journal records the offending statement as `blocked`, like the existing security path does with `offending`.
- A batch whose second result failed with `cause` `{ code:'42P01', message:'relation "userz" does not exist' }`: that result's line is followed by `Did you mean: users`.
- With `name_check: false` the batch runs.

- [ ] **Step 2: Run to verify failure.** Run `npx jest tests/unit/tools/query-handlers.test.ts -t batch`. Expected: FAIL.

- [ ] **Step 3: Implement**

Loop `preflightNames(ctx, database, dbConfig, q.query, i)` over the statements after the security loop. On the first result, set `offending` and throw `NameCheckError`. In the results loop, append `correctionForError(ctx, database, queryResult.query, queryResult.cause ?? new Error(queryResult.error))` after the `[ERROR] Failed:` line.

- [ ] **Step 4: Run to verify pass.** Run `npx jest tests/unit/tools`. Expected: PASS.

- [ ] **Step 5: Commit** — `feat: check column names before running a batch`

---

### Task 8: `sql_get_schema` on demand, and docs

**Files:**
- Modify: `src/tools/handlers/schema-handlers.ts:19-39`
- Modify: `src/tools/tool-definitions.ts:14,39` — remove the sentence `IMPORTANT: Always call sql_get_schema for the target database before your first query to learn the correct table and column names.` from the `sql_query` and `sql_batch_query` descriptions (the person's request: the name check makes it redundant). Adjust any test that asserts the old description text.
- Modify: `config.ini.template` (commented `# name_check=true` with a one-line explanation, under `[database.example]`)
- Modify: `docs/api/mcp-tools-reference.md` (`sql_query`, `sql_batch_query`, `sql_analyze_performance`, `sql_get_schema` behavior)
- Modify: `docs/guides/security-guide.md` (or whichever page lists per-connection options; `grep -rn read_only docs` / `select_only`) to document `name_check`
- Test: `tests/unit/tools/schema-handlers.test.ts`

**Interfaces:**
- Consumes: `ensureSchema` (Task 5).

- [ ] **Step 1: Write the failing test.** Replace `'should return message when no schema is available'` with `it('captures the schema when none is cached')`: `getSchema` returns `null`, then the schema; `captureSchemaOnce` is called; the response is the schema text. Keep a case where `ensureSchema` gives `null`. It returns the old message with "Connect first" replaced by `Could not capture the schema for '<db>'`.

- [ ] **Step 2: Run to verify failure.** Run `npx jest tests/unit/tools/schema-handlers.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** Call `ensureSchema` when `getSchema` is `null`. Make the docs edits.

- [ ] **Step 4: Full verification.** Run `npm run validate` (about 2 min). Expected: lint, format, type checks, Jest and the mod's Vitest all pass. Also run `npm run validate-docs`.

- [ ] **Step 5: Commit** — `feat: capture the schema on demand in sql_get_schema`

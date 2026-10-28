# Wrong table and column names: catch them, and help the agent recover

Date: 2026-10-28

## Intent

Argos is mostly used to explore unfamiliar databases, make sense of data for
agents, and debug data. The most common failure: the agent skips
`sql_get_schema`, guesses table or column names, and the query fails. The agent
then guesses again, because nothing in the failure tells it the right names.

The `sql_query` description already says "Always call sql_get_schema first".
Agents ignore it, so wording is not the fix. Argos itself should notice wrong
names and hand back the right ones in the same response, so the next attempt
succeeds without a separate schema call.

### What happens today (verified in the code)

- A failed query returns only the driver's one-line error
  (`src/tools/handlers/query-handlers.ts:143`).
- The schema is cached only **after a successful** query
  (`query-handlers.ts:100`). When the first query against a database fails, the
  usual case here, Argos has nothing to help with.
- `sql_get_schema` on a database with nothing cached replies "No schema
  available… Connect to the database first" (`schema-handlers.ts:29`), so even
  an agent that does ask first can come away empty-handed.
- Adapters wrap driver errors in a new `Error` and keep only the message
  (`src/database/adapters/base.ts:192`, `createError`). The driver's error code
  (Postgres `42703`, MySQL `1054`, and so on) is lost.
- The captured schema covers only Postgres `public`, MSSQL `dbo`, the MySQL
  connection's current database, and SQLite's main database. Tables are keyed by
  bare name (`schema.tables[name]`).

## Goals

1. **Layer 1, the check before running.** Before a query runs, compare its
   column names against the cached schema of the tables Argos knows. If Argos
   is *confident* a column does not exist, don't run the query. Return a short
   correction instead. Layer 1 never blocks on a table name (see "Why layer 1
   ignores table names").
2. **Layer 2, help after a failure.** When the database itself rejects a query
   for an unknown table or column, add the same correction to the error.
3. The correction contains: the wrong name, up to three "did you mean"
   suggestions, and the real columns (with types) of the tables involved,
   capped so wide tables can't flood context.
4. `sql_get_schema` captures the schema on demand instead of replying "connect
   first". *(My call: this is the same root cause, one small change.)*

Example of a blocked query's response (the exact wording is the builder's
call):

```
 Query not run on shop: it names a column that doesn't exist.
 - users.user_name: no such column. Did you mean: username?
 Columns of users: id (integer), username (text), email (text), created_at (timestamp)
 If you believe the schema has changed, run sql_refresh_schema and retry.
```

## Non-goals

- Full SQL validation: types, function names, syntax, permissions.
- Checking statements other than `SELECT`, `WITH … SELECT`, and `EXPLAIN` of
  those in layer 1. Writes on full-access connections (`INSERT`, `UPDATE`, …)
  and metadata commands (`SHOW`, `PRAGMA`, `DESCRIBE`) pass through unchecked.
  Layer 2 still covers them, because it works off the database's own error.
- Queries run from the pane (`pane_query`). The person at the pane is not the
  problem being solved. *(My call.)*
- Capturing schemas beyond what is captured today (other Postgres schemas,
  other MSSQL schemas).
- A new tool. This changes how the existing query tools behave.

## Anti-goals

- **Blocking a valid query.** A false block is worse than a missed one: it
  stops legitimate work, and the agent can't get past it. Whenever the analysis
  is unsure, the query runs as before.
- **Showing data values.** Corrections contain only names and types, never row
  data or sample values.
- **A wall of text.** The correction has to be short enough that it costs less
  context than the guessing it replaces.
- **Hiding the database's own error.** Layer 2 adds to the error and never
  replaces it.

## Behavior

### Which tools

- `sql_query`, `sql_batch_query` and `sql_analyze_performance` (it executes the
  query) get both layers.
- In a batch, layer 1 checks every statement before any of them runs, the same
  way the security validation already does (`query-handlers.ts:181`). One
  confident wrong name blocks the whole batch, and the response names the
  statement by its index.

### Getting the schema

- If no schema is cached for the database, capture it **before** running the
  query, then check. If capture fails, log it and run the query with no check
  (the current behavior).
- That capture has a time limit of about 5 s. If it runs over, the query runs
  unchecked and the capture finishes in the background for later queries.
  *(My call: the first query on a large database must not slow down noticeably
  or hit `query_timeout`. SQLite capture queries each table separately.)*
- `sql_get_schema` does the same capture on demand when nothing is cached.

### Layer 1: when Argos is "confident"

The analysis is deliberately conservative. A table is **known** when it appears
in `FROM` or `JOIN` unqualified, or qualified with the captured default schema
(`public.`, `dbo.`, or the current MySQL database name), is not a CTE name, and
is in the cached tables or views. Layer 1 blocks only these cases:

1. **Unknown qualified column.** `x.col`, where `x` is a table name or alias that
   resolves to a known table and `col` is not one of its columns.
2. **Unknown bare column.** Only in simple queries: a single `SELECT` with no
   subqueries, no CTEs, no derived tables and no table-valued functions in
   `FROM`, where **every** table in scope is known. Only at positions where a
   bare identifier must be a column: a select list item that is just an
   identifier, either side of a comparison in `WHERE`/`ON`/`HAVING`, and bare
   `GROUP BY`/`ORDER BY` items. The identifier has to match no column of any
   table in scope and no select-list alias.

A table that isn't known is never itself a reason to block. It just means its
columns can't be checked.

#### Why layer 1 ignores table names

*(Decided with the person after the review.)* The cached schema is narrower than
what an unqualified name can resolve to:
- Postgres: other schemas on `search_path`, materialized views, foreign tables,
  and catalog views such as `pg_stat_activity`.
- MSSQL: the user's default schema, and synonyms.
- Every engine: temp tables, which look exactly like a misspelled name.

Blocking unknown tables would block valid queries, which is the top anti-goal.
A wrong table name costs nothing to leave to the database: it refuses the query
before doing any work, and layer 2 adds similar table names to the error. The
one thing lost is that a batch with a wrong table name is not stopped before
its earlier statements run.

Never block when any of these appear in a part being checked: names qualified
with any other schema or catalog (`analytics.events`,
`information_schema.columns`, `pg_catalog…`, `sys.objects`, `sqlite_master`),
temp tables, table-valued functions (`generate_series`, `unnest`,
`json_table`, …), `VALUES` lists, `LATERAL`, `NATURAL JOIN`, or anything the
tokenizer can't place with certainty.

Name matching:
- Unquoted identifiers match case-insensitively.
- Quoted identifiers (`"x"`, `` `x` ``, `[x]`) match exactly first, then
  case-insensitively. The check blocks only if neither matches. A case-only
  mismatch can be a real error on Postgres, but the database reports that and
  layer 2 handles it.

**Stale schema guard.** Before every block, run the fingerprint check
regardless of `SchemaWatch`'s 60 s rate limit. Refresh the schema if it
changed, and re-check. Block only if the name is still missing. This needs a
new path past the rate limit. *(My call: with the rate limit, an agent that
runs `ALTER TABLE … ADD COLUMN` and queries the new column within a minute would
be wrongly blocked. The cost is one extra round-trip, and only on a query that
is about to be blocked.)*

**Turning it off.** A per-connection config option, `name_check=true`
(default), with `false` to disable layer 1. Layer 2 is always on. The agent gets
no parameter to skip the check, because agents would use it by reflex. The
block message tells it to run `sql_refresh_schema` if it believes the schema
changed. *(My call.)*

A block is journaled with outcome `blocked` and a reason naming the wrong
identifiers, like other blocks.

### Layer 2: recognizing the database's error

Classify on driver error codes where they exist, and on the message where they
don't:

| Engine     | Unknown column                     | Unknown table                     |
|------------|------------------------------------|-----------------------------------|
| PostgreSQL | `42703`                            | `42P01`                           |
| MySQL      | `1054` `ER_BAD_FIELD_ERROR`        | `1146` `ER_NO_SUCH_TABLE`         |
| MSSQL      | `207` "Invalid column name"        | `208` "Invalid object name"       |
| SQLite     | message `no such column: x`        | message `no such table: x`        |

The adapters' `createError` has to keep the original error (at least as
`cause`) so the code survives. Pull the wrong identifier out of the driver's
message. If that fails, still list the columns of the tables the query names,
with no "did you mean".

The correction is added after the sanitized driver error, in the same format as
layer 1.

### Suggestions and caps

- "Did you mean" ranks candidates by similarity after normalizing (lowercase,
  ignore `_`, singular/plural), e.g. edit distance. Show up to 3, and only ones
  that are reasonably close. No suggestion is better than a wild one.
- For an unknown column, list the columns of the table it was qualified with,
  or of every table in scope when it was bare. For an unknown table, list
  similar table names, not every table.
- Caps: at most 3 tables listed and 40 columns per table. Past those, say how
  many more and point to `sql_get_schema`.

## Constraints

- No new runtime dependency unless the builder finds the hand-rolled analysis
  can't meet the corpus below. In that case, stop and raise it rather than
  quietly adding a SQL parser. *(My call. A full parser such as
  `node-sql-parser` would be more thorough but adds weight and its own dialect
  gaps.)*
- The current security validation stays first and unchanged. The name check
  runs after it.
- The check uses only the cached schema plus at most one fingerprint check and
  refresh. It never runs a query against user tables.
- Node 24.15+, TypeScript 5.9, match the existing code style.
- The `SecurityManager` tokenizer is private and too crude (no comments, no
  dotted names). Write the new analysis as its own module, e.g. under
  `src/schema/`, rather than growing `SecurityManager`.

## Acceptance

- A **must-not-block corpus** per dialect, as unit tests, covering at least:
  CTEs (including recursive), subqueries in every position, derived tables,
  window functions, `CAST(x AS type)` and `::type`, `EXTRACT(epoch FROM …)`,
  `INTERVAL`, date/time keywords (`CURRENT_DATE`, `now()`), JSON operators
  (`->`, `->>`, `#>`), `LATERAL`, `USING`, `NATURAL JOIN`, `VALUES`, quoted
  identifiers, select-list aliases used in `ORDER BY`, cross-schema and system
  catalog tables, unqualified catalog views (`pg_stat_activity`), materialized
  views, temp tables (including MSSQL `#tmp`), table functions, comments
  containing names, and string literals containing names. A query naming a
  table that isn't in the cache is never blocked, whatever its columns.
- A **must-block corpus** for the two confident cases, each with the expected
  suggestion.
- Layer 2 tests per engine using the real error shapes (codes and messages)
  from each driver.
- Batch: one bad statement blocks the batch and the response names its index.
- Stale schema: a column that exists in the database but not in the cache is
  not blocked.
- `sql_get_schema` on an uncached database returns the schema.

## Left to the builder

- Module layout and names, and the exact wording of messages.
- The similarity measure and its threshold.
- How identifiers are pulled out of each driver's message.
- Whether layer 1 and layer 2 share one formatter (they should look the same).

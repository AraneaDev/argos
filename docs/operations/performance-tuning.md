# Performance Tuning

## Where the time actually goes

Argos does very little work of its own. A slow session is nearly always one of
three things, and they are worth separating before changing anything:

1. **The query is slow at the database.** By far the most common. The fix is an
   index or a better query, and it belongs in the database.
2. **The result is large.** Time goes into transferring, redacting and
   formatting rows, and then into the model reading them. The fix is to return
   fewer rows.
3. **The connection is slow to establish.** Usually an SSH tunnel being set up,
   which happens once per database per session.

`sql_analyze_performance` distinguishes the first from the rest: it reports the
execution time, the plan, and advice drawn from the plan.

## The levers Argos has

All of these are in `config.ini`. There is no runtime tuning API and no pool to
size — one session is one process holding at most ten connections per database,
which is not a number worth adjusting for a single conversation.

```ini
[extension]
max_rows=1000          ; cap on rows returned
query_timeout=30000    ; server-side statement timeout, milliseconds

[database.reporting]
cache_ttl_seconds=60   ; per database; how long an identical SELECT stays fresh
```

### max_rows

The most effective single setting. Rows are streamed and counted as they arrive,
so a query matching a million rows never materialises a million rows in memory —
the retained set stops at `max_rows`, and the response reports the true count
with `truncated` set so nothing is silently lost.

Lower it when sessions routinely return large results: everything after the
query — redaction, formatting, and the model's own reading — scales with the row
count.

### query_timeout

Enforced by the database rather than merely abandoned by the client:
`statement_timeout` on PostgreSQL, `max_execution_time` on MySQL
(`max_statement_time` on MariaDB), and an interrupt on SQLite. A runaway query
stops consuming server resources instead of running on unobserved.

Keep it low enough that a mistake is cheap.

### cache_ttl_seconds

Identical `SELECT`s are served from an in-memory cache, per database, capped at
100 entries. Statements that are not `SELECT`, or that contain non-deterministic
constructs, are never cached, and a write to a database drops that database's
entries. The cache lives as long as the session.

`sql_get_metrics` reports `cache.hitRate`. A rate near zero means the workload
does not repeat queries, which is normal for exploratory work and not a problem
to solve.

## Reading the metrics

`sql_get_metrics` gives `latency` as min, max, avg and p95 over the last 1000
queries, plus per-category error counts and circuit-breaker transitions.

- **p95 far above avg** — a minority of queries are much slower. Find them and
  run `sql_analyze_performance` on one.
- **Circuit events** — the database was failing often enough to trip the
  breaker, so queries were rejected without being sent. Look at `errors` for the
  category, and `argos.log` for the driver's message.
- **avg climbing over a session** — usually the database under load rather than
  anything here, since Argos keeps no state that grows.

## Tuning the database

This is where the wins are. The settings below are the database's own and are
unrelated to Argos, but they are what a slow plan usually needs.

### PostgreSQL

```sql
-- Find the expensive statements
SELECT query, calls, mean_exec_time, rows
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;

-- Confirm an index would be used before creating it
EXPLAIN (ANALYZE, BUFFERS) SELECT …;
```

Sequential scans on large tables, and nested loops reporting heavy buffer use,
are what `sql_analyze_performance` flags for PostgreSQL.

### MySQL

```sql
-- Statements worth attention
SELECT digest_text, count_star, avg_timer_wait/1e9 AS avg_ms
FROM performance_schema.events_statements_summary_by_digest
ORDER BY avg_timer_wait DESC
LIMIT 20;
```

Full table scans, filesorts and temporary tables are what the MySQL advice
reports, read from the JSON plan.

### SQLite

`ANALYZE` updates the statistics the planner uses, and is worth running after
bulk changes. Table scans and temporary B-trees are what the SQLite advice
reports.

## Connections and tunnels

An SSH tunnel is established once per database per session and reused. If the
first query of a session is slow but later ones are not, that is the tunnel
being set up, not the query.

Connections are created on demand and kept for the session. There is no pool to
warm and nothing to pre-connect.

## Related

- [Monitoring](./monitoring.md) — what `sql_get_metrics` reports
- [Advanced Performance Tutorial](../tutorials/advanced-04-performance.md) —
  database-side tuning in more depth

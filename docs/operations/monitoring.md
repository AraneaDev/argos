# Argos Monitoring Guide

## What there is to monitor

Argos is not a service. It speaks the Model Context Protocol over stdio, so the
MCP client starts a process when a session begins and it exits when the session
ends. There is no port, no HTTP endpoint and no daemon: nothing to scrape, probe
or load-balance, and no uptime to chart.

That leaves three places to look, all of them local to the machine the client
runs on:

| Source | What it tells you | Where |
|--------|-------------------|-------|
| `sql_get_metrics` tool | Live counters for the current process | Ask the model |
| Server log | What the process did, including failures | `argos.log` |
| Audit log | Which database was queried, when, and whether it worked | `~/.argos/audit/<database>.log` |

## Live metrics

`sql_get_metrics` returns the in-memory counters the process has accumulated
since it started. Pass a `database` to scope it to one, or omit it for all of
them. Because the process is per-session, these reset whenever the client
restarts it — they describe the session, not the installation.

Each entry contains:

| Field | Meaning |
|-------|---------|
| `database` | Which configured database this entry covers |
| `uptime` | Milliseconds since this process started |
| `queries` | `total`, `success` and `failed` counts |
| `latency` | `min`, `max`, `avg`, `p95` and `count` over the last 1000 queries |
| `errors` | Failure counts grouped by category |
| `circuit` | Circuit-breaker transitions, each with a timestamp |
| `cache` | `hits`, `misses` and `hitRate` for the query cache |

The latency window is capped at the most recent 1000 queries, so `p95` describes
recent behaviour rather than the whole session.

Ask for them in conversation:

```
Show me the query metrics for the analytics database.
```

### What the numbers are worth watching for

- **`failed` climbing while `total` does not** — the database is reachable but
  rejecting queries. Look for the reason in `argos.log`.
- **Circuit events appearing** — repeated failures tripped the breaker, and
  queries are being rejected without reaching the database until it closes
  again.
- **`hitRate` near zero** — the cache is doing nothing for this workload, which
  is expected for queries that differ every time.
- **`p95` far above `avg`** — a minority of queries are much slower than the
  rest, usually a missing index. `sql_analyze_performance` will show the plan.

## Server log

The process writes to `argos.log` in its working directory, owner-readable
only, and rotates the previous run to `argos.log.1` on every start. Console
output is off by design: stdout carries the JSON-RPC stream, and writing
anything else there breaks the connection.

```bash
# Follow it during a session
tail -f argos.log

# Failures only
grep -E '\[(ERROR|CRITICAL)\]' argos.log

# What happened during startup, which is where configuration problems surface
head -50 argos.log
```

Secrets are stripped from log messages before they are written: passwords,
tokens, PEM blocks, connection strings, email addresses and database usernames
are replaced with placeholders. A message containing `password=[REDACTED]` is
the redaction working, not a truncated log line.

For the SSH handshake specifically, `SSH_DEBUG=true` adds the ssh2 trace to the
same file, prefixed `[DEBUG]`. It is verbose and off by default.

## Audit log

Every query execution appends one line per database to
`~/.argos/audit/<database>.log`, in a directory created `0700` with files
created `0600`:

```
2026-08-10T17:04:02.111Z  analytics  8f2a1c04  42ms  success
```

The fields are the timestamp, the database, a hash of the normalised statement,
the duration, and the outcome. The SQL itself is deliberately not recorded, so
the file shows what ran and when without becoming a second copy of the data.

The hash is stable across whitespace and case, so the same logical query hashes
the same way and can be counted:

```bash
# Busiest statements for one database
awk '{print $3}' ~/.argos/audit/analytics.log | sort | uniq -c | sort -rn | head

# Failures, with their timestamps
grep -v ' success$' ~/.argos/audit/analytics.log

# Slowest recorded executions
sort -t$'\t' -k4 -rn ~/.argos/audit/analytics.log | head
```

Installations upgraded from a version released before the rebrand will find
their earlier records under `~/.sql-ts/audit`; those files are left where they
are.

## Monitoring the databases themselves

Everything above covers the MCP process. Load, lock contention and slow queries
on the database are the database's own concern, and its native tooling sees far
more than Argos does — `pg_stat_statements` and `pg_stat_activity` for
PostgreSQL, the performance schema and slow query log for MySQL, Query Store for
SQL Server. Argos issues ordinary client connections, so its queries appear
there like any other application's.

## Related

- [Security Hardening](./security-hardening.md) — file modes and what the audit
  log deliberately does not contain
- [Troubleshooting](../guides/troubleshooting-guide.md) — reading the log when
  something has gone wrong
- [Performance Tuning](./performance-tuning.md) — acting on what the metrics show

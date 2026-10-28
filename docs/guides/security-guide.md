# Security Guide

## What protects what

Argos runs with credentials you give it, driven by a model that will send it
whatever the conversation suggests. Every control below exists because the model
is not trusted to restrain itself, and most of them cannot be relaxed from
inside a session.

| Control | Where it lives | Can the model change it? |
|---------|----------------|--------------------------|
| SELECT-only enforcement | `SecurityManager` | No — `config.ini` only |
| Dangerous-construct blocking | `SecurityManager` | No |
| Query complexity limits | `[security]` in `config.ini` | No |
| Field redaction | `RedactionManager` | No |
| TLS certificate verification | adapters | Only ever *on*; off requires editing `config.ini` |
| SSH host-key verification | `EnhancedSSHTunnelManager` | No |
| SQLite path confinement | `SQL_MCP_SQLITE_BASE_DIR` | No |
| Adding a database | MCP tools | Yes, but always read-only |

## SELECT-only mode

With `select_only=true`, a query must satisfy all of the following before it
reaches the driver:

- **The leading command is on the allowlist** — `SELECT`, `WITH`, `SHOW`,
  `EXPLAIN`, `DESCRIBE`, plus the database's own metadata commands, matched
  exactly. A procedure whose name merely contains an allowed word does not pass.
- **There is exactly one statement.** Anything after a `;` that looks like
  another statement is refused, because a driver that executes batches would run
  it.
- **Comments cannot hide any of it.** Comments are stripped by a scanner that
  understands string literals, quoted identifiers and dollar quoting, so a `--`
  inside a string no longer swallows the rest of the line. Block comments end at
  the first `*/` on every engine, because MySQL and SQLite do not nest them.
- **No dangerous construct appears** — `INTO OUTFILE`, `INTO DUMPFILE`,
  `COPY … PROGRAM`, `WAITFOR DELAY`, and function calls such as `LOAD_FILE`,
  `SYSTEM`, `SHELL`, `EXEC`, `BENCHMARK`, `SLEEP`, `pg_read_file`, `pg_ls_dir`,
  `lo_import`, `lo_export`, `pg_sleep` and `dblink`. These are matched as
  function calls with a word boundary, so an ordinary column named
  `description` is not mistaken for `SCRIPT`.
- **It is within the complexity limits** from `[security]`: joins, subqueries,
  unions, group-bys, overall score and raw length.

A rejection comes back as a `SecurityViolationError` naming the reason, so the
model can see why and reformulate rather than retrying blindly.

Write mode (`select_only=false`) still applies the dangerous-construct and
complexity checks. It only stops restricting the leading command.

### The limits of it

This is defence in depth, not a substitute for database permissions. **Give the
account only the rights it needs.** If the account cannot write, no parser bug
can make it write:

```sql
-- PostgreSQL
CREATE USER argos_ro WITH PASSWORD '…';
GRANT CONNECT ON DATABASE app TO argos_ro;
GRANT USAGE ON SCHEMA public TO argos_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO argos_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO argos_ro;
```

```sql
-- MySQL
CREATE USER 'argos_ro'@'%' IDENTIFIED BY '…';
GRANT SELECT ON app.* TO 'argos_ro'@'%';
```

## Parameters

Pass values through `params` rather than building them into the SQL. Each
adapter binds them with its driver's own mechanism, so a value is never parsed
as SQL:

```
Run: SELECT * FROM orders WHERE customer_id = ? AND status = ?
with params [42, 'shipped']
```

SQL Server uses named parameters internally; the `?` placeholders are rewritten
to `@param0`, `@param1` and so on, skipping any `?` inside a string literal or
comment.

## What the model may change

Databases can be added and updated at runtime through the MCP tools, within
limits that the tools enforce and the model cannot lift:

- A database added this way is **always** `select_only=true`. Granting write
  access needs a human editing `config.ini`.
- `select_only` cannot be changed through any tool.
- `ssl_verify` can only ever be set to `true`. Any other value, including the
  string `"false"`, is refused. Disabling verification needs a `config.ini`
  edit.
- File paths for SQLite and SSH keys are rejected if they contain `..` or point
  into `/dev`, `/proc`, `/sys` or `/etc`. Setting `SQL_MCP_SQLITE_BASE_DIR`
  additionally confines them to one directory, which is worth doing wherever the
  model can add databases.

Set `mcp_configurable=false` on a database to keep the tools away from it
entirely.

## Sensitive values

**In results:** configure redaction per database so protected columns never
reach the model. Rules match exactly or by `*` wildcard, follow a column through
an alias (`SELECT email AS e`, `SELECT lower(email) e`), and fail closed — if
redacting a value throws, the field is replaced with `[REDACTION_ERROR]` rather
than passed through. See [Field Redaction](../features/field-redaction.md).

**In errors:** messages are scrubbed before they leave the server. Passwords,
tokens, PEM blocks, connection strings, email addresses and database usernames
are replaced with placeholders, quoted values included.

**In logs:** the same scrubbing applies to log messages. `argos.log` is
written `0600`, and the audit log records a hash of each statement rather than
the statement.

**In config:** `config.ini` holds credentials in the clear. Keep it `0600`; the
server warns on startup if it is group- or world-readable.

## Name check

`name_check` (default `true`) is a per-connection option. Before a SELECT runs,
Argos compares its column names with the cached schema and, when it is sure a
column doesn't exist, returns the correction instead of running the query. It
never runs a query against your tables and never blocks on table names: it
captures the schema when none is cached, and before a block it runs one schema
fingerprint check and, if the schema changed, refreshes the cache. Set
`name_check=false` to turn this off for a connection; the corrections appended
to the database's own unknown-name errors stay on. It is a convenience, not a
security control.

## Connections

Prefer `ssl=true` and leave `ssl_verify` alone — verification is on unless the
configuration explicitly disables it, and an unrecognised value leaves it on
rather than off.

For SSH tunnels, pin the host key:

```ini
ssh_host_fingerprint=SHA256:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU
```

Without a pinned fingerprint the tunnel refuses to connect at all, unless
`ssh_strict_host_key_checking=false` is set deliberately. Private key files must
be `0600`; a key others can read is refused with the file named.

## Reviewing what happened

`~/.argos/audit/<database>.log` records one line per query — timestamp,
database, statement hash, duration, outcome. Blocked queries and their reasons
appear in `argos.log`. Neither contains the SQL itself or any values.

```bash
grep -i "Query blocked" argos.log
grep -v ' success$' ~/.argos/audit/production.log
```

## Related

- [Security Architecture](../architecture/security-architecture.md) — how the
  layers fit together
- [Security Hardening](../operations/security-hardening.md) — database grants,
  network exposure, file modes
- [Field Redaction](../features/field-redaction.md)

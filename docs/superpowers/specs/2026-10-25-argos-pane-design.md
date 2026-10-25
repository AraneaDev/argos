# Argos pane for Claude Code — design

Date: 2026-10-25 · Status: draft for approval

## Intent

Today the only window into a database during a Claude session is what Claude
reports back: a markdown table cut at 20 rows and 50 characters a cell. The
Argos pane is the person's own view beside the chat — the schema of every
configured connection, every query Claude runs with its full result, and a
place to run their own read-only queries — opened with `/argos`, the way
`/knossos` opens the Knossos pane.

It turns Argos from "an MCP server" into "Argos": a database tool with a face
in Claude Code. (The rename itself is a separate project, done first; see
[Sequencing](#sequencing).)

## Goals (v1)

1. A pane, toggled by `/argos`, with four tabs: **Queries**, **Schema**,
   **Editor**, **Connections**.
2. Every query Claude runs through Argos appears in a history feed with its
   full, untruncated result, kept across sessions.
3. The person can type, run, rerun and pin their own queries in the pane —
   always read-only.
4. Results the person ran can be copied (markdown / CSV / JSON) or sent to
   Claude.
5. Claude is told when a connection's schema changed under it.
6. **The pane looks and behaves like the Knossos pane.**

## Non-goals (v1)

- Editing rows or schema from the pane (insert/update/delete, DDL). This is v2.
- A band above the prompt. Dropped for v1 (it would also compete with the
  Knossos and Timestamps bands for the single AbovePrompt slot).
- Detecting migrations from shell commands to force a schema check.
- Background polling of databases.
- Telling Claude about anything the person does in the pane, except when they
  press **send**.

## Anti-goals

- **A pane that does not match Knossos's look.** This is the failure the
  person named. Matching it is an acceptance criterion, not polish.
- The pane showing more than Claude may see: redaction applies to the pane too.
- The pane writing to a database, whatever the connection's `select_only`.
- Large results flooding Claude's context.

## Parts

### 1. Schema-change detection (in the Argos server)

Lives in the MCP server, so it helps users without the pane.

- Each adapter gets a cheap **schema fingerprint** query:
  - SQLite: `PRAGMA schema_version`.
  - SQL Server: `MAX(modify_date)` over `sys.objects` (user objects).
  - PostgreSQL / MySQL: a hash over the catalog's table + column list
    (name, type, nullability) for the configured schema/database.
- `SchemaManager` stores the fingerprint whenever it captures a schema.
- Before running a query from `sql_query`, `sql_batch_query` or
  `sql_analyze_performance`, Argos compares the live fingerprint with the
  stored one — **at most once per 60 s per connection**, on the connection
  already open. No extra connections, no background timer.
- On a mismatch: recapture the schema, diff old vs new (tables added/removed;
  columns added/removed/type-changed), append one line to the tool's text
  result, e.g.
  `Schema changed since last look: orders + shipped_at (timestamptz); legacy_users dropped.`
  and put the structured diff in `_meta` (see the result contract below).
- A first capture (no stored fingerprint) reports nothing.
- A fingerprint query that fails is logged and skipped; it never fails the
  user's query.

### 2. Result spool and query journal (in the Argos server)

The pane needs full results; Claude must not receive them.

- Argos writes every query tool call to a **journal** and the full result to
  a **spool file**, both under the data directory (below):
  - journal entry: id, timestamp, source (`claude` | `pane`), connection,
    SQL, tool, duration, row count, outcome (`ok` | `error` | `blocked`),
    error/blocked reason, schema-change diff if any, spool file reference.
  - spool file: column list with types, all rows — **after redaction**.
- The tool response's `_meta` carries `{ argos: { journalId, spool, schemaChange? } }`
  and nothing heavy. (Whether Claude Code shows `_meta` to the model is
  unknown; keeping it small makes that moot.)
- The spool is bounded: a total-size cap and an age cap, oldest first.
  Pinned queries keep their latest result exempt. The exact caps are the
  builder's call (see below).
- The journal is the history across sessions. A journal entry outlives its
  spool file: an evicted result shows "result no longer kept — rerun".

### 3. The `argos` CLI (new, read-only in v1)

The pane cannot reach the stdio MCP server, so — as with Knossos's `knossos`
binary — it runs a CLI that reads the same `config.ini` and the same data
directory, and goes through the same `SecurityManager`, `RedactionManager`
and audit logger.

Subcommands (JSON on stdout, for the hooks to parse):

- `argos connections` — what `sql_list_databases` knows, structured.
- `argos schema <db> [--refresh]` — tables, views, columns, keys, relations,
  row estimates, last-captured time, and the last schema diff.
- `argos query <db> <sql>` — runs the SQL **forced read-only**
  (`validateSelectOnlyQuery` regardless of the connection's `select_only`),
  journals it with source `pane`, spools the result, prints the journal entry.
- `argos history [--before <id>] [--limit n]` — paged journal.
- `argos result <journalId>` — the spooled result (paged).
- `argos pin <journalId|sql> [--name]`, `argos unpin <id>`, `argos pins`.

Each CLI call opens its own connection. Over an SSH tunnel that may be slow;
**measure it early** (see Risks).

### 4. The mod (Claude Code plugin)

Built the way the Knossos mod is built (`docs/contribute/mod-internals.md` in
Knossos-MCP): one hooks module `hooks/register.tsx`, a `Port` built from `$`
per dispatch, atoms declared in `register.tsx`, effects in `hooks/mod/`, pure
layout and parsing in `hooks/lib/` with vitest specs, a keyed loader so no
read runs inside a render, and a press table for pane actions.

Hooks used:

- `command.run` `argos` — toggle the pane.
- `tool.call` on `mcp__argos__sql_query`, `mcp__argos__sql_batch_query`,
  `mcp__argos__sql_analyze_performance` — after `next(e)`, read
  `_meta.argos` and refresh the feed (new entry selected if the pane is on
  Queries). The mod adds nothing to Claude's context here; the server's own
  text already carries the schema-change line.
- `ui.render` / `ui.focus` / `ui.scroll` for `Pane`.

The MCP tool names depend on the server's registration name, which the
rebrand settles; the mod must take it from config rather than hard-code it.

Install mirrors Knossos: an installer writes the plugin directory, the path
to the `argos` binary, and the **config.ini path / data directory** into the
hooks (hooks cannot see the MCP server's environment), then runs the two
`claude plugin` commands.

### Data directory

Argos reads `config.ini` from its working directory or a passed path. The
journal, spool and pins live in `.argos/` beside that `config.ini`, so each
config has its own history. The existing schema cache stays where it is.

## The pane

Mockups: `.superpowers/brainstorm/*/content/pane-v1.html` (approved tab set).

**Chrome (all tabs).** Header row: `argos` bold, the config location dim, one
chip per connection (coloured by engine), width gauge, and a status pill —
`read-only pane` on Queries/Editor, schema freshness on Schema. Tabs below.
Then the Knossos pattern: a rule, a row of stat cards spanning the width,
sections titled with an icon, bold title, a rule running to a right-aligned
note, and a blank line below the title. Long lists scroll (`j`/`k`, mouse),
with an `N more ↓` line. A key hint footer. Narrow widths collapse two
columns to one, as Knossos does.

**Queries.** Cards: queries (+ this session), pinned, blocked, schema changes,
connections. Left: **Pinned** then **History** (all sessions, newest first),
each row tagged `claude` or `you`, with connection, rows, duration, age;
blocked queries in red with the reason. Right: the selected entry's SQL, a
schema-change warning if it carried one, and the result grid (scrolls;
redacted cells shown as `[redacted]`). Keys: `r` rerun (read-only), `e` open
in Editor, `p` pin/unpin, `c` copy, `s` send to Claude (only on `you` rows —
Claude already has its own results).

**Schema.** Cards for the selected connection: engine/tunnel, tables, views,
columns, changed. Left: tables with row estimates, changed ones marked. Right:
the picked table's columns (PK/FK, type, null, default; new columns marked),
then **Relations** in and out. `tab` cycles connections; `q` opens a
`SELECT … LIMIT` for the table in the Editor; `c` copies DDL; `f` finds.

**Editor.** Connection picker, a text field for SQL, `enter` runs, result
below. Write statements are refused with the security manager's reason. `c`
copy (md/csv/json), `s` send, `p` pin.

**Connections.** One card per connection: name, engine, host, SSH/SSL,
`SELECT_ONLY` or full access, MCP-configurable, schema last captured.

**Send to Claude** inserts into the person's next prompt the SQL, connection
and the result as a markdown table, capped (row count and characters; builder
picks the cap) with "… N more rows" when cut.

**Copy** puts markdown, CSV or JSON on the clipboard (a second press or a
small chooser picks the format — builder's call, matching Knossos's copy).

## Matching Knossos (acceptance)

- Reuse Knossos's palette approach (Claude Code theme keys, not fixed
  colours: `text`, `inactive`, `subtle`, `suggestion`, card titles in Claude's
  orange), its section-title, stat-card, tab, pill, gauge, list-with-marker
  and footer conventions. Port the needed `hooks/lib` modules (e.g.
  `palette`, `chrome`, `cards`, `tiles`, `rows`, `layout`, `pane-list`,
  `gauge`, `table`) rather than reinventing them.
- Same engine-limit discipline: text budget, node and depth caps, held by a
  plugin test at every pane size and with large lists/results.
- Acceptance check: screenshots of each Argos tab beside Knossos's at the same
  width and theme (dark and light) read as one family. The person signs off.

## Constraints

- TypeScript, existing repo conventions (ESM, jest for the server, prettier,
  eslint). The mod's specs may use vitest as Knossos does.
- Nothing the pane runs can write. Forced read-only goes through
  `SecurityManager.validateSelectOnlyQuery`, not a separate parser.
- Redaction and audit logging apply to pane queries exactly as to Claude's.
- No new always-on processes; no polling.

## Risks to check first

1. **Stacking/engine limits**: confirm the pane renders the Knossos-style
   chrome within budget with a wide result grid (many columns, long cells).
2. **CLI latency over SSH**: time `argos schema` / `argos query` cold over a
   tunnel. If it's painful, the fallback is for the mod to keep one `argos`
   process alive for the pane's lifetime (a long-running CLI mode), still
   read-only.
3. **Concurrency**: MCP server and CLI both append to the journal; the format
   must tolerate two writers.

## Left to the builder

- Journal/spool format (JSONL vs SQLite), spool caps, eviction details.
- Exact fingerprint SQL per engine.
- Send-to-Claude cap; copy-format chooser.
- How pins are named/edited.
- Which Knossos `hooks/lib` modules to port vs re-write, as long as the
  result matches.

## Sequencing

1. **Rebrand to Argos** — separate project, brainstormed and done first, so
   the CLI, plugin, `/argos` command and tool names are born under the new
   name. Open question there: the npm name (`argos` is likely taken; maybe a
   scope).
2. Server: fingerprint + schema-change note; journal + spool + `_meta`.
3. `argos` CLI (read-only).
4. Mod: chrome + Connections, then Schema, Queries, Editor.
5. Installer and docs.

## v2 (noted, not designed)

Row and schema editing from the pane on full-access connections; schema
changes made from the pane reported to Claude; optional band; migration
detection.

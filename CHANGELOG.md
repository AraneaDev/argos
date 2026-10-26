# Changelog

All notable changes to the Argos-MCP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [6.0.1](https://github.com/AraneaDev/argos/compare/v6.0.0...v6.0.1) (2026-10-26)


### Refactoring

* remove the MCP envelope types and SQLMCPError.toJSON ([#56](https://github.com/AraneaDev/argos/issues/56)) ([7226bef](https://github.com/AraneaDev/argos/commit/7226bef2a66dc024cb87d972a0b36bc4be4ebf4f))

## [6.0.0](https://github.com/AraneaDev/argos/compare/v5.0.0...v6.0.0) (2026-10-26)


### ⚠ BREAKING CHANGES

* **deps:** Node.js 22 is no longer supported; engines is >=24.15.0.

### Fixes

* **pane:** make CLI output printable, and remove dead code ([#51](https://github.com/AraneaDev/argos/issues/51)) ([932264a](https://github.com/AraneaDev/argos/commit/932264abf06763a93bdceddd86433baf9595ef0b))
* write the server's lines to argos.log, and report failing SQLite statements ([#53](https://github.com/AraneaDev/argos/issues/53)) ([d506877](https://github.com/AraneaDev/argos/commit/d506877a2ef2d713ea897647a3b656fd30d43156))


### Chores

* **deps:** require Node.js 24.15+ and update every dependency ([#50](https://github.com/AraneaDev/argos/issues/50)) ([16aaef8](https://github.com/AraneaDev/argos/commit/16aaef895fa56c26c18021437f9ba795d59d60ac))

## [5.0.0](https://github.com/AraneaDev/argos/compare/v4.1.8...v5.0.0) (2026-10-25)


### ⚠ BREAKING CHANGES

* rebrand to Argos and add a read-only Claude Code pane ([#47](https://github.com/AraneaDev/argos/issues/47))

### Features

* rebrand to Argos and add a read-only Claude Code pane ([#47](https://github.com/AraneaDev/argos/issues/47)) ([896dcbf](https://github.com/AraneaDev/argos/commit/896dcbfdda46d02377b270a95713860ec4ff5ff3))


### Fixes

* ignore release configuration changes ([#43](https://github.com/AraneaDev/argos/issues/43)) ([cfc67e5](https://github.com/AraneaDev/argos/commit/cfc67e50068deaa5332c79a2b810d79d0b6f4c53))

## [4.1.8](https://github.com/AraneaDev/Argos-MCP/compare/v4.1.7...v4.1.8) (2026-09-16)


### Tests

* harden resilience coverage ([#39](https://github.com/AraneaDev/Argos-MCP/issues/39)) ([4962434](https://github.com/AraneaDev/Argos-MCP/commit/4962434bf7f23e927bf6e24796fa53aaa7d5d79d))

## [4.1.7](https://github.com/AraneaDev/Argos-MCP/compare/v4.1.6...v4.1.7) (2026-09-16)


### Continuous integration

* **release:** allow Release Please to be run by hand ([#37](https://github.com/AraneaDev/Argos-MCP/issues/37)) ([a97a0a7](https://github.com/AraneaDev/Argos-MCP/commit/a97a0a7113e4f065dcb8435ce61928daa7866ea5))

## [4.1.6](https://github.com/AraneaDev/Argos-MCP/compare/v4.1.5...v4.1.6) (2026-09-16)


### Continuous integration

* **pr-title:** check out the base branch, not the pull request's pinned base commit ([#35](https://github.com/AraneaDev/Argos-MCP/issues/35)) ([a4f50df](https://github.com/AraneaDev/Argos-MCP/commit/a4f50df1ffe7d01367ab76f2550721bb50fcf7e4))

## [4.1.5](https://github.com/AraneaDev/Argos-MCP/compare/v4.1.4...v4.1.5) (2026-09-16)


### Continuous integration

* **pr-title:** share one commit-style rule between CI and the hook ([#33](https://github.com/AraneaDev/Argos-MCP/issues/33)) ([0c91f73](https://github.com/AraneaDev/Argos-MCP/commit/0c91f736c116756c7338b2f6322d232d8dc63344))

## [4.1.4](https://github.com/AraneaDev/Argos-MCP/compare/v4.1.3...v4.1.4) (2026-09-15)


### Documentation

* **readme:** credit the author and link the write-up ([#31](https://github.com/AraneaDev/Argos-MCP/issues/31)) ([f472a05](https://github.com/AraneaDev/Argos-MCP/commit/f472a052284530fb2c637f094032e7472c54fce5))

## [4.1.3](https://github.com/AraneaDev/Argos-MCP/compare/v4.1.2...v4.1.3) (2026-09-08)


### Continuous integration

* scope the concurrency group to the pull request, not the base branch ([#29](https://github.com/AraneaDev/Argos-MCP/issues/29)) ([ae590a1](https://github.com/AraneaDev/Argos-MCP/commit/ae590a1ac2cc69575dfcb3d95fe35806f342b348))

## [4.1.2](https://github.com/AraneaDev/Argos-MCP/compare/v4.1.1...v4.1.2) (2026-09-08)


### Continuous integration

* cancel superseded runs and give every job a timeout ([#27](https://github.com/AraneaDev/Argos-MCP/issues/27)) ([c6af59f](https://github.com/AraneaDev/Argos-MCP/commit/c6af59f9a8b266e44182657b6946bcad6a2193b0))

## [4.1.1](https://github.com/AraneaDev/Argos-MCP/compare/v4.1.0...v4.1.1) (2026-09-07)


### Fixes

* **mssql:** accept azure-cli databases in the adapter factory ([#25](https://github.com/AraneaDev/Argos-MCP/issues/25)) ([9c1468c](https://github.com/AraneaDev/Argos-MCP/commit/9c1468cc48c470d1d82ee6e669fdfd2f5d95bc34))

## [4.1.0](https://github.com/AraneaDev/Argos-MCP/compare/v4.0.0...v4.1.0) (2026-09-05)


### Features

* **mssql:** authenticate with the signed-in Azure CLI identity ([#17](https://github.com/AraneaDev/Argos-MCP/issues/17)) ([00a4f80](https://github.com/AraneaDev/Argos-MCP/commit/00a4f806de2b22e501c14cb66a5490adeb4026a3))
* **mssql:** choose the tenant for Azure CLI authentication ([#24](https://github.com/AraneaDev/Argos-MCP/issues/24)) ([509c3c4](https://github.com/AraneaDev/Argos-MCP/commit/509c3c4650fb0da4d7a3959cb2645d89e4bfc3b8))


### Fixes

* **examples:** repair the adapter template and check it in CI ([#22](https://github.com/AraneaDev/Argos-MCP/issues/22)) ([eacf83b](https://github.com/AraneaDev/Argos-MCP/commit/eacf83b87da89342c4cb2e65094782b0331afc3c))


### Documentation

* adopt the house README style, upload coverage to Codecov ([a856626](https://github.com/AraneaDev/Argos-MCP/commit/a85662642d29811c3412c86e3cced75ec9b89f1c))
* adopt the house README style, upload coverage to Codecov ([6c23020](https://github.com/AraneaDev/Argos-MCP/commit/6c2302071e6a121a48b89759436bda62917a797f))
* link the project site from the readme ([#16](https://github.com/AraneaDev/Argos-MCP/issues/16)) ([a816bd6](https://github.com/AraneaDev/Argos-MCP/commit/a816bd67f0c31dca0f8ce2055a3990413e7e66a0))
* link the README to the project page ([27cae43](https://github.com/AraneaDev/Argos-MCP/commit/27cae4381b68a372aeb35c8051c73cb63f954568))
* normalise the badge row, self-host the coverage badge ([f9b605c](https://github.com/AraneaDev/Argos-MCP/commit/f9b605c682f556079eb2a129a48cafb664ce2e4e))
* normalise the badge row, self-host the coverage badge ([acf89b9](https://github.com/AraneaDev/Argos-MCP/commit/acf89b97d7cfbf6039059fe06bf16f9060d0abe2))
* point the badge at the renamed /tools section ([684c06b](https://github.com/AraneaDev/Argos-MCP/commit/684c06b46532c12eb8bfa75c0124645de1da659b))


### Tests

* close the mutation gaps in the new auth validation ([#23](https://github.com/AraneaDev/Argos-MCP/issues/23)) ([86989c1](https://github.com/AraneaDev/Argos-MCP/commit/86989c1ee8710e14b3158ee319cefc0c4245392e))
* type-check the test suite, which nothing was checking ([#19](https://github.com/AraneaDev/Argos-MCP/issues/19)) ([b5d88e6](https://github.com/AraneaDev/Argos-MCP/commit/b5d88e68d1d67c8463c48632b081c339238231ce))


### Continuous integration

* keep the Release PR runnable and widen the changelog ([#18](https://github.com/AraneaDev/Argos-MCP/issues/18)) ([6a0f760](https://github.com/AraneaDev/Argos-MCP/commit/6a0f7608a5a7287e3b7300d710c54d2b906cbc97))
* move off the actions still running on Node 20 ([#15](https://github.com/AraneaDev/Argos-MCP/issues/15)) ([0d4b6fc](https://github.com/AraneaDev/Argos-MCP/commit/0d4b6fc9249e6c8eb18e345b5c2217c288d32ab0))
* roll the architecture gate forward to Knossos v0.10.5 ([#10](https://github.com/AraneaDev/Argos-MCP/issues/10)) ([85da547](https://github.com/AraneaDev/Argos-MCP/commit/85da547a99900f00408c5b338a933ec62c3cd983))
* scan only this repository, and keep the restored cache writable ([#9](https://github.com/AraneaDev/Argos-MCP/issues/9)) ([b16ed3e](https://github.com/AraneaDev/Argos-MCP/commit/b16ed3e09ce4f2d3a08e833c6ca2eee0ac312c86))

## [4.0.0](https://github.com/AraneaDev/Argos-MCP/compare/v3.0.1...v4.0.0) (2026-08-10)


### ⚠ BREAKING CHANGES

* close SELECT-only and TLS bypasses, fail secure on unreadable config ([#7](https://github.com/AraneaDev/Argos-MCP/issues/7))

  **Unreadable booleans in `config.ini` now fail at startup.** Only
  `true/1/yes/on/enabled` and `false/0/no/off/disabled` are accepted; anything
  else raises a `ConfigValidationError` naming the database and the field.
  Previously an unrecognised value was read as `false`, which put it on the
  dangerous side of three security settings: `select_only = yes` granted write
  access, `ssl_verify = yes` disabled certificate checking, and
  `ssh_strict_host_key_checking = yes` disabled host-key checking. Check your
  `config.ini` before upgrading. Configurations written by `npm run setup` or
  copied from the template only ever contain `true`/`false` and are unaffected.

  **Audit records moved** from `~/.sql-ts/audit` to `~/.argos-mcp/audit`.
  Existing files are left in place rather than relocated; move or archive them
  yourself if you need one continuous history.

  **`ssl_verify` in the `add_database` and `update_database` tools accepts only
  a literal `true`,** and any other value is now rejected with an error. The
  guard previously tested `=== false`, so the JSON string `"false"`, the number
  `0` and `"no"` all passed it, were stored, and then disabled certificate
  verification once an adapter coerced them. Turning verification off is a
  deliberate change to make in `config.ini`, not something a tool call should be
  able to do.

### Bug Fixes

* close SELECT-only and TLS bypasses, fail secure on unreadable config ([#7](https://github.com/AraneaDev/Argos-MCP/issues/7)) ([8a0e085](https://github.com/AraneaDev/Argos-MCP/commit/8a0e085facdfec3815ac2bb493f2f6a17bce7ef7))

## [3.0.1](https://github.com/AraneaDev/Argos-MCP/compare/v3.0.0...v3.0.1) (2026-08-09)


### Bug Fixes

* **performance:** stop discarding MySQL EXPLAIN columns ([#5](https://github.com/AraneaDev/Argos-MCP/issues/5)) ([65e234f](https://github.com/AraneaDev/Argos-MCP/commit/65e234f82465f47ff582cfe94c738dd859b979b9))

## [Unreleased]

## [3.0.0](https://github.com/AraneaDev/Argos-MCP/compare/v2.7.2...v3.0.0) (2026-08-09)

### ⚠ BREAKING CHANGES

* package renamed sql-access -> argos-mcp; binaries renamed mcp-sql-server -> argos-mcp and mcp-sql-setup -> argos-setup; the mcp-sql-install binary is removed; Claude Desktop is no longer supported; the log file is now argos-mcp.log. Re-register the server with `claude mcp add argos --scope user -- node <path>/dist/index.js --config <path>/config.ini`.

### Features

* rebrand to Argos-MCP and adopt native Claude Code registration ([e51fde6](https://github.com/AraneaDev/Argos-MCP/commit/e51fde6f858f566c80043211b7091406259f314b))

### Detail

Rebrand to **Argos-MCP**, and a move from a bespoke installer to Claude Code's
native MCP registration. Named for Argos Panoptes, the hundred-eyed giant — one
server watching many databases at once. Joins Chaos-MCP and Knossos-MCP under
the same naming scheme.

The full suite (1340 tests) passes, `lint:check`, `format:check`, `type-check`
and `validate-docs` are clean.

### Changed — BREAKING
- **Package renamed** from `sql-access` to `argos-mcp`. The MCP server
  identifier (`SERVER_NAME`) is now `argos-mcp`.
- **Binaries renamed:** `mcp-sql-server` → `argos-mcp`, `mcp-sql-setup` →
  `argos-setup`. Re-register the server after upgrading.
- **Registration is now `claude mcp add`.** Claude Code owns its MCP registry;
  the server is added with
  `claude mcp add argos --scope user -- node <path>/dist/index.js --config <path>/config.ini`.
- **Log file renamed** from `sql-mcp-server.log` to `argos-mcp.log`.
- Repository moved to `AraneaDev/Argos-MCP`.

MCP tool names are deliberately unchanged — `sql_query`, `sql_get_schema`,
`sql_add_database` and the rest keep their names, so only the namespace shifts
(`mcp__sql-access__sql_query` → `mcp__argos__sql_query`).

### Removed — BREAKING
- **`src/install.ts` and the `mcp-sql-install` binary.** The hand-rolled
  installer edited `~/.claude.json` and `claude_desktop_config.json` as raw
  JSON, duplicating what the Claude Code CLI does natively and drifting from it.
- **Claude Desktop support.** All `claude_desktop_config.json` handling, example
  configs, and integration docs are gone; Claude Code is the only documented
  client.
- **`scripts/bump-version.sh`**, superseded by release-please.
- Documentation references to commands that never existed as bin entries
  (`sql-test-connections`, `sql-validate-config`, `sql-generate-schema`,
  `sql-benchmark`, `argos-start`, `argos-test`). Connection testing, schema
  inspection, and performance analysis are MCP tools, not shell commands.

### Added
- **release-please** (`release-please-config.json`,
  `.release-please-manifest.json`, `.github/workflows/release-please.yml`).
  Releases are cut from Conventional Commits; version references in
  `src/types/index.ts`, `README.md`, `docs/api/typescript-api.md` and
  `docs/tutorials/01-installation.md` are rewritten automatically.
- **`.github/workflows/pr-title.yml`** — rejects pull request titles that are
  not Conventional Commits. A squash merge takes the PR title as the commit
  subject, so an unclassifiable title silently skips a release.
- **Rebuilt CI** (`.github/workflows/ci.yml`): lint/format/typecheck report
  independently rather than short-circuiting, tests run on Node 20/22/24, and
  the build job asserts both bin targets exist and runs `validate-docs`.
- **Proper git hooks.** `pre-commit` refuses commits on `main`/`master`, blocks
  staged credential files (`config.ini`, `*.pem`, SSH keys) and content
  containing `BEGIN ... PRIVATE KEY`, then runs `lint-staged`. `commit-msg`
  enforces Conventional Commits. `pre-push` runs the full `validate` gate.
- **`CONTRIBUTING.md`** documenting the commit format, hooks, and release flow.
- `repository`, `homepage`, and `bugs` fields in `package.json`.

## [2.7.2] - 2026-07-07

Tooling and supply-chain follow-up to the 2.7.1 release, which failed CI on an
unformatted diff. No runtime/behaviour changes; the full unit suite (1340 tests)
passes and `npm audit` reports 0 vulnerabilities.

### Fixed
- Reformatted `src/database/adapters/mysql.ts` and
  `tests/unit/security-manager.test.ts` with Prettier so `format:check`
  (and the release pipeline) passes.

### Security
- Bumped the `esbuild` dev dependency to `0.28.1`, clearing the dev-server
  arbitrary-file-read advisory (GHSA-g7r4-m6w7-qqqr).
- Added a `qs` override (`^6.15.2`) to lift the transitive dev-only copy pulled
  in via `@stryker-mutator/core` past the `qs.stringify` DoS
  (GHSA-q8mj-m7cp-5q26).

### Added
- Husky + lint-staged pre-commit hook that runs Prettier on staged
  `src`/`tests` TypeScript and ESLint `--fix` on staged `src`, so unformatted
  code can no longer reach CI. Installs automatically via the `prepare` script.

## [2.7.1] - 2026-07-07

Follow-up remediation of audit findings C1, H1–H6, and M4, with the full unit
suite (1340 tests) passing.

### Security
- **C1**: `SecurityManager` now matches database-specific metadata commands by
  exact name instead of substring, and no longer early-returns them past the
  write-keyword and dangerous-pattern scans. A stored proc whose name merely
  contains an allowed fragment (e.g. `sp_helpdesk_reset` containing `sp_help`)
  can no longer bypass validation.
- **H1**: Config-mutating tools validate all inputs before touching the live
  config object, so a validation failure can no longer leave the in-memory
  config poisoned (pointing at a traversal path or invalid value) until restart.
- **H5**: Extended the cache mutation regex (`MERGE`, `UPSERT`, `GRANT`,
  `REVOKE`, `ATTACH`, `DETACH`, `VACUUM`, `REINDEX`, `COPY`) so these no longer
  leave cached SELECT results stale, and blocked `COPY` (a PostgreSQL server-side
  file-I/O / `FROM PROGRAM` RCE primitive) even in full-access mode.

### Fixed
- **H2**: Unregistering a database now invalidates its query cache, so stale
  results from the old config/host are not served after an update or removal.
- **H3**: Connection pools are now captured before the close loop, so
  `destroyPool()` actually runs on shutdown instead of iterating an
  already-emptied map and leaking pools/TCP connections.
- **H4**: The MySQL adapter inspects the underlying socket state to detect dead
  connections (`typeof execute === 'function'` stayed true on a closed socket),
  so `getConnection` transparently recreates them.
- **H6**: A failed query inside a transaction now rolls back, stops, and returns
  the partial per-query results (consistent with non-transaction mode) instead
  of throwing and discarding the breakdown.
- **M4**: `SchemaManager` keys cached schemas by the original database name
  stored in the schema JSON rather than the sanitized filename, so a database
  named e.g. `db/prod` is found after a restart.

## [2.7.0] - 2026-07-05

Follow-up security audit of v2.6.3 (see `SECURITY-AUDIT.md`): 24 findings remediated
(1 critical, 3 high, 8 medium, plus low/info), with real-database verification of the
streaming and timeout work.

### Security
- Fixed a **critical** SELECT-only bypass on PostgreSQL: the validator stripped `#` line
  comments for all engines (a MySQL-only rule), hiding a stacked `; DROP …` that pg's simple
  query protocol then executed. `#` is now only treated as a comment for MySQL/MariaDB.
- Blocked additional MSSQL write/admin statement verbs (`UPDATETEXT`, `WRITETEXT`, `DBCC`,
  `KILL`, `RECONFIGURE`, `CHECKPOINT`, `SHUTDOWN`, `WAITFOR`, `OPENROWSET`, …) that could ride
  after a leading `SELECT` via T-SQL's optional semicolons.
- Schema/connection tools (`sql_test_connection`, `sql_get_schema`, `sql_refresh_schema`,
  `sql_list_databases`) now sanitize driver errors before returning them, so DB usernames and
  internal host/IP details no longer reach the client.
- Field redaction resolves aliased/expression columns to their source column, so
  `SELECT ssn AS x` can no longer bypass a redaction rule; `sql_get_config` no longer discloses
  the redaction ruleset.
- Error sanitizer now masks email addresses, internal `host:port`, and DB usernames.
- Standalone `ANALYZE` is no longer allowed on PostgreSQL in SELECT-only mode.
- SELECT-only SQLite databases are opened read-only; an optional `SQL_MCP_SQLITE_BASE_DIR`
  rooted allowlist constrains model-supplied file/key paths.
- `ssl_verify=false` is rejected from the MCP config tools (disabling TLS verification requires
  a manual `config.ini` edit).
- Hardened logging: log/audit files created `0600` (and tightened on pre-existing files),
  tool-call query text/params and secret-shaped strings scrubbed before writing.
- Config-mutating MCP tools are serialized with a mutex; `config.ini` is written atomically
  via a unique temp filename.
- Removed the stray `peerDependencies.node` entry that caused npm to install a userland `node`
  package with a network-fetching preinstall script.

### Added
- Server-side statement timeouts: MySQL sets `SET SESSION max_execution_time`
  (`max_statement_time` fallback on MariaDB); SQLite calls `db.interrupt()` on the query
  timeout to abort a runaway statement instead of only abandoning it client-side.
- Pre-materialization row bounding: MySQL and SQLite stream results and retain only `max_rows`,
  so a large result set no longer fully materializes in the Node heap; the true `rowCount` and
  a `truncated` flag are still reported.
- Live-database integration tests (`tests/integration/live-adapters.test.ts`, env-gated) and a
  real-DB SQLite verification script (`scripts/verify-sqlite-streaming.cjs`).

### Fixed
- **SQLite and MSSQL adapters crashed on connect under the ESM build** — `sqlite3`/`mssql` are
  CommonJS modules whose value exports (`Database`, `ConnectionPool`) are reachable only via
  `.default` under Node ESM, so `import * as x; x.Foo` was `undefined`. Two of the four database
  backends were non-functional in the production build; fixed by resolving the CJS `.default`.
- MSSQL positional-placeholder (`?` → `@paramN`) conversion now correctly handles `''`/`""`
  escaped quotes and `[…]` bracket identifiers, so a literal `?` inside a string/identifier no
  longer shifts parameter numbering.

## [2.6.3] - 2026-07-04

### Changed
- `bump-version.sh` now promotes the `## [Unreleased]` CHANGELOG section to the released version, syncs version references in `docs/api/typescript-api.md` and `docs/tutorials/01-installation.md`, and refuses to release when the `[Unreleased]` section is missing or empty

### Fixed
- Backfilled missing CHANGELOG entries (2.4.4 through 2.6.2) and corrected stale version references in the TypeScript API and installation docs

## [2.6.2] - 2026-07-04

### Changed
- Applied Prettier formatting to satisfy the `format:check` CI gate

### Removed
- Stopped tracking `CLAUDE.md` in git and added it to `.gitignore`

## [2.6.1] - 2026-07-04

### Changed
- Hardened `utils` unit tests to a 100% mutation score (via chaos-mcp)

## [2.6.0] - 2026-07-04

Remediation of security audit findings (3 critical, 8 high, 6 medium, 3 low from `SECURITY-AUDIT.md`).

### Added
- SSH remote host key verification with fingerprint pinning (fails closed)

### Changed
- SELECT-only enforcement now also guards `sql_analyze_performance` and rejects data-modifying CTEs, `EXPLAIN ANALYZE`, `COPY ... PROGRAM`, stacked statements, and embedded write keywords (leading-token check)
- Fail-secure config defaults: `select_only` defaults to `true`, `ssl_verify` preserves `undefined` so TLS cert validation stays on, and MCP-added databases are always read-only
- SSH hardening: dropped SHA-1 KEX/HMAC, gated debug trace behind `SSH_DEBUG`, warn on non-loopback bind
- Honor configured `max_rows`; added PostgreSQL `statement_timeout`; wrapped batch/analyze in the query timeout; MSSQL placeholder replacement now skips string literals

### Fixed
- Redact secret fields before logging tool args; log/config files written `0600`; non-destructive, size-capped log rotation; atomic config writes
- Client-facing errors routed through `sanitizeMessage` (bearer tokens, passphrases, PEM); redaction now fails closed

### Security
- `npm audit fix` (6 of 7 advisories); documented the HTTP-transport auth caveat

## [2.5.3] - 2026-05-25

### Changed
- Extracted adapter construction into a dedicated `AdapterFactory` with logic and security refinements for database adapters and sanitization

## [2.5.2] - 2026-05-25

### Added
- CI now packages release assets as both `.zip` and `.tgz`
- CLAUDE.md project guidelines

### Changed
- Unified config loading and fixed runtime field redaction
- Default `ssl_verify` to `true` when SSL is enabled, extended to MSSQL
- Enforce `query_timeout` via `Promise.race`
- Unified path validation across config handlers; validate config in `handleUpdateDatabase`
- Renamed repository references and URLs to `argos-mcp`

### Fixed
- `sql_test_connection` now reports the actual connection status

### Security
- Sanitize database names in schema file paths; set restrictive (`0600`) permissions on schema files

## [2.5.1] - 2026-04-06

### Added
- Audit logging of config changes made via MCP tools

### Security
- Validate queries even when `select_only` is false
- Block `select_only` changes via MCP tools
- Block MySQL version-conditional comment bypass
- Validate database names to prevent INI injection
- Validate config in `handleAddDatabase`
- Validate SQLite file paths against traversal

### Fixed
- Resolved lint warnings and a flaky backoff test
- Ensure bin files are executable after build

## [2.5.0] - 2026-04-06

### Added
- **Circuit Breaker** - Automatic failure detection with open/half-open/closed state machine and `CircuitOpenError`
- **Query Cache** - TTL-LRU cache with per-database partitioning and automatic mutation invalidation
- **MetricsManager** - Per-database latency, error rate, circuit breaker, and cache hit/miss tracking
- **`sql_get_metrics` Tool** - New MCP tool exposing in-memory performance metrics
- **Audit Logger** - Structured audit logging with `audit_log` and `cache_ttl_seconds` config fields
- **Database Config Validation** - `validateDatabaseConfig` with host, port, and database name checks
- **SSH Key Permission Checks** - Validates private key file permissions before loading
- **Connection Pooling** - PostgreSQL pooling via `pg.Pool` and MySQL pooling via `mysql2 createPool`
- **Configurable SSH Bind Address** - New `ssh_local_host` option for SSH tunnel bind address

### Changed
- Circuit breaker, query cache, and metrics integrated into `ConnectionManager.executeQuery` pipeline
- `MetricsManager` and `QueryCache` instantiated in `SQLMCPServer` and wired into `ConnectionManager`
- Replaced non-null assertions and type assertions in adapters with typed local consts

### Fixed
- Unsafe internal property access in `isConnected` checks replaced with safe alternatives
- Swallowed errors in SSH port suggestion fallback now logged
- Flaky timing assertion in connection-manager test converted to fake timers

### Security
- Block `EXEC`/`CALL`/stored procedure execution in non-SELECT mode
- Warn when `config.ini` is group- or world-readable

### Testing
- New test coverage for circuit breaker, query cache, schema race conditions, and SSH tunnels

## [2.4.4] - 2026-04-05

### Fixed
- Documentation: corrected version references and class names, and updated the bump script

## [2.4.3] - 2026-04-05

### Added
- 10 new test files covering tools/handlers, utils, types, and adapter factory
- GitHub Actions CI workflow with lint, format, type-check, and test matrix (Node 18/20/22)
- Prettier code formatting with `.prettierrc.json` and `.prettierignore`

### Changed
- Expanded 12 existing test files with error path, edge case, and branch coverage
- Raised Jest coverage thresholds to industry standards: 80% statements/lines/functions, 70% branches
- Total test count: 416 → 1101 tests across 21 suites

### Fixed
- Redaction manager test describe block structure (premature closure)
- Logger test url mock for SWC CJS transform compatibility (`pathToFileURL`)
- Connection manager SQLite+ssh_host test missing required `ssh_password` field
- Timing-sensitive exponential backoff test tolerance

## [2.4.2] - 2026-03-28

### Changed
- Migrated repository URLs from Forgejo to GitHub
- Full spectrum audit: deduplication, type safety improvements, security hardening, and tooling updates
- Switched test transform from ts-jest to @swc/jest for native ESM/import.meta support
- Removed dead `getSafeString/Number/Boolean` test cases referencing removed base adapter methods

### Fixed
- Resolved all 10 failing test suites caused by ts-jest ESM compilation errors with `import.meta.url`
- All 11 test suites now pass (416 tests)

## [2.4.1] - 2026-03-22

### Fixed
- Resolved log and schema file paths to project root instead of current working directory
- Fixed stdout contamination and config path failures causing random MCP connection drops

## [2.4.0] - 2026-03-14

### Added
- Retry logic for transient connection failures (ECONNREFUSED, ETIMEDOUT, etc.) with exponential backoff
- 10-second shutdown timeout to prevent hanging on disconnect
- ESLint JSDoc plugin enforcing documentation on public API surface
- `@typescript-eslint/recommended` ruleset with strict type checking
- `eqeqeq` and `no-throw-literal` lint rules
- Per-connection and per-tunnel 5-second timeouts during cleanup

### Changed
- **Breaking up the god class**: Extracted SQLMCPServer (1,637 lines) into focused modules:
  - `src/tools/tool-definitions.ts` - MCP tool JSON schemas
  - `src/tools/dispatcher.ts` - Tool call routing
  - `src/tools/handlers/query-handlers.ts` - Query, batch, and performance tools
  - `src/tools/handlers/schema-handlers.ts` - Schema, list, test, and refresh tools
  - `src/tools/handlers/config-handlers.ts` - Database CRUD and config tools
  - `src/utils/response-formatter.ts` - Table and summary formatting
- SQLMCPServer reduced to ~330 lines (lifecycle + config parsing only)
- `closeAllConnections()` and `closeAllTunnels()` now use `Promise.allSettled` instead of `Promise.all`
- Uncaught exception/rejection handlers now route through `gracefulShutdown()` instead of `process.exit(1)`
- Replaced all `any` types with proper types across the codebase (0 ESLint warnings)

### Fixed
- Duplicate `process.on('exit')` and `process.on('SIGINT')` handlers in EnhancedSSHTunnelManager competing with main shutdown handler
- Async cleanup in sync `process.on('exit')` handler that could never complete
- `server.cleanup()` hanging forever if a connection/tunnel refused to close
- Schema manager tests updated to match compact schema output format
- Integration test compilation errors restored
- Strict equality violation in RedactionManager

### Removed
- Dead `SSHTunnelManager.ts` (512 lines) - never imported by production code, registered competing signal handlers
- Unused imports: `createHash`, `RedactionType`, `FieldPatternType`, `isValidFieldPatternType`

## [2.3.1] - 2026-03-11

### Changed
- **`sql_get_schema` Compact Output** - Schema output now adapts based on size: large schemas (>200 columns) show a compact summary with table names, column counts, and key columns; small schemas show full inline column details. This prevents output from exceeding MCP token limits on large databases.

## [2.3.0] - 2026-03-10

### Added
- **Dynamic Database Management via MCP** - Add, update, and remove database configurations at runtime using MCP tools
- **`sql_add_database` Tool** - Add new databases via MCP with automatic `mcp_configurable=true` and `select_only=true` defaults
- **`sql_update_database` Tool** - Modify database settings (host, port, credentials, SSL, SSH) via MCP for configurable databases
- **`sql_remove_database` Tool** - Remove databases via MCP, including disconnection and SSH tunnel cleanup
- **`sql_get_config` Tool** - View database configuration with automatic password/credential redaction
- **`sql_set_mcp_configurable` Tool** - One-way lock mechanism to prevent MCP configuration changes (unlocking requires manual config edit)
- **`mcp_configurable` Configuration Flag** - Per-database flag controlling whether MCP tools can modify the database settings
- **`argos-install` CLI Installer** - Automatic installer that configures Claude Code and Claude Desktop MCP integration
- **Platform Detection** - Installer auto-detects macOS, Windows, and Linux config file locations
- **Default Config Location** - New default config path at `~/.config/argos/config.ini` for installed usage

### Changed
- **`DatabaseConfig` Interface** - Added `mcp_configurable?: boolean` field
- **`DatabaseListItem` Interface** - Added `mcp_configurable: boolean` field
- **`sql_list_databases` Output** - Now shows MCP configurable status for each database
- **Config Persistence** - `saveConfigFile()` now writes `mcp_configurable` flag
- **`SQLMCPServer`** - Stores config file path as instance variable for runtime config persistence
- **`ConnectionManager`** - `createDatabaseListItems()` includes `mcp_configurable` in output
- **`package.json`** - Added `argos-install` bin entry and `install-mcp` npm script
- **esbuild Config** - Updated to bundle `install.ts` entry point
- **Documentation** - Comprehensive updates across README, API reference, configuration guide, installation guide, tutorials, and architecture docs

### Security
- **One-Way Lock Design** - `sql_set_mcp_configurable` can only lock (set to false), preventing AI from re-enabling its own config access
- **Credential Redaction** - `sql_get_config` always redacts passwords, SSH keys, and passphrases
- **Safe Defaults** - Manually-configured databases default to `mcp_configurable=false`; MCP-created databases default to `select_only=true`
- **Config Mutation Logging** - All configuration changes via MCP are logged

### Testing
- **456 tests passing** (up from 437)
- **Test fixture updates** - Updated `DatabaseListItem` test fixtures for `mcp_configurable` field

### Breaking Changes
- **None** - This release is fully backward compatible with v2.2.x. Existing databases without `mcp_configurable` default to `false` (locked).

### Migration Guide
No migration required. Existing configurations work without changes. To enable MCP configuration for existing databases, add `mcp_configurable=true` to the desired `[database.*]` sections in config.ini.

## [2.2.0] - 2026-02-23

### Added
- **Field Redaction Implementation** - Automatic masking/replacement of sensitive data in query results
- **Configurable Redaction Rules** - Support for exact match, wildcard, and regex patterns for field matching
- **Multiple Redaction Patterns** - Full masking, partial masking, and custom replacement text options
- **Security-Enhanced Query Results** - Automatic protection of sensitive fields without application changes
- **RedactionManager Class** - Dedicated redaction engine with flexible pattern support
- **Enhanced Configuration Schema** - New redaction configuration options in database settings
- **Audit Logging for Redacted Fields** - Optional logging when redacted fields are accessed
- **Email & Phone Redaction Patterns** - Built-in support for common sensitive data types
- **Preserve Format Options** - Maintain original data structure while redacting content

### Changed
- **Database Adapter Integration** - Enhanced base adapter to support field redaction processing
- **Configuration Parser Updates** - Extended configuration parsing to handle redaction rules
- **Query Result Processing** - Updated result normalization to apply redaction before output
- **Setup Wizard Enhancement** - Added interactive redaction configuration during setup
- **Documentation Updates** - Comprehensive redaction feature documentation and examples

### Fixed
- **Memory Management** - Improved resource cleanup in redaction processing
- **Type Safety** - Enhanced TypeScript type definitions for redaction configuration
- **Configuration Validation** - Better error handling for malformed redaction rules

### Security
- **Sensitive Data Protection** - Automatic redaction prevents accidental exposure of sensitive information
- **Configurable Security Policies** - Flexible rules allow customization per security requirements
- **Data Loss Prevention** - Built-in patterns protect common sensitive data types
- **Audit Trail** - Optional logging provides compliance-ready access tracking

### Documentation
- **Field Redaction Guide** - Complete documentation for redaction feature configuration
- **Security Best Practices** - Updated security guidance including redaction recommendations
- **Configuration Examples** - Practical examples for common redaction scenarios
- **API Documentation Updates** - Updated TypeScript API reference with redaction interfaces

### Testing
- **Redaction Test Suite** - Comprehensive tests for all redaction patterns and configurations
- **Integration Testing** - End-to-end validation of redaction in query workflows
- **Performance Testing** - Validation that redaction adds minimal performance overhead

### Breaking Changes
- **None** - This release is fully backward compatible with v2.1.x

### Migration Guide
No migration is required for this release. Field redaction is an opt-in feature that can be enabled through configuration. All existing configurations and integrations continue to work without changes.

## [2.1.0] - 2025-08-29

### Added
- **Enhanced SSH Tunneling** with connection pooling and health monitoring
- **Comprehensive test coverage** (427+ tests, 90%+ coverage achieved)
- **Enhanced configuration templates** with detailed examples
- **Port management utilities** for better resource allocation and conflict resolution 
- **Enhanced SSH tunnel examples** and comprehensive documentation
- **Improved error handling** and logging throughout all components
- **Performance optimizations** in connection management and query processing
- **Database adapter improvements** with better type safety and error handling

### Changed 
- **Improved ConnectionManager** with better error handling and resource cleanup
- **Enhanced security validation** with more comprehensive SQL injection prevention
- **Updated TypeScript configurations** for better type safety and development experience
- **Optimized query performance analysis** with more accurate complexity calculations
- **Better resource cleanup** and memory management across all components
- **Enhanced logging system** with better error tracking and debugging capabilities

### Fixed
- **SSH tunnel connection stability** issues in high-load scenarios
- **Memory leaks** in connection pooling and SSH tunnel management
- **Query complexity calculation** edge cases with complex nested queries
- **Configuration validation** edge cases with malformed INI files
- **File system operation** error handling in schema caching
- **Database adapter** connection recovery in network failure scenarios
- **Port assignment conflicts** in concurrent SSH tunnel creation

### Security
- **Enhanced SQL injection prevention** mechanisms with improved pattern detection
- **Improved error message sanitization** to prevent information disclosure
- **Better connection security validation** with stricter SSL/TLS enforcement
- **Enhanced SSH tunnel security** features with better key validation
- **Audit logging improvements** for better security compliance tracking

### Documentation
- **Complete test coverage documentation** with detailed coverage reports
- **Enhanced SSH tunneling feature documentation** with practical examples
- **Updated API documentation** and comprehensive reference guides
- **Improved troubleshooting guides** with common solutions
- **Better configuration examples** for various deployment scenarios
- **Enhanced tutorial content** for getting started quickly

### Testing
- **427+ test scenarios** added across all components
- **90%+ line coverage** achieved for core functionality
- **Comprehensive integration tests** for MCP protocol compliance
- **Performance benchmarking** for database operations
- **Security validation testing** for SQL injection prevention
- **SSH tunnel functionality testing** with real network scenarios
- **Database adapter testing** for all supported database types

### Build & Development
- **Improved build process** with better error handling
- **Enhanced development tooling** with better debugging support
- **Updated ESLint configuration** with stricter rules
- **Better TypeScript integration** with improved type definitions
- **Automated testing pipeline** improvements

### Breaking Changes
- **None** - This release is fully backward compatible with v2.0.x

### Migration Guide 
No migration is required for this release. All existing configurations, scripts, and integrations will continue to work without changes.

### Deprecation Notices
- Legacy SSH tunnel configuration format will be deprecated in v3.0.0 (still supported in v2.1.0)
- Some internal API methods may be deprecated in future releases (no user impact)

## [2.0.0] - 2025-08-14

### Added
- Initial release with comprehensive database support
- MCP protocol implementation
- Security features and SQL injection prevention
- SSH tunneling capabilities
- Multi-database support (PostgreSQL, MySQL, SQLite, SQL Server)
- Configuration management and validation
- Performance monitoring and query analysis

### Initial Features
- Connection management and pooling
- Schema caching and introspection
- Security validation and audit logging
- Error handling and recovery mechanisms
- Comprehensive documentation and examples

---

## Version Numbering

This project uses [Semantic Versioning](https://semver.org/):
- **MAJOR** version for incompatible API changes
- **MINOR** version for new functionality in a backwards compatible manner 
- **PATCH** version for backwards compatible bug fixes

## Support Policy

- **Current Release (2.5.x)**: Full support including new features and bug fixes
- **Previous Release (2.4.x)**: Security fixes and critical bug fixes only
- **Previous Release (2.3.x)**: No longer supported, upgrade recommended

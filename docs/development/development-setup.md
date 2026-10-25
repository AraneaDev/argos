# Development Setup

## Prerequisites

- Node.js 22 or newer, with npm
- Git
- A database to test against. SQLite needs nothing installed and is enough for
  most work; the other adapters need a reachable server.

There is no Docker Compose file, no `.env` handling and no migration tooling in
this repository. Argos connects to databases you already have; it does not
create or manage any.

## Getting it running

```bash
git clone https://github.com/AraneaDev/argos.git
cd Argos
npm install
npm run build
```

`npm install` runs husky, which installs the pre-commit hook. `npm run build`
type-checks first, then compiles to `dist/` and marks the two entry points
executable.

Create a configuration to work against:

```bash
npm run setup          # interactive wizard
# or
cp config.ini.template config.ini && $EDITOR config.ini
chmod 600 config.ini
```

The quickest useful configuration is a SQLite file, which needs no server:

```ini
[database.scratch]
type=sqlite
file=./scratch.sqlite
select_only=true

[extension]
max_rows=1000
query_timeout=30000
```

Run the server against it:

```bash
node dist/cli.js serve --config ./config.ini
```

It waits for JSON-RPC on stdin and logs to `argos.log`. It will look idle,
because it is: the client drives it. `Ctrl+C` to stop.

To exercise it the way a client does, register the local build:

```bash
claude mcp add argos-dev -- node "$(pwd)/dist/cli.js" serve --config "$(pwd)/config.ini"
```

## The scripts you will use

| Command | What it does |
|---------|--------------|
| `npm run dev` | `tsc --watch`; rebuilds `dist/` as you edit |
| `npm test` | The whole suite |
| `npm run test:watch` | The suite in watch mode |
| `npm run test:unit` / `test:integration` | One tree at a time |
| `npm run test:coverage` | Suite plus a coverage report in `coverage/` |
| `npm run type-check` | `tsc --noEmit`, no output written |
| `npm run lint` | ESLint with `--fix` |
| `npm run lint:check` | ESLint without fixing, as CI runs it |
| `npm run format` / `format:check` | Prettier, writing or checking |
| `npm run validate` | lint:check, format:check, type-check, test — run this before pushing |
| `npm run validate-docs` | Checks the docs against the code for the things it can verify |
| `npm run build` | Clean, type-check, compile |
| `npm run build:fast` | esbuild bundle; quicker, for iterating |

`npm run validate` is what CI runs, so a clean run locally means a clean run
there.

## Before you commit

The pre-commit hook runs automatically and will:

- refuse files that look like credentials, including a private key pasted into a
  test fixture
- run Prettier and ESLint over the staged files

If it blocks something you believe is fine, look at what it matched before
reaching for `--no-verify`: that flag skips the formatting and linting too. The
hook is in `.husky/pre-commit` and is short enough to read.

Commit messages follow Conventional Commits, and the PR title is checked
separately because a squash merge takes the title as the commit subject.

## Debugging

The server never writes to stdout: that stream carries JSON-RPC, and anything
else on it breaks the client. Everything goes to `argos.log`, rotated to
`argos.log.1` on each start.

```bash
tail -f argos.log
grep -E '\[(ERROR|CRITICAL)\]' argos.log
```

`SSH_DEBUG=true` adds the ssh2 handshake trace to the same file. There is no
general verbosity switch; the level is INFO.

For a single test, jest's own filtering is usually enough:

```bash
npx jest tests/unit/adapters/mysql-adapter.test.ts -t "full table scan"
```

To step through code, run jest under the inspector:

```bash
node --inspect-brk node_modules/.bin/jest --runInBand tests/unit/some.test.ts
```

## Layout

```
src/
  index.ts                 entry point; starts the server
  setup.ts                 entry point; the configuration wizard
  classes/                 SQLMCPServer and the managers it coordinates
  database/adapters/       one adapter per engine, over a shared base class
  tools/                   MCP tool definitions, dispatcher, handlers
  types/                   shared types
  utils/                   config, logging, errors, auditing
tests/
  unit/                    mirrors src/
  integration/             server and tunnel behaviour end to end
  fixtures/                shared test data
examples/                  templates to copy, including a custom adapter
scripts/                   validate-documentation.js, verify-sqlite-streaming.cjs
```

## Adding a database adapter

Start from `examples/custom-adapters/adapter-template.ts`, which implements
every abstract member of `DatabaseAdapter` with each one commented. Register the
finished class in `src/database/adapters/AdapterFactory.ts`, and add a test file
mirroring the existing adapter tests.

See [Database Layer](../architecture/database-layer.md) for what the base class
provides and what the subclass owes it.

## Related

- [Contributing](./contributing.md)
- [Testing Guide](./testing-guide.md)
- [Code Standards](./code-standards.md)

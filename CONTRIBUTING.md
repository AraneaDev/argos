# Contributing to Argos

## Getting set up

```bash
git clone https://github.com/AraneaDev/argos.git
cd Argos
npm install     # installs deps and the git hooks (via husky)
npm run build
```

`npm install` runs `husky`, which installs the hooks described below. If you cloned before running it, the hooks are inert — run `npm install` again.

## Commits

Releases are cut by [release-please](https://github.com/googleapis/release-please) from [Conventional Commits](https://www.conventionalcommits.org/). A subject it cannot classify silently skips the release it should have produced, so the format is enforced by a `commit-msg` hook and, for pull requests, by `.github/workflows/pr-title.yml`.

```
<type>(<optional scope>): <description>

fix(mysql): restore SSH tunnel retry on handshake timeout
feat(schema): cache enhanced column statistics per database
docs(install): document the project scope for claude mcp add
```

**Types:** `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`.

Only `feat` and `fix` cut a release. A `!` after the type — or a `BREAKING CHANGE:` footer — makes it a major bump.

Because a squash merge takes the **pull request title** as the commit subject on `main`, the PR title is what release-please actually parses. That is why it is checked separately from the individual commits.

## Git hooks

| Hook | What it does | Bypass |
|------|--------------|--------|
| `commit-msg` | Rejects subjects that are not Conventional Commits | `git commit --no-verify` |
| `pre-commit` | Refuses commits on `main`/`master`; refuses staged credential files and embedded private keys; runs `lint-staged` (prettier + eslint) on staged files | `git commit --no-verify` |
| `pre-push` | Runs `npm run validate` — the same gate CI applies | `git push --no-verify` |

The credential guard exists because this project's whole purpose is holding database and SSH credentials. `config.ini` is gitignored, but `git add -f` and renamed copies get past `.gitignore`; the hook catches those by filename and scans staged content for `BEGIN ... PRIVATE KEY`. Track configuration examples as `config.ini.template` instead.

## Before you push

```bash
npm run validate       # lint:check + format:check + type-check + test
npm run validate-docs  # version references across README and docs
```

Both run in CI. `validate-docs` fails if the version in `package.json` drifts from `SERVER_VERSION`, the README title, or the version references in `docs/`.

## Releases

You do not bump versions by hand — there is no `bump-version` script any more.

1. Merge a `feat:` or `fix:` pull request into `main`.
2. release-please opens (or updates) a **Release PR** with the version bump and the generated `CHANGELOG.md` entry.
3. Merging that Release PR tags `vX.Y.Z`, creates the GitHub Release, and attaches the packaged artifacts.

Version numbers live in `package.json` and in four annotated locations, which release-please rewrites from `release-please-config.json`:

- `src/types/index.ts` — `SERVER_VERSION`
- `README.md` — the title
- `docs/api/typescript-api.md`
- `docs/tutorials/01-installation.md`

Each is marked with an `x-release-please-version` comment. If you add another place the version appears, annotate it and add the file to `release-please-config.json`, or `validate-docs` will start failing on the next release.

Publishing to npm is wired up but dormant (`if: false` in `.github/workflows/release-please.yml`) — Argos is not on the registry yet.

## Testing your changes against a real Claude Code session

```bash
npm run build
claude mcp add argos-dev -- node "$(pwd)/dist/cli.js" serve --config "$(pwd)/config.ini"
claude mcp list
```

Use a distinct name like `argos-dev` so a working registration is not clobbered. Remove it with `claude mcp remove argos-dev`. MCP servers are resolved at session start, so restart Claude Code after a rebuild.

Never write to stdout from server code — stdout carries the JSON-RPC stream and anything else on it corrupts the protocol. Use the logger, which writes to `argos.log`.

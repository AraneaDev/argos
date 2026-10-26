# Release Process Guide

This guide outlines the complete release process for the Argos, including versioning, testing, documentation, and deployment procedures.

## Overview

The Argos follows semantic versioning and maintains a structured release process that ensures quality, stability, and proper change management. Every release goes through comprehensive testing, documentation updates, and deployment validation.

**Release Cycle:**
- **Major versions** (X.0.0) - Breaking changes, major new features
- **Minor versions** (X.Y.0) - New features, backwards compatible
- **Patch versions** (X.Y.Z) - Bug fixes, security patches

**Current Version:** 2.0.0

## Versioning Strategy

### Semantic Versioning (SemVer)

The project follows [semantic versioning](https://semver.org/) strictly:

```
MAJOR.MINOR.PATCH

Example: 2.1.3
|-- 2: Major version (breaking changes)
|-- 1: Minor version (new features, backwards compatible)
\-- 3: Patch version (bug fixes)
```

### Version Bump Guidelines

#### Major Version (X.0.0)
**Breaking Changes:**
- API interface changes that break backward compatibility
- Configuration format changes
- Removal of deprecated features
- Database schema changes requiring migration

```typescript
// Example: Breaking API change
// v1.x.x
class SecurityManager {
 validateQuery(query: string): boolean { }
}

// v2.1.0
class SecurityManager {
 validateQuery(query: string): Promise<SecurityValidation> { } // Changed return type
}
```

#### Minor Version (X.Y.0)
**New Features:**
- New database adapter support
- Additional MCP tools
- New configuration options (with defaults)
- Performance improvements
- New utility functions

```typescript
// Example: New feature addition
// v2.1.0 - Added batch query support
class SecurityManager {
 validateQuery(query: string): Promise<SecurityValidation> { }
 
 // New method added in v2.1.0
 validateBatchQueries(queries: BatchQuery[]): Promise<BatchValidationResult> { }
}
```

#### Patch Version (X.Y.Z)
**Bug Fixes:**
- Security vulnerability fixes
- Bug fixes that don't change API
- Documentation corrections
- Test improvements
- Dependency updates (non-breaking)

```typescript
// Example: Bug fix
// v2.1.3 - Fixed query complexity calculation
private analyzeQueryComplexity(query: string): QueryComplexityAnalysis {
 // Fixed: Incorrect JOIN count calculation
 const joinCount = (query.toUpperCase().match(/\bJOIN\b/g) || []).length;
 // Previous buggy version counted all occurrences of 'JOIN' substring
}
```

### Pre-release Versions

For development and testing releases:

```
2.1.0-alpha.1 # Early development
2.1.0-beta.1 # Feature complete, testing
2.1.0-rc.1 # Release candidate, final testing
```

## Release Workflow

Releases are cut by [release-please](https://github.com/googleapis/release-please)
from Conventional Commits. Versions are **never** bumped by hand, and there is no
`bump-version` script — it was removed in v3.0.0.

### 1. Merge work to `main`

Each pull request carries a Conventional Commit title. Because a squash merge
takes the PR title as the commit subject on `main`, that title is what
release-please parses; `.github/workflows/pr-title.yml` rejects titles it could
not classify.

- `feat:` → minor bump
- `fix:` → patch bump
- `feat!:` / `fix!:` / a `BREAKING CHANGE:` footer → major bump
- everything else (`docs`, `chore`, `ci`, `refactor`, `style`, `test`, `build`,
  `perf`) lands without cutting a release

### 2. Review the Release PR

`.github/workflows/release-please.yml` opens (and keeps updating) a Release PR
containing:

- the version bump in `package.json` and `.release-please-manifest.json`
- the generated `CHANGELOG.md` entry
- rewritten version references in `src/types/index.ts`, `README.md`,
  `docs/api/typescript-api.md`, and `docs/tutorials/01-installation.md`

Those four files are listed in `release-please-config.json` and each carries an
`x-release-please-version` annotation. If you add another place the version
appears, annotate it and register it there — otherwise `npm run validate-docs`
will fail on the next release.

Review the changelog entry as you would any other diff. This is the moment to
correct a misleading commit subject, since it is what users will read.

### 3. Merge the Release PR

Merging tags `vX.Y.Z`, creates the GitHub Release, and runs the verification
steps in the same workflow: build, lint, format check, typecheck, the full test
suite, then an assertion that every bin target exists and `dist/cli.js` kept its
shebang. The packaged `.tgz` and `.zip` are attached to the Release.

Publishing to npm is wired up but dormant (`if: false`) — Argos is not on the
registry yet. To go public, remove that guard and configure Trusted Publishing
or an `NPM_TOKEN`.

### Quality gates

Everything below runs before a release can be cut, on every pull request via
`.github/workflows/ci.yml`, and locally on `git push` via the `pre-push` hook:

```bash
npm run validate       # lint:check + format:check + type-check + test
npm run validate-docs  # version references across README and docs
npm run build          # must emit dist/cli.js (plus the dist/index.js and dist/setup.js aliases)
```


## Hotfix Release Process

### When Hotfixes Are Needed

- **Critical Security Vulnerabilities**
- **Data Loss or Corruption Issues**
- **Complete Feature Failures**
- **Severe Performance Regressions**

### Hotfix Workflow

A hotfix is an ordinary `fix:` pull request — the automation handles the rest.
There is no separate branch-off-the-tag procedure, because releases are always
cut from `main`.

```bash
git checkout main && git pull
git checkout -b fix/connection-pool-leak

# Make the minimal fix, with a regression test
npm run validate

git commit -m "fix(connection): release pooled handles on tunnel teardown"
git push -u origin fix/connection-pool-leak
```

Open the pull request with that same Conventional Commit subject as its title.
Once merged, release-please raises a Release PR with a patch bump; merging it
publishes the release.

If a fix is urgent, merge its PR and then merge the Release PR immediately —
the Release PR is updated within a minute of the fix landing on `main`. Nothing
about the path is different for a security fix beyond that urgency; note the
advisory in the commit body so it lands in the changelog.

## Release Automation

Three workflows carry the release, all under `.github/workflows/`:

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `ci.yml` | push/PR to `main` | lint, format check, typecheck; tests on Node 24/26; build, artifact assertions, `validate-docs` |
| `pr-title.yml` | pull request opened/edited | Rejects a PR title that is not a Conventional Commit |
| `release-please.yml` | push to `main` | Opens/updates the Release PR; on merge, tags, releases, verifies, and attaches artifacts |

`pr-title.yml` runs on `pull_request_target` rather than `pull_request`, so the
workflow definition is taken from the base branch and a pull request cannot
weaken the check in the same change it is meant to police. That trigger runs in
a trusted context, so the job is payload-only — it never checks out or executes
anything from the pull request's tree, and `permissions: {}` withholds the token
regardless.

Release configuration lives in two files:

- **`release-please-config.json`** — release type (`node`), changelog path, and
  the `extra-files` whose version references get rewritten.
- **`.release-please-manifest.json`** — the current version, which release-please
  maintains. Do not edit it by hand.

There is no `scripts/release.js` and no tag-triggered release workflow. Because
release-please creates the tag with `GITHUB_TOKEN`, a separate `on: push: tags`
workflow would never fire — which is why build, verification, and publishing all
live inside `release-please.yml` behind `if: steps.release.outputs.release_created`.


## Quality Gates

### Pre-Release Checklist

Before any release can proceed, all quality gates must pass:

#### Code Quality Gates
- [ ] All tests pass (unit + integration)
- [ ] Code coverage >= 85%
- [ ] No ESLint errors or warnings
- [ ] TypeScript compilation successful
- [ ] No security vulnerabilities (npm audit)

#### Documentation Gates
- [ ] CHANGELOG.md entry reads correctly (release-please generates it from commit
      subjects — fix a misleading one in the Release PR)
- [ ] `npm run validate-docs` passes (version references across README and docs)
- [ ] API documentation current
- [ ] README.md reflects current features
- [ ] Migration guide available (for breaking changes)

#### Security Gates
- [ ] Dependency security scan passed
- [ ] Manual security review completed
- [ ] Error message sanitization verified
- [ ] Input validation tested

#### Performance Gates
- [ ] Performance benchmarks within acceptable range
- [ ] Memory usage tests passed
- [ ] No performance regressions detected

## Rollback Procedures

### NPM Package Rollback

Argos is not published to npm yet, so this applies once the publish step in
`release-please.yml` is enabled.

```bash
# Deprecate a problematic version
npm deprecate @araneadev/argos@3.0.0 "This version has critical issues. Please upgrade to 3.0.1"

# If severe, unpublish (only possible within 72 hours of publishing)
npm unpublish @araneadev/argos@3.0.0
```

Prefer deprecating over unpublishing: unpublishing breaks every lockfile that
already pins the version.

### GitHub Release Rollback

1. **Mark release as pre-release** to hide from main releases
2. **Edit release notes** to warn about issues
3. **Create new hotfix release** with fixes
4. **Delete problematic release** if extremely severe

### User Communication

```markdown
# Critical Security Update Required

**Action Required:** All users of Argos v2.1.0 must upgrade immediately.

## Issue
Version 2.1.0 contains a critical security vulnerability that could allow SQL injection attacks.

## Solution
Upgrade to v2.1.1 immediately:

```bash
npm update -g argos
```

## Timeline
- v2.1.0 released: August 12, 2024
- Issue discovered: August 15, 2024
- v2.1.1 hotfix released: August 15, 2024

We apologize for any inconvenience and have implemented additional security testing procedures.
```

## Release Metrics and Monitoring

### Success Metrics

Track these metrics for each release:

- **Adoption Rate**: Download/install statistics
- **Issue Rate**: New issues reported post-release
- **Performance**: Response times and resource usage
- **Security**: Vulnerability reports and fixes
- **User Satisfaction**: Community feedback and ratings

### Monitoring Dashboard

```javascript
// Release monitoring script
const releaseMetrics = {
 version: '2.1.0',
 releaseDate: '2024-08-12',
 downloads: {
 npm: await getNpmDownloads('argos', '2.1.0'),
 github: await getGitHubReleaseDownloads('v2.1.0')
 },
 issues: {
 total: await getGitHubIssues({ since: '2024-08-12' }),
 critical: await getGitHubIssues({ since: '2024-08-12', labels: ['critical'] }),
 bugs: await getGitHubIssues({ since: '2024-08-12', labels: ['bug'] })
 },
 performance: {
 avgResponseTime: await getPerformanceMetrics(),
 memoryUsage: await getMemoryMetrics(),
 errorRate: await getErrorRate()
 }
};
```

## Conclusion

This comprehensive release process ensures that every Argos release meets high standards for quality, security, and reliability. The structured approach minimizes risks while maintaining development velocity and user satisfaction.

**Key Principles:**
- **Quality First**: Comprehensive testing before any release
- **Clear Communication**: Transparent changelog and user notification
- **Security Focus**: Security validation at every step
- **Rollback Ready**: Prepared procedures for handling issues
- **Continuous Improvement**: Metrics-driven process refinement

Following this process helps maintain the project's reputation for reliability while enabling rapid iteration and improvement.

## Quick Reference

### Release Commands

There are none — the bump type is derived from your commit subjects, and the
release is cut by merging the Release PR.

```bash
# Choose the bump by choosing the commit type
git commit -m "fix(mysql): ..."   # patch
git commit -m "feat(schema): ..." # minor
git commit -m "feat(api)!: ..."   # major

# Verify locally before pushing (the pre-push hook runs this too)
npm run validate
npm run validate-docs
```

### Related Documentation

- [CONTRIBUTING.md](../../CONTRIBUTING.md) — commit format, git hooks, release flow
- [`release-please-config.json`](../../release-please-config.json) — files whose version references are rewritten
- [`.github/workflows/release-please.yml`](../../.github/workflows/release-please.yml) — the release job itself

---

*For questions about the release process or to suggest improvements, please create an issue or discussion in the project repository.*

# Backup and Recovery

## What is worth backing up

Argos holds almost no state. It is a stdio process that reads a configuration,
connects to databases you already own, and exits with the session. Recovery is
correspondingly small: restore two things and rebuild, and it is back.

| Item | Where | Recreatable? |
|------|-------|--------------|
| `config.ini` | Wherever `--config` points, `~/.config/argos/config.ini` by convention | No — credentials and security settings |
| SSH private keys it references | The paths in `ssh_private_key` | No |
| Audit log | `~/.argos/audit/` | No, if you keep it for review |
| Schema cache | `schemas/` in the install | Yes — rebuilt on demand |
| `dist/` | The install | Yes — `npm run build` |
| `argos.log` | The working directory | Yes, and rotated on every start anyway |

The databases themselves are not Argos's to back up. Use their own tooling:
`pg_dump`, `mysqldump`, `sqlcmd`/native backups, or a file copy for SQLite while
nothing is writing.

## Backing up

```bash
#!/bin/bash
set -euo pipefail

CONFIG="${1:-$HOME/.config/argos/config.ini}"
DEST="${2:-$HOME/argos-backup}"

mkdir -p "$DEST"
chmod 700 "$DEST"

# The configuration, and every key it names
cp "$CONFIG" "$DEST/config.ini"
grep -E '^ssh_private_key=' "$CONFIG" | cut -d= -f2- | while read -r key; do
  [ -f "$key" ] && cp "$key" "$DEST/$(basename "$key")"
done

chmod 600 "$DEST"/*
tar -czf "$DEST.tar.gz" -C "$(dirname "$DEST")" "$(basename "$DEST")"
```

The archive contains credentials and private keys in the clear. Encrypt it
before it goes anywhere else:

```bash
gpg --symmetric --cipher-algo AES256 "$DEST.tar.gz"
shred -u "$DEST.tar.gz"
```

Add the audit log to the archive if you retain it:

```bash
cp -r ~/.argos/audit "$DEST/audit"
```

## Restoring

```bash
# 1. Reinstall and build
git clone https://github.com/AraneaDev/argos.git /opt/argos
cd /opt/argos && npm ci && npm run build

# 2. Put the configuration and keys back, owner-only
install -m 600 backup/config.ini ~/.config/argos/config.ini
install -m 600 backup/tunnel_key ~/.ssh/tunnel_key

# 3. Register with the client
claude mcp add argos --scope user -- \
  node /opt/argos/dist/cli.js serve --config "$HOME/.config/argos/config.ini"
```

Then confirm it works, which is the whole of the verification:

```bash
claude mcp list
```

and ask the model to run `sql_list_databases`, then `sql_test_connection` for
each one. A failure names the database and the reason.

The schema cache rebuilds itself the first time each database is queried. There
is nothing to migrate and no state to reconcile: the configuration is read fresh
on every start.

## If the configuration is lost

There is no way to recover credentials from an installation — nothing is stored
outside `config.ini`, and the log and audit files deliberately contain neither
statements nor values. Recreate it with `npm run setup` and the credentials from
your password manager.

This is the case worth rehearsing, because it is the only one where a backup
actually saves you.

## Rotating credentials

Rotation is an edit and a restart, not a migration:

1. Change the password or key on the database or bastion.
2. Edit `config.ini`, keeping it `0600`.
3. Restart the MCP client so the next session starts a process that reads it.

Sessions already running keep the connections they opened. There is no reload
signal; the process is short-lived by design.

## Related

- [Deployment Guide](./deployment-guide.md) — installing and registering
- [Security Hardening](./security-hardening.md) — file modes and what the audit
  log contains

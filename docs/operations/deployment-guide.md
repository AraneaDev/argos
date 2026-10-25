# Argos Deployment Guide

## What deploying this means

Argos speaks the Model Context Protocol over stdio. The MCP client starts the
process when a session begins, talks to it over stdin and stdout, and the
process exits with the session. It never opens a port and never runs as a
daemon.

That shapes everything below. There is no service to keep alive, no endpoint to
put a load balancer in front of, no instance count to scale and no rolling
restart to orchestrate. Deploying Argos means putting the built code and a
configuration file somewhere the client can reach, and registering it.

If you are looking for redundancy or throughput, both belong to the database:
replicas, connection limits and failover are configured there, and Argos
connects to whatever endpoint you point it at.

## Installing

```bash
git clone https://github.com/AraneaDev/argos.git /opt/argos
cd /opt/argos
npm ci
npm run build
```

`npm run build` type-checks first, so a build that succeeds has already been
type-checked. It produces `dist/cli.js`, the `argos` command (`argos serve` for the server,
`argos setup` for the configuration wizard), plus the deprecated `argos-mcp` and
`argos-setup` aliases, all executable.

## Configuration

Create the configuration with the wizard, which writes to
`~/.config/argos/config.ini` by convention:

```bash
npm run setup
chmod 600 ~/.config/argos/config.ini
```

The file holds database credentials. The server warns on startup if it is
group- or world-readable.

The server finds it in one of three ways, in order:

1. The path given to `--config`
2. `config.ini` in the working directory the client started the process in
3. `config.ini` next to the installation

The working directory is whatever the MCP client happens to use, which is not
something you control, so pass `--config` explicitly for anything but a local
checkout you run by hand. Relying on the fallbacks is how a server ends up
reading a configuration you forgot was there.

## Registering with the client

```bash
claude mcp add argos --scope user -- \
  node /opt/argos/dist/cli.js serve --config "$HOME/.config/argos/config.ini"
```

Confirm it connected:

```bash
claude mcp list
```

See the [Quick Start](../guides/quick-start.md) for the scope options and what
they mean.

## Separating environments

One installation reads one configuration, and a configuration can hold many
databases. Keep environments apart by registering them separately rather than by
switching a flag:

```bash
claude mcp add argos-staging    --scope user -- node /opt/argos/dist/cli.js serve --config /etc/argos/staging.ini
claude mcp add argos-production --scope user -- node /opt/argos/dist/cli.js serve --config /etc/argos/production.ini
```

Each appears under its own name, so a query addressed to one cannot reach the
other. Give the production configuration `select_only=true` on every database
unless there is a specific reason not to; that setting cannot be changed through
the MCP tools, only by editing the file.

## Containers

A container only helps if the MCP client runs inside it too, because the client
starts the server as a child process. Running Argos in a container of its own
and expecting something to connect to it does not work: there is nothing
listening.

Where the client is containerised, install Argos into the same image and mount
the configuration read-only:

```yaml
services:
  workspace:
    image: your-workspace-image
    volumes:
      - ./config.ini:/etc/argos/config.ini:ro
    environment:
      - SQL_MCP_SQLITE_BASE_DIR=/app/data
```

`SQL_MCP_SQLITE_BASE_DIR` confines SQLite paths supplied through the MCP tools
to one directory, which is worth setting wherever the model can add databases.

## Upgrading

```bash
cd /opt/argos
git pull
npm ci
npm run build
```

The next session the client starts picks up the new build. Running sessions keep
the code they started with, so restart the client to move an active session
across. There is no migration step: configuration is read fresh each start, and
nothing is persisted between runs except the schema cache and the audit log,
both of which are safe to delete.

To roll back, check out the previous tag and rebuild.

## What to back up

| Item | Why |
|------|-----|
| `config.ini` | Credentials and security settings. Not reproducible. |
| SSH private keys it references | Same. |
| `~/.argos/audit/` | Query history, if you are keeping it for review. |

The schema cache under `schemas/` is derived and rebuilds itself on demand.
`dist/` is a build artefact.

## Verifying a deployment

```bash
# The build produced both entry points
test -x /opt/argos/dist/cli.js && echo ok

# The configuration is owner-only
stat -c '%a %n' ~/.config/argos/config.ini   # expect 600

# The client can reach it
claude mcp list
```

Then ask the model to run `sql_list_databases`, and `sql_test_connection` for
each database. A failure there names the database and the reason, and the detail
is in `argos.log`.

## Troubleshooting a deployment

Startup problems surface in `argos.log` in the process's working directory,
not on the console: stdout is the JSON-RPC channel, so the server never writes
diagnostics there.

The usual causes, in the order they occur:

- **No configuration found** — `--config` was omitted and the working directory
  had no `config.ini`. Pass the path explicitly.
- **The wrong configuration was read** — one of the fallbacks matched. The log
  records which file was loaded on startup.
- **A database fails to connect but others work** — credentials or network, not
  deployment. `sql_test_connection` gives the driver's own error.

[Troubleshooting Guide](../guides/troubleshooting-guide.md) covers these in
depth.

## Related

- [Security Hardening](./security-hardening.md) — file modes, database grants,
  network exposure
- [Monitoring](./monitoring.md) — what is observable and where
- [Backup and Recovery](./backup-recovery.md)

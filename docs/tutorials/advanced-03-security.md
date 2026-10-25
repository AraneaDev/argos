# Advanced Tutorial 3: Hardening a Production Database

## Overview

This tutorial takes one production database from a working connection to a
locked-down one, and then verifies each control is actually in force. Everything
here is a setting Argos reads or a grant the database enforces; there is nothing
to implement.

The order matters. Each step is weaker than the one before it, so start at the
bottom of the stack.

## Prerequisites

- [Advanced Tutorial 1: Multi-Database Configuration](advanced-01-multi-database.md)
- [Advanced Tutorial 2: SSH Tunnel Configuration](advanced-02-ssh-tunnels.md)
- Administrative access to the database you are hardening

## Step 1: Give it an account that cannot do damage

Argos enforces SELECT-only in software, and that enforcement has been worth
having. It is still the weakest layer here, because it is the only one that
depends on parsing SQL correctly. A read-only grant does not.

```sql
-- PostgreSQL
CREATE USER argos_ro WITH PASSWORD 'generated-not-chosen';
GRANT CONNECT ON DATABASE app TO argos_ro;
GRANT USAGE ON SCHEMA public TO argos_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO argos_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO argos_ro;

-- Withhold what a read-only account never needs
REVOKE ALL ON SCHEMA information_schema FROM argos_ro;
```

Verify by trying to write, as that user:

```sql
INSERT INTO orders (id) VALUES (1);
-- ERROR:  permission denied for table orders
```

If that succeeds, nothing else in this tutorial matters.

## Step 2: Encrypt the connection and verify the certificate

```ini
[database.production]
type=postgresql
host=db.internal.example.com
port=5432
database=app
username=argos_ro
password=generated-not-chosen
ssl=true
select_only=true
mcp_configurable=false
```

`ssl_verify` is deliberately absent: verification is on unless the file
explicitly disables it. Leave it that way. It cannot be turned off through the
MCP tools — the tools accept only `true` — so the file is the only place it can
change.

`mcp_configurable=false` puts this database out of reach of the configuration
tools altogether.

## Step 3: Pin the SSH host key

If the database is reached through a bastion, get the fingerprint out of band —
from the host itself, not from the connection you are about to trust:

```bash
# On the bastion
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
# 256 SHA256:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU no comment (ED25519)
```

```ini
ssh_host=bastion.example.com
ssh_username=argos
ssh_private_key=/etc/argos/tunnel_key
ssh_host_fingerprint=SHA256:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU
```

```bash
chmod 600 /etc/argos/tunnel_key   # a key others can read is refused by name
```

Without a pinned fingerprint the tunnel refuses to connect at all. That is the
intended default: an unverified host key is how a tunnel gets terminated
somewhere you did not intend.

## Step 4: Keep sensitive columns out of the conversation

Redaction runs on results before they reach the model, so a protected column
never enters the context:

```ini
redaction_enabled=true
redaction_rules=*email*:partial_mask,*ssn*:replace:[SSN_REDACTED],*password*:replace:[HIDDEN]
redaction_log_access=true
```

Rules match a column name exactly or by `*` wildcard, and follow a column
through an alias — `SELECT email AS e` and `SELECT lower(email) e` are both
covered, so renaming a column is not a way around the rule.

Verify it, with a query designed to defeat it:

```
Run: SELECT email AS contact_details FROM users LIMIT 1
```

The value comes back masked. If it does not, the rule did not match the column
name; check the spelling against the schema.

## Step 5: Bound what a single query can cost

```ini
[security]
max_joins=10
max_subqueries=5
max_unions=3
max_group_bys=5
max_complexity_score=100
max_query_length=10000

[extension]
max_rows=1000
query_timeout=30000
```

These limit the damage of a badly-formed query rather than a malicious one. The
timeout is enforced by the database itself, so an over-ambitious query stops
consuming server resources rather than running on unwatched.

## Step 6: Confirm the file itself is not the weak point

`config.ini` now holds a password and the path to a private key.

```bash
chmod 600 /etc/argos/config.ini
ls -l /etc/argos/config.ini      # -rw------- 
```

The server warns on startup if it is group- or world-readable. Treat that
warning as an incident: anyone who could read the file has the credentials.

## Step 7: Verify the whole thing

Ask the model to attempt each of these against the hardened database. Every one
should be refused, and the reason should say why:

| Attempt | Expected |
|---------|----------|
| `DELETE FROM orders WHERE 1=1` | Blocked — not a read command |
| `SELECT 1; DROP TABLE orders` | Blocked — multiple statements |
| `SELECT '--' ; DROP TABLE orders` | Blocked — the comment does not hide the second statement |
| `SELECT pg_read_file('/etc/passwd')` | Blocked — dangerous function |
| `COPY (SELECT 1) TO PROGRAM 'id'` | Blocked — dangerous construct |
| Changing `select_only` via a tool | Refused — config file only |
| Setting `ssl_verify` false via a tool | Refused — only `true` is accepted |

Then check the record of it:

```bash
grep -i "Query blocked" argos.log
tail ~/.argos/audit/production.log
```

The audit log holds a hash of each statement rather than the statement, and the
server log has secrets scrubbed from its messages, so neither becomes a second
copy of what you are protecting.

## What Argos does not do

Worth being explicit, so you do not plan around something that is not there:

- **No authentication of its own.** It runs as whoever started it, with the
  credentials in its configuration. The MCP client is the trust boundary.
- **No per-user authorization.** There are no roles inside Argos; the database
  account's grants are the authorization model.
- **No encryption at rest.** `config.ini` is plaintext, protected by file
  permissions. Use a secrets manager to write the file if that is not enough.
- **No compliance tooling.** The audit log is a query record, not a
  certification.

## Next Steps

- [Advanced Tutorial 4: Performance](advanced-04-performance.md)
- [Security Guide](../guides/security-guide.md) — the controls in reference form
- [Security Hardening](../operations/security-hardening.md) — database and
  network side

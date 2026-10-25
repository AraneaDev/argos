# Claude Code Integration Tutorial

This tutorial shows you how to register Argos with Claude Code, enabling Claude to query your databases directly.

## Overview

Claude Code connects to MCP (Model Context Protocol) servers to extend Claude's capabilities. Argos acts as a bridge between Claude and your databases, allowing Claude to:

- Query your databases safely with built-in security validation
- Analyze data and generate insights
- Create reports and visualizations
- Help with database administration tasks

## Prerequisites

Before starting this tutorial, ensure you have:

- **Argos installed** - [Installation Tutorial](01-installation.md)
- **Database configured** - At least one database connection configured
- **Claude Code installed** - `claude --version` should report a version
- **Server tested** - verified that `argos serve` starts without errors

## Step 1: Verify Argos

First, ensure your Argos is properly configured:

### Check Configuration

```bash
# Verify configuration file exists
ls -la config.ini

# Test server startup
argos serve --test
```

**Expected Output:**
```
 Argos starting...
 Loaded 1 database configuration(s):
 - production (postgresql, SELECT-only)
 Security manager initialized with default limits
 All systems ready
```

### Test Database Connections

```bash
# Test all configured databases
npm run setup
```

**Expected Output:**
```
--- Testing Connections ---
Testing production...
 Connected
 Schema captured: 23 tables, 156 columns
 Access mode: SELECT-only

Testing analytics...
 Connected
 Schema captured: 8 tables, 67 columns
 Access mode: SELECT-only
```

If you see connection errors, resolve them before registering with Claude Code.

## Step 2: Register the Server with Claude Code

Claude Code owns its own MCP registry — you never hand-edit a JSON config. From the repository root:

```bash
claude mcp add argos --scope user -- \
  node "$(pwd)/dist/cli.js" serve --config "$HOME/.config/argos/config.ini"
```

Everything after `--` is the command Claude Code will spawn. Both paths must be absolute: Claude Code executes the command directly, so `~` and relative paths are not expanded.

### Choosing a Scope

| Scope | Flag | Stored in | Use when |
|-------|------|-----------|----------|
| User | `--scope user` | `~/.claude.json` | You want Argos in every project — the usual choice |
| Project | `--scope project` | `.mcp.json` in the repo | You want to commit the registration for your team |
| Local | *(default)* | Per-project, private | You are trying it out in one project |

A project-scoped registration is worth knowing about: `.mcp.json` is a tracked file, so teammates get Argos on checkout. It records the command, not your credentials — those stay in the `config.ini` each person keeps locally.

### Passing Environment Variables

Use `-e` for anything the server should read from the environment, so secrets stay out of the recorded arguments:

```bash
claude mcp add argos --scope user \
  -e NODE_ENV=production \
  -e SSH_KEY_PASSPHRASE="$SSH_KEY_PASSPHRASE" \
  -- node "$(pwd)/dist/cli.js" serve --config "$HOME/.config/argos/config.ini"
```

### Registering Several Configurations

Separate registrations can point at different `config.ini` files — useful for keeping production strictly read-only while development stays writable:

```bash
claude mcp add argos-prod --scope user -- \
  node "$(pwd)/dist/cli.js" serve --config /etc/argos/production.ini

claude mcp add argos-dev --scope user -- \
  node "$(pwd)/dist/cli.js" serve --config /etc/argos/development.ini
```

Each appears under its own tool namespace — `mcp__argos-prod__sql_query`, `mcp__argos-dev__sql_query` — so there is no ambiguity about which database Claude is reaching for.

## Step 3: Verify the Registration

```bash
claude mcp list
```

Argos should be listed as connected. To see exactly what was recorded:

```bash
claude mcp get argos
```

## Step 4: Start a Session

Claude Code launches the server on demand — there is no daemon to start and no application to restart. Open Claude Code and the Argos tools are available immediately in a new session; `/mcp` lists the connected servers and their tools.

## Step 5: Test Integration

### Basic Connection Test

Start a conversation with Claude and ask:

```
Are you connected to any databases? Can you list the available databases?
```

**Expected Response:**
```
Yes! I can see that I'm connected to your SQL databases through the MCP server. Let me list the available databases for you.

I have access to the following databases:
- production (PostgreSQL, SELECT-only mode)
- analytics (MySQL, SELECT-only mode)

These databases are configured with security restrictions that allow only SELECT, WITH, SHOW, EXPLAIN, and DESCRIBE operations to ensure safe read-only access.

Would you like me to explore the schema of any of these databases or help you with a specific query?
```

### Schema Exploration Test

Ask Claude to explore your database structure:

```
Can you show me the tables in the production database?
```

**Expected Response:**
```
I'll explore the schema of your production database for you.

Here are the tables in your production database:

**User Management:**
- users (id, name, email, created_at, updated_at)
- user_profiles (user_id, bio, avatar_url, settings)
- user_sessions (id, user_id, token, expires_at)

**Content:**
- posts (id, user_id, title, content, published_at)
- comments (id, post_id, user_id, content, created_at)
- categories (id, name, description, slug)

**Analytics:**
- page_views (id, page_url, visitor_id, viewed_at)
- user_actions (id, user_id, action_type, metadata)

**System:**
- migrations (version, applied_at)
- settings (key, value, updated_at)

The database has a total of 23 tables with 156 columns. Would you like me to explore any specific table in more detail or help you with a particular query?
```

### Query Test

Test Claude's ability to run queries:

```
Show me the top 5 most active users by post count
```

**Expected Response:**
```
I'll query your database to find the most active users by post count.

Here are the top 5 most active users:

| Rank | User Name | Email | Post Count | Latest Post |
|------|-----------|-------|------------|-------------|
| 1 | Sarah Johnson | sarah@example.com | 42 | 2024-08-10 |
| 2 | Mike Chen | mike.chen@example.com | 38 | 2024-08-12 |
| 3 | Alex Rodriguez | alex.r@example.com | 35 | 2024-08-09 |
| 4 | Emily Davis | emily.davis@example.com | 31 | 2024-08-11 |
| 5 | John Smith | john.smith@example.com | 28 | 2024-08-08 |

This data shows that Sarah Johnson is your most prolific content creator with 42 posts, followed closely by Mike Chen. The activity levels suggest a healthy, engaged user base.

Would you like me to analyze posting patterns over time or explore other user engagement metrics?
```

## Troubleshooting Integration Issues

### Issue 1: MCP Server Not Found

**Symptoms:**
- `claude mcp list` does not show `argos`, or shows it as failed
- No database tools available in a new session

**Solutions:**

1. **Check what was actually recorded:**
 ```bash
 claude mcp get argos
 ```
 The command and every argument must be an absolute path. A registration made with `~` or a relative path will fail to spawn.

2. **Confirm the entry point exists and runs:**
 ```bash
 test -f /abs/path/to/argos/dist/cli.js && echo present
 node /abs/path/to/argos/dist/cli.js version
 ```
 If it is missing, you have not built yet — run `npm run build`.

3. **Re-register after moving or rebuilding the repository:**
 ```bash
 claude mcp remove argos --scope user
 claude mcp add argos --scope user -- \
   node "$(pwd)/dist/cli.js" serve --config "$HOME/.config/argos/config.ini"
 ```

4. **Check the scope you registered under.** A `--scope local` registration only exists in the project directory where you ran it. `claude mcp list` from elsewhere will not show it.

### Issue 2: Configuration File Not Found

**Symptoms:**
- Error messages about missing config.ini
- Server starts but no databases available

**Solutions:**

1. **Specify the config path explicitly when registering:**
 ```bash
 claude mcp remove argos --scope user
 claude mcp add argos --scope user -- \
   node /abs/path/dist/cli.js serve --config /full/path/to/config.ini
 ```

2. **Verify the config file exists and is readable:**
 ```bash
 ls -la /full/path/to/config.ini
 ```
 Argos resolves `--config` relative to nothing — the path is used as given, and Claude Code spawns the server with an unpredictable working directory, so a bare `config.ini` will not be found.

### Issue 3: Database Connection Errors

**Symptoms:**
- MCP server loads but database queries fail
- Connection timeout or authentication errors

**Solutions:**

1. **Test connections independently** — call the `sql_test_connection` tool from Claude, or run the wizard's test pass:
 ```bash
 npm run setup
 ```

2. **Pass credentials through the environment** rather than the config file:
 ```bash
 claude mcp add argos --scope user \
   -e DB_PASSWORD="$DB_PASSWORD" \
   -- node /abs/path/dist/cli.js serve --config /abs/path/config.ini
 ```

3. **Enable debug logging:**
 ```bash
 claude mcp add argos --scope user \
   -e LOG_LEVEL=DEBUG \
   -- node /abs/path/dist/cli.js serve --config /abs/path/config.ini
 ```
 Output goes to `argos.log`, never to stdout — stdout carries the JSON-RPC stream and anything written there breaks the protocol.

### Issue 4: Permission Denied

**Symptoms:**
- "Permission denied" errors when starting MCP server
- Authentication failures

**Solutions:**

1. **Check file permissions:**
 ```bash
 chmod +x $(which argos)
 chmod 600 config.ini # Protect sensitive config
 ```

2. **Verify user permissions:**
 ```bash
 # Test database connection manually
 psql -h localhost -U your_user -d your_database
 ```

### Issue 5: Registration Not Taking Effect

**Symptoms:**
- Changes to the registration don't appear
- The server loads with stale arguments

**Solutions:**

1. **MCP servers are resolved when a session starts.** Exit Claude Code and start a new session after changing a registration.

2. **Check for a duplicate at another scope.** A project-scoped `.mcp.json` entry and a user-scoped entry can both define `argos`; the narrower scope wins.
 ```bash
 claude mcp list
 cat .mcp.json 2>/dev/null
 ```

3. **Read the server's own log.** Argos writes startup and connection failures to `argos.log` in the repository root — that is where a bad `config.ini` path shows up.
 ```bash
 tail -n 50 /abs/path/to/argos/argos.log
 ```

4. **Remove and re-add** if the recorded entry looks wrong:
 ```bash
 claude mcp remove argos --scope user
 claude mcp add argos --scope user -- node /abs/path/dist/cli.js serve --config /abs/path/config.ini
 ```

## Advanced Integration Configurations

### Multiple Database Servers

Register one server per environment, each with its own config file:

```bash
claude mcp add production-db --scope user -- \
  node /abs/path/dist/cli.js serve --config /etc/argos/production.ini

claude mcp add development-db --scope user -- \
  node /abs/path/dist/cli.js serve --config /etc/argos/development.ini

claude mcp add analytics-db --scope user -- \
  node /abs/path/dist/cli.js serve --config /etc/argos/analytics.ini
```

The registration name becomes the tool namespace, so Claude sees `mcp__production-db__sql_query` and `mcp__development-db__sql_query` as distinct tools. Naming them for the environment rather than the database is what keeps a production query from being issued by accident.

### Configuration with SSH Tunnels

For databases reached through a bastion host:

```bash
claude mcp add secure-database --scope user \
  -e SSH_PRIVATE_KEY=/path/to/ssh/private/key \
  -e SSH_PASSPHRASE="$SSH_PASSPHRASE" \
  -e DB_PASSWORD="$DB_PASSWORD" \
  -- node /abs/path/dist/cli.js serve --config /secure/path/config.ini
```

The tunnel itself is described in `config.ini` (`ssh_host`, `ssh_username`, `ssh_private_key`); the environment is only for the secrets you would rather not write to disk.

### Development vs Production Configuration

**Development:**
```bash
claude mcp add argos-dev --scope user \
  -e NODE_ENV=development \
  -e LOG_LEVEL=DEBUG \
  -- node /abs/path/dist/cli.js serve --config /etc/argos/development.ini
```

**Production:**
```bash
claude mcp add argos-prod --scope user \
  -e NODE_ENV=production \
  -e LOG_LEVEL=WARN \
  -e DB_PASSWORD="$DB_PASSWORD" \
  -- node /abs/path/dist/cli.js serve --config /etc/argos/production.ini
```

Pair the production registration with `select_only=true` in its config file. The scopes are independent, so a project-scoped `argos-dev` and a user-scoped `argos-prod` can coexist without either shadowing the other.

## Security Considerations

### Environment Variable Security

`claude mcp add` records what you type verbatim, so a literal password becomes a plaintext string in `~/.claude.json` — and in `.mcp.json`, which is committed to git.

```bash
# Bad: the password is written into the registration and into shell history
claude mcp add argos --scope user -e DB_PASSWORD=actual_password_here -- node ...

# Good: the value is expanded from your environment at registration time
claude mcp add argos --scope user -e DB_PASSWORD="$DB_PASSWORD" -- node ...
```

For a project-scoped registration, keep credentials out of the registration entirely and leave them in the local `config.ini` — `.mcp.json` should describe how to start the server and nothing more.

### File Permissions

Protect your configuration files:

```bash
# Secure the Claude Code registration (it can hold env values)
chmod 600 ~/.claude.json

# Secure Argos config
chmod 600 config.ini

# Secure SSH keys
chmod 600 ~/.ssh/your_private_key
```

### SELECT-Only Mode

Always use SELECT-only mode for databases accessed through Claude:

```ini
[database.production]
type=postgresql
# ... connection details ...
select_only=true # Prevents INSERT/UPDATE/DELETE
```

## Usage Examples

### Data Analysis

Ask Claude to analyze your data:

```
Analyze user registration trends over the last 6 months. Show me monthly signup counts and identify any patterns.
```

### Business Intelligence

Get business insights:

```
Create a report showing our top-performing content categories by engagement metrics including views, comments, and user interactions.
```

### Database Administration

Get help with database tasks:

```
Check the database schema for any tables that might need indexing. Look for tables with many rows but no indexes on commonly queried columns.
```

### Performance Analysis

Analyze database performance:

```
Help me identify slow-running queries by analyzing the most complex queries in our application and suggesting optimizations.
```

## Next Steps

Now that Claude Code is connected to your databases:

1. **Learn Query Techniques** -> [Basic Queries Tutorial](04-basic-queries.md)
2. **Explore Advanced Features** -> [Configuration Guide](../guides/configuration-guide.md)
3. **Review Security Settings** -> [Security Guide](../guides/security-guide.md)
4. **Optimize Performance** -> [Performance Tuning Guide](../operations/performance-tuning.md)

## Configuration Reference

### Complete Registration Example

```bash
claude mcp add argos --scope user \
  -e NODE_ENV=production \
  -e LOG_LEVEL=INFO \
  -e DB_PROD_PASSWORD="$DB_PROD_PASSWORD" \
  -e DB_ANALYTICS_PASSWORD="$DB_ANALYTICS_PASSWORD" \
  -e SSH_PRIVATE_KEY=/secure/path/ssh_key \
  -- node /opt/argos/dist/cli.js serve --config /etc/argos/config.ini
```

Inspect what was stored with `claude mcp get argos`.

### Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Runtime environment | `production`, `development` |
| `LOG_LEVEL` | Logging level | `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `DB_PASSWORD` | Database password | `secure_password123` |
| `SSH_PRIVATE_KEY` | SSH key path | `/path/to/ssh/key` |
| `SSH_PASSPHRASE` | SSH key passphrase | `key_passphrase` |
| `CONFIG_PATH` | Custom config path | `/custom/path/config.ini` |

---

** Success!** Claude Code is now connected to your databases. Continue with the [Basic Queries Tutorial](04-basic-queries.md) to learn how to effectively use Claude for database operations.

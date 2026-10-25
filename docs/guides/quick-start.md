# Quick Start Guide

Get Argos up and running with Claude Code in less than 5 minutes.

## Prerequisites

Before you begin, ensure you have:

- **Node.js 22+** and **npm 10+** installed
- **Claude Code CLI** installed and on your `PATH` (`claude --version`)
- **Database credentials** for at least one supported database:
 - PostgreSQL, MySQL, SQLite, or SQL Server
 - Network access to your database (direct or via SSH)

## 5-Minute Setup

### Step 1: Build the Server

```bash
git clone https://github.com/AraneaDev/argos.git
cd Argos

# Install dependencies
npm install

# Build the project
npm run build
```

### Step 2: Run Interactive Setup

```bash
npm run setup
```

The setup wizard will guide you through:

1. **Database Configuration**
 - Database type (PostgreSQL/MySQL/SQLite/SQL Server)
 - Connection details (host, port, credentials)
 - SSH tunnel setup (if needed)
 - Security settings (SELECT-only mode recommended)

2. **Extension Settings**
 - Query result limits (default: 1,000 rows)
 - Query timeout (default: 30 seconds)
 - Batch operation limits (default: 10 queries)

3. **Security Configuration** (optional)
 - Query complexity limits
 - Performance safeguards

Example setup session:
```
=== Claude SQL Extension Configuration ===

Configuring database connection #1:
Database name (e.g., primary, analytics): production
Database type (postgresql/mysql/sqlite/mssql): postgresql
Database host: db.company.com
Database port (default: 5432): 
Database name: production_db
Username: readonly_user
Password: [hidden]
Use SSL? (y/n): y
Use SSH tunnel? (y/n): y

--- SSH Tunnel Configuration ---
SSH host: bastion.company.com
SSH port (default: 22): 
SSH username: deploy_user
SSH auth method (password/key): key
SSH private key path: ~/.ssh/id_rsa

--- Access Permissions ---
SELECT-only mode restricts this database to SELECT, WITH, SHOW, EXPLAIN, and DESCRIBE statements only.
This is recommended for production databases or read-only access scenarios.
Enable SELECT-only mode? (y/n): y

 Database 'production' configured with SELECT-only access
```

### Step 3: Test Connections

The setup wizard will offer to test your connections:

```
Test database connections now? (y/n): y

--- Testing Connections ---
Testing production...
 Connected
 SSH tunnel established
 Schema captured: 45 tables, 1,247 columns
 Access mode: SELECT-only
```

### Step 4: Register with Claude Code

From the repository root:

```bash
claude mcp add argos --scope user -- \
  node "$(pwd)/dist/cli.js" serve --config "$HOME/.config/argos/config.ini"
```

`--scope user` registers Argos for every project. Use `--scope project` instead to write a `.mcp.json` your team can commit, or omit the flag to keep it local to the current project.

### Step 5: Verify

```bash
claude mcp list
```

You should see `argos` reported as connected. Claude Code starts the server itself over stdio — there is no long-running process for you to launch. To check it by hand:

```bash
node dist/cli.js serve --config ~/.config/argos/config.ini
```

The process will sit waiting for JSON-RPC on stdin; `Ctrl+C` to exit. Errors surface in `argos.log` in the repository root.

## Your First Query

Once registered, open Claude Code and try:

> "Show me the users table schema from my production database"

or

> "Run a query to count active users in the production database"

Claude will now have access to your database through the MCP tools!

## Example Configuration Files

### Simple PostgreSQL Setup
```ini
[database.production]
type=postgresql
host=localhost
port=5432
database=myapp_production
username=readonly_user
password=secure_password
ssl=true
select_only=true
timeout=30000

[extension]
max_rows=1000
query_timeout=30000
max_batch_size=10
debug=false
```

### Multi-Database with SSH Tunnel
```ini
[database.production]
type=postgresql
host=internal-db.company.local
port=5432
database=production
username=app_reader
password=secure_pass
ssl=true
select_only=true
ssh_host=bastion.company.com
ssh_port=22
ssh_username=deploy_user
ssh_private_key=/home/user/.ssh/id_rsa

[database.analytics]
type=mysql
host=analytics.company.com
port=3306
database=analytics
username=analytics_user
password=analytics_pass
ssl=false
select_only=false
timeout=45000

[extension]
max_rows=1000
query_timeout=30000
max_batch_size=10
debug=false

[security]
max_joins=10
max_subqueries=5
max_unions=3
max_group_bys=5
max_complexity_score=100
max_query_length=10000
```

### SQLite Setup (Local Development)
```ini
[database.local]
type=sqlite
file=./data/app.db
select_only=false
mcp_configurable=true

[extension]
max_rows=500
query_timeout=15000
debug=true
```

## Common Configuration Options

### Database Types
| Type | Description | Default Port |
|------|-------------|--------------|
| `postgresql` | PostgreSQL database | 5432 |
| `mysql` | MySQL/MariaDB database | 3306 |
| `sqlite` | SQLite file database | N/A |
| `mssql` | Microsoft SQL Server | 1433 |

### Security Modes
- **SELECT-only (`select_only=true`)**: Restricts to read-only operations (recommended for production)
- **Full access (`select_only=false`)**: Allows all SQL operations (use with caution)

### SSH Tunneling
Perfect for secure access to remote databases:
```ini
ssh_host=bastion.example.com
ssh_port=22
ssh_username=tunnel_user
ssh_private_key=/path/to/key
# OR
ssh_password=ssh_password
```

## Security Best Practices

### Production Databases
Always use SELECT-only mode for production databases:
```ini
select_only=true # Blocks INSERT, UPDATE, DELETE, DROP, etc.
```

### Connection Security
- Use SSL/TLS connections (`ssl=true`)
- Use SSH tunnels for remote access
- Create dedicated database users with minimal permissions
- Use strong, unique passwords

### Query Limits
Configure appropriate limits for your use case:
```ini
[extension]
max_rows=1000 # Limit result sets
query_timeout=30000 # 30-second timeout

[security]
max_joins=10 # Prevent complex queries
max_complexity_score=100 # Overall complexity limit
```

## Troubleshooting Quick Fixes

### Connection Issues
```bash
# Test configuration
npm run setup
# Choose option 2: "Test existing connections"

# Check logs
tail -f argos.log
```

### Claude Code Not Recognizing the Server
1. Confirm it is registered: `claude mcp list` — Argos should appear as `argos`
2. Check the recorded command and paths: `claude mcp get argos`
3. Both paths in the command must be absolute — `~` and relative paths are not expanded when Claude Code spawns the process
4. Re-register after moving or rebuilding the repository:
 ```bash
 claude mcp remove argos --scope user
 claude mcp add argos --scope user -- \
   node "$(pwd)/dist/cli.js" serve --config "$HOME/.config/argos/config.ini"
 ```
5. Check `argos.log` in the repository root for startup errors

### Permission Denied
```sql
-- Check database user permissions
SHOW GRANTS FOR 'username'@'host'; -- MySQL
\du username -- PostgreSQL
```

### SSH Tunnel Issues
```bash
# Test SSH connection manually
ssh -i /path/to/key user@bastion.example.com

# Check SSH key permissions
chmod 600 ~/.ssh/id_rsa
```

## Next Steps

Once you have the basic setup working:

1. **[Configure Multiple Databases](../tutorials/advanced-01-multi-database.md)** - Add more database connections
2. **[Set Up SSH Tunneling](../tutorials/advanced-02-ssh-tunnels.md)** - Secure remote database access
3. **[Production Deployment](../operations/deployment-guide.md)** - Deploy for team use
4. **[Security Hardening](../operations/security-hardening.md)** - Enhanced security configuration

## Pro Tips

### Faster Setup
- Keep database credentials handy before running setup
- Use SSH key authentication instead of passwords
- Test connections individually if batch testing fails

### Better Performance
- Enable connection pooling with reasonable timeouts
- Use indexes on frequently queried columns
- Set appropriate `max_rows` limits for your use case

### Security
- Always start with SELECT-only mode
- Create dedicated database users for the MCP server
- Regularly rotate database credentials
- Monitor query patterns and complexity

---

**Need help?** Check the [troubleshooting guide](troubleshooting-guide.md) or [join our discussions](https://github.com/AraneaDev/argos/discussions).
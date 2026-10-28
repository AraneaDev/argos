# Installation Tutorial

This tutorial walks you through installing and setting up the Argos from start to finish.

## Prerequisites

### System Requirements

- **Node.js**: Version 24.15.0 or higher
- **npm**: Version 10.0.0 or higher 
- **Operating System**: Windows, macOS, or Linux
- **Memory**: At least 512MB RAM available
- **Disk Space**: 50MB for installation

### Supported Databases

The Argos supports these database systems:

- **PostgreSQL** 11+ (including Amazon RDS, Google Cloud SQL, Azure Database)
- **MySQL** 5.7+ and MariaDB 10.3+ (including cloud variants)
- **SQLite** 3.x (including in-memory databases)
- **Microsoft SQL Server** 2016+ (including Azure SQL Database)

## Installation Methods

### Method 0: Register with Claude Code (Easiest)

The fastest way to get started. Registration is handled by Claude Code's own CLI:

```bash
git clone https://github.com/AraneaDev/argos.git
cd Argos
npm install && npm run build

claude mcp add argos --scope user -- \
  node "$(pwd)/dist/cli.js" serve --config "$HOME/.config/argos/config.ini"
```

Then add your databases with the `sql_add_database` MCP tool directly from Claude, or run `npm run setup` to write `~/.config/argos/config.ini` by hand.

### Install from source

This is the only supported installation today. Argos is not on the npm registry
yet — the publish step in the release workflow is deliberately dormant until the
first public release — so `npm install -g argos-mcp` will not resolve.

```bash
git clone https://github.com/AraneaDev/argos.git
cd Argos
npm install
npm run build
```

`npm run build` type-checks before compiling, so a successful build has already
been type-checked. It produces the `argos` command:

```
dist/cli.js   argos serve (the MCP server) and argos setup (the configuration wizard)
```

**Version:**

<!-- x-release-please-start-version -->
```
Argos v6.1.0
```
<!-- x-release-please-end-version -->

The version comes from `package.json`; the server itself takes no `--version`
flag. Started without a client it simply waits on stdin, which is what an MCP
server does.

Optionally put the two commands on your `PATH`:

```bash
npm link      # provides the argos command
```

## Initial Configuration

### Quick Setup with Interactive Wizard

The easiest way to configure the server is using the interactive setup wizard:

```bash
# Run the setup wizard
npm run setup
# or if globally installed:
argos setup
```

The wizard will guide you through:

1. **Database Selection**: Choose your database type
2. **Connection Details**: Enter host, credentials, etc.
3. **Security Settings**: Configure access permissions
4. **SSH Tunneling**: Optional secure connections
5. **Extension Settings**: Performance and behavior options

### Example: PostgreSQL Setup

Here's what the interactive setup looks like for PostgreSQL:

```
 Argos Setup

=== Claude SQL Extension Configuration ===

Configuring database connection #1:
Database name (e.g., primary, analytics): production
Database type (postgresql/mysql/sqlite/mssql): postgresql
Database host: localhost
Database port (default: 5432): 5432
Database name: myapp
Username: readonly_user
Password: ********
Use SSL? (y/n): y
Use SSH tunnel? (y/n): n

--- Access Permissions ---
SELECT-only mode restricts this database to SELECT, WITH, SHOW, EXPLAIN, and DESCRIBE statements only.
This is recommended for production databases or read-only access scenarios.
Enable SELECT-only mode? (y/n): y

Connection timeout (ms, default: 30000): 30000
Add another database? (y/n): n

--- Extension Settings ---
Maximum rows per query (default: 1000): 1000
Query timeout (ms, default: 30000): 30000
Maximum queries in batch operations (default: 10): 10
Enable debug mode? (y/n): n

 Database 'production' configured with SELECT-only access
 Configuration saved to config.ini

Test database connections now? (y/n): y

--- Testing Connections ---
Testing production...
 Connected
 Schema captured: 15 tables, 127 columns
 Access mode: SELECT-only

 Configuration complete!
```

### Manual Configuration

You can also create the configuration file manually:

```bash
# Create config.ini file
cat > config.ini << 'EOF'
[database.primary]
type=postgresql
host=localhost
port=5432
database=myapp
username=readonly_user
password=your_password
ssl=true
select_only=true
timeout=30000

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
max_batch_size=10
debug=false
EOF
```

## Verification Steps

### 1. Test Server Startup

```bash
# Start the server
argos serve
# or if installed locally:
npx @araneadev/argos serve
```

**Expected Output:**
```
 Argos starting...
 Loaded 1 database configuration(s):
 - primary (postgresql, SELECT-only)
 Security manager initialized
 MCP Server listening on stdio
```

### 2. Test Database Connection

```bash
# Test connections (if server is running)
npm run setup
# or via setup:
npm run setup
```

**Expected Output:**
```
--- Testing Connections ---
Testing primary...
 Connected
 Schema captured: 15 tables, 127 columns
 Access mode: SELECT-only
```

### 3. Verify MCP Protocol

```bash
# Test MCP protocol communication
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | argos serve
```

**Expected Response:**
```json
{
 "jsonrpc": "2.0",
 "id": 1,
 "result": {
 "tools": [
 {
 "name": "sql_query",
 "description": "Execute SQL queries with safety validation"
 },
 {
 "name": "sql_list_databases",
 "description": "List all configured databases"
 }
 ]
 }
}
```

## Common Installation Issues

### Issue 1: Node.js Version

**Error:**
```
Error: Node.js version 22.x is not supported
```

**Solution:**
```bash
# Check Node.js version
node --version

# Install Node.js 24+ using nvm (Linux/macOS)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 24
nvm use 24

# Or download from nodejs.org for Windows
```

### Issue 2: Permission Denied

**Error:**
```
Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules'
```

**Solution:**
```bash
# Fix npm permissions (Linux/macOS)
sudo chown -R $(whoami) $(npm config get prefix)/{lib/node_modules,bin,share}

# Or use npx instead of global install
npx @araneadev/argos serve
```

### Issue 3: Database Connection Failed

**Error:**
```
 Failed: Connection refused
```

**Solutions:**

1. **Check database is running:**
 ```bash
 # PostgreSQL
 sudo systemctl status postgresql
 
 # MySQL
 sudo systemctl status mysql
 
 # Check if port is open
 telnet localhost 5432
 ```

2. **Verify credentials:**
 ```sql
 -- Test connection manually
 psql -h localhost -U readonly_user -d myapp
 ```

3. **Check firewall settings:**
 ```bash
 # Allow database port through firewall
 sudo ufw allow 5432
 ```

### Issue 4: SSL Connection Issues

**Error:**
```
 Failed: SSL connection error
```

**Solutions:**

1. **Disable SSL for testing:**
 ```ini
 [database.primary]
 ssl=false
 ```

2. **Check server SSL configuration:**
 ```sql
 -- PostgreSQL: Check SSL settings
 SHOW ssl;
 ```

3. **Use self-signed certificate:**
 ```ini
 [database.primary]
 ssl=true
 # Server handles self-signed certificates automatically
 ```

## Configuration Templates

### Template 1: Development Setup

```ini
[database.dev]
type=sqlite
file=./dev_database.db
select_only=false
timeout=10000

[extension]
max_rows=100
query_timeout=10000
max_batch_size=5
debug=true

[security]
max_joins=5
max_subqueries=3
max_complexity_score=50
```

### Template 2: Production Setup

```ini
[database.prod]
type=postgresql
host=prod-db.company.com
port=5432
database=production
username=readonly_service
password=${DB_PASSWORD}
ssl=true
select_only=true
timeout=30000

[database.analytics]
type=mysql
host=analytics-db.company.com
port=3306
database=analytics
username=analytics_readonly
password=${ANALYTICS_PASSWORD}
ssl=true
select_only=true
timeout=15000

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
max_batch_size=10
debug=false
```

### Template 3: SSH Tunnel Setup

```ini
[database.remote]
type=postgresql
host=internal-db.company.local
port=5432
database=production
username=app_user
password=db_password
ssl=true
select_only=true

# SSH Tunnel Configuration
ssh_host=bastion.company.com
ssh_port=22
ssh_username=deploy_user
ssh_private_key=/path/to/private/key
# ssh_passphrase=optional_key_passphrase

[security]
max_joins=10
max_subqueries=5
max_complexity_score=100

[extension]
max_rows=1000
query_timeout=60000
debug=false
```

## Environment Variables

### Using Environment Variables for Sensitive Data

```bash
# Set environment variables
export DB_PASSWORD="your_secure_password"
export ANALYTICS_PASSWORD="another_secure_password"

# Reference in config.ini
[database.prod]
password=${DB_PASSWORD}
```

### Supported Environment Variables

- `DB_PASSWORD` - Database password
- `DB_HOST` - Database host override
- `SSH_PRIVATE_KEY` - SSH private key path
- `NODE_ENV` - Environment mode (development/production)
- `DEBUG` - Enable debug output
- `CONFIG_PATH` - Custom configuration file path

## Starting the Server

### Development Mode

```bash
# Start with debug output
DEBUG=argos:* argos serve

# Start with custom config
argos serve --config=/path/to/custom/config.ini

# Start with environment override
NODE_ENV=development argos serve
```

### Production Mode

```bash
# Start as background service
nohup argos serve > server.log 2>&1 &

# Using systemd (Linux)
sudo systemctl start argos
sudo systemctl enable argos

# Using PM2 process manager
npm install -g pm2
pm2 start argos --name "argos" -- serve
pm2 startup
pm2 save
```

### Docker Deployment

```dockerfile
FROM node:24-alpine

WORKDIR /app
RUN git clone https://github.com/AraneaDev/argos.git . \
 && npm ci && npm run build

COPY config.ini /etc/argos/config.ini
```

There is no port to expose and no long-running container to start. Argos speaks
over stdio, so the image is only useful if the MCP client runs inside it and
starts `node /app/dist/cli.js serve --config /etc/argos/config.ini` as a child
process. An image that runs the server on its own has nothing talking to it and
exits immediately.

## Next Steps

After successful installation:

1. **Register with Claude Code** -> [Claude Integration Tutorial](03-claude-integration.md)
2. **Learn Basic Query Operations** -> [Basic Queries Tutorial](04-basic-queries.md)
3. **Review Security Configuration** -> [Security Guide](../guides/security-guide.md)
4. **Explore Advanced Features** -> [Configuration Guide](../guides/configuration-guide.md)

## Command Reference

### Installation Commands
```bash
git clone https://github.com/AraneaDev/argos.git   # the supported install
npm install && npm run build
npm link                                               # optional: argos on PATH
```

### Configuration Commands
```bash
argos setup # Interactive configuration
argos setup --template=production # Generate template
argos setup --config=/path/to/config.ini # Custom config path
```

### Server Commands
```bash
argos serve # Start the server on stdio (Claude Code does this for you)
argos version # Show version
argos help # Show help
```

### Claude Code Registration
```bash
claude mcp add argos --scope user -- node /abs/path/dist/cli.js serve --config /abs/path/config.ini
claude mcp list # Confirm argos is connected
claude mcp get argos # Show the recorded command and scope
claude mcp remove argos --scope user
```

### Runtime Tools

Connection testing, schema inspection, and performance analysis are exposed as MCP tools rather than shell commands — call `sql_test_connection`, `sql_get_schema`, and `sql_analyze_performance` from Claude.

## Getting Help

### Documentation Resources

- **[Configuration Guide](../guides/configuration-guide.md)** - Complete configuration reference
- **[Troubleshooting Guide](../guides/troubleshooting-guide.md)** - Common issues and solutions
- **[Security Guide](../guides/security-guide.md)** - Security best practices

### Community Support

- **GitHub Issues** - Bug reports and feature requests
- **GitHub Discussions** - Questions and community support
- **Documentation** - Comprehensive guides and examples

### Professional Support

- **Enterprise Support** - Priority support for commercial users
- **Consulting Services** - Custom deployment and integration
- **Training** - Team training and best practices

---

** Congratulations!** You've successfully installed the Argos. Continue with the [Claude Integration Tutorial](03-claude-integration.md) to register it with Claude Code.

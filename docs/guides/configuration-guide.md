# Configuration Guide

This comprehensive guide covers all configuration options for the Argos, from basic setup to advanced enterprise deployments.

## Table of Contents

- [Configuration Overview](#configuration-overview)
- [Database Configuration](#database-configuration)
- [Security Configuration](#security-configuration)
- [Extension Configuration](#extension-configuration)
- [Dynamic Database Management via MCP](#dynamic-database-management-via-mcp)
- [Field Redaction](#field-redaction)
- [SSH Tunnel Configuration](#ssh-tunnel-configuration)
- [Configuration Examples](#configuration-examples)
- [Configuration Validation](#configuration-validation)
- [Environment Variables](#environment-variables)
- [Advanced Configuration](#advanced-configuration)

---

## Configuration Overview

### Configuration File Location
The Argos uses an INI-format configuration file:
- **Default location**: `./config.ini`
- **Custom location**: Specify via command line or environment variable

### Configuration Structure
```ini
# Database connections
[database.name1]
type=postgresql
host=localhost
# ... database-specific options

[database.name2]
type=mysql
host=mysql.example.com
# ... database-specific options

# Global security settings
[security]
max_joins=10
max_complexity_score=100
# ... security options

# Server extension settings
[extension]
max_rows=1000
query_timeout=30000
# ... operational options
```

### Configuration Hierarchy
Settings are resolved in this order (highest priority first):
1. Command line arguments
2. Environment variables
3. Configuration file
4. Default values

---

## Database Configuration

### Basic Database Section
Each database requires its own section with the naming pattern `[database.name]`:

```ini
[database.mydb]
type=postgresql # Required: Database type
host=localhost # Required: Database host (except SQLite)
```

### Supported Database Types
- `postgresql` / `postgres`
- `mysql`
- `sqlite`
- `mssql` / `sqlserver`

### Boolean Values

Anywhere a parameter takes a yes/no answer, write one of:

| Meaning | Accepted |
|---------|----------|
| on | `true`, `1`, `yes`, `on`, `enabled` |
| off | `false`, `0`, `no`, `off`, `disabled` |

Case and surrounding spaces do not matter. Anything else is refused at startup
with an error naming the database and the field, rather than being read as
`off`. Several of these parameters are security settings: `select_only`,
`ssl_verify` and `ssh_strict_host_key_checking` all protect something, so a
value Argos cannot read is reported instead of guessed.

### Common Database Parameters

#### Required Parameters
| Parameter | Description | Example |
|-----------|-------------|---------|
| `type` | Database type | `postgresql` |
| `select_only` | Restrict to SELECT queries | `true` |

#### Connection Parameters
| Parameter | Default | Description | Example |
|-----------|---------|-------------|---------|
| `host` | - | Database hostname | `db.example.com` |
| `port` | *varies* | Database port | `5432` |
| `database` | - | Database name | `myapp` |
| `username` | - | Username | `readonly_user` |
| `password` | - | Password | `secure_password` |

#### Connection Options
| Parameter | Default | Description | Example |
|-----------|---------|-------------|---------|
| `ssl` | `false` | Enable SSL/TLS | `true` |
| `timeout` | `30000` | Connection timeout (ms) | `15000` |
| `mcp_configurable` | `false` | Allow MCP tools to modify this database config | `true` |
| `require_readonly_role` | `false` | Refuse a `select_only` connection whose database role can write, or whose privileges could not be checked. Off, the check only warns; see [Database role check](security-guide.md#database-role-check) | `true` |
| `name_check` | `true` | Check column names against the cached schema before a SELECT runs; see [Name Checking](../api/mcp-tools-reference.md#name-checking) | `false` |

#### SQLite-Specific Parameters
| Parameter | Description | Example |
|-----------|-------------|---------|
| `file` | SQLite file path | `./data/mydb.sqlite` |

#### SQL Server-Specific Parameters
| Parameter | Default | Description | Example |
|-----------|---------|-------------|---------|
| `encrypt` | `true` | Enable connection encryption | `false` |
| `authentication` | `sql` | Authentication mode: `sql` or `azure-cli` | `azure-cli` |
| `azure_tenant_id` | *CLI's active tenant* | Tenant to take the Azure CLI token from (GUID) | `00000000-0000-0000-0000-000000000000` |
| `azure_config_dir` | *the server's profile* | Azure CLI profile directory (as `AZURE_CONFIG_DIR`) this database takes its token from, so it can use its own reader identity | `~/.azure-claude-ro` |

With `authentication=azure-cli` the connection uses the identity already signed
in to the Azure CLI, so `username` and `password` are neither required nor read.
See the [SQL Server guide](../databases/sql-server.md#azure-cli-authentication).

PostgreSQL takes `authentication=azure-cli` and `azure_tenant_id` too, for Azure
Database for PostgreSQL. There `username` is still required: it is the Entra
principal's name. See the
[PostgreSQL guide](../databases/postgresql.md#azure-database-for-postgresql-with-azure-cli-authentication).

### Default Port Numbers
- **PostgreSQL**: 5432
- **MySQL**: 3306
- **SQL Server**: 1433
- **SQLite**: N/A (file-based)

---

## Security Configuration

### Security Section
Global security settings apply to all databases:

```ini
[security]
max_joins=10
max_subqueries=5
max_unions=3
max_group_bys=5
max_complexity_score=100
max_query_length=10000
```

### Security Parameters

#### Query Complexity Limits
| Parameter | Default | Description | Range |
|-----------|---------|-------------|-------|
| `max_joins` | `10` | Maximum JOIN operations | 1-100 |
| `max_subqueries` | `5` | Maximum subqueries | 1-50 |
| `max_unions` | `3` | Maximum UNION operations | 1-20 |
| `max_group_bys` | `5` | Maximum GROUP BY clauses | 1-50 |
| `max_complexity_score` | `100` | Overall complexity limit | 10-1000 |
| `max_query_length` | `10000` | Maximum query characters | 100-100000 |

#### SELECT-Only Mode
Configure per database:
```ini
[database.production]
type=postgresql
host=prod-db.com
select_only=true # Recommended for production

[database.development]
type=postgresql
host=dev-db.com
select_only=false # Allow writes in development
```

---

## Extension Configuration

### Extension Section
Server operational settings:

```ini
[extension]
max_rows=1000
max_batch_size=10
query_timeout=30000
```

### Extension Parameters

#### Result Management
| Parameter | Default | Description | Range |
|-----------|---------|-------------|-------|
| `max_rows` | `1000` | Maximum rows per query | 1-100000 |
| `max_batch_size` | `10` | Maximum queries per batch | 1-100 |
| `query_timeout` | `30000` | Query timeout (ms) | 1000-600000 |

#### Performance Settings
Performance features such as **Connection Pooling** (10 connections for PostgreSQL and pooled drivers) and **Schema Caching** (persistent in `./schemas/` on-demand) are managed internally by the server. 
Logging verbosity can be set via command-line arguments or environment variables (`LOG_LEVEL`).

---

## Dynamic Database Management via MCP

### Overview
Databases can be added, updated, and removed at runtime using MCP tools. This is controlled by the `mcp_configurable` flag on each database.

### The `mcp_configurable` Flag
| Value | Meaning |
|-------|---------|
| `true` | Database can be modified/removed via MCP tools |
| `false` (default) | Database is locked -- only manual config.ini editing can change it |

**Security design:**
- Databases added via MCP tools (`sql_add_database`) always start with `mcp_configurable=true`
- Databases defined manually in config.ini default to `mcp_configurable=false`
- The `sql_set_mcp_configurable` tool can only set the value to `false` (lock)
- Re-enabling `mcp_configurable=true` requires manual config.ini editing -- this prevents an AI from re-enabling its own access after a human locks it

### Configuration Example
```ini
[database.production]
type=postgresql
host=db.company.com
database=production
username=readonly
password=secret
select_only=true
mcp_configurable=false ; Locked - manual config only

[database.sandbox]
type=postgresql
host=sandbox-db.company.com
database=sandbox
username=dev_user
password=dev_pass
select_only=false
mcp_configurable=true ; Can be modified via MCP tools
```

### Available MCP Tools
| Tool | Description | Requires mcp_configurable |
|------|-------------|--------------------------|
| `sql_add_database` | Add a new database | N/A (always creates with true) |
| `sql_update_database` | Update database settings | Yes |
| `sql_remove_database` | Remove a database | Yes |
| `sql_get_config` | View config (passwords redacted) | No |
| `sql_set_mcp_configurable` | Lock database from MCP changes | N/A (one-way lock) |

---

## Field Redaction

Automatically mask sensitive data in query results before they reach Claude or other clients. Redaction is configured per-database. For the full guide with examples, see **[Field Redaction](../features/field-redaction.md)**.

### Enabling Redaction

Add redaction settings to any `[database.*]` section:

```ini
[database.production]
type=postgresql
host=prod-db.company.com
database=app_db
username=readonly_user
password=secure_pass

# Field Redaction
redaction_enabled=true
redaction_rules=*email*:partial_mask,*phone*:full_mask,ssn:replace:[PROTECTED]
```

### Redaction Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `redaction_enabled` | `false` | Enable redaction for this database |
| `redaction_rules` | - | Comma-separated rules in `field:type[:options]` format |
| `redaction_replacement_text` | `[REDACTED]` | Default text for `replace` type |
| `redaction_log_access` | `false` | Log when redacted fields are accessed |
| `redaction_case_sensitive` | `false` | Case-sensitive field name matching |
| `redaction_audit_queries` | `false` | Audit trail for queries touching redacted fields |

### Rule Format

Rules use the format `field_pattern:redaction_type[:options]`:

**Field patterns:**
- **Exact**: `email` — matches only fields named "email"
- **Wildcard**: `*email*` — matches any field containing "email"
- **Regex**: `/^user_.+$/` — regex matching

**Redaction types:**
| Type | Effect | Example |
|------|--------|---------|
| `full_mask` | Replace entire value with `*` | `john@email.com` -> `**********` |
| `partial_mask` | Smart format-preserving mask | `john.doe@example.com` -> `j******.e@*****.com` |
| `replace` | Fixed text replacement | `123-45-6789` -> `[PROTECTED]` |
| `custom` | Regex pattern replacement | Custom regex match/replace |

### Example: Multi-Rule Configuration

```ini
redaction_rules=*email*:partial_mask,*phone*:full_mask,*ssn*:replace:[SSN],*password*:replace:[HIDDEN],customer_id:replace:[CUST_ID]
```

---

## SSH Tunnel Configuration

### SSH Parameters per Database
Add SSH tunnel settings to any database configuration:

```ini
[database.remote_db]
type=postgresql
host=internal-db.company.local # Internal database host
port=5432
database=production
username=readonly_user
password=db_password

# SSH Tunnel Configuration
ssh_host=bastion.company.com # SSH bastion host
ssh_port=22 # SSH port
ssh_username=tunnel_user # SSH username
ssh_private_key=/path/to/key # SSH private key path
ssh_passphrase=key_passphrase # SSH key passphrase (if encrypted)
```

### SSH Authentication Methods

#### Private Key Authentication (Recommended)
```ini
ssh_host=bastion.example.com
ssh_username=service_user
ssh_private_key=/secure/path/to/ssh_key
ssh_passphrase=optional_passphrase
```

#### Password Authentication
```ini
ssh_host=bastion.example.com
ssh_username=tunnel_user
ssh_password=ssh_password
```

### SSH Key Management
```bash
# Generate SSH key
ssh-keygen -t rsa -b 4096 -f ~/.ssh/sql_mcp_key

# Set proper permissions
chmod 600 ~/.ssh/sql_mcp_key
chmod 644 ~/.ssh/sql_mcp_key.pub

# Copy to bastion host
ssh-copy-id -i ~/.ssh/sql_mcp_key.pub user@bastion.host.com
```

---

## Configuration Examples

### Local Development Setup
```ini
[database.development]
type=sqlite
file=./dev.sqlite
select_only=false

[database.test_postgres]
type=postgresql
host=localhost
port=5432
database=test_db
username=test_user
password=test_password
ssl=false
select_only=false

[security]
# Relaxed limits for development
max_joins=20
max_complexity_score=200

[extension]
max_rows=5000
query_timeout=60000
```

### Production Environment
```ini
[database.production_read]
type=postgresql
host=prod-replica.company.com
port=5432
database=production
username=readonly_service
password=complex_secure_password
ssl=true
select_only=true
timeout=15000

[database.analytics]
type=postgresql
host=analytics-db.company.com
port=5432
database=data_warehouse
username=analytics_user
password=analytics_password
ssl=true
select_only=true

[security]
# Strict production limits
max_joins=5
max_subqueries=3
max_complexity_score=50
max_query_length=5000

[extension]
max_rows=1000
max_batch_size=5
query_timeout=30000
```

### Multi-Database Analytics
```ini
[database.transactions]
type=postgresql
host=txn-db.company.com
database=transactions
username=analytics_readonly
password=txn_password
ssl=true
select_only=true

[database.users]
type=mysql
host=user-db.company.com
database=users
username=analytics_readonly
password=user_password
ssl=true
select_only=true

[database.events]
type=postgresql
host=events-db.company.com
database=events
username=analytics_readonly
password=events_password
ssl=true
select_only=true

[database.local_cache]
type=sqlite
file=./cache/analytics.sqlite
select_only=false

[extension]
max_rows=2000
max_batch_size=15
```

### SSH Tunnel Setup
```ini
[database.secure_production]
type=postgresql
host=10.0.1.100 # Internal database IP
port=5432
database=production
username=readonly_user
password=db_password
ssl=true
select_only=true

# SSH tunnel through bastion
ssh_host=bastion.company.com
ssh_port=22
ssh_username=service_account
ssh_private_key=/etc/argos/keys/production.key

[database.multi_hop]
type=mysql
host=192.168.1.50 # Database behind multiple firewalls
port=3306
database=internal_app
username=readonly_user
password=mysql_password

# Multi-hop SSH tunnel
ssh_host=external-bastion.company.com
ssh_port=2222
ssh_username=tunnel_service
ssh_private_key=/secure/keys/multi_hop.key
ssh_passphrase=key_encryption_password
```

---

## Configuration Validation

### Interactive Setup Wizard
Use the built-in wizard for guided configuration:

```bash
# Start configuration wizard
argos setup

# Follow prompts:
? Select database type: PostgreSQL
? Database host: db.example.com
? Database port: 5432
? Database name: myapp
? Username: readonly_user
? Password: [hidden]
? Enable SSL? Yes
? SELECT-only mode? Yes (recommended)
? Configure SSH tunnel? Yes
? SSH host: bastion.example.com
```

### Manual Configuration Validation

#### Check Configuration Syntax
```bash
# Validate configuration file
node -e "console.log(require('ini').parse(require('fs').readFileSync('config.ini', 'utf8')))"
```

#### Test Database Connections
Use the connection test tool:

```typescript
// Test all configured databases
await server.testConnection('production');
await server.testConnection('analytics');
```

### Common Validation Errors

#### Missing Required Fields
```
 Database 'mydb' missing required field 'type'
 PostgreSQL database 'prod' missing required field 'host'
 SQLite database 'cache' missing required field 'file'
```

#### Invalid Configuration Values
```
 Invalid database type 'postgress' (did you mean 'postgresql'?)
 Invalid port '5432abc' - must be a number
 Security limit 'max_joins' must be between 1 and 100
```

---

## Environment Variables

### Override Configuration with Environment Variables

#### Database Configuration
```bash
# Override database host
export SQL_MCP_DATABASE_PRODUCTION_HOST=new-host.example.com

# Override database password (recommended for security)
export SQL_MCP_DATABASE_PRODUCTION_PASSWORD=secure_password

# Override SSH configuration
export SQL_MCP_DATABASE_PRODUCTION_SSH_HOST=new-bastion.example.com
```

#### Global Configuration
```bash
# Override security settings
export SQL_MCP_SECURITY_MAX_JOINS=15
export SQL_MCP_SECURITY_MAX_COMPLEXITY_SCORE=150

# Override extension settings
export SQL_MCP_EXTENSION_MAX_ROWS=2000
export SQL_MCP_EXTENSION_QUERY_TIMEOUT=45000
```

### Environment Variable Naming Convention
- Prefix: `SQL_MCP_`
- Section: `DATABASE_<name>_` or `SECURITY_` or `EXTENSION_`
- Parameter: `<PARAMETER_NAME>` (uppercase)

Examples:
- `SQL_MCP_DATABASE_PROD_HOST`
- `SQL_MCP_SECURITY_MAX_JOINS`
- `SQL_MCP_EXTENSION_MAX_ROWS`

### Docker Environment Configuration
```dockerfile
# Dockerfile
FROM node:24-alpine
COPY . /app
WORKDIR /app

# Set configuration via environment
ENV SQL_MCP_DATABASE_PRODUCTION_HOST=db.production.local
ENV SQL_MCP_DATABASE_PRODUCTION_PASSWORD_FILE=/run/secrets/db_password
ENV SQL_MCP_SECURITY_MAX_JOINS=5
ENV SQL_MCP_EXTENSION_MAX_ROWS=1000

CMD ["node", "dist/cli.js", "serve"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
 argos:
 image: argos
 environment:
 - SQL_MCP_DATABASE_APP_HOST=postgres
 - SQL_MCP_DATABASE_APP_PASSWORD=docker_password
 depends_on:
 - postgres

 postgres:
 image: postgres:15
 environment:
 POSTGRES_PASSWORD: docker_password
```

---

## Advanced Configuration (Planned Features)

The following advanced configuration features are planned for future releases:

- **Configuration Templates**: Reusable configuration templates for common setups
- **Dynamic Configuration**: Now implemented via the `mcp_configurable` flag and the MCP config tools (`sql_add_database`, `sql_update_database`, `sql_remove_database`, `sql_get_config`, `sql_set_mcp_configurable`). See the [Dynamic Database Management via MCP](#dynamic-database-management-via-mcp) section for details.
- **Configuration Encryption**: Encrypted storage for sensitive configuration values
- **Profile-Based Configuration**: Environment-specific configuration profiles

For the current release, use environment variables for sensitive values and configuration file for static settings.

---

## Configuration Troubleshooting

### Common Issues and Solutions

#### Configuration File Not Found
```
 Error: No config.ini found
```
**Solutions:**
1. Create configuration file: `touch config.ini`
2. Run setup wizard: `argos setup`
3. Specify custom path: `--config=/path/to/config.ini`

#### Permission Denied Reading Configuration
```
 Error: EACCES: permission denied, open 'config.ini'
```
**Solutions:**
1. Fix file permissions: `chmod 644 config.ini`
2. Check directory permissions
3. Run as appropriate user

#### Invalid Configuration Syntax
```
 Error: Invalid INI syntax at line 15
```
**Solutions:**
1. Validate INI syntax
2. Check for missing quotes around special characters
3. Ensure proper section headers `[section.name]`

#### Database Connection Failed
```
 Error: Connection failed to database 'production'
```
**Solutions:**
1. Verify all required parameters are provided
2. Test database connectivity manually
3. Check firewall and network settings
4. Validate credentials

### Configuration Validation Tools

#### Built-in Validation
```bash
# Validate configuration
argos serve --validate-config

# Test specific database
argos serve --test-database=production
```

#### External Validation
```bash
# Use external INI validator
npm install -g ini-validator
ini-validator config.ini

# JSON schema validation
npm install -g ajv-cli
ajv validate -s config-schema.json -d config.json
```

This comprehensive configuration guide provides all the information needed to properly configure the Argos for any environment, from local development to enterprise production deployments.
# Tutorial 2: Connecting Your First Database

This tutorial walks you through connecting your first database to the Argos, from initial setup to running your first query with Claude Code.

## What You'll Learn

- How to configure different database types
- Setting up secure connections with SSL/SSH
- Testing database connectivity
- Making your first Claude query

## Prerequisites

- Argos installed ([Tutorial 1: Installation](01-installation.md))
- A database to connect to (PostgreSQL, MySQL, SQLite, or SQL Server)
- Database credentials and network access

## Database Connection Examples

### PostgreSQL Database

#### Basic Local Connection
```ini
[database.local_postgres]
type=postgresql
host=localhost
port=5432
database=myapp_development
username=postgres
password=postgres123
ssl=false
select_only=true
timeout=30000
```

#### Secure Production Connection
```ini
[database.production]
type=postgresql
host=db.company.com
port=5432
database=production_db
username=readonly_user
password=secure_random_password
ssl=true
select_only=true
timeout=15000
```

#### With SSH Tunnel
```ini
[database.remote_postgres]
type=postgresql
host=internal-db.company.local
port=5432
database=analytics
username=analytics_reader
password=analytics_pass
ssl=true
select_only=true
timeout=30000

# SSH Tunnel Configuration
ssh_host=bastion.company.com
ssh_port=22
ssh_username=deploy_user
ssh_private_key=/home/user/.ssh/id_rsa
ssh_passphrase=optional_key_passphrase
local_port=0
```

### MySQL Database

#### Basic Connection
```ini
[database.local_mysql]
type=mysql
host=localhost
port=3306
database=webapp
username=app_user
password=app_password
ssl=false
select_only=true
timeout=30000
```

#### Production with SSL
```ini
[database.mysql_prod]
type=mysql
host=mysql.company.com
port=3306
database=production
username=readonly
password=secure_mysql_pass
ssl=true
select_only=true
timeout=20000
```

### SQLite Database

#### Local File Database
```ini
[database.local_sqlite]
type=sqlite
file=./data/application.sqlite
select_only=true
```

#### Shared Development Database
```ini
[database.dev_sqlite]
type=sqlite
file=/shared/development/app.db
select_only=false
```

### SQL Server Database

#### Windows Authentication
```ini
[database.sqlserver_local]
type=mssql
host=localhost
port=1433
database=AdventureWorks
username=sa
password=SqlServer123!
ssl=false
encrypt=true
select_only=true
timeout=30000
```

#### Azure SQL Database
```ini
[database.azure_sql]
type=mssql
host=myserver.database.windows.net
port=1433
database=mydatabase
username=azureuser@myserver
password=azure_password
ssl=true
encrypt=true
select_only=true
timeout=30000
```

## Step-by-Step Configuration

### Step 1: Choose Your Database

Decide which database you want to connect first. For this tutorial, we'll use PostgreSQL, but the process is similar for all database types.

### Step 2: Gather Connection Information

You'll need:
- **Host/Server**: Database server hostname or IP address
- **Port**: Database port (default: PostgreSQL=5432, MySQL=3306, SQL Server=1433)
- **Database Name**: Name of the specific database/schema
- **Username**: Database user account
- **Password**: User password
- **SSL Requirements**: Whether the database requires encrypted connections

### Step 3: Run the Setup Wizard

```bash
npm run setup
```

The interactive wizard will guide you through configuration:

```
=== Claude SQL Extension Configuration ===

Configuring database connection #1:
Database name (e.g., primary, analytics): production
Database type (postgresql/mysql/sqlite/mssql): postgresql
Database host: db.company.com
Database port (default: 5432): 
Database name: production_app
Username: app_readonly
Password: [hidden]
Use SSL? (y/n): y
Use SSH tunnel? (y/n): n

--- Access Permissions ---
SELECT-only mode restricts this database to SELECT, WITH, SHOW, EXPLAIN, and DESCRIBE statements only.
This is recommended for production databases or read-only access scenarios.
Enable SELECT-only mode? (y/n): y

 Database 'production' configured with SELECT-only access
```

### Step 4: Test the Connection

The setup wizard will offer to test your connection:

```
Test database connections now? (y/n): y

--- Testing Connections ---
Testing production...
 Connected
 Schema captured: 23 tables, 456 columns
 Access mode: SELECT-only
```

If the test fails, you'll see diagnostic information:

```
 Connection failed: Connection timeout after 30000ms

Troubleshooting:
- Verify database host and port are correct
- Check firewall rules allow connections
- Ensure database credentials are correct
- Try increasing timeout value
```

### Step 5: Start the MCP Server

```bash
npm start
```

You should see:
```
Argos running on stdio
Connection established: production
Schema cached: production
Server ready for Claude Code integration
```

## Security Configuration Deep Dive

### SELECT-Only Mode (Recommended for Production)

SELECT-only mode provides read-only access to your database:

```ini
# Production database - read-only access
[database.production]
type=postgresql
host=prod-db.company.com
database=production
username=readonly_user
password=readonly_pass
ssl=true
select_only=true # <- This enables read-only mode
```

**What's Allowed:**
- `SELECT` - Query data
- `WITH` - Common table expressions
- `SHOW` - Database information (MySQL/PostgreSQL specific)
- `EXPLAIN` - Query execution plans
- `DESCRIBE` - Table structure information

**What's Blocked:**
- `INSERT`, `UPDATE`, `DELETE` - Data modification
- `CREATE`, `ALTER`, `DROP` - Schema changes 
- `TRUNCATE` - Data deletion
- `EXEC`, `CALL` - Stored procedure execution

### Full Access Mode (Use with Caution)

```ini
# Development database - full access
[database.development]
type=postgresql
host=dev-db.company.local
database=development
username=dev_user
password=dev_pass
ssl=false
select_only=false # <- Full access mode
```

**Use Cases for Full Access:**
- Development and testing databases
- Data import/export operations
- Database maintenance tasks
- When you need write operations

### SSL/TLS Configuration

Always use SSL for production databases:

```ini
# PostgreSQL with SSL
[database.secure_postgres]
ssl=true # Enable SSL/TLS encryption

# SQL Server with encryption
[database.secure_mssql]
ssl=true
encrypt=true # SQL Server specific encryption
```

### SSH Tunneling for Remote Access

For databases behind firewalls or on private networks:

```ini
[database.remote_secure]
type=postgresql
host=internal-db-server.local # Internal hostname
port=5432
database=production
username=app_user
password=secure_pass
ssl=true
select_only=true

# SSH Tunnel through bastion host
ssh_host=bastion.company.com
ssh_port=22
ssh_username=tunnel_user

# SSH Key Authentication (Recommended)
ssh_private_key=/path/to/ssh/key
ssh_passphrase=key_passphrase # If key is encrypted

# OR Password Authentication
# ssh_password=ssh_password

local_port=0 # Auto-assign local port
```

## Database-Specific Setup Tips

### PostgreSQL

**Create a Read-Only User:**
```sql
-- Create dedicated user
CREATE USER claude_readonly WITH PASSWORD 'secure_random_password';

-- Grant schema usage
GRANT USAGE ON SCHEMA public TO claude_readonly;

-- Grant SELECT on all current tables
GRANT SELECT ON ALL TABLES IN SCHEMA public TO claude_readonly;

-- Grant SELECT on all future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
 GRANT SELECT ON TABLES TO claude_readonly;

-- Allow EXPLAIN queries
GRANT EXECUTE ON FUNCTION pg_stat_statements_reset() TO claude_readonly;
```

**Connection String Format:**
```
postgresql://username:password@host:port/database?sslmode=require
```

### MySQL

**Create a Read-Only User:**
```sql
-- Create user
CREATE USER 'claude_readonly'@'%' IDENTIFIED BY 'secure_random_password';

-- Grant SELECT privileges
GRANT SELECT ON myapp_production.* TO 'claude_readonly'@'%';

-- Allow SHOW commands
GRANT SHOW VIEW ON myapp_production.* TO 'claude_readonly'@'%';

-- Refresh privileges
FLUSH PRIVILEGES;
```

**MySQL 8.0+ Authentication:**
```sql
-- For compatibility with older auth methods
CREATE USER 'claude_readonly'@'%' IDENTIFIED WITH mysql_native_password BY 'password';
```

### SQLite

**File Permissions:**
```bash
# Set appropriate file permissions
chmod 644 /path/to/database.sqlite

# For read-only access
chmod 444 /path/to/database.sqlite
```

**WAL Mode for Better Concurrency:**
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
```

### SQL Server

**Create a Read-Only User:**
```sql
-- Create login and user
CREATE LOGIN claude_readonly WITH PASSWORD = 'SecurePassword123!';
USE YourDatabase;
CREATE USER claude_readonly FOR LOGIN claude_readonly;

-- Grant read permissions
ALTER ROLE db_datareader ADD MEMBER claude_readonly;

-- Allow view definitions
GRANT VIEW DEFINITION TO claude_readonly;
```

## Testing Your Connection

### Manual Connection Test

You can test connectivity outside of the setup wizard:

```bash
# Test connections only
npm run setup
# Choose option 2: "Test existing connections"
```

### Test with Simple Queries

Once connected, try these test queries through Claude Code:

1. **Basic Connection Test:**
 > "Test the connection to my production database"

2. **Schema Exploration:**
 > "Show me the table structure of my production database"

3. **Simple Data Query:**
 > "Count the total number of records in each table"

4. **Sample Data:**
 > "Show me 5 sample records from the users table"

### Common Connection Issues

#### Connection Timeout
```
 Connection timeout after 30000ms
```
**Solutions:**
- Increase timeout in configuration: `timeout=60000`
- Check network connectivity: `ping database-host`
- Verify firewall rules allow database port

#### Authentication Failed
```
 Authentication failed for user 'username'
```
**Solutions:**
- Verify username and password are correct
- Check if user exists in database
- Confirm user has necessary permissions
- For PostgreSQL, check `pg_hba.conf` settings

#### Database Not Found
```
 Database 'myapp' does not exist
```
**Solutions:**
- Verify database name is correct
- Check if database exists: `\l` (PostgreSQL) or `SHOW DATABASES;` (MySQL)
- Confirm user has access to the specified database

#### SSL Connection Issues
```
 SSL connection required but not supported
```
**Solutions:**
- Enable SSL in your configuration: `ssl=true`
- Verify database server supports SSL
- Check SSL certificates are properly configured
- For development, try `ssl=false` temporarily

#### SSH Tunnel Problems
```
 SSH tunnel failed: Authentication failed
```
**Solutions:**
- Test SSH connection manually: `ssh user@bastion-host`
- Verify SSH credentials are correct
- Check SSH key permissions: `chmod 600 ~/.ssh/id_rsa`
- Ensure SSH user has tunneling permissions

## Next Steps

Once you have a working database connection:

1. **[Tutorial 3: Claude Integration](03-claude-integration.md)** - Configure Claude Code
2. **[Tutorial 4: Basic Queries](04-basic-queries.md)** - Run your first queries
3. **[Advanced Multi-Database Setup](advanced-01-multi-database.md)** - Add more databases
4. **[SSH Tunnel Configuration](advanced-02-ssh-tunnels.md)** - Secure remote access

## Pro Tips

### Security Best Practices
- Always use SELECT-only mode for production databases
- Create dedicated database users with minimal permissions
- Use SSL/TLS for encrypted connections
- Implement SSH tunnels for remote database access
- Regularly rotate database passwords

### Performance Optimization
- Set appropriate connection timeouts based on network conditions
- Use connection pooling for high-throughput scenarios
- Consider read replicas for analytical queries
- Monitor query performance and set appropriate limits

### Configuration Management
- Keep configuration files in version control (without passwords)
- Use environment variables for sensitive values
- Document your database configurations
- Test configuration changes in development first

---

**Need help?** Check the [troubleshooting guide](../guides/troubleshooting-guide.md) or ask in [GitHub Discussions](https://github.com/AraneaDev/argos/discussions).
# PostgreSQL Database Guide

This guide provides comprehensive information for connecting the Argos to PostgreSQL databases, including configuration, optimization, and best practices.

## Table of Contents

- [Quick Start](#quick-start)
- [Configuration Options](#configuration-options)
- [Connection Examples](#connection-examples)
- [PostgreSQL-Specific Features](#postgresql-specific-features)
- [Performance Optimization](#performance-optimization)
- [Security Best Practices](#security-best-practices)
- [SSH Tunnel Setup](#ssh-tunnel-setup)
- [Troubleshooting](#troubleshooting)
- [Advanced Configuration](#advanced-configuration)

---

## Quick Start

### Basic PostgreSQL Configuration
```ini
[database.mypostgres]
type=postgresql
host=localhost
port=5432
database=myapp
username=readonly_user
password=secure_password
ssl=true
select_only=true
```

### Test Your Connection
```bash
# Start the setup wizard
argos setup

# Or test existing configuration
node dist/cli.js serve
```

---

## Configuration Options

### Required Parameters
| Parameter | Description | Example |
|-----------|-------------|---------|
| `type` | Database type | `postgresql` |
| `host` | PostgreSQL server hostname | `db.example.com` |
| `username` | Database username | `readonly_user` |

### Optional Parameters
| Parameter | Default | Description | Example |
|-----------|---------|-------------|---------|
| `port` | `5432` | PostgreSQL port | `5432` |
| `database` | `postgres` | Database name | `myapp` |
| `password` | - | User password | `secure_password` |
| `ssl` | `false` | Enable SSL/TLS | `true` |
| `select_only` | `true` | Restrict to SELECT queries | `true` |
| `timeout` | `30000` | Connection timeout (ms) | `30000` |

### PostgreSQL-Specific Parameters
| Parameter | Description | Example |
|-----------|-------------|---------|
| `sslmode` | SSL mode | `require` |
| `application_name` | Application identifier | `argos` |
| `statement_timeout` | Query timeout | `30000` |
| `idle_in_transaction_session_timeout` | Transaction timeout | `600000` |

---

## Connection Examples

### Local Development Database
```ini
[database.development]
type=postgresql
host=localhost
port=5432
database=myapp_dev
username=dev_user
password=dev_password
ssl=false
select_only=false
```

### Production Database (Read-Only)
```ini
[database.production]
type=postgresql
host=prod-db-replica.company.com
port=5432
database=production_app
username=readonly_service
password=complex_secure_password
ssl=true
select_only=true
timeout=15000
```

### Cloud Database (AWS RDS)
```ini
[database.aws_rds]
type=postgresql
host=myapp.cluster-abc123.us-west-2.rds.amazonaws.com
port=5432
database=myapp
username=analytics_user
password=rds_password
ssl=true
select_only=true
```

### Azure Database for PostgreSQL with Azure CLI authentication

The Azure CLI's sign-in is the credential: Argos asks it for a Microsoft Entra
access token and sends that as the password, so no secret is written to
`config.ini`.

```ini
[database.azure_pg]
type=postgresql
host=myserver.postgres.database.azure.com
port=5432
database=myapp
username=argos-readers
authentication=azure-cli
select_only=true
# Only when the server's tenant is not the CLI's active context. Must be the GUID.
# azure_tenant_id=00000000-0000-0000-0000-000000000000
```

- `username` is the Entra principal's name as the database knows it: a user's
  sign-in name, or a group's display name, as mapped with
  `SELECT * FROM pgaadauth_create_principal('argos-readers', false, false);`.
  Grant that role read access only.
- A token is valid for 5 to 60 minutes, so Argos fetches a fresh one for every
  new connection the pool opens rather than holding one that expires.
- TLS with certificate verification is forced. `ssl=false` is a startup error,
  and `ssl_verify=false` does not reach this path: an access token on an
  unverified connection goes to whoever answers.
- `az login` must have been run. A token failure says so, rather than surfacing
  as an opaque login error.
- `azure_config_dir=~/.azure-claude-ro` takes the token from that Azure CLI
  profile instead of the server's, so the agent can use a reader identity signed
  in with `AZURE_CONFIG_DIR=~/.azure-claude-ro az login` while your own shell
  keeps your login.

### Cloud Database (Google Cloud SQL)
```ini
[database.gcp_sql]
type=postgresql
host=10.1.2.3
port=5432
database=myapp
username=service_account
password=gcp_password
ssl=true
select_only=true
```

---

## PostgreSQL-Specific Features

### Supported Data Types
The Argos fully supports all PostgreSQL data types:

#### Numeric Types
- `smallint`, `integer`, `bigint`
- `decimal`, `numeric`
- `real`, `double precision`
- `smallserial`, `serial`, `bigserial`

#### Character Types
- `character varying(n)`, `varchar(n)`
- `character(n)`, `char(n)`
- `text`

#### Date/Time Types
- `timestamp [without time zone]`
- `timestamp with time zone`
- `date`
- `time [without time zone]`
- `time with time zone`
- `interval`

#### Boolean Type
- `boolean`

#### Array Types
- `integer[]`, `text[]`, etc.
- Multidimensional arrays supported

#### JSON Types
- `json`
- `jsonb` (binary JSON)

#### UUID Type
- `uuid`

#### Network Address Types
- `cidr`, `inet`, `macaddr`

### Advanced PostgreSQL Features

#### Common Table Expressions (CTEs)
```sql
WITH recent_orders AS (
 SELECT customer_id, COUNT(*) as order_count
 FROM orders 
 WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
 GROUP BY customer_id
)
SELECT c.name, c.email, ro.order_count
FROM customers c
JOIN recent_orders ro ON c.id = ro.customer_id
ORDER BY ro.order_count DESC;
```

#### Window Functions
```sql
SELECT 
 name,
 salary,
 department,
 AVG(salary) OVER (PARTITION BY department) as dept_avg_salary,
 ROW_NUMBER() OVER (ORDER BY salary DESC) as salary_rank
FROM employees;
```

#### JSON Operations
```sql
-- Query JSON data
SELECT 
 id,
 metadata->>'customer_name' as customer_name,
 metadata->'preferences'->>'theme' as theme
FROM user_profiles 
WHERE metadata @> '{"active": true}';

-- JSON aggregation
SELECT 
 department,
 JSON_AGG(
 JSON_BUILD_OBJECT(
 'name', name,
 'salary', salary
 )
 ) as employees
FROM employees 
GROUP BY department;
```

#### Array Operations
```sql
-- Working with arrays
SELECT 
 product_name,
 tags,
 ARRAY_LENGTH(tags, 1) as tag_count,
 'electronics' = ANY(tags) as is_electronic
FROM products 
WHERE tags && ARRAY['sale', 'featured'];
```

---

## Performance Optimization

### Connection Pooling
The Argos automatically manages connection pooling for PostgreSQL:

```typescript
// Automatic connection reuse
const result1 = await executeQuery('production', 'SELECT COUNT(*) FROM users');
const result2 = await executeQuery('production', 'SELECT COUNT(*) FROM orders');
// Same connection reused for both queries
```

### Query Performance Tips

#### Use Proper Indexes
```sql
-- Check for missing indexes
SELECT 
 schemaname,
 tablename,
 attname,
 n_distinct,
 correlation
FROM pg_stats 
WHERE schemaname = 'public' 
 AND n_distinct > 100;

-- Create indexes for frequently queried columns
CREATE INDEX CONCURRENTLY idx_users_email ON users(email);
CREATE INDEX CONCURRENTLY idx_orders_created_at ON orders(created_at);
```

#### Analyze Query Performance
```sql
-- Use EXPLAIN ANALYZE for query optimization
EXPLAIN (ANALYZE, BUFFERS) 
SELECT u.name, COUNT(o.id) as order_count
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
GROUP BY u.id, u.name
HAVING COUNT(o.id) > 5;
```

#### Optimize Large Result Sets
```sql
-- Use LIMIT for large datasets
SELECT * FROM large_table 
ORDER BY created_at DESC 
LIMIT 1000;

-- Use cursor-based pagination
SELECT * FROM products 
WHERE id > $1 
ORDER BY id 
LIMIT 100;
```

### Performance Monitoring Queries

#### Connection Information
```sql
-- Check active connections
SELECT 
 datname,
 usename,
 client_addr,
 state,
 query_start,
 LEFT(query, 50) as query_preview
FROM pg_stat_activity 
WHERE datname = current_database()
 AND state = 'active';
```

#### Query Performance Statistics
```sql
-- Top slow queries
SELECT 
 query,
 calls,
 total_time,
 total_time/calls as avg_time,
 rows,
 100.0 * shared_blks_hit/nullif(shared_blks_hit + shared_blks_read, 0) AS hit_percent
FROM pg_stat_statements 
ORDER BY total_time DESC 
LIMIT 10;
```

---

## Security Best Practices

### User Account Setup

#### Create Read-Only User
```sql
-- Create dedicated read-only user
CREATE USER sql_mcp_readonly WITH PASSWORD 'secure_random_password';

-- Grant connection permission
GRANT CONNECT ON DATABASE myapp TO sql_mcp_readonly;

-- Grant schema usage
GRANT USAGE ON SCHEMA public TO sql_mcp_readonly;

-- Grant read access to all tables
GRANT SELECT ON ALL TABLES IN SCHEMA public TO sql_mcp_readonly;

-- Grant read access to sequences (for schema introspection)
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO sql_mcp_readonly;

-- Set default permissions for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
 GRANT SELECT ON TABLES TO sql_mcp_readonly;
```

#### Create Analytics User (Limited Write Access)
```sql
-- Create user for analytics workloads
CREATE USER sql_mcp_analytics WITH PASSWORD 'analytics_password';

-- Grant connection and schema access
GRANT CONNECT ON DATABASE myapp TO sql_mcp_analytics;
GRANT USAGE ON SCHEMA public TO sql_mcp_analytics;

-- Grant read access to all tables
GRANT SELECT ON ALL TABLES IN SCHEMA public TO sql_mcp_analytics;

-- Grant write access only to specific tables
GRANT INSERT, UPDATE, DELETE ON analytics_temp_tables TO sql_mcp_analytics;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sql_mcp_analytics;
```

### SSL/TLS Configuration

#### Server-Side SSL Setup
```postgresql
# In postgresql.conf
ssl = on
ssl_cert_file = 'server.crt'
ssl_key_file = 'server.key'
ssl_ca_file = 'ca.crt'
ssl_ciphers = 'HIGH:MEDIUM:+3DES:!aNULL'
ssl_prefer_server_ciphers = on
```

#### Client-Side SSL Configuration
```ini
[database.secure_postgres]
type=postgresql
host=secure-db.company.com
port=5432
database=production
username=readonly_user
password=secure_password
ssl=true
sslmode=require
# Optional: verify server certificate
sslcert=/path/to/client.crt
sslkey=/path/to/client.key
sslrootcert=/path/to/ca.crt
```

### Row Level Security (RLS)
```sql
-- Enable RLS on sensitive table
ALTER TABLE customer_data ENABLE ROW LEVEL SECURITY;

-- Create policy for MCP user
CREATE POLICY mcp_access_policy ON customer_data
 FOR SELECT
 TO sql_mcp_readonly
 USING (tenant_id = current_setting('app.current_tenant_id', true));
```

---

## SSH Tunnel Setup

### Basic SSH Tunnel Configuration
```ini
[database.remote_postgres]
type=postgresql
host=internal-db.company.local
port=5432
database=production
username=readonly_user
password=db_password
ssl=true
select_only=true

# SSH Tunnel Configuration
ssh_host=bastion.company.com
ssh_port=22
ssh_username=tunnel_user
ssh_private_key=/secure/path/to/ssh_key
```

### SSH Key Setup
```bash
# Generate SSH key pair
ssh-keygen -t rsa -b 4096 -f ~/.ssh/sql_mcp_key -C "Argos"

# Copy public key to bastion host
ssh-copy-id -i ~/.ssh/sql_mcp_key.pub tunnel_user@bastion.company.com

# Set proper permissions
chmod 600 ~/.ssh/sql_mcp_key
chmod 644 ~/.ssh/sql_mcp_key.pub
```

### Advanced SSH Configuration
```ini
[database.multi_hop_postgres]
type=postgresql
host=10.0.1.100
port=5432
database=production
username=readonly_user
password=db_password
ssl=true

# SSH tunnel through multiple hops
ssh_host=bastion.company.com
ssh_port=2222
ssh_username=service_account
ssh_private_key=/etc/argos/keys/service_key
ssh_passphrase=key_passphrase
```

---

## Troubleshooting

### Common Connection Issues

#### Authentication Failed
```
 Error: password authentication failed for user "username"
```

**Solutions:**
1. Verify username and password in configuration
2. Check user exists and has login permission:
 ```sql
 SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = 'username';
 ```
3. Check `pg_hba.conf` authentication methods
4. Verify password hasn't expired

#### Connection Refused
```
 Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Solutions:**
1. Verify PostgreSQL is running:
 ```bash
 sudo systemctl status postgresql
 ```
2. Check PostgreSQL is listening on correct port:
 ```bash
 sudo netstat -tlnp | grep 5432
 ```
3. Verify `listen_addresses` in `postgresql.conf`
4. Check firewall rules

#### SSL Connection Issues
```
 Error: SSL connection failed
```

**Solutions:**
1. Verify server SSL configuration
2. Check certificate validity:
 ```bash
 openssl x509 -in server.crt -text -noout
 ```
3. Test SSL connectivity:
 ```bash
 psql "host=hostname port=5432 dbname=database user=username sslmode=require"
 ```

#### Permission Denied
```
 Error: permission denied for table "table_name"
```

**Solutions:**
1. Grant necessary permissions:
 ```sql
 GRANT SELECT ON table_name TO username;
 ```
2. Check schema permissions:
 ```sql
 GRANT USAGE ON SCHEMA schema_name TO username;
 ```

### Performance Issues

#### Slow Queries
1. Enable query logging in `postgresql.conf`:
 ```
 log_statement = 'all'
 log_duration = on
 log_min_duration_statement = 1000
 ```

2. Use `EXPLAIN ANALYZE` to identify bottlenecks
3. Check for missing indexes
4. Consider query rewriting

#### Connection Limits
```
 Error: too many connections for role "username"
```

**Solutions:**
1. Increase connection limit:
 ```sql
 ALTER ROLE username CONNECTION LIMIT 10;
 ```
2. Use connection pooling (already handled by MCP server)
3. Check for connection leaks

### Schema Introspection Issues

#### Empty Schema Information
If schema capture returns no tables:

1. Check user has access to `information_schema`:
 ```sql
 SELECT * FROM information_schema.tables LIMIT 5;
 ```
2. Verify schema permissions:
 ```sql
 SELECT schema_name FROM information_schema.schemata;
 ```
3. Check table ownership and permissions

---

## Advanced Configuration

### PostgreSQL Extensions Support
The Argos supports queries using PostgreSQL extensions:

#### UUID Extension
```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Use UUID functions
SELECT uuid_generate_v4() as new_id;
```

#### Full Text Search
```sql
-- Enable full text search
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Search queries
SELECT title, content 
FROM articles 
WHERE to_tsvector('english', content) @@ to_tsquery('postgresql & performance');
```

### Custom Data Type Handling
The server handles PostgreSQL's custom types:

```sql
-- Enum types
CREATE TYPE mood AS ENUM ('sad', 'ok', 'happy');

-- Custom composite types
CREATE TYPE address AS (
 street text,
 city text,
 state text,
 zip_code text
);

-- Query custom types
SELECT name, current_mood, (address).city 
FROM users 
WHERE current_mood = 'happy';
```

### Materialized Views
```sql
-- Create materialized view
CREATE MATERIALIZED VIEW sales_summary AS
SELECT 
 DATE_TRUNC('month', created_at) as month,
 SUM(amount) as total_sales,
 COUNT(*) as order_count
FROM orders 
GROUP BY DATE_TRUNC('month', created_at);

-- Query materialized view
SELECT * FROM sales_summary ORDER BY month DESC;

-- Refresh when needed (requires write access)
REFRESH MATERIALIZED VIEW sales_summary;
```

### Partitioned Tables
```sql
-- Query partitioned tables (handled transparently)
SELECT customer_id, order_date, amount 
FROM orders_partitioned 
WHERE order_date >= '2024-01-01'
 AND order_date < '2025-01-01';
```

---

## Monitoring and Maintenance

### Database Health Queries

#### Table Sizes
```sql
SELECT 
 schemaname,
 tablename,
 pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

#### Index Usage
```sql
SELECT 
 schemaname,
 tablename,
 indexname,
 idx_scan as index_scans,
 pg_size_pretty(pg_relation_size(indexname::regclass)) as index_size
FROM pg_stat_user_indexes 
ORDER BY idx_scan DESC;
```

#### Vacuum and Analyze Status
```sql
SELECT 
 schemaname,
 tablename,
 last_vacuum,
 last_autovacuum,
 last_analyze,
 last_autoanalyze,
 n_tup_ins + n_tup_upd + n_tup_del as total_operations
FROM pg_stat_user_tables 
ORDER BY total_operations DESC;
```

### Configuration Validation

#### Recommended Settings Check
```sql
SELECT name, setting, unit, short_desc 
FROM pg_settings 
WHERE name IN (
 'max_connections',
 'shared_buffers', 
 'work_mem',
 'maintenance_work_mem',
 'checkpoint_completion_target',
 'wal_buffers',
 'default_statistics_target'
);
```

This comprehensive PostgreSQL guide provides everything needed to successfully connect, configure, and optimize PostgreSQL databases with the Argos.
# SQL Server Database Configuration Guide

This guide covers Microsoft SQL Server setup, configuration, and optimization for the Argos.

## Overview

The Argos provides comprehensive SQL Server support through the `mssql` driver, offering enterprise-grade connectivity, connection pooling, and advanced features for Microsoft SQL Server environments.

**Supported Versions:**
- SQL Server 2016, 2017, 2019, 2022
- Azure SQL Database
- Azure SQL Managed Instance
- SQL Server Express and Developer editions
- SQL Server on Linux

## Quick Start

### 1. Basic Configuration

Add to your `config.ini`:

```ini
[database.sqlserver_example]
type=mssql
host=localhost
port=1433
database=your_database_name
username=your_username
password=your_password
encrypt=true
select_only=true
timeout=30000
```

### 2. Test Connection

```bash
# Test it from Claude with the sql_test_connection tool, database: sqlserver_example
```

## Configuration Options

### Required Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `type` | Database type | `mssql` |
| `host` | SQL Server hostname | `localhost`, `sql.company.com` |
| `database` | Database name | `ProductionDB` |
| `username` | SQL Server login | `app_user` |
| `password` | SQL Server password | `SecurePassword123!` |

`username` and `password` are not required when `authentication=azure-cli`; see
[Azure CLI authentication](#azure-cli-authentication).

### Optional Parameters

| Parameter | Description | Default | Example |
|-----------|-------------|---------|---------|
| `port` | SQL Server port | `1433` | `1434` |
| `encrypt` | Enable connection encryption | `true` | `false` |
| `timeout` | Connection timeout (ms) | `30000` | `60000` |
| `select_only` | Restrict to SELECT queries | `true` | `false` |
| `authentication` | Authentication mode: `sql` or `azure-cli` | `sql` | `azure-cli` |
| `azure_tenant_id` | Tenant to take the CLI token from (GUID) | CLI's active tenant | `00000000-0000-0000-0000-000000000000` |

### Advanced Configuration

```ini
[database.sqlserver_production]
type=mssql
host=sqlprod.company.com
port=1433
database=ProductionApp
username=readonly_service
password=${SQLSERVER_PASSWORD}
encrypt=true
select_only=true
timeout=30000

# Connection pool automatically managed
# max_connections=10
# connection_timeout=30000
# request_timeout=30000
```

## Authentication Methods

### SQL Server Authentication

```ini
[database.sql_auth]
type=mssql
host=sqlserver.company.com
database=AppDatabase
username=sql_user
password=sql_password
encrypt=true
```

### Windows Authentication

```ini
[database.windows_auth]
type=mssql
host=sqlserver.company.com
database=AppDatabase
username=DOMAIN\\windows_user
password=windows_password
encrypt=true
```

### Azure Active Directory

For Azure SQL Database with AAD authentication:

```ini
[database.azure_aad]
type=mssql
host=myserver.database.windows.net
database=mydatabase
username=user@company.com
password=aad_password
encrypt=true
```

### Azure CLI authentication

Authenticate as the identity already signed in to the Azure CLI, so no Azure
credential is written to `config.ini` at all:

```ini
[database.azure_cli]
type=mssql
host=myserver.database.windows.net
database=mydatabase
authentication=azure-cli
```

Requirements:

- The [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) is installed and on `PATH`.
- `az login` has been run, and the signed-in identity has access to the database.
- The Azure AD identity is mapped to a database user, for example:
  `CREATE USER [you@company.com] FROM EXTERNAL PROVIDER;`

### Choosing the tenant

An account with access to more than one tenant is the normal case, and the CLI
has exactly one active context. When the server lives in a different tenant from
that context, the token is issued by the wrong authority and the connection
fails with `Login failed for user '<token-identified principal>'. The server is
not currently configured to accept this token.` Name the tenant to fix it:

```ini
[database.azure_cli]
type=mssql
host=myserver.database.windows.net
database=mydatabase
authentication=azure-cli
azure_tenant_id=00000000-0000-0000-0000-000000000000
```

`az account list --all --query '[].{name:name, tenantId:tenantId}' -o table`
lists the tenants you are signed in to. The value must be the GUID, not the
tenant's display name; a name is rejected at startup rather than becoming an
opaque auth error later.

Notes:

- `username` and `password` are ignored in this mode. Leave them out.
- Encryption and certificate verification are both forced on. An `encrypt=false`
  is a startup error, and `ssl_verify=false` does not reach this path. An access
  token is a bearer credential: an attacker who terminates the TLS with a forged
  certificate captures it and can replay it against every database the signed-in
  identity can reach.
- The token is acquired per connection through the CLI, so a session that has
  expired surfaces as a connection error telling you to run `az login` again.
- Unattended use works as long as the CLI itself has a non-interactive session,
  which `az login --service-principal` provides. A dedicated service-principal
  credential would be the more direct tool for that, and is not implemented yet;
  SQL authentication remains the simpler option for CI.

## SSL/TLS Configuration

### Standard Encryption

```ini
[database.encrypted]
type=mssql
host=sqlserver.company.com
database=SecureDB
username=app_user
password=secure_password
encrypt=true # Enables SSL/TLS
```

The SQL Server adapter automatically configures:
- `encrypt: true` - Enables SSL/TLS encryption
- `trustServerCertificate: true` - Accepts self-signed certificates
- `enableArithAbort: true` - Recommended SQL Server setting

### Certificate Validation

For production environments with valid certificates:

```javascript
// Advanced SSL configuration (handled internally)
options: {
 encrypt: true,
 trustServerCertificate: false, // Validate certificates
 enableArithAbort: true
}
```

## Cloud Provider Setup

### Azure SQL Database

```ini
[database.azure_sql]
type=mssql
host=myserver.database.windows.net
port=1433
database=production_db
username=admin_user
password=complex_password123!
encrypt=true
select_only=true
timeout=30000
```

**Azure SQL Database features:**
- Always encrypted connections
- Built-in high availability
- Automatic backups
- Elastic scaling

### Azure SQL Managed Instance

```ini
[database.azure_managed]
type=mssql
host=myinstance.public.xyz.database.windows.net
port=3342
database=production_db
username=admin_user
password=managed_password
encrypt=true
select_only=true
```

### SQL Server on AWS RDS

```ini
[database.rds_sqlserver]
type=mssql
host=mydb.xyz.us-west-2.rds.amazonaws.com
port=1433
database=production
username=admin
password=rds_password
encrypt=true
select_only=true
```

### Google Cloud SQL for SQL Server

```ini
[database.gcp_sqlserver]
type=mssql
host=10.x.x.x # Private IP
port=1433
database=application_db
username=sqlserver_user
password=gcp_password
encrypt=true
select_only=true
```

## Performance Optimization

### Connection Management

The SQL Server adapter provides:
- **Connection pooling** with up to 10 concurrent connections
- **Automatic connection recovery** on failures
- **Request timeout management**
- **Connection health monitoring**

Configuration is handled automatically:
```javascript
pool: {
 max: 10, // Maximum connections
 min: 0, // Minimum connections
 idleTimeoutMillis: 30000 // Idle connection timeout
}
```

### Query Performance

Optimize SQL Server performance:

```sql
-- Update statistics for better query plans
UPDATE STATISTICS table_name;

-- Enable query plan caching
-- (automatically handled by SQL Server)

-- Monitor query performance
SELECT 
 qs.sql_handle,
 qs.execution_count,
 qs.total_elapsed_time / qs.execution_count as avg_elapsed_time,
 qt.text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
ORDER BY avg_elapsed_time DESC;
```

### Index Optimization

```sql
-- Find missing indexes
SELECT 
 migs.avg_total_user_cost * (migs.avg_user_impact / 100.0) * (migs.user_seeks + migs.user_scans) AS improvement_measure,
 'CREATE INDEX [IX_' + OBJECT_NAME(mid.object_id) + '_' + REPLACE(REPLACE(REPLACE(ISNULL(mid.equality_columns,''), ', ', '_'), '[', ''), ']', '') + ']'
 + ' ON ' + mid.statement + ' (' + ISNULL(mid.equality_columns,'')
 + CASE WHEN mid.inequality_columns IS NOT NULL THEN ',' + mid.inequality_columns ELSE '' END + ')'
 + ISNULL(' INCLUDE (' + mid.included_columns + ')', '') AS create_index_statement,
 migs.*, mid.database_id, mid.object_id
FROM sys.dm_db_missing_index_groups mig
INNER JOIN sys.dm_db_missing_index_group_stats migs ON migs.group_handle = mig.index_group_handle
INNER JOIN sys.dm_db_missing_index_details mid ON mig.index_handle = mid.index_handle
WHERE migs.avg_total_user_cost * (migs.avg_user_impact / 100.0) * (migs.user_seeks + migs.user_scans) > 10
ORDER BY improvement_measure DESC;
```

## Security Best Practices

### User Permissions

Create a dedicated read-only user:

```sql
-- Create login
CREATE LOGIN claude_readonly WITH PASSWORD = 'SecureRandomPassword123!';

-- Create user in database
USE ProductionDB;
CREATE USER claude_readonly FOR LOGIN claude_readonly;

-- Grant read permissions
ALTER ROLE db_datareader ADD MEMBER claude_readonly;

-- Grant view definition (for schema capture)
GRANT VIEW DEFINITION TO claude_readonly;

-- Grant specific permissions if needed
GRANT SELECT ON INFORMATION_SCHEMA.TABLES TO claude_readonly;
GRANT SELECT ON INFORMATION_SCHEMA.COLUMNS TO claude_readonly;
```

### Row-Level Security

Implement row-level security for sensitive data:

```sql
-- Create security policy
CREATE SCHEMA Security;

CREATE FUNCTION Security.fn_securitypredicate(@UserId int)
 RETURNS TABLE
WITH SCHEMABINDING
AS
 RETURN SELECT 1 AS fn_securitypredicate_result
 WHERE @UserId = USER_ID() OR USER_NAME() = 'claude_readonly';

CREATE SECURITY POLICY CustomerFilter
ADD FILTER PREDICATE Security.fn_securitypredicate(user_id) ON dbo.customers,
ADD BLOCK PREDICATE Security.fn_securitypredicate(user_id) ON dbo.customers
WITH (STATE = ON);
```

### Dynamic Data Masking

Protect sensitive data:

```sql
-- Apply dynamic data masking
ALTER TABLE customers
ALTER COLUMN email ADD MASKED WITH (FUNCTION = 'email()');

ALTER TABLE customers 
ALTER COLUMN phone ADD MASKED WITH (FUNCTION = 'partial(1,"XXX-XXX-",4)');

-- Grant unmask permission
GRANT UNMASK TO claude_readonly;
```

## SQL Server Data Types

The adapter handles all SQL Server data types:

### Numeric Types
- `bit`, `tinyint`, `smallint`, `int`, `bigint`
- `decimal`, `numeric`, `smallmoney`, `money`
- `float`, `real`

### String Types
- `char`, `varchar`, `text`
- `nchar`, `nvarchar`, `ntext`
- `binary`, `varbinary`, `image`

### Date/Time Types
- `datetime`, `datetime2`, `smalldatetime`
- `date`, `time`, `datetimeoffset`

### Advanced Types
- `uniqueidentifier` (GUID)
- `xml`
- `geometry`, `geography` (spatial types)
- `hierarchyid`
- `sql_variant`

## SQL Server-Specific Features

### Common Table Expressions (CTEs)

```sql
-- Recursive hierarchy
WITH EmployeeHierarchy AS (
 -- Anchor member: top-level managers
 SELECT employee_id, name, manager_id, 0 as level
 FROM employees
 WHERE manager_id IS NULL
 
 UNION ALL
 
 -- Recursive member: direct reports
 SELECT e.employee_id, e.name, e.manager_id, eh.level + 1
 FROM employees e
 INNER JOIN EmployeeHierarchy eh ON e.manager_id = eh.employee_id
)
SELECT * FROM EmployeeHierarchy
ORDER BY level, name;
```

### Window Functions

```sql
-- Advanced analytics with window functions
SELECT 
 customer_id,
 order_date,
 total_amount,
 SUM(total_amount) OVER (PARTITION BY customer_id ORDER BY order_date) as running_total,
 LAG(total_amount) OVER (PARTITION BY customer_id ORDER BY order_date) as previous_order,
 ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY total_amount DESC) as order_rank
FROM orders;
```

### JSON Support (SQL Server 2016+)

```sql
-- JSON querying
SELECT 
 customer_id,
 JSON_VALUE(preferences, '$.theme') as preferred_theme,
 JSON_QUERY(preferences, '$.notifications') as notification_settings
FROM customer_profiles
WHERE JSON_VALUE(preferences, '$.active') = 'true';

-- JSON aggregation
SELECT 
 category,
 (SELECT 
 product_id, 
 name, 
 price 
 FROM products p 
 WHERE p.category_id = c.id 
 FOR JSON PATH) as products_json
FROM categories c;
```

### Temporal Tables (SQL Server 2016+)

```sql
-- Query temporal (system-versioned) tables
SELECT * FROM employees
FOR SYSTEM_TIME AS OF '2024-01-01 10:00:00';

-- Get history of changes
SELECT * FROM employees
FOR SYSTEM_TIME BETWEEN '2024-01-01' AND '2024-02-01'
WHERE employee_id = 123;
```

## Monitoring and Diagnostics

### Performance Monitoring

```sql
-- Current active connections
SELECT 
 session_id,
 login_time,
 host_name,
 program_name,
 login_name,
 status,
 cpu_time,
 memory_usage,
 reads,
 writes
FROM sys.dm_exec_sessions
WHERE is_user_process = 1
ORDER BY cpu_time DESC;

-- Database size information
SELECT 
 DB_NAME() as database_name,
 SUM(CASE WHEN type = 0 THEN size END) * 8 / 1024 as data_size_mb,
 SUM(CASE WHEN type = 1 THEN size END) * 8 / 1024 as log_size_mb,
 SUM(size) * 8 / 1024 as total_size_mb
FROM sys.database_files;
```

### Health Checks

The adapter provides SQL Server-specific monitoring:

```javascript
// Available through adapter methods
const version = await adapter.getVersion(connection);
const dbSize = await adapter.getDatabaseSize(connection);
const tableStats = await adapter.getTableStats(connection);
const connections = await adapter.getActiveConnections(connection);
```

### Wait Statistics

```sql
-- Identify performance bottlenecks
SELECT 
 wait_type,
 wait_time_ms,
 waiting_tasks_count,
 signal_wait_time_ms,
 wait_time_ms - signal_wait_time_ms as resource_wait_time_ms
FROM sys.dm_os_wait_stats
WHERE wait_time_ms > 1000
ORDER BY wait_time_ms DESC;
```

## Troubleshooting

### Common Issues

#### Connection Failed
```
Error: Failed to connect to SQL Server
```

**Solutions:**
- Verify SQL Server service is running
- Check TCP/IP is enabled in SQL Server Configuration Manager
- Verify port 1433 is not blocked by firewall
- Test with SQL Server Management Studio

#### Authentication Failed
```
Error: Login failed for user 'username'
```

**Solutions:**
- Verify username and password
- Check if login exists: `SELECT name FROM sys.server_principals WHERE type = 'S';`
- Verify user has database access
- Check password policy compliance

#### Encryption Issues
```
Error: SSL connection failed
```

**Solutions:**
- Try with `encrypt=false` for testing
- Verify server certificate configuration
- Check if force encryption is enabled
- Update to latest SQL Server drivers

#### Timeout Errors
```
Error: Timeout: Request failed to complete in 30000ms
```

**Solutions:**
- Increase timeout value
- Optimize slow queries
- Check for blocking processes
- Review server resource usage

### Performance Issues

#### Slow Queries
- Use SQL Server Profiler or Extended Events
- Analyze execution plans with `SET STATISTICS IO ON`
- Update table statistics: `UPDATE STATISTICS table_name`
- Consider query optimization

#### Memory Issues
- Monitor buffer cache hit ratio
- Review max server memory settings
- Check for memory pressure indicators
- Analyze memory grants for queries

#### Blocking and Deadlocks

```sql
-- Monitor blocking
SELECT 
 blocking_session_id,
 session_id,
 wait_type,
 wait_time,
 wait_resource
FROM sys.dm_exec_requests
WHERE blocking_session_id <> 0;

-- Deadlock information
SELECT 
 session_id,
 deadlock_priority,
 transaction_isolation_level
FROM sys.dm_exec_sessions
WHERE session_id IN (SELECT session_id FROM sys.dm_exec_requests WHERE blocking_session_id <> 0);
```

## Advanced Configuration

### Multiple Instances

Connect to named instances:

```ini
[database.named_instance]
type=mssql
host=server\\INSTANCENAME
port=1433
database=AppDB
username=user
password=password
encrypt=true
```

### Always On Availability Groups

```ini
[database.availability_group]
type=mssql
host=ag-listener.company.com
port=1433
database=ProductionDB
username=app_user
password=secure_password
encrypt=true
select_only=true
```

### Multiple Databases

Configure access to multiple databases on the same server:

```ini
[database.sales]
type=mssql
host=sqlserver.company.com
database=SalesDB
username=readonly_user
password=password123
encrypt=true
select_only=true

[database.inventory]
type=mssql
host=sqlserver.company.com
database=InventoryDB
username=readonly_user
password=password123
encrypt=true
select_only=true
```

## Integration Examples

### Business Intelligence Queries

```sql
-- Sales performance dashboard
SELECT 
 DATENAME(month, order_date) + ' ' + CAST(YEAR(order_date) AS VARCHAR) as month_year,
 COUNT(*) as total_orders,
 SUM(total_amount) as revenue,
 AVG(total_amount) as avg_order_value,
 COUNT(DISTINCT customer_id) as unique_customers
FROM orders
WHERE order_date >= DATEADD(month, -12, GETDATE())
GROUP BY YEAR(order_date), MONTH(order_date), DATENAME(month, order_date)
ORDER BY YEAR(order_date) DESC, MONTH(order_date) DESC;
```

### Advanced Analytics

```sql
-- Customer cohort analysis
WITH FirstPurchase AS (
 SELECT 
 customer_id,
 MIN(order_date) as first_purchase_date,
 YEAR(MIN(order_date)) as cohort_year,
 MONTH(MIN(order_date)) as cohort_month
 FROM orders
 GROUP BY customer_id
),
CustomerMonths AS (
 SELECT 
 fp.customer_id,
 fp.cohort_year,
 fp.cohort_month,
 DATEDIFF(month, fp.first_purchase_date, o.order_date) as months_since_first
 FROM FirstPurchase fp
 JOIN orders o ON fp.customer_id = o.customer_id
)
SELECT 
 cohort_year,
 cohort_month,
 months_since_first,
 COUNT(DISTINCT customer_id) as customers
FROM CustomerMonths
GROUP BY cohort_year, cohort_month, months_since_first
ORDER BY cohort_year, cohort_month, months_since_first;
```

## Conclusion

The SQL Server adapter provides enterprise-grade connectivity with comprehensive support for:

- **All SQL Server versions** and cloud variants
- **Advanced security features** including encryption and authentication
- **High-performance connection pooling** and optimization
- **Rich T-SQL feature set** including CTEs, window functions, and JSON
- **Comprehensive monitoring** and diagnostics capabilities

The adapter handles all SQL Server complexities while providing access to powerful enterprise features and optimizations.

For additional help:
- [SQL Server Documentation](https://docs.microsoft.com/en-us/sql/sql-server/)
- [Azure SQL Documentation](https://docs.microsoft.com/en-us/azure/azure-sql/)
- [Troubleshooting Guide](../guides/troubleshooting-guide.md)
- [Security Guide](../guides/security-guide.md)

# MySQL Database Configuration Guide

This guide covers MySQL and MariaDB setup, configuration, and optimization for the Argos.

## Overview

The Argos provides comprehensive support for MySQL and MariaDB databases through the `mysql2` driver, offering high-performance connections, connection pooling, and enterprise-grade features.

**Supported Versions:**
- MySQL 5.7, 8.0, 8.1+
- MariaDB 10.3, 10.4, 10.5, 10.6, 10.11+
- Azure Database for MySQL
- Amazon RDS for MySQL
- Google Cloud SQL for MySQL

## Quick Start

### 1. Basic Configuration

Add to your `config.ini`:

```ini
[database.mysql_example]
type=mysql
host=localhost
port=3306
database=your_database_name
username=your_username
password=your_password
ssl=false
select_only=true
timeout=30000
```

### 2. Test Connection

```bash
# Test it from Claude with the sql_test_connection tool, database: mysql_example
```

## Configuration Options

### Required Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `type` | Database type | `mysql` |
| `host` | MySQL server hostname | `localhost`, `mysql.company.com` |
| `database` | Database name | `production_app` |
| `username` | MySQL username | `app_user` |
| `password` | MySQL password | `secure_password123` |

### Optional Parameters

| Parameter | Description | Default | Example |
|-----------|-------------|---------|---------|
| `port` | MySQL server port | `3306` | `3307` |
| `ssl` | Enable SSL/TLS connection | `false` | `true` |
| `timeout` | Connection timeout (ms) | `30000` | `15000` |
| `select_only` | Restrict to SELECT queries | `true` | `false` |

### Advanced Configuration

```ini
[database.mysql_production]
type=mysql
host=mysql-primary.company.com
port=3306
database=production_app
username=readonly_user
password=${MYSQL_PASSWORD}
ssl=true
select_only=true
timeout=15000

# Connection pool settings (handled automatically)
# max_connections=10
# idle_timeout=30000
```

## SSL/TLS Configuration

### Basic SSL

```ini
[database.mysql_ssl]
type=mysql
host=mysql.company.com
database=secure_app
username=app_user
password=secure_password
ssl=true
```

### Custom SSL Options

For advanced SSL configuration, the adapter supports:
- Self-signed certificates (automatically handled)
- Custom CA certificates
- Client certificate authentication

The MySQL adapter automatically configures:
```javascript
ssl: { rejectUnauthorized: false }
```

## Cloud Provider Setup

### Azure Database for MySQL

```ini
[database.azure_mysql]
type=mysql
host=myserver.mysql.database.azure.com
port=3306
database=production_db
username=adminuser@myserver # Azure format required
password=complex_password123!
ssl=true
select_only=true
timeout=30000
```

**Note:** Azure MySQL requires SSL connections and specific username format.

### Amazon RDS for MySQL

```ini
[database.rds_mysql]
type=mysql
host=mydb.cluster-xyz.us-west-2.rds.amazonaws.com
port=3306
database=production
username=admin
password=rds_password
ssl=true
select_only=true
timeout=30000
```

### Google Cloud SQL

```ini
[database.gcp_mysql]
type=mysql
host=10.x.x.x # Private IP or public IP
port=3306
database=application_db
username=mysql_user
password=gcp_password
ssl=true
select_only=true
```

## Performance Optimization

### Connection Management

The MySQL adapter automatically handles:
- **Connection pooling** with up to 10 concurrent connections
- **Connection reuse** to minimize connection overhead
- **Automatic reconnection** on connection failures
- **Connection health checks**

### Query Performance

Enable MySQL's query optimization features:

```sql
-- Enable slow query log
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 2;

-- Optimize for read-heavy workloads
SET GLOBAL innodb_buffer_pool_size = 1073741824; -- 1GB
SET GLOBAL query_cache_size = 67108864; -- 64MB
```

### Schema Optimization

The adapter efficiently captures schema information using:
- `INFORMATION_SCHEMA` tables for metadata
- Optimized queries for large databases
- Caching of schema information

## Security Best Practices

### User Permissions

Create a dedicated read-only user:

```sql
-- Create read-only user
CREATE USER 'claude_readonly'@'%' IDENTIFIED BY 'secure_random_password';

-- Grant SELECT permissions on specific databases
GRANT SELECT ON production_app.* TO 'claude_readonly'@'%';
GRANT SELECT ON analytics.* TO 'claude_readonly'@'%';

-- Grant metadata access
GRANT SELECT ON INFORMATION_SCHEMA.* TO 'claude_readonly'@'%';
GRANT SELECT ON PERFORMANCE_SCHEMA.* TO 'claude_readonly'@'%';

-- Apply changes
FLUSH PRIVILEGES;
```

### Connection Security

```ini
[database.secure_mysql]
type=mysql
host=mysql.internal.company.com
database=sensitive_data
username=claude_readonly
password=${MYSQL_READONLY_PASSWORD}
ssl=true
select_only=true # Enforces read-only at application level
timeout=15000
```

### Network Security

- Use SSL/TLS for all connections
- Restrict MySQL bind address: `bind-address = 10.0.0.0/8`
- Configure firewall rules
- Use SSH tunneling for additional security

## Common MySQL Data Types

The adapter handles these MySQL data types automatically:

### Numeric Types
- `TINYINT`, `SMALLINT`, `MEDIUMINT`, `INT`, `BIGINT`
- `DECIMAL`, `NUMERIC`, `FLOAT`, `DOUBLE`
- `BIT`

### String Types
- `CHAR`, `VARCHAR`, `BINARY`, `VARBINARY`
- `TINYBLOB`, `BLOB`, `MEDIUMBLOB`, `LONGBLOB`
- `TINYTEXT`, `TEXT`, `MEDIUMTEXT`, `LONGTEXT`
- `ENUM`, `SET`

### Date/Time Types
- `DATE`, `TIME`, `DATETIME`, `TIMESTAMP`, `YEAR`

### JSON and Spatial Types
- `JSON` (MySQL 5.7+)
- `GEOMETRY`, `POINT`, `LINESTRING`, `POLYGON`

## Troubleshooting

### Common Issues

#### Connection Refused
```
Error: connect ECONNREFUSED 127.0.0.1:3306
```

**Solutions:**
- Verify MySQL server is running: `systemctl status mysql`
- Check port configuration: `SHOW VARIABLES LIKE 'port';`
- Verify host/port in configuration

#### Authentication Failed
```
Error: Access denied for user 'username'@'host'
```

**Solutions:**
- Verify username and password
- Check user host permissions: `SELECT User, Host FROM mysql.user;`
- Ensure user has required privileges

#### SSL Connection Issues
```
Error: SSL connection error
```

**Solutions:**
- Verify server SSL configuration
- Check if SSL is required: `SHOW VARIABLES LIKE 'require_secure_transport';`
- Try with `ssl=false` for testing

#### Too Many Connections
```
Error: Too many connections
```

**Solutions:**
- Check current connections: `SHOW PROCESSLIST;`
- Increase max_connections: `SET GLOBAL max_connections = 200;`
- Review connection pooling settings

### Performance Issues

#### Slow Queries
- Enable slow query log
- Use `EXPLAIN` to analyze query execution
- Check indexes: `SHOW INDEX FROM table_name;`
- Monitor with: `SHOW ENGINE INNODB STATUS;`

#### High Memory Usage
- Monitor buffer pool usage: `SHOW ENGINE INNODB STATUS;`
- Check query cache hit rate
- Review table cache settings

### MySQL-Specific Features

#### Character Sets and Collation
The adapter automatically handles various character sets:
- `utf8mb4` (recommended for full Unicode support)
- `utf8` (legacy Unicode support)
- `latin1` (single-byte character set)

#### Storage Engines
Supported storage engines:
- **InnoDB** (recommended, ACID-compliant)
- **MyISAM** (legacy, faster reads)
- **MEMORY** (in-memory storage)
- **ARCHIVE** (compressed storage)

#### MySQL 8.0+ Features
- **Common Table Expressions (CTEs)**
- **Window functions**
- **JSON functions**
- **Invisible indexes**
- **Atomic DDL**

## Monitoring and Maintenance

### Health Checks

The adapter provides built-in health monitoring:

```sql
-- Check server status
SELECT VERSION() as version;

-- Monitor connections
SELECT COUNT(*) as connection_count 
FROM INFORMATION_SCHEMA.PROCESSLIST;

-- Check database sizes
SELECT 
 table_schema,
 ROUND(SUM(data_length + index_length) / 1024 / 1024, 1) AS 'DB Size in MB'
FROM information_schema.tables 
GROUP BY table_schema;
```

### Performance Monitoring

Enable performance monitoring:

```sql
-- Enable performance schema
SET GLOBAL performance_schema = ON;

-- Monitor slow queries
SELECT 
 query,
 exec_count,
 avg_timer_wait/1000000000000 as avg_time_sec
FROM performance_schema.events_statements_summary_by_digest
ORDER BY avg_timer_wait DESC
LIMIT 10;
```

### Backup Considerations

While the MCP server only reads data, consider:
- Regular `mysqldump` backups
- Binary log archival
- Point-in-time recovery setup
- Monitoring replication lag (if using replicas)

## Integration Examples

### Basic Query Examples

```sql
-- User analytics
SELECT 
 DATE(created_at) as date,
 COUNT(*) as new_users
FROM users 
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(created_at)
ORDER BY date;

-- Sales summary
SELECT 
 p.name as product_name,
 SUM(oi.quantity * oi.price) as revenue
FROM order_items oi
JOIN products p ON oi.product_id = p.id
JOIN orders o ON oi.order_id = o.id
WHERE o.created_at >= DATE_SUB(NOW(), INTERVAL 1 MONTH)
GROUP BY p.id, p.name
ORDER BY revenue DESC;
```

### Advanced Analytics

```sql
-- Customer lifetime value with window functions
SELECT 
 customer_id,
 total_spent,
 ROW_NUMBER() OVER (ORDER BY total_spent DESC) as spending_rank,
 NTILE(10) OVER (ORDER BY total_spent) as decile
FROM (
 SELECT 
 customer_id,
 SUM(total_amount) as total_spent
 FROM orders
 GROUP BY customer_id
) customer_totals;
```

## Conclusion

The MySQL adapter provides enterprise-grade connectivity with automatic optimization, comprehensive security, and robust error handling. It supports all major MySQL variants and cloud providers while maintaining high performance through intelligent connection management and query optimization.

For additional help:
- [MySQL Documentation](https://dev.mysql.com/doc/)
- [MariaDB Documentation](https://mariadb.com/kb/en/)
- [Troubleshooting Guide](../guides/troubleshooting-guide.md)
- [Security Guide](../guides/security-guide.md)

# SQLite Database Configuration Guide

This guide covers SQLite setup, configuration, and optimization for the Argos.

## Overview

The Argos provides comprehensive SQLite support through the `sqlite3` driver, offering lightweight, serverless database connectivity perfect for development, testing, and single-user applications.

**Supported Versions:**
- SQLite 3.x (all versions)
- In-memory databases (`:memory:`)
- Read-only databases
- WAL mode databases
- Encrypted databases (with appropriate SQLite builds)

## Quick Start

### 1. Basic Configuration

Add to your `config.ini`:

```ini
[database.sqlite_local]
type=sqlite
file=./data/application.db
select_only=false
timeout=10000
```

### 2. Test Connection

```bash
# Test it from Claude with the sql_test_connection tool, database: sqlite_local
```

## Configuration Options

### Required Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `type` | Database type | `sqlite` |
| `file` | SQLite database file path | `./data/app.db`, `/var/data/production.db` |

### Optional Parameters

| Parameter | Description | Default | Example |
|-----------|-------------|---------|---------|
| `timeout` | Query timeout (ms) | `10000` | `30000` |
| `select_only` | Restrict to SELECT queries | `false` | `true` |

### Special File Paths

```ini
# In-memory database
[database.memory]
type=sqlite
file=:memory:
select_only=false

# Absolute path
[database.production]
type=sqlite
file=/var/lib/sqlite/production.db
select_only=true
timeout=30000

# Relative path with subdirectories
[database.analytics]
type=sqlite
file=./databases/analytics/reports.db
select_only=true
```

## File Management

### Database File Creation

The SQLite adapter handles database files automatically:
- **Existing files**: Opens and connects normally
- **Missing files**: Connection will fail (files are not auto-created)
- **Permissions**: Requires read access (+ write if not select_only)

### Directory Structure

Organize your SQLite databases:

```
project/
+-- databases/
|   +-- development/
|   |   +-- app.db
|   |   +-- test.db
|   +-- analytics/
|   |   +-- reports.db
|   |   +-- metrics.db
|   +-- backups/
|       +-- app_backup_20240812.db
+-- config.ini
```

### File Permissions

```bash
# Read-only access for production
chmod 444 /path/to/readonly.db
chown app:app /path/to/readonly.db

# Read-write for development 
chmod 644 /path/to/development.db
chown developer:developer /path/to/development.db
```

## Performance Optimization

### SQLite Configuration

The adapter uses optimized SQLite settings:

```sql
-- Automatically applied optimizations
PRAGMA journal_mode = WAL; -- Write-Ahead Logging
PRAGMA synchronous = NORMAL; -- Balanced durability/performance
PRAGMA cache_size = 10000; -- 10MB page cache
PRAGMA foreign_keys = ON; -- Enforce foreign keys
PRAGMA temp_store = MEMORY; -- Use memory for temporary tables
```

### Query Optimization

Optimize your SQLite queries:

```sql
-- Create indexes for frequently queried columns
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_orders_created_at ON orders(created_at);
CREATE INDEX idx_order_items_composite ON order_items(order_id, product_id);

-- Use EXPLAIN QUERY PLAN to analyze performance
EXPLAIN QUERY PLAN 
SELECT * FROM users u 
JOIN orders o ON u.id = o.user_id 
WHERE u.created_at > date('now', '-30 days');
```

### Database Maintenance

Regular maintenance commands:

```sql
-- Analyze tables for query optimizer
ANALYZE;

-- Rebuild database to reclaim space
VACUUM;

-- Check database integrity
PRAGMA integrity_check;

-- Get database statistics
PRAGMA database_list;
PRAGMA table_info(table_name);
```

## SQLite-Specific Features

### Built-in Functions

SQLite provides extensive built-in functions:

#### Date/Time Functions
```sql
-- Current timestamp
SELECT datetime('now') as current_time;

-- Date arithmetic
SELECT date('now', '+30 days') as future_date;
SELECT date('now', 'start of month') as month_start;

-- Date formatting
SELECT strftime('%Y-%m-%d %H:%M', created_at) as formatted_date
FROM orders;
```

#### String Functions
```sql
-- Text manipulation
SELECT 
 upper(name) as uppercase_name,
 length(description) as desc_length,
 substr(email, 1, instr(email, '@') - 1) as username
FROM users;
```

#### Aggregate Functions
```sql
-- Statistical functions
SELECT 
 count(*) as total_orders,
 avg(total_amount) as avg_order_value,
 sum(total_amount) as total_revenue,
 min(created_at) as first_order,
 max(created_at) as latest_order,
 group_concat(product_name, ', ') as products
FROM orders;
```

### JSON Support

Modern SQLite versions support JSON operations:

```sql
-- JSON data querying
SELECT 
 json_extract(metadata, '$.user_id') as user_id,
 json_extract(metadata, '$.preferences') as preferences
FROM user_profiles
WHERE json_extract(metadata, '$.active') = 1;

-- JSON aggregation
SELECT json_group_array(
 json_object('name', name, 'email', email)
) as users_json
FROM users
WHERE active = 1;
```

### Common Table Expressions (CTEs)

SQLite 3.8.3+ supports CTEs:

```sql
-- Recursive query example
WITH RECURSIVE category_hierarchy(id, name, parent_id, level) AS (
 -- Base case: top-level categories
 SELECT id, name, parent_id, 0
 FROM categories 
 WHERE parent_id IS NULL
 
 UNION ALL
 
 -- Recursive case: child categories
 SELECT c.id, c.name, c.parent_id, ch.level + 1
 FROM categories c
 JOIN category_hierarchy ch ON c.parent_id = ch.id
)
SELECT * FROM category_hierarchy ORDER BY level, name;
```

## Data Types and Storage

### SQLite Type Affinity

SQLite uses dynamic typing with type affinity:

| Declared Type | Affinity | Examples |
|---------------|----------|----------|
| `INTEGER` | INTEGER | `1`, `42`, `-17` |
| `REAL` | REAL | `3.14`, `1.0`, `-2.5` |
| `TEXT` | TEXT | `'Hello'`, `'2024-08-12'` |
| `BLOB` | NONE | Binary data |
| `NUMERIC` | NUMERIC | Numbers or text |

### Column Types in Schema

The adapter recognizes these common column declarations:

```sql
CREATE TABLE products (
 id INTEGER PRIMARY KEY,
 name TEXT NOT NULL,
 price REAL,
 weight NUMERIC,
 image BLOB,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 is_active INTEGER DEFAULT 1 -- Boolean as INTEGER
);
```

### Constraints and Keys

```sql
CREATE TABLE orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 order_date TEXT DEFAULT CURRENT_TIMESTAMP,
 total_amount REAL CHECK (total_amount >= 0),
 status TEXT CHECK (status IN ('pending', 'shipped', 'delivered')),
 
 FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Indexes for performance
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE UNIQUE INDEX idx_orders_tracking ON orders(tracking_number) WHERE tracking_number IS NOT NULL;
```

## Development and Testing

### In-Memory Databases

Perfect for testing and temporary data:

```ini
[database.test]
type=sqlite
file=:memory:
select_only=false
timeout=5000
```

Use cases:
- Unit tests
- Temporary calculations
- Data processing pipelines
- Cache storage

### Multiple Database Files

Configure multiple SQLite databases:

```ini
# Main application database
[database.app]
type=sqlite
file=./data/application.db
select_only=false

# Read-only reporting database
[database.reports]
type=sqlite
file=./data/reports.db
select_only=true

# Analytics database
[database.analytics]
type=sqlite
file=./data/analytics.db
select_only=true

# Configuration database
[database.config]
type=sqlite
file=./data/config.db
select_only=false
```

### Database Seeding

Populate test databases:

```sql
-- Create sample data
INSERT INTO users (name, email, created_at) VALUES
('John Doe', 'john@example.com', datetime('now', '-30 days')),
('Jane Smith', 'jane@example.com', datetime('now', '-25 days')),
('Bob Johnson', 'bob@example.com', datetime('now', '-20 days'));

INSERT INTO orders (user_id, total_amount, created_at) VALUES
(1, 99.99, datetime('now', '-15 days')),
(2, 149.50, datetime('now', '-10 days')),
(1, 79.99, datetime('now', '-5 days'));
```

## Security Considerations

### File System Security

```bash
# Secure database files
chmod 600 sensitive.db # Owner read/write only
chown app:app sensitive.db # Correct ownership

# Secure directory
chmod 700 /var/lib/sqlite/ # Directory access restricted
```

### Read-Only Mode

Enable read-only mode for production:

```ini
[database.production_readonly]
type=sqlite
file=/var/lib/sqlite/production.db
select_only=true
timeout=30000
```

### Database Encryption

For encrypted SQLite databases (requires SQLCipher):

```sql
-- Open encrypted database (if supported)
PRAGMA key = 'your_encryption_key';
```

Note: Standard SQLite builds don't include encryption. Use SQLCipher for encrypted databases.

## Troubleshooting

### Common Issues

#### Database Locked
```
Error: SQLITE_BUSY: database is locked
```

**Solutions:**
- Check for long-running transactions
- Verify no other processes are accessing the file
- Use WAL mode: `PRAGMA journal_mode = WAL;`
- Increase timeout value

#### File Not Found
```
Error: SQLITE_CANTOPEN: unable to open database file
```

**Solutions:**
- Verify file path is correct
- Check file permissions
- Ensure directory exists
- Confirm file is not corrupted

#### Disk I/O Error
```
Error: SQLITE_IOERR: disk I/O error
```

**Solutions:**
- Check disk space: `df -h`
- Verify file system permissions
- Check for disk errors
- Ensure file system supports SQLite features

#### Corrupted Database
```
Error: SQLITE_CORRUPT: database disk image is malformed
```

**Solutions:**
- Run integrity check: `PRAGMA integrity_check;`
- Attempt recovery: `.recover` (SQLite CLI)
- Restore from backup
- Export/import data to new database

### Performance Issues

#### Slow Queries
- Add appropriate indexes
- Use `EXPLAIN QUERY PLAN` to analyze
- Consider query restructuring
- Update table statistics: `ANALYZE;`

#### Large Database Files
- Run `VACUUM` to reclaim space
- Use `auto_vacuum` pragma
- Consider data archival
- Optimize schema design

## Monitoring and Maintenance

### Database Statistics

```sql
-- Database size and page information
SELECT 
 page_count * page_size as size_bytes,
 page_count,
 page_size,
 freelist_count
FROM pragma_page_count(), pragma_page_size(), pragma_freelist_count();

-- Table sizes
SELECT 
 name,
 pgsize as size_bytes,
 pgsize / 1024.0 as size_kb
FROM dbstat
WHERE aggregate = TRUE
ORDER BY pgsize DESC;
```

### Health Checks

```sql
-- Verify database integrity
PRAGMA integrity_check;

-- Quick integrity check
PRAGMA quick_check;

-- Check foreign key constraints
PRAGMA foreign_key_check;

-- Schema information
PRAGMA table_list;
PRAGMA database_list;
```

### Backup Strategy

```bash
# Simple file copy (database must be idle)
cp application.db backup_$(date +%Y%m%d).db

# Online backup using SQLite CLI
sqlite3 application.db ".backup backup_file.db"

# Dump to SQL
sqlite3 application.db .dump > backup.sql
```

## Integration Examples

### Data Analysis Queries

```sql
-- Sales trends
SELECT 
 date(created_at) as order_date,
 count(*) as order_count,
 sum(total_amount) as daily_revenue,
 avg(total_amount) as avg_order_value
FROM orders
WHERE created_at >= date('now', '-30 days')
GROUP BY date(created_at)
ORDER BY order_date;

-- Customer segmentation
SELECT 
 CASE 
 WHEN total_spent >= 1000 THEN 'High Value'
 WHEN total_spent >= 500 THEN 'Medium Value'
 ELSE 'Low Value'
 END as customer_segment,
 count(*) as customer_count,
 avg(total_spent) as avg_spent
FROM (
 SELECT 
 user_id,
 sum(total_amount) as total_spent
 FROM orders
 GROUP BY user_id
) customer_totals
GROUP BY customer_segment;
```

### Reporting Queries

```sql
-- Monthly summary with growth
WITH monthly_sales AS (
 SELECT 
 strftime('%Y-%m', created_at) as month,
 count(*) as orders,
 sum(total_amount) as revenue
 FROM orders
 GROUP BY strftime('%Y-%m', created_at)
)
SELECT 
 month,
 orders,
 revenue,
 LAG(revenue) OVER (ORDER BY month) as prev_month_revenue,
 CASE 
 WHEN LAG(revenue) OVER (ORDER BY month) > 0 THEN
 ROUND((revenue - LAG(revenue) OVER (ORDER BY month)) / 
 LAG(revenue) OVER (ORDER BY month) * 100, 2)
 ELSE NULL
 END as growth_rate
FROM monthly_sales
ORDER BY month DESC;
```

## Conclusion

SQLite provides an excellent lightweight database solution for the Argos, offering:

- **Zero configuration** for simple use cases
- **High performance** for read-heavy workloads
- **ACID compliance** with WAL mode
- **Rich SQL feature set** including CTEs, window functions, and JSON support
- **Perfect for development** and single-user applications

The SQLite adapter handles all the complexity while providing access to SQLite's powerful features and optimizations.

For additional help:
- [SQLite Documentation](https://www.sqlite.org/docs.html)
- [SQLite Tutorial](https://www.sqlitetutorial.net/)
- [Troubleshooting Guide](../guides/troubleshooting-guide.md)
- [Performance Tuning Guide](../operations/performance-tuning.md)

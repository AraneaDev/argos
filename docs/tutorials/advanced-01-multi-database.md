# Advanced Tutorial 1: Multi-Database Configuration

## Overview

This advanced tutorial demonstrates how to configure and manage multiple database connections within a single Argos instance. You'll learn advanced connection patterns, cross-database queries, data federation strategies, and performance optimization techniques for multi-database environments.

## Prerequisites

- Completed basic tutorial series (01-04)
- Understanding of database fundamentals
- Access to multiple database systems (PostgreSQL, MySQL, SQLite recommended)
- Basic knowledge of SQL joins and data relationships

## Architecture Overview

```
+-------------------------------------------------------------------+
| Multi-Database Architecture                                       |
+-------------------------------------------------------------------+
|                                                                   |
|  +--------------+  +--------------------------------------+       |
|  | Claude       |----| Argos                     |       |
|  |              |  | (Single Instance)                    |       |
|  +--------------+  +--------------------------------------+       |
|                              |                                    |
|          +-------------------+-------------------+                |
|          |                   |                   |                |
|          v                   v                   v                |
|     +---------+         +---------+         +---------+           |
|     | Postgres|         | MySQL   |         | SQLite  |           |
|     | (Users) |         |(Orders) |         |(Cache)  |           |
|     +---------+         +---------+         +---------+           |
|                                                                   |
+-------------------------------------------------------------------+
```

## Configuration Patterns

### 1. Basic Multi-Database Setup

**Example Scenario**: E-commerce system with separated concerns
- PostgreSQL: User management and authentication
- MySQL: Order processing and inventory
- SQLite: Local caching and temporary data

```ini
# config.ini - Multi-database configuration

# PostgreSQL for user management
[database.users]
type=postgresql
host=users-db.company.com
port=5432
database=user_management
username=readonly_user
password=secure_password_1
ssl=true
select_only=true
timeout=15000

# MySQL for order processing
[database.orders]
type=mysql
host=orders-db.company.com
port=3306
database=order_system
username=analytics_user
password=secure_password_2
ssl=true
select_only=true
timeout=10000

# SQLite for local caching
[database.cache]
type=sqlite
file=./data/analytics_cache.sqlite
select_only=false # Allow writes for caching

# Analytics data warehouse
[database.analytics]
type=postgresql
host=analytics-db.company.com
port=5432
database=data_warehouse
username=analytics_readonly
password=secure_password_3
ssl=true
select_only=true
timeout=30000

# Global security settings
[security]
max_joins=15
max_subqueries=8
max_complexity_score=200
max_query_length=15000

# Performance settings for multi-database
[extension]
max_rows=2000
max_batch_size=8
query_timeout=45000
```

### 2. Environment-Based Configuration

**Development Configuration**:
```ini
# config/development.ini
[database.users]
type=postgresql
host=localhost
port=5432
database=users_dev
username=dev_user
password=dev_password
ssl=false
select_only=false

[database.orders]
type=mysql
host=localhost
port=3306
database=orders_dev
username=dev_user
password=dev_password
ssl=false
select_only=false

[database.cache]
type=sqlite
file=./dev_cache.sqlite
select_only=false

[security]
# Relaxed limits for development
max_joins=50
max_complexity_score=500

[extension]
max_rows=10000
query_timeout=120000
```

**Production Configuration**:
```ini
# config/production.ini
[database.users_primary]
type=postgresql
host=users-primary.prod.com
port=5432
database=users
username=app_readonly
password=complex_prod_password_1
ssl=true
select_only=true
timeout=10000

[database.users_replica]
type=postgresql
host=users-replica.prod.com
port=5432
database=users
username=app_readonly
password=complex_prod_password_2
ssl=true
select_only=true
timeout=10000

[database.orders_primary]
type=mysql
host=orders-primary.prod.com
port=3306
database=orders
username=app_readonly
password=complex_prod_password_3
ssl=true
select_only=true
timeout=8000

[database.orders_replica]
type=mysql
host=orders-replica.prod.com
port=3306
database=orders
username=app_readonly
password=complex_prod_password_4
ssl=true
select_only=true
timeout=8000

[database.analytics]
type=postgresql
host=analytics.prod.com
port=5432
database=data_warehouse
username=analytics_service
password=complex_prod_password_5
ssl=true
select_only=true
timeout=60000

[security]
# Strict production limits
max_joins=10
max_subqueries=5
max_complexity_score=100
max_query_length=8000

[extension]
max_rows=1000
max_batch_size=5
query_timeout=30000
```

## Advanced Query Strategies

### 1. Cross-Database Data Analysis

**Example: Customer Order Analysis**

```sql
-- Query user data from PostgreSQL
SELECT 
 user_id,
 email,
 registration_date,
 user_tier,
 total_spent
FROM users 
WHERE user_tier IN ('gold', 'platinum')
 AND registration_date >= '2024-01-01'
ORDER BY total_spent DESC
LIMIT 100;
```

Then correlate with order data from MySQL:
```sql
-- Query order data from MySQL 
SELECT 
 user_id,
 COUNT(*) as order_count,
 SUM(total_amount) as total_spent,
 AVG(total_amount) as avg_order_value,
 MAX(order_date) as last_order_date
FROM orders 
WHERE user_id IN (12345, 67890, 11223, 44556) -- IDs from previous query
 AND order_status = 'completed'
 AND order_date >= '2024-01-01'
GROUP BY user_id
ORDER BY total_spent DESC;
```

### 2. Data Federation Patterns

**Pattern 1: Sequential Queries**
```sql
-- Step 1: Get high-value customers from users database
SELECT user_id, email, user_tier 
FROM users 
WHERE total_lifetime_value > 10000;

-- Step 2: Use results to query orders database
SELECT 
 user_id,
 product_category,
 SUM(quantity) as total_quantity,
 SUM(total_amount) as category_spend
FROM orders 
WHERE user_id IN (1001, 1002, 1003) -- From step 1
GROUP BY user_id, product_category;

-- Step 3: Cache results in SQLite for future analysis
INSERT INTO cache.customer_analysis 
VALUES (...); -- Combined results
```

**Pattern 2: Parallel Data Gathering**
```sql
-- Query A: User demographics (PostgreSQL)
SELECT 
 COUNT(*) as total_users,
 COUNT(CASE WHEN user_tier = 'premium' THEN 1 END) as premium_users,
 AVG(EXTRACT(YEAR FROM AGE(birth_date))) as avg_age
FROM users 
WHERE status = 'active';

-- Query B: Order metrics (MySQL) - Run simultaneously
SELECT 
 COUNT(*) as total_orders,
 SUM(total_amount) as total_revenue,
 AVG(total_amount) as avg_order_value,
 COUNT(DISTINCT user_id) as unique_customers
FROM orders 
WHERE order_date >= '2024-01-01'
 AND order_status = 'completed';
```

### 3. Caching Strategies

**Write-Through Caching Pattern**:
```sql
-- Check cache first (SQLite)
SELECT * FROM cache.user_order_summary 
WHERE user_id = 12345 
 AND cache_timestamp > datetime('now', '-1 hour');

-- If not in cache, query source databases and cache result
-- (This would be handled by application logic in practice)

-- Cache the computed result
INSERT OR REPLACE INTO cache.user_order_summary 
(user_id, order_count, total_spent, avg_order_value, cache_timestamp)
VALUES (12345, 15, 2450.75, 163.38, datetime('now'));
```

## Database Naming Conventions

### 1. Functional Naming
```ini
[database.user_management] # Clear functional purpose
[database.order_processing] # Business domain focus
[database.inventory_tracking] # Specific responsibility
[database.analytics_warehouse] # Data purpose
[database.session_cache] # Technical function
```

### 2. Environment Naming
```ini
[database.users_dev] # Development environment
[database.users_staging] # Staging environment
[database.users_prod_primary] # Production primary
[database.users_prod_replica] # Production replica
```

### 3. Geographic Naming
```ini
[database.orders_us_east] # Geographic region
[database.orders_eu_west] # European region
[database.orders_asia_pacific] # APAC region
```

## Performance Optimization

### 1. Connection Pooling

The Argos manages connection pooling internally to optimize database resource utilization and ensure rapid response times:
- **PostgreSQL**: Utilizes `pg.Pool` with an automatic pool size of 10 concurrent connections.
- **MySQL**: Managed via `mysql2.createPool` for efficient connection reuse.
- **SQLite**: Single file access handles concurrency natively.
- **Cleanup**: Active connections are safely returned to the pool, and pools are destroyed within a 10-second timeout during server shutdown.

### 2. Query Routing Optimization

**Read Replica Configuration**:
```ini
# Primary databases for writes (not used in SELECT-only mode)
[database.users_primary]
type=postgresql
host=users-primary.com
# ... configuration

# Read replicas for queries
[database.users_read]
type=postgresql
host=users-replica.com
# ... configuration

# Load balancing handled by Claude's query distribution
```

### 3. Batch Query Optimization

**Example: Efficient multi-database analysis**:
```sql
-- Batch 1: Get user segments from users database
SELECT 
 user_id, 
 user_tier, 
 registration_date,
 location_region
FROM users 
WHERE registration_date >= '2024-01-01'
 AND status = 'active'
ORDER BY user_id;

-- Batch 2: Get aggregated order data for user segments
SELECT 
 user_id,
 COUNT(*) as order_count,
 SUM(total_amount) as total_spent,
 COUNT(DISTINCT product_category) as category_diversity,
 MAX(order_date) as last_order
FROM orders 
WHERE user_id BETWEEN 1000 AND 2000 -- Process in chunks
 AND order_status = 'completed'
GROUP BY user_id;

-- Batch 3: Update analytics cache with combined results
-- (Handled through application logic)
```

## Data Synchronization Patterns

### 1. Event-Driven Synchronization

**Cache Invalidation Strategy**:
```sql
-- When user data changes, invalidate related caches
DELETE FROM cache.user_order_summary 
WHERE user_id = 12345;

DELETE FROM cache.user_analytics 
WHERE user_id = 12345 
 OR cache_timestamp < datetime('now', '-2 hours');
```

### 2. Scheduled Synchronization

**Periodic Cache Refresh**:
```sql
-- Clear stale cache entries (run periodically)
DELETE FROM cache.user_order_summary 
WHERE cache_timestamp < datetime('now', '-24 hours');

-- Rebuild cache for active users
INSERT OR REPLACE INTO cache.user_order_summary 
SELECT 
 u.user_id,
 COUNT(o.order_id) as order_count,
 COALESCE(SUM(o.total_amount), 0) as total_spent,
 COALESCE(AVG(o.total_amount), 0) as avg_order_value,
 datetime('now') as cache_timestamp
FROM users u
LEFT JOIN orders o ON u.user_id = o.user_id 
WHERE u.status = 'active'
 AND u.last_login >= datetime('now', '-30 days')
GROUP BY u.user_id;
```

## Monitoring Multi-Database Environments

### 1. Connection Health Monitoring

**Query to check database connectivity**:
```sql
-- Test PostgreSQL connection
SELECT 'users_db' as database_name, 
 'postgresql' as type, 
 version() as version,
 now() as timestamp;

-- Test MySQL connection 
SELECT 'orders_db' as database_name,
 'mysql' as type,
 @@version as version,
 now() as timestamp;

-- Test SQLite connection
SELECT 'cache_db' as database_name,
 'sqlite' as type, 
 sqlite_version() as version,
 datetime('now') as timestamp;
```

### 2. Performance Metrics per Database

**Query execution time analysis**:
```sql
-- Analyze query patterns per database
-- (This would be implemented in application monitoring)

-- Example metrics to track:
-- - Average query time per database
-- - Query count per database
-- - Error rates per database 
-- - Connection pool utilization
-- - Cache hit rates
```

## Security Considerations

### 1. Database-Specific Security

**Different security levels per database**:
```ini
# High security for user data
[database.users]
type=postgresql
# ... connection details
select_only=true
timeout=10000

# Medium security for order data 
[database.orders]
type=mysql
# ... connection details
select_only=true
timeout=15000

# Lower security for cache (allows writes)
[database.cache]
type=sqlite
file=./cache.sqlite
select_only=false
```

### 2. Network Security

**Secure multi-database connections**:
```ini
# Production databases require SSL
[database.users_prod]
type=postgresql
host=users.prod.internal
ssl=true
ssl_ca=/path/to/ca-cert.pem
ssl_cert=/path/to/client-cert.pem
ssl_key=/path/to/client-key.pem

# Development can use less strict security
[database.users_dev]
type=postgresql
host=localhost
ssl=false
```

## Troubleshooting Multi-Database Issues

### 1. Connection Problems

**Diagnostic queries**:
```sql
-- Check if all databases are accessible
SELECT 1 as test FROM users LIMIT 1; -- PostgreSQL
SELECT 1 as test FROM orders LIMIT 1; -- MySQL 
SELECT 1 as test FROM cache.metadata LIMIT 1; -- SQLite
```

**Common issues and solutions**:

| Issue | Symptoms | Solution |
|-------|----------|----------|
| Connection timeout | Slow queries, timeouts | Adjust `timeout` settings per database |
| Pool exhaustion | "No connections available" | Optimize query execution times or reduce concurrent batch queries |
| SSL certificate errors | SSL handshake failures | Check certificate paths and validity |
| Cross-database confusion | Wrong results | Verify database names in queries |

### 2. Performance Issues

**Query distribution analysis**:
```sql
-- Identify which database is being queried most
-- (Implement in monitoring/logging)

-- Check for:
-- - Uneven load distribution
-- - Slow queries on specific databases 
-- - Network latency between databases
-- - Cache miss rates
```

### 3. Data Consistency Checks

**Verification queries**:
```sql
-- Verify user counts match between systems
SELECT 'users_db' as source, COUNT(*) as user_count 
FROM users WHERE status = 'active';

-- Cross-reference with orders database
SELECT 'orders_db' as source, COUNT(DISTINCT user_id) as unique_customers
FROM orders WHERE order_status = 'completed';

-- Check cache consistency
SELECT 'cache_db' as source, COUNT(*) as cached_users
FROM cache.user_order_summary 
WHERE cache_timestamp > datetime('now', '-1 hour');
```

## Advanced Use Cases

### 1. Microservices Data Integration

**Pattern**: Each microservice has its own database, but analytics needs combined data.

```sql
-- User service data (PostgreSQL)
SELECT user_id, email, registration_date, user_tier
FROM users 
WHERE status = 'active';

-- Order service data (MySQL)
SELECT user_id, order_count, total_spent, last_order_date
FROM order_summary 
WHERE last_order_date >= '2024-01-01';

-- Inventory service data (PostgreSQL)
SELECT product_id, name, category, current_stock
FROM products 
WHERE status = 'active';

-- Product analytics (MySQL) 
SELECT product_id, total_sales, avg_rating, review_count
FROM product_metrics
WHERE last_updated >= '2024-01-01';
```

### 2. Multi-Tenant Architecture

**Pattern**: Separate database per tenant with shared analytics.

```ini
# Tenant-specific databases
[database.tenant_acme]
type=postgresql
host=tenant-db.internal
database=tenant_acme
# ... configuration

[database.tenant_globex]
type=postgresql 
host=tenant-db.internal
database=tenant_globex
# ... configuration

# Shared analytics database
[database.cross_tenant_analytics]
type=postgresql
host=analytics-db.internal
database=multi_tenant_analytics
# ... configuration
```

### 3. Data Lake Integration

**Pattern**: Combine operational databases with data lake queries.

```sql
-- Operational data (PostgreSQL)
SELECT 
 user_id,
 current_subscription_tier,
 account_status,
 last_login
FROM users 
WHERE status = 'active';

-- Historical analysis (Data Lake via specialized connector)
-- Note: This would require custom connector implementation
SELECT 
 user_id,
 session_count,
 total_page_views,
 avg_session_duration
FROM user_behavior_lake
WHERE date_partition >= '2024-01-01';
```

## Best Practices Summary

### Configuration Best Practices

- [ ] Use descriptive, consistent database naming conventions
- [ ] Set appropriate timeouts per database type and usage pattern
- [ ] Configure security settings based on data sensitivity
- [ ] Use environment-specific configurations
- [ ] Document database purposes and data flows

### Query Design Best Practices

- [ ] Design queries to minimize cross-database dependencies
- [ ] Use caching for frequently accessed combined data
- [ ] Batch related queries when possible
- [ ] Implement proper error handling for database-specific issues
- [ ] Monitor query performance per database

### Security Best Practices

- [ ] Apply principle of least privilege per database
- [ ] Use different credentials for different databases
- [ ] Implement database-specific security measures
- [ ] Regular security audits of multi-database access
- [ ] Network segmentation for database access

### Operational Best Practices

- [ ] Monitor connection health for all databases
- [ ] Implement proper logging and alerting
- [ ] Plan for database-specific maintenance windows
- [ ] Have rollback procedures for configuration changes
- [ ] Document database dependencies and relationships

## Next Steps

After mastering multi-database configuration:

1. **Advanced Tutorial 2**: [SSH Tunnel Setup](advanced-02-ssh-tunnels.md)
2. **Advanced Tutorial 3**: [Security Configuration](advanced-03-security.md)
3. **Advanced Tutorial 4**: [Performance Optimization](advanced-04-performance.md)

## Additional Resources

- [Configuration Guide](../guides/configuration-guide.md) - Complete configuration reference
- [Security Guide](../guides/security-guide.md) - Security best practices
- [Performance Tuning](../operations/performance-tuning.md) - Performance optimization
- [Troubleshooting Guide](../guides/troubleshooting-guide.md) - Common issues and solutions

---

*This tutorial is part of the Argos Advanced Configuration Series. For questions or feedback, please refer to our [community discussions](https://github.com/AraneaDev/argos/discussions).*
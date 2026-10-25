# Advanced Tutorial 4: Performance Optimization

## Overview

This advanced tutorial focuses on comprehensive performance optimization strategies for Argos in production environments. You'll learn advanced query optimization, caching strategies, connection pooling, memory management, and system-level performance tuning.

## Prerequisites

- Completed [Advanced Tutorial 1: Multi-Database Configuration](advanced-01-multi-database.md)
- Completed [Advanced Tutorial 2: SSH Tunnel Configuration](advanced-02-ssh-tunnels.md) 
- Completed [Advanced Tutorial 3: Advanced Security Configuration](advanced-03-security.md)
- Understanding of database performance concepts
- Experience with profiling and monitoring tools
- System administration knowledge

## Performance Architecture Overview

```
+-------------------------------------------------------------------+
| Performance Architecture                                          |
+-------------------------------------------------------------------+
|                                                                   |
|  +--------------+ +------------------+ +------------------+       |
|  | Client       |----| Load Balancer  |----| MCP Cluster    |    |
|  | (Claude)     | | (HAProxy/        | | (Auto-scaling)   |      |
|  +--------------+ | Nginx)           | +------------------+      |
|                    +------------------+        |                  |
|                                                |                  |
|  +-------------------------------------------------+------+      |
|  | Caching Layer                               |          |      |
|  | +----------+ +----------+ +----------+ +----------+   |      |
|  | | Redis    | |MemCache  | |Query     | | Result   |   |      |
|  | |(Session) | |(Objects) | | Cache    | | Cache    |   |      |
|  | +----------+ +----------+ +----------+ +----------+   |      |
|  +--------------------------------------------------------+      |
|                                |                                  |
|                       Connection Pooling                          |
|                                |                                  |
|  +---------------------------------+---------------------------+  |
|  | Database Cluster                |                           |  |
|  | +---------+ +---------+ +---------+ +---------+            |  |
|  | |Primary  | |Read     | |Read     | |Analytics|            |  |
|  | |(Write)  | |Replica 1| |Replica 2| | Replica |            |  |
|  | +---------+ +---------+ +---------+ +---------+            |  |
|  +-------------------------------------------------------------+  |
+-------------------------------------------------------------------+
```

## Advanced Query Optimization

### 1. Intelligent Query Analysis

**Configuration for Query Performance**:
```ini
# config.ini - Performance optimization settings
[performance]
enable_query_analysis=true
slow_query_threshold=500 # ms
query_cache_enabled=true
query_cache_ttl=300 # 5 minutes
max_cache_size=512MB
enable_query_hints=true

[optimization]
auto_index_suggestions=true
query_rewriting=true
execution_plan_caching=true
statistics_auto_update=true
cost_based_optimization=true

# Query execution limits for performance
[security]
max_execution_time=30000 # 30 seconds
max_memory_per_query=256MB
max_temporary_tables=5
query_complexity_scoring=true
```

### 2. Query Caching System

The Argos includes a high-performance in-memory TTL-LRU query cache for SELECT queries:
- **Per-Database Partitioning**: Caches are partitioned per database to prevent query collision.
- **LRU Eviction**: Limits cache entries (default: 100 entries per database) using Least Recently Used replacement.
- **Automatic Invalidation**: Automatically clears the cached partition for a database when a mutation query (INSERT, UPDATE, DELETE, etc.) is executed in a batch query.
- **Default TTL**: Cached results are valid for 60 seconds by default.

### 3. Connection Pooling

Connection pooling is automatically managed for high-performance and connection reuse:
- **PostgreSQL**: Managed via `pg.Pool` with an automatic pool size of 10 concurrent connections.
- **MySQL**: Managed via `mysql2.createPool` for efficient connection reuse.
- **SQLite**: Single file access handles concurrency natively.
- **Cleanup**: Active connections are safely returned to the pool, and pools are destroyed within a 10-second timeout during server shutdown.

## Database-Specific Performance Optimizations

### 1. PostgreSQL Performance Tuning

**PostgreSQL Optimizations**:
```sql
-- PostgreSQL performance configuration
-- /etc/postgresql/15/main/postgresql.conf optimizations

-- Connection settings
max_connections = 200
superuser_reserved_connections = 3

-- Memory settings
shared_buffers = 256MB -- 25% of RAM
effective_cache_size = 1GB -- 75% of available RAM
work_mem = 8MB -- Per operation memory
maintenance_work_mem = 128MB -- For maintenance operations
wal_buffers = 16MB -- WAL buffer size

-- Query planner settings
random_page_cost = 1.1 -- For SSD storage
effective_io_concurrency = 200 -- For SSD/NVMe
default_statistics_target = 100 -- Statistics detail level

-- Checkpoint settings
checkpoint_completion_target = 0.9
checkpoint_timeout = 15min
max_wal_size = 2GB
min_wal_size = 1GB

-- Logging for performance analysis
log_min_duration_statement = 1000 -- Log slow queries
log_checkpoints = on
log_connections = on
log_disconnections = on
log_lock_waits = on

-- Additional performance settings
autovacuum = on
autovacuum_max_workers = 3
autovacuum_naptime = 30s
```

**Connection settings Argos passes through**: `timeout` becomes the driver's
connection timeout and `query_timeout` becomes the server-side statement
timeout. The pool is fixed at 10 connections per database and is not
configurable; a single stdio session does not generate the concurrency that
would make tuning it worthwhile.

### 2. MySQL Performance Tuning

**MySQL Optimizations**:
```sql
-- MySQL performance configuration
-- /etc/mysql/mysql.conf.d/mysqld.cnf optimizations

[mysqld]
# Connection settings
max_connections = 300
max_connect_errors = 100000
max_allowed_packet = 64M
connect_timeout = 10
interactive_timeout = 600
wait_timeout = 600

# InnoDB settings
innodb_buffer_pool_size = 1G # 70-80% of RAM
innodb_log_file_size = 256M
innodb_log_buffer_size = 32M
innodb_flush_log_at_trx_commit = 2 # Better performance, slight durability trade-off
innodb_file_per_table = 1
innodb_flush_method = O_DIRECT
innodb_io_capacity = 2000 # For SSD
innodb_io_capacity_max = 4000

# Query cache (MySQL 5.7 and below)
query_cache_type = ON
query_cache_size = 256M
query_cache_limit = 8M

# MyISAM settings (if used)
key_buffer_size = 128M
myisam_sort_buffer_size = 64M

# Temporary table settings
tmp_table_size = 64M
max_heap_table_size = 64M

# Sort and join optimization
sort_buffer_size = 8M
join_buffer_size = 8M
read_buffer_size = 2M
read_rnd_buffer_size = 4M

# Logging
slow_query_log = 1
slow_query_log_file = /var/log/mysql/slow.log
long_query_time = 1
log_queries_not_using_indexes = 1
```

### 3. SQL Server Performance Tuning

**SQL Server Optimizations**:
```sql
-- SQL Server performance configuration
-- These should be executed as database administrator

-- Memory configuration
EXEC sp_configure 'max server memory (MB)', 2048; -- Leave some RAM for OS
EXEC sp_configure 'min server memory (MB)', 1024;
RECONFIGURE;

-- Parallelism settings
EXEC sp_configure 'max degree of parallelism', 4; -- Number of CPU cores / 2
EXEC sp_configure 'cost threshold for parallelism', 25;
RECONFIGURE;

-- Connection settings
EXEC sp_configure 'user connections', 500;
RECONFIGURE;

-- Database-specific optimizations
ALTER DATABASE [your_database] SET AUTO_CREATE_STATISTICS ON;
ALTER DATABASE [your_database] SET AUTO_UPDATE_STATISTICS ON;
ALTER DATABASE [your_database] SET AUTO_UPDATE_STATISTICS_ASYNC ON;

-- TempDB optimization (multiple files for better performance)
ALTER DATABASE tempdb MODIFY FILE (NAME = tempdev, SIZE = 1024MB, FILEGROWTH = 256MB);
ALTER DATABASE tempdb ADD FILE (NAME = tempdev2, FILENAME = 'C:\TempDB\tempdev2.mdf', SIZE = 1024MB, FILEGROWTH = 256MB);
ALTER DATABASE tempdb ADD FILE (NAME = tempdev3, FILENAME = 'C:\TempDB\tempdev3.mdf', SIZE = 1024MB, FILEGROWTH = 256MB);
ALTER DATABASE tempdb ADD FILE (NAME = tempdev4, FILENAME = 'C:\TempDB\tempdev4.mdf', SIZE = 1024MB, FILEGROWTH = 256MB);
```

## What Argos itself does about performance

The tuning above is the database's. These are the levers on the MCP side, and
they are all in `config.ini` or in the tools.

### Result size

`max_rows` in `[extension]` caps how many rows are returned, defaulting to 1000.
Rows are streamed and counted as they arrive rather than buffered, so a query
matching a million rows does not pull a million rows into memory before the cap
is applied; the retained set stops at `max_rows` and the response reports the
full count with `truncated` set.

```ini
[extension]
max_rows=1000
query_timeout=30000
```

Reducing `max_rows` is the single most effective change for a workload that
keeps returning large result sets, because everything downstream — redaction,
formatting, the model's context — scales with it.

### Timeouts

`query_timeout` is enforced by the database, not just abandoned by the client:
PostgreSQL gets `statement_timeout`, MySQL `max_execution_time` (MariaDB
`max_statement_time`), and SQLite is interrupted through the driver. A runaway
query stops consuming server resources rather than continuing unwatched.

Set it low enough that a mistake is cheap. Thirty seconds is generous for
interactive use.

### Caching

Repeated identical `SELECT`s are served from an in-memory cache, per database,
capped at 100 entries and expiring after that database's `cache_ttl_seconds`,
which defaults to 60. Statements that
are not `SELECT`, or that contain non-deterministic constructs, are never
cached, and a write to a database drops that database's entries.

The cache is per process, so it lives as long as the session. `sql_get_metrics`
reports `cache.hitRate`; a rate near zero means the workload does not repeat
queries, which is normal for exploratory analysis and not worth chasing.

### Circuit breaker

Repeated failures against one database trip a breaker, after which queries are
rejected immediately instead of waiting for another timeout. It closes again
after a cool-off. The transitions appear in `sql_get_metrics` under `circuit`,
and are the quickest way to tell "the database is down" from "this query is
wrong".

### Finding the slow query

`sql_analyze_performance` runs the statement, then its `EXPLAIN`, and returns
the timings, the plan and dialect-specific advice — sequential scans and
unbuffered nested loops on PostgreSQL, full table scans, filesorts and temporary
tables on MySQL, table scans and temporary B-trees on SQLite.

```
Analyse the performance of: SELECT * FROM orders WHERE customer_email = 'x@y.z'
```

Act on the plan rather than the timing: the index it suggests belongs in the
database, and this tool cannot create it.

## Best Practices Summary

### Query Optimization Best Practices

- [ ] **Use Indexes Effectively**: Create indexes on frequently queried columns
- [ ] **Avoid SELECT ***: Specify only needed columns
- [ ] **Use LIMIT Clauses**: Limit result sets for large tables
- [ ] **Optimize JOINs**: Ensure proper indexes on JOIN columns
- [ ] **Analyze Query Plans**: Use EXPLAIN to understand query execution
- [ ] **Use Query Caching**: Cache frequently executed queries
- [ ] **Batch Operations**: Combine multiple operations when possible

### Connection Management Best Practices

- [ ] **Right-Size Pools**: Configure optimal connection pool sizes
- [ ] **Monitor Pool Health**: Track connection pool metrics
- [ ] **Use Connection Validation**: Test connections before use
- [ ] **Implement Timeouts**: Set appropriate connection timeouts
- [ ] **Load Balance Reads**: Distribute queries across read replicas
- [ ] **Reuse Connections**: Maximize connection reuse

### Memory Management Best Practices

- [ ] **Monitor Memory Usage**: Track heap and memory metrics
- [ ] **Implement Streaming**: Stream large result sets
- [ ] **Optimize Garbage Collection**: Configure GC appropriately
- [ ] **Clear Unused Caches**: Regularly clean expired cache entries
- [ ] **Set Memory Limits**: Configure appropriate heap limits
- [ ] **Handle Memory Pressure**: Implement pressure release mechanisms

### System-Level Best Practices

- [ ] **OS-Level Tuning**: Optimize network and memory settings
- [ ] **Database Configuration**: Tune database server settings
- [ ] **Monitoring and Alerting**: Comprehensive performance monitoring
- [ ] **Regular Benchmarking**: Automated performance testing
- [ ] **Capacity Planning**: Plan for growth and scaling
- [ ] **Performance Budgets**: Set and maintain performance targets

## Next Steps

After mastering performance optimization:

1. **Review Other Tutorials**: [Complete Tutorial Series](../README.md)
2. **Operations Documentation**: [Production Deployment](../operations/)
3. **Monitoring Setup**: [System Monitoring](../operations/monitoring.md)
4. **Operational limits**: [Deployment Guide](../operations/deployment-guide.md) — why there is no horizontal scaling dimension for a process the client spawns

## Additional Resources

- [Performance Tuning Guide](../operations/performance-tuning.md) - Detailed performance optimization
- [Monitoring Documentation](../operations/monitoring.md) - System monitoring setup
- [Database Optimization](../databases/) - Database-specific optimizations
- [Architecture Guide](../architecture/system-architecture.md) - System design principles

---

*This tutorial completes the Argos Advanced Configuration Series. For questions or feedback, please refer to our [community discussions](https://github.com/AraneaDev/argos/discussions).*
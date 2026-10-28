# MCP Tools Reference

This document provides comprehensive documentation for all MCP tools exposed by the Argos. These tools enable Claude Code to interact with your configured databases securely and efficiently.

## Feature Status

- **Implemented**: Core query execution, SSH tunneling, SELECT-only security, batch operations, database listing, schema management, connection testing
- **Implemented**: Dynamic database configuration management via MCP tools
- [WIP] **Basic Implementation**: Performance analysis (basic recommendations only)
- **Planned**: Advanced performance analysis with detailed index recommendations, configuration templates, enhanced schema relationship mapping

## Available Tools

### `sql_query`
Execute a single SQL query on a configured database with automatic schema awareness and security enforcement.

#### Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `database` | `string` | | Database name from configuration |
| `query` | `string` | | SQL query to execute |
| `params` | `string[]` | | Optional query parameters for prepared statements |

#### Features
- **Security Validation**: Automatic query validation for SELECT-only mode
- **Schema Awareness**: Uses cached schema information for context
- **Name Check**: Before a SELECT (or `WITH`...`SELECT`, or `EXPLAIN` of one) runs, Argos compares its column names with the cached schema; see [Name Checking](#name-checking)
- **SSH Tunneling**: Automatic SSH tunnel establishment if configured
- **Result Formatting**: Structured table output with row limits
- **Performance Tracking**: Query execution time measurement

#### Example Usage
```sql
-- Simple SELECT query
SELECT u.name, u.email, COUNT(o.id) as order_count
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE u.created_at > '2024-01-01'
GROUP BY u.id, u.name, u.email
ORDER BY order_count DESC
LIMIT 10
```

#### Response Format
- Success response with formatted table
- Row count and execution time
- Security mode indicators (SSH tunnel, SELECT-only)
- Structured results with column headers

#### Security Considerations
- In SELECT-only mode, only SELECT, WITH, SHOW, EXPLAIN, and DESCRIBE statements are allowed
- Query complexity is analyzed and limited based on configuration
- Dangerous patterns are automatically detected and blocked

---

### `sql_batch_query`
Execute multiple SQL queries in batch for improved performance with optional transaction support.

#### Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `database` | `string` | | Database name from configuration |
| `queries` | `object[]` | | Array of SQL queries to execute |
| `transaction` | `boolean` | | Execute all queries in a single transaction (default: false) |

#### Query Object Structure
```typescript
{
 query: string; // SQL query to execute
 params?: string[]; // Optional query parameters
 label?: string; // Optional label for identification
}
```

#### Features
- **Batch Processing**: Execute up to configurable max queries (default: 10)
- **Transaction Support**: Optional transactional execution for consistency
- **Individual Results**: Detailed results for each query in the batch
- **Failure Handling**: Continues on failures unless in transaction mode
- **Name Check**: One statement naming a column that doesn't exist blocks the whole batch before any statement runs, and the response names the statement; see [Name Checking](#name-checking)
- **Performance Metrics**: Total and individual query execution times

#### Example Usage
```json
{
 "database": "analytics",
 "queries": [
 {
 "query": "SELECT COUNT(*) as total_users FROM users",
 "label": "User Count"
 },
 {
 "query": "SELECT COUNT(*) as total_orders FROM orders WHERE created_at > ?",
 "params": ["2024-01-01"],
 "label": "Recent Orders"
 },
 {
 "query": "SELECT AVG(order_total) as avg_order_value FROM orders",
 "label": "Average Order Value"
 }
 ],
 "transaction": false
}
```

#### Response Format
- **Execution Summary**: Total time, query counts, success/failure rates
- **Individual Results**: Success status, data, and timing for each query
- **Transaction Status**: Whether transaction was used and its outcome
- **Security Indicators**: SELECT-only mode, SSH tunnel status

#### Limitations
- Maximum batch size is configurable (default: 10 queries)
- All queries must pass security validation
- Transaction mode requires full database access (not SELECT-only)

---

### `sql_analyze_performance`
Analyze query performance and provide optimization recommendations using database EXPLAIN plans.

#### Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `database` | `string` | | Database name from configuration |
| `query` | `string` | | SQL query to analyze |

#### Features
- **Execution Plan Analysis**: Database-specific EXPLAIN query execution
- **Performance Metrics**: Execution time, row counts, column analysis
- **Optimization Recommendations**: Automated suggestions for improvements
- **Database-Specific**: Tailored analysis for PostgreSQL, MySQL, SQLite, SQL Server
- **Name Check**: The query is checked against the cached schema before it is analyzed; see [Name Checking](#name-checking)

#### Example Usage
```sql
SELECT u.name, u.email, p.title, p.created_at
FROM users u
JOIN posts p ON u.id = p.user_id
WHERE u.status = 'active'
 AND p.created_at > CURRENT_DATE - INTERVAL '30 days'
ORDER BY p.created_at DESC
```

#### Response Format
- [TIME] **Execution Times**: Query execution time and explain analysis time (in milliseconds)
- **Query Results**: Row count and column count from actual execution
- **Execution Plan**: Raw database execution plan output
- **Performance Recommendations**: Basic optimization suggestions (generic recommendations)

#### Current Recommendations Include
- Query execution time analysis
- Result set size warnings
- Basic JOIN optimization suggestions
- Database-specific execution plan analysis (PostgreSQL, MySQL, SQLite)
- Generic performance tips (LIMIT usage, SELECT * warnings)

**Note:** Advanced index recommendations and detailed query optimization analysis are planned for future releases.

---

### `sql_list_databases`
List all configured databases with their connection status, security settings, and schema information.

#### Parameters
No parameters required.

#### Features
- **Configuration Overview**: All registered databases
- **Connection Status**: Active/inactive connection information
- **Security Settings**: SELECT-only mode, SSL, SSH tunnel status
- **Schema Information**: Cached schema metadata summary
- **Global Security Limits**: System-wide security configuration

#### Response Format
```
 Configured Databases:

 **production** (postgresql)
 db.company.com:5432
 SSH tunnel enabled
 SSL enabled
 Security: SELECT-only mode (production safe)
 Allows: SELECT, WITH, SHOW, EXPLAIN, DESCRIBE
 Blocks: INSERT, UPDATE, DELETE, DROP, CREATE, ALTER
 Schema: 45 tables, 1,247 columns
 MCP configurable: no (manual config only)

 **analytics** (mysql)
 analytics.company.com:3306
 SSL enabled
 Security: Full access mode (use with caution)
 Schema: 12 tables, 89 columns
 MCP configurable: yes

 **Global Security Limits:**
 - Max JOINs: 10
 - Max Subqueries: 5
 - Max UNIONs: 3
 - Max GROUP BYs: 5
 - Max Complexity Score: 100
 - Max Query Length: 10000
```

---

### `sql_get_schema`
Retrieve detailed schema information for a database including tables, columns, and relationships.

#### Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `database` | `string` | | Database name to get schema for |
| `table` | `string` | | Optional: Get schema for specific table only |

#### Features
- **Complete Schema**: Tables, views, columns, data types
- **Relationship Information**: Foreign keys and constraints
- **Column Details**: Types, nullability, defaults, constraints
- **Filtered Output**: Optional single table focus
- **Cached Results**: Fast retrieval from schema cache
- **Captured on Demand**: When no schema is cached yet, Argos captures it first (up to 5 seconds) instead of asking you to connect; if the capture fails or takes longer, the response says it could not capture the schema, and the capture keeps going in the background

#### Response Format

The output format adapts based on schema size to stay within token limits.

**Large schemas (>200 columns) — compact summary:**
```
production (postgresql) - 45T 8V 1247C
TABLES:
users(5c keys:[id,email])
posts(6c keys:[id,user_id])
comments(5c keys:[id,post_id,user_id])
orders(8c keys:[id,user_id])
...

Use sql_get_schema with table parameter to see full column details for a specific table.
```

Each table shows: `name(column_count keys:[key_columns]) //comment`

**Small schemas (≤200 columns) — full inline detail:**
```
mydb (mysql) - 5T 0V 28C
TABLES:
users: id int [PRI,NN], name varchar(255) [NN], email varchar(255) [PRI,NN], created_at timestamp [NN,d:CURRENT_TIMESTAMP]
posts: id int [PRI,NN], user_id int [MUL,NN], title varchar(500) [NN], content text, published tinyint [NN,d:0]
```

Column flags: `PRI`=primary key, `MUL`=indexed, `UNI`=unique, `NN`=not null, `d:val`=default value. Comments appear as `//comment`.

**Single table request** (always shows full detail regardless of schema size):
```
production (postgresql) - 45T 8V 1247C
users: id bigint [PRI,NN], name varchar(255) [NN], email varchar(255) [PRI,NN], status varchar(50) [NN,d:'active'], created_at timestamp [NN,d:CURRENT_TIMESTAMP], updated_at timestamp [NN,d:CURRENT_TIMESTAMP]
```

---

### `sql_test_connection`
Test connectivity to a database, establish SSH tunnels if needed, and capture schema information.

#### Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `database` | `string` | | Database name to test |

#### Features
- **Connection Validation**: Full connection test including authentication
- **SSH Tunnel Testing**: Validates SSH tunnel connectivity
- **Schema Capture**: Attempts to capture basic schema information
- **Performance Testing**: Basic connectivity performance measurement
- **Configuration Validation**: Validates database configuration

#### Response Format
**Successful Connection:**
```
 Connection successful to production
 SSH tunnel established
 SELECT-only mode active
 Schema captured: 45 tables, 1,247 columns
```

**Failed Connection:**
```
 Connection failed to production: Connection timeout after 30000ms

Troubleshooting:
- Verify database host and port are correct
- Check firewall rules allow connections
- Ensure SSH tunnel configuration is valid
- Verify database credentials are correct
```

#### Use Cases
- Initial database setup validation
- Troubleshooting connection issues
- Verifying SSH tunnel configuration
- Schema capture after database changes

---

### `sql_refresh_schema`
Refresh cached schema information for a database after structural changes.

#### Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `database` | `string` | | Database name to refresh schema for |

#### Features
- **Force Refresh**: Bypasses cache and re-captures schema
- **Complete Rebuild**: Updates all tables, views, and relationships
- **Performance Optimized**: Efficient schema discovery queries
- **Cache Update**: Updates in-memory schema cache

#### Response Format
```
 Schema refreshed for production
 Captured: 45 tables, 1,247 columns

**Changes Detected:**
- 2 new tables added
- 1 table modified (new columns)
- 3 new indexes created
```

#### When to Use
- After database schema changes
- When schema cache becomes stale
- Before important query operations
- During database migration processes

---

### `sql_add_database`
Add a new database configuration at runtime. The new database will be MCP-configurable by default.

#### Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | | Unique name for the database |
| `type` | `string` | | Database type: mysql, postgresql, postgres, sqlite, mssql, sqlserver |
| `host` | `string` | | Database host (not needed for SQLite) |
| `port` | `number` | | Database port (uses default for type if omitted) |
| `database` | `string` | | Database name on the server |
| `username` | `string` | | Database username |
| `password` | `string` | | Database password |
| `file` | `string` | | File path (SQLite only) |
| `ssl` | `boolean` | | Enable SSL (default: false) |
| `select_only` | `boolean` | | Restrict to SELECT queries only (default: true) |
| `ssh_host` | `string` | | SSH tunnel host |
| `ssh_port` | `number` | | SSH tunnel port (default: 22) |
| `ssh_username` | `string` | | SSH username |
| `ssh_password` | `string` | | SSH password |
| `ssh_private_key` | `string` | | SSH private key path |

#### Features
- **Always MCP-Configurable**: Sets mcp_configurable=true on created databases
- **Safe Defaults**: Defaults to select_only=true for safety
- **Persistent**: Persists to config.ini automatically
- **Immediate Registration**: Registers database with connection manager immediately

#### Example Usage
```json
{
 "tool": "sql_add_database",
 "arguments": {
 "name": "analytics",
 "type": "postgresql",
 "host": "analytics-db.company.com",
 "port": 5432,
 "database": "analytics",
 "username": "readonly_user",
 "password": "secure_password",
 "ssl": true,
 "select_only": true
 }
}
```

#### Response Format
```
 Database 'analytics' added successfully (type: postgresql)
 MCP configurable: yes (can be locked via sql_set_mcp_configurable)
 SELECT-only: yes
Use sql_test_connection to verify connectivity.
```

---

### `sql_update_database`
Update settings on an existing database. Only works on databases with mcp_configurable=true.

#### Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `database` | `string` | | Database name to update |
| `host` | `string` | | New host |
| `port` | `number` | | New port |
| `database_name` | `string` | | New database name on server |
| `username` | `string` | | New username |
| `password` | `string` | | New password |
| `file` | `string` | | New file path (SQLite) |
| `ssl` | `boolean` | | Enable/disable SSL |
| `select_only` | `boolean` | | Enable/disable SELECT-only mode |
| `ssh_host` | `string` | | SSH tunnel host |
| `ssh_port` | `number` | | SSH tunnel port |
| `ssh_username` | `string` | | SSH username |
| `ssh_password` | `string` | | SSH password |
| `ssh_private_key` | `string` | | SSH private key path |

#### Features
- **MCP-Configurable Only**: Only works on databases where mcp_configurable=true
- **Clear Error on Lock**: Refuses with clear error if database is locked (mcp_configurable=false)
- **Immediate Effect**: Re-registers database with connection manager to apply changes
- **Persistent**: Persists changes to config.ini

#### Security
Refuses to modify databases that are not MCP-configurable. Manually-configured databases are protected by default.

#### Example Usage
```json
{
 "tool": "sql_update_database",
 "arguments": {
 "database": "analytics",
 "host": "new-analytics-db.company.com",
 "ssl": true
 }
}
```

#### Response Format
```
 Database 'analytics' updated successfully
 Changed fields: host, ssl
Use sql_test_connection to verify connectivity with new settings.
```

---

### `sql_remove_database`
Remove a database configuration. Only works on databases with mcp_configurable=true.

#### Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `database` | `string` | | Database name to remove |

#### Features
- **MCP-Configurable Only**: Only works on databases where mcp_configurable=true
- **Full Cleanup**: Disconnects active connections and SSH tunnels
- **Persistent**: Removes from in-memory config and persists to config.ini
- **Irreversible**: Cannot be undone (database must be re-added)

#### Example Usage
```json
{
 "tool": "sql_remove_database",
 "arguments": {
 "database": "old_analytics"
 }
}
```

#### Response Format
```
 Database 'old_analytics' removed successfully
Connection closed and configuration saved.
```

---

### `sql_get_config`
Get the current configuration of a database. Passwords and SSH credentials are always redacted in the output.

#### Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `database` | `string` | | Database name to get config for |

#### Features
- **Always Allowed**: Permitted regardless of mcp_configurable setting
- **Credential Redaction**: Automatically redacts: password, ssh_password, ssh_private_key, ssh_passphrase
- **MCP Status**: Shows mcp_configurable status
- **Full Overview**: Shows all connection and security settings

#### Example Usage
```json
{
 "tool": "sql_get_config",
 "arguments": {
 "database": "production"
 }
}
```

#### Response Format
```
 Configuration for 'production':

 type: postgresql
 host: db.company.com
 port: 5432
 database: production_db
 username: readonly_user
 password: ***REDACTED***
 ssl: true
 select_only: true
 timeout: 30000

 MCP configurable: no
```

---

### `sql_get_metrics`
Get in-memory performance metrics for configured databases. Returns query latency (min/max/avg/p95), error counts by category, circuit breaker state, cache hit rate, and pool utilization.

#### Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `database` | `string` | No | Optional database name. Omit to get metrics for all databases. |

#### Features
- **Query Latency Tracking**: Tracks min, max, average, and p95 query execution latencies
- **Error Tracking by Category**: Tracks query, connection, timeout, and security errors
- **Circuit Breaker State**: Reports current state (CLOSED, OPEN, HALF_OPEN)
- **Cache Efficiency**: Reports cache hit and miss statistics
- **Real-time Performance Monitoring**: Instant in-memory stats snapshot as formatted JSON

#### Example Usage
```json
{
  "tool": "sql_get_metrics",
  "arguments": {
    "database": "production"
  }
}
```

#### Response Format
```json
{
  "database": "production",
  "uptime": 123456,
  "queries": {
    "total": 156,
    "success": 154,
    "failure": 2
  },
  "latency": {
    "min": 2,
    "max": 245,
    "avg": 15,
    "p95": 45
  },
  "errors": {
    "query": 1,
    "connection": 1,
    "timeout": 0,
    "security": 0
  },
  "circuit": {
    "events": []
  },
  "cache": {
    "hits": 42,
    "misses": 114,
    "hitRate": 0.269
  }
}
```

---

### `sql_set_mcp_configurable`
Lock a database from MCP configuration changes. This is a one-way operation -- once locked, only manual editing of config.ini can re-enable MCP configuration access.

#### Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `database` | `string` | | Database name |
| `enabled` | `boolean` | | Must be false. Setting to true is rejected for security. |

#### Features
- **One-Way Lock**: Can ONLY set mcp_configurable to false (lock)
- **Security Enforced**: Setting enabled=true returns an error with instructions for manual unlocking
- **AI-Proof**: Prevents AI from re-enabling its own configuration access after a human locks it
- **Immediate Persistence**: Persists immediately to config.ini

#### Security
This one-way lock is a critical security feature. It ensures that once a human decides to lock a database from MCP changes, no AI agent can reverse that decision. Only a human with file system access can unlock it.

#### Example Usage

**Locking a database:**
```json
{
 "tool": "sql_set_mcp_configurable",
 "arguments": {
 "database": "production",
 "enabled": false
 }
}
```

**Response:**
```
 Database 'production' is now locked from MCP configuration changes.
To re-enable MCP configuration, manually set mcp_configurable=true in config.ini.
```

**Attempting to unlock (rejected):**
```json
{
 "tool": "sql_set_mcp_configurable",
 "arguments": {
 "database": "production",
 "enabled": true
 }
}
```

**Response (error):**
```
 Cannot enable MCP configurability via MCP tools.
For security, setting mcp_configurable=true must be done by manually editing config.ini.
This prevents an AI from re-enabling its own configuration access after a human locks it.

To unlock, add this to config.ini under [database.production]:
mcp_configurable=true
```

---

## Security Model

### SELECT-Only Mode
When `select_only=true` in database configuration:

**Allowed Operations:**
- `SELECT` - Data retrieval queries
- `WITH` - Common table expressions
- `SHOW` - Database information queries
- `EXPLAIN` - Query execution plans
- `DESCRIBE` - Table structure queries

**Blocked Operations:**
- `INSERT`, `UPDATE`, `DELETE` - Data modification
- `DROP`, `CREATE`, `ALTER` - Schema changes
- `TRUNCATE` - Data deletion
- `GRANT`, `REVOKE` - Permission changes
- `EXEC`, `CALL` - Stored procedure execution

### Name Checking
Agents often guess column names. Argos checks them in two layers.

**Before the query runs** (`sql_query`, `sql_batch_query`, `sql_analyze_performance`): for a `SELECT`, a `WITH`...`SELECT` or an `EXPLAIN` of either, Argos compares the column names with the cached schema of the tables it knows. If it is confident a column doesn't exist, it doesn't run the query and returns:

```
 Query not run on mydb: it names a column that doesn't exist: users.user_name
```

followed by a correction: a "did you mean" suggestion and the table's columns with their types. In a batch, one bad statement blocks the whole batch before any statement runs, and the response names that statement. Table names never block, and when Argos is unsure the query runs. Before blocking, Argos re-checks the live schema fingerprint so a column that was just added is not blocked; the message suggests `sql_refresh_schema` for a stale cache. Blocked queries are journaled as blocked.

**After the database rejects the query** (always on): when the database reports an unknown column or table, the same style of correction is appended after the database's own error.

If no schema is cached, Argos captures it before the first query. The capture waits up to 5 seconds; past that the query runs unchecked and the capture finishes in the background.

Corrections show names and types only, capped at 3 tables, 40 columns per table and 3 suggestions. Set `name_check=false` on a connection to turn off the first layer; the second stays on.

### Query Complexity Limits
All queries are analyzed for complexity and resource usage:

| Limit | Default | Description |
|-------|---------|-------------|
| Max JOINs | 10 | Maximum number of JOIN operations |
| Max Subqueries | 5 | Maximum nested subqueries |
| Max UNIONs | 3 | Maximum UNION operations |
| Max GROUP BYs | 5 | Maximum GROUP BY clauses |
| Max Complexity Score | 100 | Overall query complexity limit |
| Max Query Length | 10,000 | Maximum character length |

### Dangerous Pattern Detection
The system automatically detects and blocks:
- SQL injection attempts
- File system access operations
- System command execution
- Privilege escalation attempts
- Data exfiltration patterns

---

## Performance Features

### Result Set Management
- **Row Limiting**: Configurable maximum rows per query (default: 1,000)
- **Truncation Indicators**: Clear indication when results are limited
- **Memory Management**: Efficient handling of large result sets
- **Streaming**: Support for large query results

### Connection Optimization
- **Connection Pooling**: Reuse database connections across queries
- **SSH Tunnel Reuse**: Persistent SSH tunnels for remote databases
- **Health Monitoring**: Automatic connection health checks
- **Timeout Management**: Configurable query and connection timeouts

### Schema Caching
- **In-Memory Cache**: Fast schema access without database queries
- **Automatic Refresh**: Schema updates on connection changes
- **Selective Caching**: Option to cache specific tables or databases
- **Cache Invalidation**: Manual and automatic cache refresh

---

## Error Handling

### Common Error Responses

#### Connection Errors
```
 Connection failed to database: Connection timeout
Troubleshooting:
- Verify host and port configuration
- Check network connectivity
- Ensure database is running
- Validate credentials
```

#### Security Violations
```
 Query blocked: INSERT is not allowed in SELECT-only mode
Security Information:
This database is configured with SELECT-only mode for safety.
Only SELECT, WITH, SHOW, EXPLAIN, and DESCRIBE statements are allowed.
```

#### Query Complexity Errors
```
 Query complexity exceeds limits: 15 JOINs (max: 10)
Suggestions:
- Break complex queries into smaller parts
- Use temporary tables for intermediate results
- Consider query optimization techniques
```

#### SSH Tunnel Errors
```
 SSH tunnel failed: Authentication failed
Troubleshooting:
- Verify SSH credentials
- Check SSH key permissions
- Ensure SSH server is accessible
- Validate tunnel configuration
```

---

## Usage Examples

### Basic Query Execution
```json
{
 "tool": "sql_query",
 "arguments": {
 "database": "production",
 "query": "SELECT COUNT(*) as user_count FROM users WHERE status = 'active'"
 }
}
```

### Batch Analytics Query
```json
{
 "tool": "sql_batch_query",
 "arguments": {
 "database": "analytics",
 "queries": [
 {
 "query": "SELECT DATE(created_at) as date, COUNT(*) as signups FROM users WHERE created_at >= ? GROUP BY DATE(created_at) ORDER BY date",
 "params": ["2024-01-01"],
 "label": "Daily Signups"
 },
 {
 "query": "SELECT COUNT(*) as active_users FROM users WHERE last_login >= ? AND status = 'active'",
 "params": ["2024-07-01"],
 "label": "Active Users Last Month"
 }
 ],
 "transaction": false
 }
}
```

### Performance Analysis
```json
{
 "tool": "sql_analyze_performance",
 "arguments": {
 "database": "production",
 "query": "SELECT u.name, COUNT(o.id) as order_count FROM users u LEFT JOIN orders o ON u.id = o.user_id WHERE u.created_at > '2024-01-01' GROUP BY u.id, u.name HAVING COUNT(o.id) > 10 ORDER BY order_count DESC"
 }
}
```

### Schema Exploration
```json
{
 "tool": "sql_get_schema",
 "arguments": {
 "database": "production",
 "table": "users"
 }
}
```

### Add a New Database at Runtime
```json
{
 "tool": "sql_add_database",
 "arguments": {
 "name": "staging",
 "type": "postgresql",
 "host": "staging-db.company.com",
 "port": 5432,
 "database": "staging",
 "username": "app_user",
 "password": "staging_password",
 "select_only": true
 }
}
```

### Update Database Configuration
```json
{
 "tool": "sql_update_database",
 "arguments": {
 "database": "staging",
 "host": "new-staging-db.company.com",
 "port": 5433
 }
}
```

### Remove a Database
```json
{
 "tool": "sql_remove_database",
 "arguments": {
 "database": "staging"
 }
}
```

### View Database Configuration
```json
{
 "tool": "sql_get_config",
 "arguments": {
 "database": "production"
 }
}
```

### View Performance Metrics
```json
{
 "tool": "sql_get_metrics",
 "arguments": {
 "database": "production"
 }
}
```

### Lock a Database from MCP Changes
```json
{
 "tool": "sql_set_mcp_configurable",
 "arguments": {
 "database": "production",
 "enabled": false
 }
}
```

---

## Best Practices

### Query Writing
1. **Use Parameterized Queries**: Always use parameter binding for dynamic values
2. **Limit Result Sets**: Include LIMIT clauses for exploratory queries
3. **Index Awareness**: Consider index usage in WHERE and JOIN clauses
4. **SELECT Specific Columns**: Avoid SELECT * in production queries

### Security
1. **Use SELECT-Only Mode**: Enable for production databases
2. **Regular Schema Refresh**: Keep schema cache updated
3. **Monitor Query Complexity**: Review blocked queries for optimization
4. **SSH Tunnel Best Practices**: Use key-based authentication

### Performance
1. **Batch Related Queries**: Use batch execution for multiple queries
2. **Connection Reuse**: Let the system manage connection pooling
3. **Schema Caching**: Refresh schema only when needed
4. **Query Analysis**: Use performance analysis for slow queries

---

This reference provides comprehensive coverage of all available MCP tools. For additional examples and use cases, see the [tutorials](../tutorials/) section.

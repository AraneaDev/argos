# Error Codes Reference

This document provides a comprehensive reference for all error codes and error handling patterns used in the Argos.

## Error Code Categories

### MCP Protocol Errors (-32xxx)
Following JSON-RPC 2.0 specification for MCP protocol errors.

### Database Errors (1xxx - 3xxx)
Application-specific database operation errors.

### Security Errors (4xxx - 5xxx)
Security validation and access control errors.

### Configuration Errors (6xxx - 7xxx) 
Configuration and setup related errors.

---

## MCP Protocol Errors

### -32700 Parse Error
**Description**: Invalid JSON was received by the server.
**Cause**: Malformed JSON in MCP message
**Resolution**: Ensure valid JSON formatting

```json
{
 "jsonrpc": "2.0",
 "id": null,
 "error": {
 "code": -32700,
 "message": "Parse error"
 }
}
```

### -32600 Invalid Request
**Description**: The JSON sent is not a valid Request object.
**Cause**: Missing required fields or invalid request structure
**Resolution**: Validate request format against MCP specification

```json
{
 "jsonrpc": "2.0",
 "id": 1,
 "error": {
 "code": -32600,
 "message": "Invalid Request"
 }
}
```

### -32601 Method Not Found
**Description**: The method does not exist or is not available.
**Cause**: Unknown MCP method called
**Resolution**: Use supported methods: initialize, tools/list, tools/call

```json
{
 "jsonrpc": "2.0",
 "id": 1,
 "error": {
 "code": -32601,
 "message": "Method not found: unknown_method"
 }
}
```

### -32602 Invalid Params
**Description**: Invalid method parameter(s).
**Cause**: Missing required parameters or incorrect parameter types
**Resolution**: Check tool documentation for required parameters

```json
{
 "jsonrpc": "2.0",
 "id": 1,
 "error": {
 "code": -32602,
 "message": "Invalid tool call request"
 }
}
```

### -32603 Internal Error
**Description**: Internal JSON-RPC error.
**Cause**: Server-side error during request processing
**Resolution**: Check server logs for detailed error information

```json
{
 "jsonrpc": "2.0",
 "id": 1,
 "error": {
 "code": -32603,
 "message": "Internal error: Connection failed"
 }
}
```

---

## Database Errors

### 1001 Connection Failed
**Description**: Failed to establish database connection
**Common Causes**:
- Invalid host/port configuration
- Network connectivity issues
- Database server not running
- Invalid credentials

**Resolution Steps**:
1. Verify database configuration
2. Test network connectivity
3. Check database server status
4. Validate credentials

```typescript
interface ConnectionError {
 code: 1001;
 message: string;
 details: {
 database: string;
 host?: string;
 port?: number;
 timeout?: number;
 originalError: string;
 };
}
```

### 1002 Authentication Failed
**Description**: Database authentication rejected
**Common Causes**:
- Incorrect username/password
- User account locked/disabled
- Insufficient privileges
- Authentication method mismatch

**Resolution Steps**:
1. Verify credentials are correct
2. Check user account status
3. Confirm user has database access
4. Review authentication method

### 1003 Database Not Found
**Description**: Specified database does not exist
**Common Causes**:
- Database name typo
- Database not created
- Insufficient privileges to access

**Resolution Steps**:
1. Verify database name spelling
2. Confirm database exists
3. Check user permissions

### 1004 Connection Timeout
**Description**: Database connection attempt timed out
**Common Causes**:
- Network latency issues
- Database server overloaded
- Firewall blocking connection
- Incorrect timeout settings

**Resolution Steps**:
1. Check network connectivity
2. Increase timeout values
3. Verify firewall rules
4. Monitor database server load

### 1005 SSL/TLS Error
**Description**: SSL/TLS connection failed
**Common Causes**:
- Invalid SSL certificates
- SSL/TLS version mismatch
- Certificate verification failed

**Resolution Steps**:
1. Verify SSL certificate validity
2. Check SSL/TLS configuration
3. Ensure certificate chain is complete

---

## Query Execution Errors

### 2001 Query Execution Failed
**Description**: SQL query execution failed
**Common Causes**:
- Syntax errors in SQL
- Referenced objects don't exist
- Data type mismatches
- Constraint violations

**Resolution Steps**:
1. Validate SQL syntax
2. Check object existence
3. Review data types
4. Verify constraints

```typescript
interface QueryExecutionError {
 code: 2001;
 message: string;
 details: {
 database: string;
 query: string;
 position?: number;
 sqlState?: string;
 originalError: string;
 };
}
```

### 2002 Query Timeout
**Description**: Query execution exceeded timeout limit
**Common Causes**:
- Complex queries taking too long
- Large result sets
- Database locks/blocking
- Insufficient resources

**Resolution Steps**:
1. Optimize query performance
2. Increase timeout settings
3. Check for blocking operations
4. Add appropriate indexes

### 2003 Result Set Too Large
**Description**: Query returned more rows than allowed limit
**Common Causes**:
- Missing LIMIT clause
- Broader WHERE conditions than expected
- Configuration limit set too low

**Resolution Steps**:
1. Add LIMIT clause to query
2. Refine WHERE conditions
3. Increase max_rows configuration
4. Use pagination for large datasets

### 2004 Transaction Failed
**Description**: Database transaction failed
**Common Causes**:
- Deadlocks
- Constraint violations
- Resource limitations
- Connection lost during transaction

**Resolution Steps**:
1. Retry transaction
2. Review transaction logic
3. Check for deadlock conditions
4. Verify connection stability

---

## Security Errors

### 4001 Query Blocked - SELECT Only Mode
**Description**: Non-SELECT query blocked in SELECT-only mode
**Blocked Operations**: INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, TRUNCATE

**Resolution**: 
- Use SELECT-only operations
- Configure full access mode if needed
- Use appropriate database for modifications

```typescript
interface SecurityViolationError {
 code: 4001;
 message: string;
 details: {
 database: string;
 query: string;
 reason: string;
 blockedOperation: string;
 };
}
```

### 4002 Query Complexity Exceeded
**Description**: Query complexity exceeds configured limits
**Common Limits**:
- Max JOINs (default: 10)
- Max subqueries (default: 5) 
- Max UNIONs (default: 3)
- Max complexity score (default: 100)

**Resolution Steps**:
1. Simplify complex queries
2. Break into smaller queries
3. Adjust complexity limits
4. Use temporary tables

### 4003 Query Length Exceeded
**Description**: Query exceeds maximum allowed length
**Default Limit**: 10,000 characters

**Resolution Steps**:
1. Shorten query text
2. Remove unnecessary whitespace
3. Use query parameters
4. Increase max_query_length setting

### 4004 Dangerous Pattern Detected
**Description**: Potentially dangerous SQL pattern detected
**Common Patterns**:
- File system access
- System command execution
- Privilege escalation attempts
- Data exfiltration patterns

**Resolution Steps**:
1. Review query for security issues
2. Remove dangerous operations
3. Use safer alternative approaches

### 4005 SQL Injection Attempt
**Description**: Potential SQL injection pattern detected
**Common Indicators**:
- Unusual quote patterns
- Comment injection attempts
- Union-based attack patterns
- Boolean-based blind attempts

**Resolution Steps**:
1. Use parameterized queries
2. Validate input data
3. Escape special characters
4. Review security practices

---

## SSH Tunnel Errors

### 5001 SSH Connection Failed
**Description**: Failed to establish SSH tunnel connection
**Common Causes**:
- Invalid SSH host/port
- Network connectivity issues
- SSH server not running
- Firewall blocking SSH

**Resolution Steps**:
1. Verify SSH host configuration
2. Test SSH connectivity manually
3. Check firewall rules
4. Confirm SSH server status

### 5002 SSH Authentication Failed
**Description**: SSH authentication rejected
**Common Causes**:
- Invalid username/password
- SSH key authentication failed
- Key permissions incorrect
- SSH agent issues

**Resolution Steps**:
1. Verify SSH credentials
2. Check SSH key permissions (600)
3. Test SSH key manually
4. Review SSH agent configuration

### 5003 SSH Tunnel Creation Failed
**Description**: Failed to create SSH tunnel for database
**Common Causes**:
- Port forwarding disabled
- Local port already in use
- Remote port not accessible
- SSH tunnel configuration invalid

**Resolution Steps**:
1. Check SSH tunnel configuration
2. Verify port forwarding is enabled
3. Use different local port
4. Test remote port accessibility

### 5004 SSH Key Invalid
**Description**: SSH private key is invalid or corrupted
**Common Causes**:
- Corrupted key file
- Incorrect key format
- Password-protected key without passphrase
- Key file permissions incorrect

**Resolution Steps**:
1. Verify key file integrity
2. Check key format (OpenSSH/PEM)
3. Provide passphrase if needed
4. Set correct file permissions

---

## Configuration Errors

### 6001 Configuration File Missing
**Description**: config.ini file not found
**Default Location**: ./config.ini

**Resolution Steps**:
1. Run `argos setup` to create configuration
2. Verify config.ini exists in working directory
3. Check file permissions
4. Specify custom config path

### 6002 Invalid Configuration
**Description**: Configuration file contains invalid settings
**Common Issues**:
- Missing required fields
- Invalid data types
- Unknown configuration options
- Malformed INI syntax

**Resolution Steps**:
1. Validate INI file syntax
2. Check required fields are present
3. Verify data type formats
4. Review configuration documentation

### 6003 Database Configuration Invalid
**Description**: Database-specific configuration is invalid
**Common Issues**:
- Missing required database fields
- Invalid database type
- Incompatible options
- Invalid port numbers

**Resolution Steps**:
1. Verify all required fields present
2. Check database type is supported
3. Validate port numbers
4. Review database-specific requirements

```typescript
interface ConfigurationError {
 code: 6003;
 message: string;
 details: {
 database: string;
 field: string;
 value?: any;
 expectedType?: string;
 validValues?: string[];
 };
}
```

### 6004 Security Configuration Invalid
**Description**: Security settings are invalid or conflicting
**Common Issues**:
- Negative limit values
- Conflicting security settings
- Invalid complexity thresholds

**Resolution Steps**:
1. Check all security limits are positive
2. Review security configuration logic
3. Validate threshold values
4. Test with default security settings

### 6005 Extension Configuration Invalid
**Description**: Extension/operational settings are invalid
**Common Issues**:
- Invalid timeout values
- Negative row limits
- Invalid batch sizes

**Resolution Steps**:
1. Verify timeout values are reasonable
2. Check row limits are positive
3. Validate batch size limits
4. Review operational settings

---

## Schema Errors

### 7001 Schema Capture Failed
**Description**: Failed to capture database schema information
**Common Causes**:
- Insufficient database privileges
- System tables not accessible
- Database-specific query errors
- Connection lost during capture

**Resolution Steps**:
1. Verify user has schema read permissions
2. Check system table access
3. Review database error logs
4. Ensure stable connection

### 7002 Schema Not Available
**Description**: Schema information not available for database
**Common Causes**:
- Schema never captured
- Schema cache cleared
- Database connection never established
- Schema capture disabled

**Resolution Steps**:
1. Connect to database first
2. Use `sql_refresh_schema` tool
3. Check schema cache status
4. Enable schema capture

### 7003 Schema Cache Invalid
**Description**: Cached schema information is invalid or corrupted
**Common Causes**:
- Schema cache corruption
- Database structure changed
- Version mismatch
- File system issues

**Resolution Steps**:
1. Refresh schema cache
2. Clear and recapture schema
3. Check file system integrity
4. Restart server if needed

---

## Error Response Format

All errors follow a consistent format:

### MCP Error Response
```json
{
 "jsonrpc": "2.0",
 "id": 1,
 "error": {
 "code": -32603,
 "message": "Database connection failed",
 "data": {
 "database": "production",
 "host": "db.example.com",
 "originalError": "Connection timeout"
 }
 }
}
```

### Tool Error Response
```json
{
 "jsonrpc": "2.0",
 "id": 1,
 "result": {
 "content": [
 {
 "type": "text",
 "text": " Error in sql_query: Connection failed to database 'production'"
 }
 ],
 "isError": true,
 "_meta": {
 "progressToken": null
 }
 }
}
```

### TypeScript Error Types
```typescript
// Base error class
export class SQLMCPError extends Error {
 code: number;
 details?: Record<string, any>;
 
 constructor(message: string, code: number, details?: Record<string, any>) {
 super(message);
 this.name = 'SQLMCPError';
 this.code = code;
 this.details = details;
 }
}

// Security violation error
export class SecurityViolationError extends SQLMCPError {
 constructor(message: string, details?: Record<string, any>) {
 super(message, 4001, details);
 this.name = 'SecurityViolationError';
 }
}

// Connection error
export class ConnectionError extends SQLMCPError {
 constructor(message: string, details?: Record<string, any>) {
 super(message, 1001, details);
 this.name = 'ConnectionError';
 }
}

// Query execution error
export class QueryExecutionError extends SQLMCPError {
 constructor(message: string, details?: Record<string, any>) {
 super(message, 2001, details);
 this.name = 'QueryExecutionError';
 }
}
```

---

## Error Recovery Strategies

### Automatic Retry Logic
- Connection errors: 3 retries with exponential backoff
- Timeout errors: 1 retry with extended timeout
- Transient errors: Smart retry based on error type

### Fallback Mechanisms
- SSH tunnel failures: Direct connection attempt if configured
- Schema cache misses: On-demand schema capture
- Connection pool exhaustion: Queue with timeout

### Circuit Breaker Pattern
- Database connection failures trigger circuit breaker
- Prevents cascade failures
- Automatic recovery after cool-down period

---

## Error Monitoring

### Recommended Monitoring
- Error rate by error code
- Connection failure patterns
- Query execution error trends
- Security violation attempts

### Alerting Thresholds
- Connection error rate > 5%
- Security violations > 10/hour
- Query timeout rate > 2%
- SSH tunnel failures > 3/hour

### Log Analysis Queries
```sql
-- Connection error patterns
SELECT database, COUNT(*) as error_count 
FROM error_logs 
WHERE error_code BETWEEN 1001 AND 1999
GROUP BY database 
ORDER BY error_count DESC;

-- Security violation trends
SELECT DATE(timestamp) as date, COUNT(*) as violations
FROM error_logs 
WHERE error_code BETWEEN 4001 AND 4999
GROUP BY DATE(timestamp) 
ORDER BY date DESC;
```

This comprehensive error code reference helps developers and operators understand, diagnose, and resolve issues effectively.
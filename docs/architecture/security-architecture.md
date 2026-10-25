# Security Architecture

The Argos implements a comprehensive, multi-layered security architecture designed to protect database assets while providing secure access to Claude Code. This document details the security model, threat analysis, and protective mechanisms.

## Security Philosophy

The security architecture follows the principle of **Defense in Depth**, implementing multiple security layers to protect against various threat vectors:

1. **Assume Breach**: Design for the scenario where one layer is compromised
2. **Least Privilege**: Minimum necessary access by default
3. **Fail Secure**: Default to blocking rather than allowing uncertain operations
4. **Audit Everything**: Comprehensive logging of all security-relevant events
5. **Defense in Depth**: Multiple independent security layers

## Security Layers

```mermaid
graph TB
 Claude[Claude Code] --> Transport[Transport Security]
 Transport --> Protocol[MCP Protocol Validation]
 Protocol --> Authentication[Authentication Layer]
 Authentication --> Authorization[Authorization & Access Control]
 Authorization --> QueryValidation[Query Validation]
 QueryValidation --> ComplexityAnalysis[Complexity Analysis]
 ComplexityAnalysis --> PatternDetection[Dangerous Pattern Detection]
 PatternDetection --> SelectOnly[SELECT-Only Enforcement]
 SelectOnly --> ConnectionIsolation[Connection Isolation]
 ConnectionIsolation --> AuditLogging[Audit & Monitoring]
 AuditLogging --> Database[(Database)]
```

## Core Security Components

### 1. Query Validation Engine

The `SecurityManager` class provides comprehensive SQL query validation through multiple stages:

#### SQL Tokenization & Parsing
```typescript
interface SQLToken {
 value: string;
 type: 'KEYWORD' | 'IDENTIFIER' | 'STRING' | 'OPERATOR' | 'UNKNOWN';
 position: number;
 normalized: string;
}
```

**Features:**
- **Lexical Analysis**: Breaks queries into tokens for detailed analysis
- **Keyword Classification**: Distinguishes between allowed and blocked keywords
- **Comment Stripping**: Removes SQL comments that could hide malicious code
- **Normalization**: Standardizes whitespace and casing for consistent analysis

#### Keyword-Based Filtering
```typescript
// Blocked keywords in SELECT-only mode
const blockedKeywords = [
 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER',
 'TRUNCATE', 'REPLACE', 'MERGE', 'UPSERT', 'GRANT', 'REVOKE',
 'EXEC', 'EXECUTE', 'CALL', 'SET', 'DECLARE', 'USE', 'LOAD',
 'IMPORT', 'EXPORT', 'BACKUP', 'RESTORE', 'ATTACH', 'DETACH'
];

// Allowed keywords in SELECT-only mode 
const allowedKeywords = [
 'SELECT', 'WITH', 'FROM', 'WHERE', 'JOIN', 'GROUP', 'BY',
 'HAVING', 'ORDER', 'LIMIT', 'UNION', 'CASE', 'WHEN', 'THEN',
 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'SHOW', 'EXPLAIN', 'DESCRIBE'
];
```

### 2. Query Complexity Analysis

Advanced complexity scoring prevents resource abuse and potential DoS attacks:

#### Complexity Metrics
```typescript
interface QueryComplexityAnalysis {
 score: number; // Overall complexity score
 factors: string[]; // Contributing complexity factors
 joinCount: number; // Number of JOIN operations
 subqueryCount: number; // Number of nested subqueries
 unionCount: number; // Number of UNION operations
 groupByCount: number; // Number of GROUP BY fields
 windowFuncCount: number; // Number of window functions
 risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}
```

#### Complexity Scoring Algorithm
```typescript
calculateComplexityScore(query: string): number {
 let score = 0;
 
 // Weight different operations by resource impact
 score += joinCount * 5; // JOINs are expensive
 score += subqueryCount * 10; // Nested queries multiply complexity
 score += unionCount * 8; // UNIONs require result merging
 score += groupByCount * 3; // GROUP BY requires sorting/aggregation
 score += windowFuncCount * 7; // Window functions are resource intensive
 score += Math.floor(query.length / 100); // Length factor
 
 return score;
}
```

#### Configurable Limits
```ini
[security]
max_joins=10 # Maximum JOIN operations
max_subqueries=5 # Maximum nested subqueries 
max_unions=3 # Maximum UNION operations
max_group_bys=5 # Maximum GROUP BY clauses
max_complexity_score=100 # Overall complexity threshold
max_query_length=10000 # Maximum query character length
```

### 3. Dangerous Pattern Detection

Multi-layered pattern recognition identifies potential security threats:

#### SQL Injection Detection
```typescript
const injectionPatterns = [
 /;\s*(DROP|DELETE|UPDATE|INSERT|EXEC|EXECUTE)/i, // Command chaining
 /UNION\s+SELECT.*INTO/i, // Union-based injection
 /'\s*OR\s+'1'\s*=\s*'1/i, // Classic tautology
 /'\s*;\s*DROP\s+TABLE/i, // Table dropping
 /CONCAT\s*\(\s*CHAR\s*\(/i // Character encoding bypass
];
```

#### Function-Based Threats
```typescript
const dangerousFunctions = [
 'LOAD_FILE', // File system access
 'INTO OUTFILE', // File writing
 'INTO DUMPFILE', // Binary file writing 
 'SYSTEM', // System command execution
 'BENCHMARK', // DoS via CPU consumption
 'SLEEP', // DoS via time delays
 'WAITFOR DELAY' // SQL Server time delays
];
```

#### Privilege Escalation Detection
```typescript
const privilegePatterns = [
 /CREATE\s+USER/i, // User creation
 /GRANT\s+ALL/i, // Permission grants
 /ALTER\s+USER/i, // User modification
 /SET\s+PASSWORD/i // Password changes
];
```

### 4. SELECT-Only Mode Enforcement

Provides read-only database access for production environments:

#### Access Control Matrix
| Operation Category | SELECT-Only Mode | Full Access Mode |
|-------------------|------------------|------------------|
| **Data Retrieval** | Allowed | Allowed |
| `SELECT`, `WITH` | | |
| **Schema Inspection** | Allowed | Allowed |
| `SHOW`, `EXPLAIN`, `DESCRIBE` | | |
| **Data Modification** | Blocked | Allowed |
| `INSERT`, `UPDATE`, `DELETE` | | |
| **Schema Changes** | Blocked | Allowed |
| `CREATE`, `ALTER`, `DROP` | | |
| **System Operations** | Blocked | Blocked |
| `EXEC`, `LOAD_FILE`, `SYSTEM` | | |

#### Database-Specific Allowances
```typescript
const dbSpecificAllowed = {
 mysql: ['SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'],
 postgresql: ['\\d', '\\dt', '\\l', 'EXPLAIN', 'ANALYZE'], 
 mssql: ['sp_help', 'sp_columns', 'sp_tables'],
 sqlite: ['.schema', '.tables', '.indices']
};
```

## Threat Model Analysis

### Identified Threats

#### 1. SQL Injection Attacks
**Threat:** Malicious SQL code injection through query parameters or Claude's query generation

**Mitigation:**
- Comprehensive pattern matching for injection signatures
- Query tokenization and syntax analysis
- Parameter binding enforcement where possible
- Query complexity limits prevent elaborate injection payloads

#### 2. Data Exfiltration
**Threat:** Unauthorized access to sensitive data through legitimate query interfaces

**Mitigation:**
- SELECT-only mode prevents data modification that could signal extraction
- Query result limits prevent bulk data export
- Audit logging tracks all data access patterns
- Connection-level access controls

#### 3. Denial of Service (DoS)
**Threat:** Resource exhaustion through complex or numerous database queries

**Mitigation:**
- Query complexity scoring and limits
- Connection timeouts and query timeouts
- Batch operation limits
- Resource usage estimation and throttling

#### 4. Privilege Escalation
**Threat:** Attempts to gain higher database privileges or system access

**Mitigation:**
- Keyword-based blocking of privilege management commands
- Database user isolation with minimal necessary permissions
- Function-based blocking of system access functions
- Audit logging of privilege escalation attempts

#### 5. Information Disclosure
**Threat:** Unintended exposure of database schema or sensitive metadata

**Mitigation:**
- Error message sanitization
- Controlled schema exposure through dedicated tools
- Audit logging of schema access
- Configurable information exposure levels

### Attack Vectors & Countermeasures

```mermaid
graph LR
 Attacker[Attacker] --> Vector1[Direct Query Manipulation]
 Attacker --> Vector2[Claude Prompt Injection]
 Attacker --> Vector3[Configuration Exploitation]
 Attacker --> Vector4[Connection Hijacking]
 
 Vector1 --> Defense1[Query Validation Engine]
 Vector2 --> Defense2[Pattern Detection]
 Vector3 --> Defense3[Configuration Validation]
 Vector4 --> Defense4[Connection Isolation]
 
 Defense1 --> Audit[Audit System]
 Defense2 --> Audit
 Defense3 --> Audit
 Defense4 --> Audit
```

## Security Validation Process

### Multi-Stage Validation Pipeline
```mermaid
sequenceDiagram
 participant C as Claude Request
 participant V as Validator
 participant P as Pattern Detector
 participant A as Complexity Analyzer
 participant E as Execution Engine
 participant L as Audit Logger
 
 C->>V: SQL Query
 V->>V: Tokenize & Parse
 V->>V: Keyword Validation
 V->>P: Pattern Analysis
 P->>P: Injection Detection
 P->>P: Function Scanning
 P->>A: Complexity Analysis
 A->>A: Score Calculation
 A->>A: Limit Checking
 A->>L: Log Security Event
 
 alt Query Allowed
 A->>E: Execute Query
 E->>L: Log Successful Execution
 else Query Blocked
 A->>C: Security Violation Error
 A->>L: Log Security Violation
 end
```

### Validation Stages

1. **Input Sanitization**
 - Remove SQL comments (`--`, `/* */`, `#`)
 - Normalize whitespace and casing
 - Basic format validation

2. **Lexical Analysis**
 - Tokenize query into constituent parts
 - Classify tokens (keywords, identifiers, strings, operators)
 - Build query structure representation

3. **Keyword Validation**
 - Check against blocked/allowed keyword lists
 - Database-specific keyword handling
 - Context-sensitive validation

4. **Pattern Detection**
 - SQL injection pattern matching
 - Dangerous function detection
 - Privilege escalation attempts
 - System access attempts

5. **Complexity Analysis**
 - Calculate complexity score
 - Check against configured limits
 - Assess resource usage impact
 - Risk level classification

6. **Deep Validation**
 - Nested query analysis
 - Cross-reference validation
 - Contextual security checks
 - Final approval/rejection

## Audit & Monitoring

### Comprehensive Audit Logging

Every executed query appends one line to `~/.argos/audit/<database>.log`
(directory 0700, file 0600; `src/utils/audit-logger.ts`). The line carries no SQL text,
only a hash of the normalised query:

```text
<ISO 8601 timestamp>  <database>  <first 8 hex chars of SHA-256(query)>  <duration>ms  <outcome>
```

### Security Event Categories

#### Information Events
- Query executions (allowed)
- Schema access
- Connection establishments
- Configuration updates

#### Warning Events
- Query blocks (security violations)
- Complexity limit violations
- Unusual usage patterns
- Failed connection attempts

#### Critical Events
- Suspected injection attempts
- Privilege escalation attempts
- System function access attempts
- Multiple rapid failures

### Real-Time Monitoring

```typescript
// Every query is validated before it reaches the database. A rejection is thrown as a
// SecurityViolationError, which the tool layer logs and returns to the client.
const validation = dbConfig.select_only
 ? securityManager.validateSelectOnlyQuery(query, dbConfig.type)
 : securityManager.validateAnyQuery(query, dbConfig.type);
if (!validation.allowed) {
 throw new SecurityViolationError(`Query blocked: ${validation.reason}`, { database, reason: validation.reason });
}
```

## Security Configuration

### Production Security Baseline
```ini
[security]
# Query complexity limits
max_joins=5 # Reduced for production
max_subqueries=3 # Conservative nesting
max_unions=2 # Limited union operations
max_group_bys=3 # Controlled aggregation
max_complexity_score=50 # Strict complexity limit
max_query_length=5000 # Shorter queries only

# Database access controls
[database.production]
select_only=true # READ-ONLY ACCESS
ssl=true # Encrypted connections
timeout=15000 # Quick timeouts
```

### Development Security Configuration
```ini
[security]
# Relaxed limits for development
max_joins=10
max_subqueries=5
max_unions=3
max_group_bys=5
max_complexity_score=100
max_query_length=10000

[database.development]
select_only=false # Full access for testing
ssl=false # Optional for local dev
timeout=30000 # Longer timeouts
debug=true # Enable debug logging
```

## Security Best Practices

### Deployment Security

1. **Network Security**
 ```ini
 # Use SSH tunnels for remote databases
 ssh_host=bastion.company.com
 ssh_private_key=/secure/path/to/key
 
 # Enable SSL/TLS for database connections
 ssl=true
 ```

2. **Database User Configuration**
 ```sql
 -- Create dedicated read-only user
 CREATE USER 'claude_mcp'@'%' IDENTIFIED BY 'strong_random_password';
 
 -- Grant minimal required permissions
 GRANT SELECT ON app_database.* TO 'claude_mcp'@'%';
 GRANT SHOW VIEW ON app_database.* TO 'claude_mcp'@'%';
 
 -- No administrative privileges
 REVOKE ALL PRIVILEGES ON mysql.* FROM 'claude_mcp'@'%';
 ```

3. **Configuration Hardening**
 ```ini
 # Strict production settings
 [extension]
 max_rows=500 # Limit result sets
 query_timeout=10000 # Quick timeouts
 max_batch_size=5 # Small batches only
 debug=false # No debug info
 ```

### Operational Security

1. **Log Management**
 - Centralized security log collection
 - Real-time alerting on security violations
 - Regular security log analysis
 - Long-term audit trail retention

2. **Access Control**
 - Regular credential rotation
 - Principle of least privilege
 - Network access restrictions
 - Multi-factor authentication where possible

3. **Monitoring & Alerting**
 - Unusual query pattern detection
 - Failed connection monitoring
 - Resource usage anomaly detection
 - Security threshold breach alerts

## Encryption & Data Protection

### Data in Transit
- **MCP Protocol**: JSON-RPC over stdio (process isolation)
- **Database Connections**: SSL/TLS encryption required for production
- **SSH Tunnels**: End-to-end encryption for remote database access

### Transport Model & Client Authentication

This server uses the MCP **stdio transport only** (`StdioServerTransport`): it is spawned as a
child process by the MCP client and communicates over stdin/stdout. There is no network
listener, so there is no remote attack surface to authenticate and MCP client authentication
(OAuth) is intentionally **not** implemented — the trust boundary is OS process ownership.

**Important:** exposing this server over an HTTP/SSE transport is **out of scope and unsupported**.
Doing so would make several controls that currently assume a local, single-user context
(plaintext credentials in `config.ini`, host-local logging, fail-open-on-opt-out defaults)
remotely reachable. If an HTTP transport is ever added, MCP client authentication and
authorization become a hard prerequisite, not an option.

### Data at Rest
- **Configuration Files**: Secure file permissions (600)
- **Log Files**: Encrypted storage recommended
- **SSH Keys**: Secure key storage and permissions
- **Database**: Database-level encryption (TDE) recommended

### Sensitive Data Handling
```typescript
// Automatic sensitive data redaction (src/utils/error-handler.ts)
// sanitizeMessage() redacts passwords, tokens, keys, secrets, card and SSN-shaped
// numbers, and truncates to 500 characters. sanitizeError() applies it to any thrown value.
const safe = sanitizeError(error);
```

## Security Validation Testing

### Automated Security Tests
```typescript
describe('Security Validation', () => {
 it('should block SQL injection attempts', () => {
 const maliciousQueries = [
 "SELECT * FROM users WHERE id = 1; DROP TABLE users;",
 "SELECT * FROM users WHERE name = '' OR '1'='1'",
 "SELECT * FROM users UNION SELECT password FROM admin"
 ];
 
 maliciousQueries.forEach(query => {
 const result = securityManager.validateSelectOnlyQuery(query);
 expect(result.allowed).toBe(false);
 });
 });
 
 it('should enforce complexity limits', () => {
 const complexQuery = buildComplexQuery({ joins: 20 }); // Exceeds limit
 const result = securityManager.validateSelectOnlyQuery(complexQuery);
 expect(result.allowed).toBe(false);
 expect(result.reason).toContain('complexity');
 });
});
```

This security architecture provides comprehensive protection while maintaining usability for legitimate database operations. The multi-layered approach ensures that even if one security mechanism is bypassed, additional layers provide continued protection.
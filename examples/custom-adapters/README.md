# Custom Database Adapters

This directory contains examples and templates for creating custom database adapters for Argos. Learn how to extend support to new database types or customize existing adapters.

## Directory Structure

```
custom-adapters/
|-- README.md # This file
|-- adapter-template.ts # Base template for new adapters
|-- oracle-adapter/ # Oracle Database adapter example
| |-- oracle-adapter.ts # Oracle adapter implementation
| |-- README.md # Oracle-specific documentation
| |-- package.json # Oracle dependencies
| \-- test-oracle-adapter.js # Testing script
|-- redis-adapter/ # Redis adapter example
| |-- redis-adapter.ts # Redis adapter (NoSQL example)
| |-- README.md # Redis-specific documentation
| \-- package.json # Redis dependencies
|-- csv-adapter/ # CSV file adapter example
| |-- csv-adapter.ts # CSV file adapter
| |-- README.md # CSV adapter documentation
| \-- sample-data.csv # Sample CSV file
|-- snowflake-adapter/ # Snowflake Data Warehouse adapter
| |-- snowflake-adapter.ts # Snowflake adapter
| |-- README.md # Snowflake documentation
| \-- package.json # Snowflake dependencies
|-- integration-guide.md # How to integrate custom adapters
|-- testing-framework.md # Testing custom adapters
|-- best-practices.md # Adapter development best practices
\-- troubleshooting.md # Common issues and solutions
```

## What are Custom Adapters?

Custom adapters extend Argos to support:

1. **New Database Types**: Oracle, Cassandra, MongoDB, etc.
2. **Cloud Data Services**: Snowflake, BigQuery, Redshift, etc.
3. **File-Based Sources**: CSV, JSON, Parquet files
4. **NoSQL Databases**: Redis, MongoDB, DynamoDB
5. **Specialized Systems**: Time-series databases, graph databases
6. **Legacy Systems**: Mainframe databases, proprietary formats

## Quick Start

### 1. Using the Template
```bash
# Copy the template
cp examples/custom-adapters/adapter-template.ts src/database/adapters/my-database.ts

# Edit the adapter for your database type
# Update the imports, connection logic, and queries
```

### 2. Register Your Adapter
```typescript
// In src/database/adapters/index.ts
import { MyDatabaseAdapter } from './my-database.js';

export function createAdapter(config: DatabaseConfig): DatabaseAdapter {
 switch (config.type.toLowerCase()) {
 case 'mydatabase':
 return new MyDatabaseAdapter(config);
 // ... other cases
 }
}
```

### 3. Add Configuration Support
```typescript
// Update src/types/database.ts
export type DatabaseTypeString = 
 'mysql' | 'postgresql' | 'sqlite' | 'mssql' | 'mydatabase';
```

### 4. Test Your Adapter
```bash
# Create test configuration
echo '[database.test]
type=mydatabase
host=localhost
port=1234
database=testdb' > test-config.ini

# Test the connection
npm test
```

## Adapter Examples

### 1. Oracle Database Adapter
Full-featured adapter for Oracle Database with support for:
- Advanced SQL features (PL/SQL, packages, procedures)
- Multiple connection modes (dedicated, shared, pooled)
- Oracle-specific data types and functions
- Performance optimization features

### 2. Redis Adapter
NoSQL adapter that translates SQL-like operations to Redis commands:
- Key-value operations mapped to SQL SELECT
- Hash operations for structured data
- Set operations for unique collections
- Sorted set operations for ordered data

### 3. CSV File Adapter
File-based adapter for querying CSV files:
- In-memory CSV parsing and querying
- Type inference and schema detection
- Support for joins across multiple files
- Export query results back to CSV

### 4. Snowflake Adapter
Cloud data warehouse adapter with features:
- Snowflake-specific SQL dialect support
- Virtual warehouse management
- Role-based access control
- Optimized query execution

## Development Workflow

### 1. Planning Your Adapter

**Identify Requirements:**
- What database/system are you connecting to?
- What authentication methods are supported?
- What query capabilities do you need?
- Are there any special features or limitations?

**Design Considerations:**
- Connection management strategy
- Error handling patterns
- Performance optimization needs
- Security requirements

### 2. Implementation Steps

1. **Extend DatabaseAdapter**: Start with the base class
2. **Implement Required Methods**: Connect, query, disconnect, etc.
3. **Add Type Definitions**: Update TypeScript types
4. **Handle Errors**: Implement proper error handling
5. **Add Tests**: Create comprehensive test suite
6. **Document**: Write usage documentation

### 3. Testing and Validation

**Unit Tests:**
```typescript
describe('MyDatabaseAdapter', () => {
 it('should connect successfully', async () => {
 const adapter = new MyDatabaseAdapter(config);
 const connection = await adapter.connect();
 expect(connection).toBeDefined();
 });
});
```

**Integration Tests:**
```typescript
it('should execute queries correctly', async () => {
 const result = await adapter.executeQuery(connection, 'SELECT 1');
 expect(result.rows).toHaveLength(1);
});
```

**Performance Tests:**
```typescript
it('should handle large result sets', async () => {
 const result = await adapter.executeQuery(connection, largeQuery);
 expect(result.execution_time_ms).toBeLessThan(5000);
});
```

## Architecture Guidelines

### Connection Management
```typescript
class MyDatabaseAdapter extends DatabaseAdapter {
 private connectionPool: Pool;

 async connect(): Promise<DatabaseConnection> {
 // Implement connection logic
 // Consider connection pooling for performance
 // Handle authentication and SSL
 }

 async disconnect(connection: DatabaseConnection): Promise<void> {
 // Clean up resources
 // Close connections properly
 // Handle connection pool cleanup
 }
}
```

### Query Translation
```typescript
async executeQuery(
 connection: DatabaseConnection,
 query: string,
 params?: unknown[]
): Promise<QueryResult> {
 // Translate standard SQL to database-specific dialect
 const translatedQuery = this.translateQuery(query);
 
 // Execute with proper error handling
 try {
 const result = await connection.query(translatedQuery, params);
 return this.normalizeResult(result);
 } catch (error) {
 throw this.createError('Query execution failed', error);
 }
}
```

### Schema Capture
```typescript
async captureSchema(connection: DatabaseConnection): Promise<DatabaseSchema> {
 const schema = this.createBaseSchema(this.config.database!);
 
 // Implement database-specific schema queries
 const tables = await this.getTables(connection);
 const views = await this.getViews(connection);
 
 // Process and normalize schema information
 for (const table of tables) {
 schema.tables[table.name] = await this.getTableDetails(connection, table.name);
 }
 
 return schema;
}
```

## Configuration Examples

### Simple Configuration
```ini
[database.mydatabase]
type=mydatabase
host=localhost
port=1234
database=mydb
username=user
password=pass
```

### Advanced Configuration
```ini
[database.oracle]
type=oracle
host=oracle.company.com
port=1521
database=PROD
username=readonly_user
password=secure_password
connection_mode=dedicated
pool_size=5
ssl=true
ssl_cert_path=/path/to/cert.pem
select_only=true
timeout=45000

# Oracle-specific settings
oracle_wallet_path=/path/to/wallet
oracle_service_name=PROD.company.com
```

## Best Practices

### 1. Error Handling
- Use the base adapter's error creation methods
- Provide meaningful error messages
- Include relevant context in errors
- Handle connection timeouts gracefully

### 2. Performance
- Implement connection pooling where appropriate
- Use prepared statements for parameterized queries
- Implement query result streaming for large datasets
- Add query timeout handling

### 3. Security
- Never log sensitive connection details
- Use the base adapter's config sanitization
- Implement proper input validation
- Support SSL/TLS connections where available

### 4. Compatibility
- Follow the standard DatabaseAdapter interface
- Normalize result formats consistently
- Handle type conversions properly
- Support standard SQL where possible

## Integration Process

### 1. Add Dependencies
```json
{
 "dependencies": {
 "my-database-driver": "^2.0.0"
 }
}
```

### 2. Update Type Definitions
```typescript
// src/types/database.ts
export type DatabaseTypeString = 
 'mysql' | 'postgresql' | 'sqlite' | 'mssql' | 'mydatabase';

// Add any custom configuration options
export interface DatabaseConfig {
 // ... existing properties
 my_database_option?: string;
}
```

### 3. Register Adapter
```typescript
// src/database/adapters/index.ts
import { MyDatabaseAdapter } from './my-database.js';

export function createAdapter(config: DatabaseConfig): DatabaseAdapter {
 switch (config.type.toLowerCase()) {
 case 'mydatabase':
 return new MyDatabaseAdapter(config);
 default:
 throw new Error(`Unsupported database type: ${config.type}`);
 }
}
```

### 4. Add Tests
```bash
# Create test file
cp tests/unit/postgresql-adapter.test.ts tests/unit/mydatabase-adapter.test.ts

# Update test configuration
# Run tests
npm test
```

## Common Patterns

### Connection Pooling
```typescript
class MyDatabaseAdapter extends DatabaseAdapter {
 private pool: ConnectionPool;

 constructor(config: DatabaseConfig) {
 super(config);
 this.pool = new ConnectionPool({
 host: config.host,
 max: 10,
 min: 1,
 idleTimeoutMillis: 30000
 });
 }
}
```

### Query Result Transformation
```typescript
protected normalizeQueryResult(rawResult: MyDatabaseResult): QueryResult {
 return {
 rows: rawResult.data.map(row => this.transformRow(row)),
 rowCount: rawResult.data.length,
 fields: rawResult.columns.map(col => col.name),
 truncated: false,
 execution_time_ms: rawResult.executionTime
 };
}
```

### Schema Information
```typescript
async captureSchema(connection: DatabaseConnection): Promise<DatabaseSchema> {
 const schema = this.createBaseSchema(this.config.database!);
 
 // Get table information
 const tablesQuery = "SHOW TABLES"; // Adjust for your database
 const tablesResult = await this.executeQuery(connection, tablesQuery);
 
 for (const tableRow of tablesResult.rows) {
 const tableName = tableRow.table_name;
 const columns = await this.getColumnInfo(connection, tableName);
 
 schema.tables[tableName] = {
 name: tableName,
 type: 'BASE TABLE',
 columns: columns
 };
 }
 
 return schema;
}
```

## Support and Resources

### Getting Help
- Review existing adapter implementations
- Check the base adapter documentation
- Test with simple queries first
- Use debug logging during development

### Contributing
- Follow the project coding standards
- Add comprehensive tests
- Document any special configuration requirements
- Submit adapters as pull requests for inclusion

### Documentation
- **Base Adapter**: [src/database/adapters/base.ts](../../src/database/adapters/base.ts)
- **Type Definitions**: [src/types/database.ts](../../src/types/database.ts)
- **Architecture Guide**: [../../docs/architecture/database-layer.md](../../docs/architecture/database-layer.md)
- **Testing Guide**: [../../docs/development/testing-guide.md](../../docs/development/testing-guide.md)

## Maintenance

### Version Compatibility
- Test adapters with new Argos versions
- Update dependencies regularly
- Monitor for breaking changes in database drivers
- Keep documentation current

### Performance Monitoring
- Monitor connection pool usage
- Track query execution times
- Watch for memory leaks
- Optimize based on usage patterns

Remember: Custom adapters extend the power of Argos to work with virtually any data source. Start simple, test thoroughly, and iterate based on real usage needs.
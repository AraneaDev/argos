/**
 * Database Adapter Template
 * 
 * Use this template to create custom database adapters for Argos.
 * Replace all instances of "Template" with your database name.
 * 
 * Example: TemplateAdapter -> OracleAdapter, RedisAdapter, etc.
 */

import { DatabaseAdapter } from '../../src/database/adapters/base.js';
import type { 
 DatabaseConnection, 
 QueryResult, 
 DatabaseSchema,
 ColumnInfo,
 TableInfo,
 DatabaseConfig
} from '../../src/types/index.js';

// Import your database driver here
// Example: import * as driverName from 'database-driver';

// ============================================================================
// Template Database Adapter Implementation
// ============================================================================

export class TemplateAdapter extends DatabaseAdapter {
 
 // ============================================================================
 // Constructor and Initialization
 // ============================================================================

 constructor(config: DatabaseConfig) {
 super(config);
 
 // Add any adapter-specific initialization here
 // Example: connection pool setup, driver configuration, etc.
 }

 // ============================================================================
 // Required Abstract Method Implementations
 // ============================================================================

 /**
 * Create a connection to the database
 */
 async connect(): Promise<DatabaseConnection> {
 // Validate required configuration fields
 this.validateConfig(['host', 'database', 'username', 'password']);

 // Build connection configuration. Declare every key the object may carry:
 // assigning a new one afterwards does not widen an inferred object type.
 const connectionConfig: {
 host: string;
 port: number;
 database: string;
 username: string;
 password: string;
 timeout: number;
 ssl?: boolean;
 } = {
 host: this.config.host!,
 port: this.parseConfigValue<number>(this.config.port, 'number', 1234), // Default port
 database: this.config.database!,
 username: this.config.username!,
 password: this.config.password!,
 timeout: this.connectionTimeout
 };

 // Add SSL configuration if needed
 if (this.config.ssl) {
 connectionConfig.ssl = this.parseConfigValue(this.config.ssl, 'boolean', false);
 }

 try {
 // Replace with your database driver's connection logic
 // const client = new DatabaseDriver(connectionConfig);
 // await client.connect();
 // return client as DatabaseConnection;

 throw new Error('Template adapter: Implement connection logic here');
 } catch (error) {
 throw this.createError('Failed to connect to Template database', error as Error);
 }
 }

 /**
 * Execute a query against the database
 */
 async executeQuery(
 connection: DatabaseConnection,
 query: string,
 params: unknown[] = []
 ): Promise<QueryResult> {
 const startTime = Date.now();
 
 try {
 // Replace with your database driver's query execution logic
 // const result = await connection.query(query, params);
 // return this.normalizeQueryResult(result, startTime);

 throw new Error('Template adapter: Implement query execution here');
 } catch (error) {
 throw this.createError('Failed to execute Template query', error as Error);
 }
 }

 /**
 * Disconnect from the database
 */
 async disconnect(connection: DatabaseConnection): Promise<void> {
 try {
 // Replace with your database driver's disconnection logic
 // await connection.close();
 // await connection.end();
 // connection.destroy();

 throw new Error('Template adapter: Implement disconnection logic here');
 } catch (error) {
 throw this.createError('Failed to disconnect from Template database', error as Error);
 }
 }

 /**
 * Test if the connection is still alive
 */
 isConnected(connection: DatabaseConnection): boolean {
 try {
 // Replace with your database driver's connection status check
 // return connection.isConnected();
 // return connection.readyState === 1;
 // return !connection.destroyed;

 return false; // Template: Always returns false
 } catch {
 return false;
 }
 }

 /**
 * Capture schema information from the database
 */
 async captureSchema(connection: DatabaseConnection): Promise<DatabaseSchema> {
 try {
 const schema = this.createBaseSchema(this.config.database!);
 
 // Get all tables - replace with your database's schema query
 const tablesQuery = `
 SELECT table_name, table_type 
 FROM information_schema.tables 
 WHERE table_schema = ?
 `;
 
 // Execute the query - update based on your implementation
 // const tablesResult = await this.executeQuery(connection, tablesQuery, [this.config.database]);
 
 // Process each table - example implementation
 // for (const table of tablesResult.rows) {
 // const columns = await this.captureTableColumns(connection, table.table_name);
 // 
 // const tableInfo: TableInfo = {
 // name: table.table_name,
 // type: table.table_type,
 // comment: '',
 // columns
 // };
 //
 // if (table.table_type === 'BASE TABLE') {
 // schema.tables[table.table_name] = tableInfo;
 // } else {
 // schema.views[table.table_name] = tableInfo;
 // }
 // }

 this.updateSchemaSummary(schema);
 return schema;
 
 } catch (error) {
 throw this.createError('Failed to capture Template schema', error as Error);
 }
 }

 // ============================================================================
 // Transaction Management
 // ============================================================================

 /**
 * Begin a transaction
 */
 async beginTransaction(connection: DatabaseConnection): Promise<void> {
 try {
 // Replace with your database's transaction begin logic
 // await connection.query('BEGIN');
 // await connection.beginTransaction();
 
 throw new Error('Template adapter: Implement transaction begin logic here');
 } catch (error) {
 throw this.createError('Failed to begin Template transaction', error as Error);
 }
 }

 /**
 * Commit a transaction
 */
 async commitTransaction(connection: DatabaseConnection): Promise<void> {
 try {
 // Replace with your database's transaction commit logic
 // await connection.query('COMMIT');
 // await connection.commit();
 
 throw new Error('Template adapter: Implement transaction commit logic here');
 } catch (error) {
 throw this.createError('Failed to commit Template transaction', error as Error);
 }
 }

 /**
 * Rollback a transaction
 */
 async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
 try {
 // Replace with your database's transaction rollback logic
 // await connection.query('ROLLBACK');
 // await connection.rollback();
 
 throw new Error('Template adapter: Implement transaction rollback logic here');
 } catch (error) {
 throw this.createError('Failed to rollback Template transaction', error as Error);
 }
 }

 // ============================================================================
 // Performance Analysis
 // ============================================================================

 /**
 * Build an EXPLAIN query for performance analysis
 */
 buildExplainQuery(query: string): string {
 // Replace with your database's EXPLAIN syntax
 // Examples:
 // PostgreSQL: `EXPLAIN (ANALYZE, BUFFERS) ${query}`
 // MySQL: `EXPLAIN FORMAT=JSON ${query}`
 // Oracle: `EXPLAIN PLAN FOR ${query}`
 
 return `EXPLAIN ${query}`; // Generic example
 }

 // ============================================================================
 // Result Processing (Required Abstract Method Implementations)
 // ============================================================================

 /**
 * Extract raw rows from database-specific result
 */
 protected extractRawRows(result: unknown): unknown[] {
 // Replace with your database driver's result structure
 // Examples:
 // PostgreSQL: (result as pg.QueryResult).rows
 // MySQL: (result as mysql.QueryResult)[0] as unknown[]
 // Custom: (result as CustomResult).data
 
 const customResult = result as any; // Replace with proper typing
 return Array.isArray(customResult.rows) ? customResult.rows : [];
 }

 /**
 * Extract field names from query results
 */
 protected extractFieldNames(result: unknown): string[] {
 // Replace with your database driver's field extraction logic
 // Examples:
 // PostgreSQL: (result as pg.QueryResult).fields?.map(field => field.name) || []
 // MySQL: (result as mysql.QueryResult).fields?.map(field => field.name) || []
 
 const customResult = result as any; // Replace with proper typing
 return customResult.fields?.map((field: any) => field.name) || [];
 }

 // ============================================================================
 // Helper Methods (Optional - Add as needed)
 // ============================================================================

 /**
 * Capture column information for a specific table
 */
 private async captureTableColumns(
 connection: DatabaseConnection,
 tableName: string
 ): Promise<ColumnInfo[]> {
 // Replace with your database's column information query
 const columnsQuery = `
 SELECT 
 column_name,
 data_type,
 is_nullable,
 column_default
 FROM information_schema.columns 
 WHERE table_name = ? AND table_schema = ?
 ORDER BY ordinal_position
 `;

 try {
 // const columnsResult = await this.executeQuery(connection, columnsQuery, [tableName, this.config.database]);
 
 // return columnsResult.rows.map((col: any): ColumnInfo => ({
 // name: col.column_name,
 // type: col.data_type,
 // nullable: col.is_nullable === 'YES',
 // default: col.column_default,
 // comment: '', // Add if your database supports column comments
 // key: '', // Add if your database has key information
 // extra: '' // Add if your database has extra column info
 // }));

 return []; // Template: Return empty array
 } catch (error) {
 throw this.createError(`Failed to capture columns for table ${tableName}`, error as Error);
 }
 }

 /**
 * Database-specific utility methods (Optional)
 */
 
 /**
 * Get database version information
 */
 async getVersion(connection: DatabaseConnection): Promise<string> {
 try {
 // Replace with your database's version query
 // const result = await this.executeQuery(connection, 'SELECT version()');
 // return result.rows[0]?.version || 'Unknown';

 return 'Template Database v1.0'; // Template example
 } catch (error) {
 throw this.createError('Failed to get Template database version', error as Error);
 }
 }

 /**
 * Get current database size
 */
 async getDatabaseSize(connection: DatabaseConnection): Promise<string> {
 try {
 // Replace with your database's size query
 // PostgreSQL: SELECT pg_size_pretty(pg_database_size(?))
 // MySQL: SELECT SUM(data_length + index_length) FROM information_schema.tables WHERE table_schema = ?
 
 return 'Unknown'; // Template example
 } catch (error) {
 throw this.createError('Failed to get Template database size', error as Error);
 }
 }

 // ============================================================================
 // Configuration Validation (Optional)
 // ============================================================================

 /**
 * Validate template-specific configuration
 */
 protected validateTemplateConfig(): void {
 // Add any database-specific validation here
 // Example:
 // if (this.config.custom_option && !this.isValidCustomOption(this.config.custom_option)) {
 // throw new Error('Invalid custom_option value');
 // }
 }

 // ============================================================================
 // Error Handling (Optional)
 // ============================================================================

 /**
 * Create database-specific error with additional context
 */
 protected createTemplateError(message: string, originalError?: Error, context?: Record<string, unknown>): Error {
 const errorMessage = `Template Database: ${message}`;
 const error = this.createError(errorMessage, originalError);
 
 if (context) {
 (error as any).context = context;
 }
 
 return error;
 }
}

// ============================================================================
// Usage Instructions
// ============================================================================

/*
TO USE THIS TEMPLATE:

1. COPY AND RENAME:
 cp adapter-template.ts my-database-adapter.ts

2. FIND AND REPLACE:
 - Replace "Template" with your database name (e.g., "Oracle", "Redis")
 - Replace "template" with lowercase version (e.g., "oracle", "redis")

3. UPDATE IMPORTS:
 - Add your database driver import at the top
 - Update type imports if needed

4. IMPLEMENT METHODS:
 - connect(): Database connection logic
 - executeQuery(): Query execution logic
 - disconnect(): Connection cleanup logic
 - captureSchema(): Schema information retrieval
 - extractRawRows(): Result row extraction
 - extractFieldNames(): Field name extraction

5. ADD CONFIGURATION:
 - Update validateConfig() calls with required fields
 - Add database-specific configuration options
 - Update default ports and connection parameters

6. TEST YOUR ADAPTER:
 - Create unit tests based on existing adapter tests
 - Test with real database connections
 - Verify error handling and edge cases

7. INTEGRATE:
 - Add to src/database/adapters/index.ts
 - Update type definitions in src/types/database.ts
 - Add configuration examples

8. DOCUMENT:
 - Create README.md for your adapter
 - Document configuration options
 - Provide usage examples

OPTIONAL ENHANCEMENTS:
- Connection pooling
- Custom error types
- Performance optimizations
- Advanced schema capture
- Database-specific features
- SSL/TLS support
- Custom authentication methods

REMEMBER TO:
- Handle errors gracefully
- Follow TypeScript best practices 
- Use the base adapter's helper methods
- Test thoroughly with different scenarios
- Document configuration requirements
- Consider security implications
*/
# Code Standards Guide

This document outlines the coding standards, style guidelines, and best practices for the Argos project.

## Overview

The Argos follows strict coding standards to ensure consistency, maintainability, and reliability across the codebase. These standards cover TypeScript code style, architecture patterns, documentation requirements, and development workflows.

**Key Principles:**
- **Type Safety First** - Leverage TypeScript's type system fully
- **Explicit over Implicit** - Clear, readable code over clever shortcuts
- **Security by Design** - Security considerations in every component
- **Performance Aware** - Efficient code that scales well
- **Testable Architecture** - Code designed for comprehensive testing

## Language and Platform Standards

### TypeScript Configuration

The project uses TypeScript 5.0+ with strict settings:

```json
{
 "compilerOptions": {
 "target": "ES2022",
 "module": "ESNext",
 "moduleResolution": "node",
 "strict": true,
 "exactOptionalPropertyTypes": false,
 "noFallthroughCasesInSwitch": true,
 "noImplicitOverride": true,
 "noImplicitReturns": true,
 "noUnusedLocals": false,
 "noUnusedParameters": false
 }
}
```

### Node.js Compatibility

- **Minimum Version**: Node.js 22.0.0+
- **Module System**: ESM (ES Modules) only
- **Target**: ES2022 for modern JavaScript features

## Code Style Guidelines

### ESLint Configuration

The project uses ESLint with TypeScript support:

```json
{
 "parser": "@typescript-eslint/parser",
 "plugins": ["@typescript-eslint"],
 "extends": ["eslint:recommended"],
 "rules": {
 "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
 "prefer-const": "error",
 "no-console": ["warn", { "allow": ["error"] }],
 "no-useless-escape": "warn"
 }
}
```

### Naming Conventions

#### Classes and Interfaces

```typescript
// Classes: PascalCase
class SecurityManager { }
class SQLMCPServer { }
class ConnectionManager { }

// Interfaces: PascalCase with 'I' prefix for generic interfaces
interface ISecurityManager { }
interface IConnectionManager { }

// Type aliases: PascalCase
type DatabaseConfig = { };
type SecurityValidation = { };
```

#### Variables and Functions

```typescript
// Variables: camelCase
const connectionTimeout = 30000;
const maxRetryAttempts = 3;
let currentConnection: DatabaseConnection;

// Functions: camelCase
function validateQuery(query: string): SecurityValidation { }
async function executeQuery(connection: DatabaseConnection, query: string): Promise<QueryResult> { }

// Constants: SCREAMING_SNAKE_CASE for module-level constants
const MAX_QUERY_LENGTH = 10000;
const DEFAULT_TIMEOUT = 30000;
const BLOCKED_KEYWORDS = ['DROP', 'DELETE', 'UPDATE'];
```

#### Files and Directories

```
// Files: kebab-case for non-class files, PascalCase for classes
security-manager.ts // Incorrect
SecurityManager.ts // Correct (class file)
response-formatter.ts // Correct (utility file)
error-handler.ts // Correct (utility file)

// Directories: lowercase with hyphens
src/
|-- classes/ // Correct
|-- database/
| |-- adapters/ // Correct
| \-- types/ // Correct
\-- utils/ // Correct
```

### Code Formatting

#### Indentation and Spacing

```typescript
// Use 2 spaces for indentation
class ExampleClass {
 private readonly config: Config;
 
 constructor(config: Config) {
 this.config = config;
 }
 
 public async performOperation(): Promise<Result> {
 if (this.config.enabled) {
 return await this.processRequest();
 }
 
 throw new Error('Operation not enabled');
 }
}
```

#### Line Length

- **Maximum line length**: 100 characters
- **Break long lines** at logical points
- **Align parameters** for readability

```typescript
// Good: Logical line breaks
const result = await connectionManager.createConnection(
 databaseName,
 connectionConfig,
 { timeout: 30000, retries: 3 }
);

// Avoid: Too long
const result = await connectionManager.createConnection(databaseName, connectionConfig, { timeout: 30000, retries: 3 });
```

#### Import Statements

```typescript
// Group imports logically
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

import type { 
 DatabaseConfig, 
 SecurityValidation, 
 QueryResult 
} from '../types/index.js';

import { SecurityManager } from './SecurityManager.js';
import { ConnectionManager } from './ConnectionManager.js';

import { getLogger } from '../utils/logger.js';
import { createError } from '../utils/error-handler.js';
```

### String and Template Usage

```typescript
// Use template literals for interpolation
const message = `Connection to ${dbName} failed after ${retries} attempts`;

// Use single quotes for simple strings
const simpleString = 'This is a simple string';

// Use double quotes when string contains single quotes
const stringWithQuotes = "This string contains 'quoted text'";

// Multiline strings with proper indentation
const query = `
 SELECT u.name, p.title, COUNT(c.id) as comment_count
 FROM users u
 JOIN posts p ON u.id = p.user_id
 LEFT JOIN comments c ON p.id = c.post_id
 GROUP BY u.id, u.name, p.id, p.title
 ORDER BY comment_count DESC
`;
```

## Type System Guidelines

### Type Definitions

#### Prefer Explicit Types

```typescript
// Explicit return types for public methods
public async validateQuery(query: string): Promise<SecurityValidation> {
 // Implementation
}

// Explicit parameter types
function processResult(
 result: QueryResult,
 options: ProcessingOptions
): ProcessedResult {
 // Implementation
}
```

#### Use Type Unions Appropriately

```typescript
// Good: Clear type union for status
type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

// Good: Optional vs undefined distinction
interface DatabaseConfig {
 host: string;
 port?: number; // Optional with default
 timeout: number | null; // Explicitly nullable
}
```

#### Generic Type Usage

```typescript
// Good: Bounded generics with constraints
interface DatabaseAdapter<T extends DatabaseConnection> {
 connect(): Promise<T>;
 executeQuery(connection: T, query: string): Promise<QueryResult>;
 disconnect(connection: T): Promise<void>;
}

// Good: Utility types for transformation
type PartialConfig<T> = {
 [K in keyof T]?: T[K];
};

type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;
```

### Type Safety Patterns

#### Null Safety

```typescript
// Handle null/undefined explicitly
function processConnection(connection: DatabaseConnection | null): void {
 if (!connection) {
 throw new Error('Connection is required');
 }
 
 // TypeScript now knows connection is not null
 connection.query('SELECT 1');
}

// Use optional chaining
const port = config.database?.port ?? 5432;
const ssl = config.database?.ssl?.enabled ?? false;
```

#### Type Guards

```typescript
// Custom type guards for runtime validation
function isValidDatabaseConfig(config: unknown): config is DatabaseConfig {
 return (
 typeof config === 'object' &&
 config !== null &&
 typeof (config as DatabaseConfig).host === 'string' &&
 typeof (config as DatabaseConfig).database === 'string'
 );
}

// Usage
if (isValidDatabaseConfig(userInput)) {
 // TypeScript knows userInput is DatabaseConfig
 await connectToDatabase(userInput);
}
```

#### Assertion Functions

```typescript
// Assertion functions for validation
function assertValidQuery(query: string): asserts query is string {
 if (!query || typeof query !== 'string' || query.trim().length === 0) {
 throw new Error('Query must be a non-empty string');
 }
}

// Usage
assertValidQuery(userQuery);
// TypeScript knows userQuery is a valid string
const result = await executeQuery(userQuery);
```

## Architecture Patterns

### Class Design

#### Constructor Patterns

```typescript
// Good: Clear constructor with validation
class SecurityManager extends EventEmitter implements ISecurityManager {
 private readonly complexityLimits: ComplexityLimits;
 private readonly logger = getLogger();
 private selectOnlyMode: boolean = true;

 constructor(config: SecurityManagerConfig = {}, selectOnlyMode: boolean = true) {
 super(); // Call EventEmitter constructor
 
 this.selectOnlyMode = selectOnlyMode;
 this.complexityLimits = this.initializeComplexityLimits(config.security);
 
 this.logger.info('Security manager initialized', {
 limits: this.complexityLimits,
 selectOnlyMode: this.selectOnlyMode
 });
 }

 private initializeComplexityLimits(config?: SecurityConfig): ComplexityLimits {
 return {
 maxJoins: this.parseConfigValue(config?.max_joins, 10),
 maxSubqueries: this.parseConfigValue(config?.max_subqueries, 5),
 maxUnions: this.parseConfigValue(config?.max_unions, 3),
 maxGroupBys: this.parseConfigValue(config?.max_group_bys, 5),
 maxComplexityScore: this.parseConfigValue(config?.max_complexity_score, 100),
 maxQueryLength: this.parseConfigValue(config?.max_query_length, 10000)
 };
 }
}
```

#### Method Organization

```typescript
class DatabaseAdapter {
 // ============================================================================
 // Public Interface Methods
 // ============================================================================

 public async connect(): Promise<DatabaseConnection> {
 // Implementation
 }

 public async executeQuery(connection: DatabaseConnection, query: string): Promise<QueryResult> {
 // Implementation
 }

 // ============================================================================
 // Protected Helper Methods (for inheritance)
 // ============================================================================

 protected validateConfig(requiredFields: string[]): void {
 // Implementation
 }

 protected normalizeQueryResult(result: unknown, startTime: number): QueryResult {
 // Implementation
 }

 // ============================================================================
 // Private Implementation Methods
 // ============================================================================

 private parseConfigValue(value: string | number | undefined, defaultValue: number): number {
 // Implementation
 }

 private createError(message: string, originalError?: Error): Error {
 // Implementation
 }
}
```

### Error Handling Patterns

#### Custom Error Classes

```typescript
// Structured error hierarchy
export class DatabaseError extends Error {
 public readonly code: string;
 public readonly database?: string;
 public readonly query?: string;
 public readonly originalError?: Error;

 constructor(
 message: string, 
 code: string, 
 context: { database?: string; query?: string; originalError?: Error } = {}
 ) {
 super(message);
 this.name = 'DatabaseError';
 this.code = code;
 this.database = context.database;
 this.query = context.query?.substring(0, 100); // Truncate for logging
 this.originalError = context.originalError;
 }
}

export class SecurityViolationError extends DatabaseError {
 public readonly blockedCommand?: string;
 public readonly complexityScore?: number;

 constructor(
 message: string, 
 context: { 
 database?: string; 
 query?: string; 
 blockedCommand?: string;
 complexityScore?: number;
 } = {}
 ) {
 super(message, 'SECURITY_VIOLATION', context);
 this.name = 'SecurityViolationError';
 this.blockedCommand = context.blockedCommand;
 this.complexityScore = context.complexityScore;
 }
}
```

#### Error Handling Strategy

```typescript
// Consistent error handling pattern
public async executeQuery(
 connection: DatabaseConnection,
 query: string,
 params: unknown[] = []
): Promise<QueryResult> {
 const startTime = Date.now();
 
 try {
 this.logger.debug('Executing query', { 
 database: this.config.database,
 query: query.substring(0, 100)
 });

 const rawResult = await this.performQuery(connection, query, params);
 const result = this.normalizeQueryResult(rawResult, startTime);
 
 this.logger.debug('Query executed successfully', {
 database: this.config.database,
 rowCount: result.rowCount,
 executionTime: result.execution_time_ms
 });

 return result;
 
 } catch (error) {
 const executionTime = Date.now() - startTime;
 
 this.logger.error('Query execution failed', {
 database: this.config.database,
 query: query.substring(0, 100),
 executionTime,
 error: (error as Error).message
 });

 throw new DatabaseError(
 `Failed to execute query: ${(error as Error).message}`,
 'QUERY_EXECUTION_ERROR',
 {
 database: this.config.database,
 query,
 originalError: error as Error
 }
 );
 }
}
```

### Async/Await Patterns

#### Promise Handling

```typescript
// Proper async/await with error handling
public async createConnection(
 databaseName: string,
 config: DatabaseConfig
): Promise<DatabaseConnection> {
 try {
 const adapter = this.getAdapter(config.type);
 const connection = await adapter.connect();
 
 // Store connection for management
 this.connections.set(databaseName, {
 connection,
 adapter,
 lastUsed: Date.now(),
 isActive: true
 });

 this.emit('connection-created', databaseName);
 return connection;
 
 } catch (error) {
 this.emit('connection-failed', databaseName, error);
 throw new ConnectionError(
 `Failed to create connection to ${databaseName}`,
 { database: databaseName, originalError: error as Error }
 );
 }
}

// Concurrent operations with proper error handling
public async validateBatch(queries: BatchQuery[]): Promise<BatchValidationResult[]> {
 const validationPromises = queries.map(async (queryObj, index) => {
 try {
 const validation = await this.validateQuery(queryObj.query);
 return { index, ...validation };
 } catch (error) {
 return {
 index,
 allowed: false,
 reason: `Validation error: ${(error as Error).message}`,
 confidence: 0
 };
 }
 });

 return await Promise.all(validationPromises);
}
```

#### Resource Management

```typescript
// Proper cleanup with try/finally
public async withConnection<T>(
 databaseName: string,
 operation: (connection: DatabaseConnection) => Promise<T>
): Promise<T> {
 const connectionInfo = this.connections.get(databaseName);
 if (!connectionInfo) {
 throw new ConnectionError(`No connection found for database: ${databaseName}`);
 }

 const { connection, adapter } = connectionInfo;
 
 try {
 // Update last used timestamp
 connectionInfo.lastUsed = Date.now();
 
 // Execute operation
 return await operation(connection);
 
 } catch (error) {
 this.logger.error('Operation failed', {
 database: databaseName,
 error: (error as Error).message
 });
 throw error;
 
 } finally {
 // Cleanup or connection health check could go here
 if (!adapter.isConnected(connection)) {
 this.logger.warn('Connection lost during operation', { database: databaseName });
 connectionInfo.isActive = false;
 }
 }
}
```

## Documentation Standards

### JSDoc Comments

#### Class Documentation

```typescript
/**
 * SQL Security Manager with comprehensive validation capabilities.
 * 
 * Provides query validation, complexity analysis, and security enforcement
 * for SQL operations in SELECT-only mode or full access mode.
 * 
 * @example
 * ```typescript
 * const securityManager = new SecurityManager({
 * security: {
 * max_joins: 10,
 * max_subqueries: 5,
 * max_complexity_score: 100
 * }
 * });
 * 
 * const validation = await securityManager.validateQuery('SELECT * FROM users');
 * if (validation.allowed) {
 * // Execute query
 * }
 * ```
 */
export class SecurityManager extends EventEmitter implements ISecurityManager {
```

#### Method Documentation

```typescript
/**
 * Validates a SQL query against security policies and complexity limits.
 * 
 * @param query - The SQL query string to validate
 * @param dbType - Database type for dialect-specific validation (default: 'mysql')
 * @returns Promise resolving to validation result with allow/deny decision
 * 
 * @throws {SecurityViolationError} When query violates security policies
 * @throws {ValidationError} When query format is invalid
 * 
 * @example
 * ```typescript
 * const result = await securityManager.validateQuery(
 * 'SELECT u.name, COUNT(p.id) FROM users u LEFT JOIN posts p ON u.id = p.user_id GROUP BY u.id',
 * 'postgresql'
 * );
 * 
 * console.log(result.allowed); // true/false
 * console.log(result.confidence); // 0.0-1.0
 * console.log(result.reason); // Optional denial reason
 * ```
 */
public async validateQuery(query: string, dbType = 'mysql'): Promise<SecurityValidation> {
```

#### Interface Documentation

```typescript
/**
 * Configuration options for security manager initialization.
 * 
 * @public
 */
export interface SecurityManagerConfig {
 /** Security policy configuration */
 security?: {
 /** Maximum number of JOINs allowed in a single query (default: 10) */
 max_joins?: number;
 
 /** Maximum number of subqueries allowed in a single query (default: 5) */
 max_subqueries?: number;
 
 /** Maximum number of UNION operations allowed (default: 3) */
 max_unions?: number;
 
 /** Maximum number of GROUP BY clauses allowed (default: 5) */
 max_group_bys?: number;
 
 /** Maximum complexity score before query is rejected (default: 100) */
 max_complexity_score?: number;
 
 /** Maximum query length in characters (default: 10000) */
 max_query_length?: number;
 };
}
```

### Code Comments

#### Explanation Comments

```typescript
// ============================================================================
// Connection Management
// ============================================================================

public async connect(): Promise<DatabaseConnection> {
 this.validateConfig(['host', 'database', 'username', 'password']);

 const connectionConfig: mysql.ConnectionOptions = {
 host: this.config.host!,
 port: this.parseConfigValue(this.config.port, 'number', 3306),
 database: this.config.database!,
 user: this.config.username!,
 password: this.config.password!,
 connectTimeout: this.connectionTimeout
 };

 // Handle SSL configuration based on server requirements
 if (this.config.ssl !== undefined) {
 const sslEnabled = this.parseConfigValue(this.config.ssl ?? false, 'boolean', false);
 if (sslEnabled) {
 connectionConfig.ssl = { rejectUnauthorized: false };
 }
 }

 // Special handling for Azure MariaDB/MySQL which requires specific username format
 if (this.config.host?.includes('.mariadb.database.azure.com') || 
 this.config.host?.includes('.mysql.database.azure.com')) {
 
 // Azure requires SSL connections
 connectionConfig.ssl = { rejectUnauthorized: false };
 
 // Format username for Azure if not already formatted (user@server format)
 let azureUser = this.config.username!;
 if (!azureUser.includes('@') && this.config.host) {
 const serverName = this.config.host.split('.')[0];
 azureUser = `${azureUser}@${serverName}`;
 }
 connectionConfig.user = azureUser;
 }

 try {
 const connection = await mysql.createConnection(connectionConfig);
 return connection as DatabaseConnection;
 } catch (error) {
 throw this.createError('Failed to connect to MySQL database', error as Error);
 }
}
```

#### TODO and FIXME Comments

```typescript
// TODO: Add connection pooling for better performance
// TODO: Implement connection retry logic with exponential backoff
// FIXME: Handle edge case where connection drops during query execution
// NOTE: This is a temporary workaround for MySQL 8.0 authentication issues
```

## Performance Guidelines

### Efficient Patterns

#### Avoid N+1 Queries

```typescript
// Bad: N+1 query pattern
async function getUsersWithPosts(): Promise<UserWithPosts[]> {
 const users = await getAllUsers();
 
 const usersWithPosts = [];
 for (const user of users) {
 const posts = await getPostsByUserId(user.id); // N additional queries
 usersWithPosts.push({ ...user, posts });
 }
 
 return usersWithPosts;
}

// Good: Single query with JOIN
async function getUsersWithPosts(): Promise<UserWithPosts[]> {
 const query = `
 SELECT 
 u.id, u.name, u.email,
 p.id as post_id, p.title, p.content
 FROM users u
 LEFT JOIN posts p ON u.id = p.user_id
 ORDER BY u.id, p.created_at DESC
 `;
 
 const result = await this.executeQuery(connection, query);
 return this.groupUserPosts(result.rows);
}
```

#### Memory Management

```typescript
// Stream large result sets
public async *streamQueryResults(
 connection: DatabaseConnection,
 query: string,
 batchSize = 1000
): AsyncGenerator<QueryResult[], void, unknown> {
 let offset = 0;
 let hasMore = true;

 while (hasMore) {
 const batchQuery = `${query} LIMIT ${batchSize} OFFSET ${offset}`;
 const result = await this.executeQuery(connection, batchQuery);
 
 if (result.rows.length === 0) {
 hasMore = false;
 } else {
 yield result.rows;
 offset += batchSize;
 hasMore = result.rows.length === batchSize;
 }
 }
}
```

### Caching Strategies

```typescript
// Implement intelligent caching
class SchemaManager {
 private schemaCache = new Map<string, { schema: DatabaseSchema; timestamp: number }>();
 private readonly cacheTimeout = 5 * 60 * 1000; // 5 minutes

 public async getSchema(databaseName: string, forceRefresh = false): Promise<DatabaseSchema> {
 const cached = this.schemaCache.get(databaseName);
 const now = Date.now();

 // Return cached schema if valid and not forcing refresh
 if (!forceRefresh && cached && (now - cached.timestamp) < this.cacheTimeout) {
 this.logger.debug('Returning cached schema', { database: databaseName });
 return cached.schema;
 }

 // Fetch fresh schema
 this.logger.debug('Fetching fresh schema', { database: databaseName });
 const schema = await this.fetchSchemaFromDatabase(databaseName);
 
 // Update cache
 this.schemaCache.set(databaseName, {
 schema,
 timestamp: now
 });

 return schema;
 }
}
```

## Security Guidelines

### Input Validation

```typescript
// Comprehensive input validation
public validateDatabaseConfig(name: string, config: unknown): ValidationResult {
 const errors: string[] = [];

 // Type validation
 if (!config || typeof config !== 'object') {
 return {
 isValid: false,
 errors: ['Configuration must be an object'],
 warnings: []
 };
 }

 const dbConfig = config as Record<string, unknown>;

 // Required field validation
 const requiredFields = ['type', 'host', 'database', 'username', 'password'];
 for (const field of requiredFields) {
 if (!dbConfig[field] || typeof dbConfig[field] !== 'string') {
 errors.push(`${field} is required and must be a string`);
 }
 }

 // Type-specific validation
 if (typeof dbConfig.type === 'string') {
 const validTypes = ['postgresql', 'mysql', 'sqlite', 'mssql'];
 if (!validTypes.includes(dbConfig.type)) {
 errors.push(`Invalid database type: ${dbConfig.type}. Must be one of: ${validTypes.join(', ')}`);
 }
 }

 // Port validation
 if (dbConfig.port !== undefined) {
 const port = Number(dbConfig.port);
 if (isNaN(port) || port < 1 || port > 65535) {
 errors.push('Port must be a valid number between 1 and 65535');
 }
 }

 // SSL validation
 if (dbConfig.ssl !== undefined && typeof dbConfig.ssl !== 'boolean') {
 errors.push('SSL setting must be a boolean value');
 }

 return {
 isValid: errors.length === 0,
 errors,
 warnings: []
 };
}
```

### Query Sanitization

```typescript
// Sanitize error messages to prevent information disclosure
public sanitizeErrorMessage(errorMessage: string): string {
 return errorMessage
 .replace(/password[=:]\s*[^\s;,)]+/gi, 'password=[REDACTED]')
 .replace(/pwd[=:]\s*[^\s;,)]+/gi, 'pwd=[REDACTED]')
 .replace(/token[=:]\s*[^\s;,)]+/gi, 'token=[REDACTED]')
 .replace(/key[=:]\s*[^\s;,)]+/gi, 'key=[REDACTED]')
 .replace(/secret[=:]\s*[^\s;,)]+/gi, 'secret=[REDACTED]')
 .replace(/\b\d{4}-\d{4}-\d{4}-\d{4}\b/g, 'XXXX-XXXX-XXXX-XXXX') // Credit card numbers
 .replace(/\b\d{3}-\d{2}-\d{4}\b/g, 'XXX-XX-XXXX') // SSN format
 .substring(0, 500); // Limit message length
}
```

## Testing Integration

### Testable Code Design

```typescript
// Dependency injection for testability
export class SecurityManager {
 constructor(
 private config: SecurityManagerConfig = {},
 private selectOnlyMode: boolean = true,
 private logger: Logger = getLogger() // Injectable dependency
 ) {
 // Implementation
 }
}

// Test-friendly methods
public async validateQueryForTesting(
 query: string,
 mockComplexityLimits?: Partial<ComplexityLimits>
): Promise<SecurityValidation> {
 if (mockComplexityLimits && process.env.NODE_ENV === 'test') {
 const originalLimits = { ...this.complexityLimits };
 Object.assign(this.complexityLimits, mockComplexityLimits);
 
 try {
 return await this.validateQuery(query);
 } finally {
 Object.assign(this.complexityLimits, originalLimits);
 }
 }
 
 return this.validateQuery(query);
}
```

## Build and Development Integration

### Package Scripts Integration

```json
{
 "scripts": {
 "lint": "eslint src/**/*.ts --fix",
 "lint:check": "eslint src/**/*.ts",
 "type-check": "tsc --noEmit",
 "build": "npm run clean && tsc",
 "build:production": "npm run clean && npm run lint && npm run test && npm run build",
 "validate": "npm run lint:check && npm run type-check && npm run test"
 }
}
```

### Pre-commit Validation

```bash
# Recommended pre-commit hook
#!/bin/sh
set -e

echo "Running pre-commit validation..."

# Type checking
echo "Type checking..."
npm run type-check

# Linting
echo "Linting..."
npm run lint:check

# Testing
echo "Running tests..."
npm run test

echo "All validations passed!"
```

## Code Review Guidelines

### Review Checklist

- [ ] **Type Safety**: All types are explicit and correct
- [ ] **Error Handling**: Proper error handling with meaningful messages
- [ ] **Testing**: New code has corresponding tests
- [ ] **Documentation**: Public APIs are documented with JSDoc
- [ ] **Performance**: No obvious performance issues
- [ ] **Security**: Input validation and sanitization where needed
- [ ] **Standards Compliance**: Follows project coding standards
- [ ] **Logging**: Appropriate logging for debugging and monitoring

### Common Review Comments

```typescript
// Comment: Missing error handling
function riskyOperation() {
 return JSON.parse(userInput); // What if userInput is invalid?
}

// Fixed: Proper error handling
function safeOperation(userInput: string): ParsedData {
 try {
 return JSON.parse(userInput);
 } catch (error) {
 throw new ValidationError('Invalid JSON input', { originalError: error });
 }
}

// Comment: Magic numbers
if (attempts > 5) { // What's special about 5?

// Fixed: Named constants
const MAX_RETRY_ATTEMPTS = 5;
if (attempts > MAX_RETRY_ATTEMPTS) {
```

## Conclusion

These coding standards ensure the Argos maintains high quality, security, and maintainability. All developers should familiarize themselves with these guidelines and apply them consistently across the codebase.

**Key Takeaways:**
- **Type safety first** - Leverage TypeScript fully
- **Security awareness** - Validate inputs, sanitize outputs
- **Clear documentation** - Code should be self-documenting with good JSDoc
- **Testable design** - Write code that can be easily tested
- **Performance conscious** - Consider performance implications
- **Consistent style** - Follow established patterns and naming conventions

For questions about specific standards or patterns not covered here, refer to existing codebase examples or raise them in code review discussions.

## References

- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [ESLint Rules](https://eslint.org/docs/rules/)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [TypeScript ESLint](https://typescript-eslint.io/)
- [Jest Testing Framework](https://jestjs.io/)

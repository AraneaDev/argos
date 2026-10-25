# TypeScript API Reference

This document provides comprehensive TypeScript API documentation for the Argos. It covers all interfaces, types, classes, and functions available for developers working with or extending the server.

## What this covers

Describes the source as of v4.1.8 <!-- x-release-please-version -->. These are
the internal types and classes of the server, for anyone reading or extending
it. They are not a supported import surface: the package publishes `dist/` but
declares no `types` entry and no `exports` map, so names here can change without
a major version.

For the interface that *is* stable, see the
[MCP Tools Reference](./mcp-tools-reference.md): the tools, their arguments and
their responses are what a client depends on.

Coverage figures are deliberately not quoted here, because a number written into
a document is wrong the week after. Run `npm run test:coverage` for the current
state.

## Table of Contents

- [Core Classes](#core-classes)
- [Database Types](#database-types)
- [MCP Protocol Types](#mcp-protocol-types)
- [Security Types](#security-types)
- [SSH Tunnel Types](#ssh-tunnel-types)
- [Configuration Types](#configuration-types)
- [Error Types](#error-types)
- [Utility Functions](#utility-functions)
- [Constants](#constants)
- [Usage Examples](#usage-examples)

---

## Core Classes

### SQLMCPServer 
Main server class that orchestrates all operations.

```typescript
export class SQLMCPServer extends EventEmitter {
 constructor();
 
 // Lifecycle methods
 initialize(configPath?: string): Promise<void>;
 run(): Promise<void>;
 cleanup(): Promise<void>;
 
 // Request handling
 handleRequest(request: MCPRequest): Promise<MCPResponse | null>;
 
 // Database operations
 testConnection(database: string): Promise<TestConnectionResult>;
 
 // Events emitted
 on(event: 'initialized', listener: () => void): this;
 on(event: 'cleanup', listener: () => void): this;
 on(event: 'error', listener: (error: Error) => void): this;
}
```

### ConnectionManager 
Manages database connections and connection pooling.

```typescript
export class ConnectionManager extends EventEmitter {
 constructor(sshTunnelManager: EnhancedSSHTunnelManager, metrics?: MetricsManager, queryCache?: QueryCache);
 
 // Connection management
 initialize(databases: Record<string, DatabaseConfig>): void;
 getConnection(database: string): Promise<DatabaseConnection | null>;
 closeConnection(database: string): Promise<void>;
 closeAllConnections(): Promise<void>;
 
 // Query execution
 executeQuery(database: string, query: string, params?: unknown[]): Promise<QueryResult>;
 executeBatch(database: string, queries: Array<{query: string; params?: unknown[]; label?: string}>, transaction?: boolean): Promise<BatchResult>;
 analyzePerformance(database: string, query: string): Promise<{
 executionTime: number;
 explainTime: number;
 rowCount: number;
 columnCount: number;
 executionPlan: string;
 recommendations: string;
 }>;
 
 // Events emitted
 on(event: 'connected', listener: (database: string) => void): this;
 on(event: 'disconnected', listener: (database: string) => void): this;
 on(event: 'error', listener: (error: Error, database?: string) => void): this;
}
```

### SecurityManager 
Handles query validation and security enforcement.

```typescript
export class SecurityManager extends EventEmitter {
 constructor(config?: SecurityManagerConfig, selectOnlyMode?: boolean);
 
 // Initialization
 initialize(config: ParsedServerConfig): void;
 
 // Main validation methods
 validateQuery(query: string, dbType?: string): Promise<SecurityValidation>;
 validateAnyQuery(query: string, dbType?: string): SecurityValidation;
 analyzeQuery(query: string): Promise<QueryComplexityAnalysis>;
 analyzeQueryComplexity(query: string): QueryComplexityAnalysis;
 
 // Batch validation 
 validateBatchSelectOnlyQueries(
 queries: Array<{query: string; params?: unknown[]; label?: string}>, 
 dbType?: string
 ): BatchValidationResult;
 
 // Configuration management
 updateConfig(config: SecurityManagerConfig): void;
 getConfig(): SecurityManagerConfig;
 setSelectOnlyMode(enabled: boolean): void;
 isSelectOnlyMode(): boolean;
 
 // Audit and utilities
 createAuditLog(database: string, query: string | string[], allowed: boolean, reason?: string, metadata?: Record<string, unknown>): AuditLogEntry;
 sanitizeErrorMessage(errorMessage: string): string;
 getStatistics(): { queriesValidated: number; queriesBlocked: number; queriesAllowed: number; totalComplexity: number; avgComplexity: number; };
 
 // Events emitted
 on(event: 'query-blocked', listener: (database: string, reason: string) => void): this;
 on(event: 'query-approved', listener: (database: string) => void): this;
 on(event: 'initialized', listener: (config: ParsedServerConfig) => void): this;
}
```

### SchemaManager 
Manages database schema caching and retrieval.

```typescript
export class SchemaManager extends EventEmitter {
 constructor(connectionManager: ConnectionManager, schemaPath?: string);
 
 // Initialization
 initialize(): Promise<void>;
 
 // Schema operations
 hasSchema(database: string): boolean;
 getSchema(database: string): DatabaseSchema | null;
 captureSchema(database: string, config: DatabaseConfig): Promise<DatabaseSchema>;
 refreshSchema(database: string): Promise<DatabaseSchema>;
 generateSchemaContext(database: string, table?: string): string;
 
 // Events emitted
 on(event: 'schema-cached', listener: (database: string) => void): this;
 on(event: 'schema-refreshed', listener: (database: string) => void): this;
}
```

### EnhancedSSHTunnelManager
Manages SSH tunnels for secure database connections.

```typescript
export class EnhancedSSHTunnelManager extends EventEmitter {
 constructor();

 // Initialization
 initialize(): Promise<void>;

 // Tunnel management
 createTunnel(dbName: string, options: SSHTunnelCreateOptions): Promise<SSHTunnelInfo>;
 createEnhancedTunnel(dbName: string, options: EnhancedTunnelOptions): Promise<EnhancedTunnelInfo>;
 hasTunnel(dbName: string): boolean;
 getTunnel(dbName: string): SSHTunnelInfo | undefined;
 getEnhancedTunnel(dbName: string): EnhancedTunnelInfo | undefined;
 closeTunnel(dbName: string): Promise<void>;
 closeAllTunnels(): Promise<void>;

 // Status
 isConnected(dbName: string): boolean;
 getTunnelStatus(dbName: string): SSHTunnelStatusInfo | undefined;
 getActiveTunnels(): string[];
}
```

The class is named `EnhancedSSHTunnelManager`; there is no `SSHTunnelManager`.
The getters return `undefined` rather than `null` for an unknown database.

---

## Database Types

### DatabaseConfig
Configuration for a database connection.

```typescript
export interface DatabaseConfig {
 type: DatabaseType;
 select_only: boolean;
 
 // Connection details (not required for SQLite)
 host?: string;
 port?: number;
 database?: string;
 username?: string;
 password?: string;
 
 // SQLite specific
 file?: string;
 
 // Connection options
 ssl?: boolean;
 timeout?: number;
 
 // SSH tunnel configuration
 ssh_host?: string;
 ssh_port?: number;
 ssh_username?: string;
 ssh_password?: string;
 ssh_private_key?: string;
 ssh_passphrase?: string;

 // MCP configuration management
 mcp_configurable?: boolean;
}
```

### DatabaseType
Supported database types.

```typescript
export type DatabaseType = 'mysql' | 'postgresql' | 'postgres' | 'sqlite' | 'mssql' | 'sqlserver';
export type DatabaseTypeString = string & DatabaseType;
```

### QueryResult
Result of a database query execution.

```typescript
export interface QueryResult {
 rows: Record<string, any>[];
 fields: string[];
 rowCount: number;
 executionTime?: number;
 truncated?: boolean;
}
```

### DatabaseSchema
Complete schema information for a database.

```typescript
export interface DatabaseSchema {
 database: string;
 type: DatabaseTypeString;
 captured_at: string;
 tables: Record<string, TableInfo>;
 views: Record<string, TableInfo>;
 summary: {
 table_count: number;
 view_count: number;
 total_columns: number;
 };
}

export interface TableInfo {
 name: string;
 type: string;
 comment?: string;
 columns: ColumnInfo[];
}

export interface ColumnInfo {
 name: string;
 type: string;
 nullable: boolean;
 default: unknown;
 max_length?: number | null;
 precision?: number | null;
 scale?: number | null;
 comment?: string;
 key?: string;
 extra?: string;
}
```

Two things to note about what schema capture returns, because both are easy to
assume otherwise:

- **Columns are an array, not a map.** `TableInfo.columns` is ordered as the
  database returned it, and each entry carries its own `name`.
- **Relationships and indexes are not captured.** There is no foreign-key or
  index metadata in the schema, on any adapter. `ColumnInfo.key` carries
  whatever the driver reports for the column (MySQL's `COLUMN_KEY`, for
  instance), which is the closest thing available. To reason about
  relationships, query the database's own catalogue.

Views are described with the same `TableInfo` shape as tables and are
distinguished by the `type` field.

### BatchResult
Result of batch query execution.

```typescript
export interface BatchResult {
 results: BatchResultItem[];
 totalExecutionTime: number;
 successCount: number;
 failureCount: number;
 transactionUsed?: boolean;
}

export interface BatchResultItem {
 index: number;
 label?: string;
 query?: string;
 success: boolean;
 data?: QueryResult;
 error?: string;
}
```

---

## MCP Protocol Types

### MCPRequest
Base MCP request structure.

```typescript
export interface MCPRequest {
 jsonrpc: '2.0';
 id: string | number | null;
 method: string;
 params?: Record<string, any>;
}

export interface MCPToolCallRequest extends MCPRequest {
 method: 'tools/call';
 params: MCPToolCallParams;
}

export interface MCPToolCallParams {
 name: string;
 arguments: Record<string, any>;
}
```

### MCPResponse
Base MCP response structure.

```typescript
export interface MCPResponse {
 jsonrpc: '2.0';
 id: string | number | null;
 result?: any;
 error?: MCPError;
}

export interface MCPError {
 code: number;
 message: string;
 data?: any;
}
```

### Tool definitions
The tool list served for `tools/list`.

```typescript
export function getToolDefinitions(): Array<{
 name: string;
 description: string;
 inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}>;

export interface MCPToolParameter {
 type: string;
 description?: string;
 enum?: string[];
 items?: MCPToolParameter;
 default?: unknown;
}
```

The definitions are plain object literals in `src/tools/tool-definitions.ts` and
their type is inferred rather than declared, so there is no `MCPTool` interface
to import. `MCPToolParameter` describes the shape of one property inside an
`inputSchema` and is the only part of this declared as a named type.

### Tool Input Types
Specific input argument types for each tool.

```typescript
export interface SQLQueryArgs {
 database: string;
 query: string;
 params?: string[];
}

export interface SQLBatchQueryArgs {
 database: string;
 queries: QueryObject[];
 transaction?: boolean;
}

export interface SQLAnalyzePerformanceArgs {
 database: string;
 query: string;
}

export interface SQLGetSchemaArgs {
 database: string;
 table?: string;
}

export interface SQLTestConnectionArgs {
 database: string;
}

export interface SQLRefreshSchemaArgs {
 database: string;
}

```

The config-management tools (`sql_add_database`, `sql_update_database`,
`sql_remove_database`, `sql_get_config`, `sql_set_mcp_configurable`) and
`sql_list_databases` have no declared argument interfaces. Their handlers take
`Record<string, unknown>` and read the fields they need, so the authoritative
description of what each accepts is the `inputSchema` in
`src/tools/tool-definitions.ts` and the
[MCP Tools Reference](./mcp-tools-reference.md).


### MCPToolResponse
Tool response structure.

```typescript
export interface MCPToolResponse {
 content: MCPToolContent[];
 isError?: boolean;
 _meta: {
 progressToken: string | null;
 };
}

export interface MCPToolContent {
 type: 'text' | 'image' | 'resource';
 text?: string;
 data?: string;
 mimeType?: string;
}
```

---

## Security Types

### SecurityValidation
Result of query security validation.

```typescript
export interface SecurityValidation {
 allowed: boolean;
 reason?: string;
 confidence: number;
 blockedCommand?: string;
}
```

### QueryComplexityAnalysis
Analysis of query complexity and performance characteristics.

```typescript
export interface QueryComplexityAnalysis {
 score: number;
 factors: string[];
 joinCount: number;
 subqueryCount: number;
 unionCount: number;
 groupByCount: number;
 windowFuncCount: number;
 risk_level: ComplexityRiskLevel;
}

export type ComplexityRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
```
```



### SecurityConfig
Security configuration settings.

```typescript
export interface SecurityConfig {
 max_joins: number;
 max_subqueries: number;
 max_unions: number;
 max_group_bys: number;
 max_complexity_score: number;
 max_query_length: number;
}
```

---

## SSH Tunnel Types

### SSHTunnelCreateOptions
Options for creating SSH tunnels.

```typescript
export interface SSHTunnelCreateOptions {
 sshConfig: SSHConnectionConfig;
 forwardConfig: SSHForwardConfig;
}

export interface SSHConnectionConfig {
 host: string;
 port: number;
 username: string;
 password?: string;
 privateKey?: string;
 passphrase?: string;
 timeout?: number;
}

export interface SSHForwardConfig {
 sourceHost: string;
 sourcePort: number;
 destinationHost: string;
 destinationPort: number;
}
```

### SSHTunnelInfo
Information about an active SSH tunnel.

```typescript
export interface SSHTunnelInfo {
 database: string;
 localPort: number;
 remoteHost: string;
 remotePort: number;
 sshHost: string;
 sshPort: number;
 status: SSHTunnelStatus;
 createdAt: Date;
 lastUsed?: Date;
}

export type SSHTunnelStatus = 
 | 'connecting' 
 | 'connected' 
 | 'error' 
 | 'disconnected' 
 | 'reconnecting';
```

---

## Configuration Types

### ParsedServerConfig
Complete server configuration after parsing.

```typescript
export interface ParsedServerConfig {
 databases: Record<string, DatabaseConfig>;
 security?: SecurityConfig;
 extension?: ExtensionConfig;
}

export interface ExtensionConfig {
 max_rows: number;
 max_batch_size: number;
 query_timeout: number;
}
```

### RawConfigFile
Raw configuration file structure from INI parsing.

```typescript
export interface RawConfigFile {
 database?: Record<string, DatabaseSectionConfig>;
 security?: Record<string, string>;
 extension?: Record<string, string>;
 [key: string]: any;
}

export interface DatabaseSectionConfig {
 type: string;
 host?: string;
 port?: string;
 database?: string;
 username?: string;
 password?: string;
 file?: string;
 ssl?: string;
 select_only?: string;
 timeout?: string;
 ssh_host?: string;
 ssh_port?: string;
 ssh_username?: string;
 ssh_password?: string;
 ssh_private_key?: string;
 ssh_passphrase?: string;
 mcp_configurable?: string;
}
```

---

## Error Types

### Error Classes
Custom error classes with specific error codes.

```typescript
export class SQLMCPError extends Error {
 code: number;
 details?: Record<string, any>;
 
 constructor(message: string, code: number, details?: Record<string, any>);
}

export class SecurityViolationError extends SQLMCPError {
 constructor(message: string, details?: Record<string, any>);
}

export class ConnectionError extends SQLMCPError {
 constructor(message: string, details?: Record<string, any>);
}

export class QueryExecutionError extends SQLMCPError {
 constructor(message: string, details?: Record<string, any>);
}
```

### TestConnectionResult
Result of database connection testing.

```typescript
export interface TestConnectionResult {
 success: boolean;
 database: string;
 message?: string;
 error?: string;
 ssh_tunnel: boolean;
 select_only_mode: boolean;
 schema_captured: boolean;
 schema_info?: {
 table_count: number;
 view_count: number;
 total_columns: number;
 };
}
```

---

## Utility Functions

### Type Guards
Functions to check types at runtime.

```typescript
// Database type guards
export function isDatabaseType(value: any): value is DatabaseType;
export function isQueryObject(value: any): value is QueryObject;
export function isSecurityViolationError(error: any): error is SecurityViolationError;

// MCP type guards
export function isMCPRequest(message: any): message is MCPRequest;
export function isMCPResponse(message: any): message is MCPResponse;
export function isMCPToolCallRequest(request: any): request is MCPToolCallRequest;
export function isSQLQueryArgs(args: any): args is SQLQueryArgs;
export function isSQLBatchQueryArgs(args: any): args is SQLBatchQueryArgs;

// Security type guards
export function isComplexityRiskLevel(value: any): value is ComplexityRiskLevel;
export function isTokenType(value: any): value is TokenType;

// SSH type guards
export function isSSHTunnelStatus(value: any): value is SSHTunnelStatus;
export function validateSSHConfig(config: any): config is SSHConnectionConfig;
```

### Configuration Utilities
Helper functions for configuration management.

```typescript
export function parseStringToNumber(value: string, defaultValue: number): number;
export function parseStringToBoolean(value: string, defaultValue: boolean): boolean;
export function validateDatabaseType(type: string): type is DatabaseType;
export function getRequiredFields(dbType: DatabaseType): string[];
export function validateRequiredFields(config: any, required: string[]): string[];
```

---

## Constants

### Default Configurations
Default configuration values.

```typescript
export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
 max_joins: 10,
 max_subqueries: 5,
 max_unions: 3,
 max_group_bys: 5,
 max_complexity_score: 100,
 max_query_length: 10000
};

export const DEFAULT_EXTENSION_CONFIG: ExtensionConfig = {
 max_rows: 1000,
 max_batch_size: 10,
 query_timeout: 30000
};

export const DEFAULT_DATABASE_PORTS: Record<string, number> = {
 mysql: 3306,
 postgresql: 5432,
 postgres: 5432,
 mssql: 1433,
 sqlserver: 1433
};

export const DEFAULT_CONNECTION_TIMEOUT = 30000;
export const DEFAULT_SSH_PORT = 22;
```

### Version Information
Server and protocol version constants.

```typescript
export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const SERVER_VERSION = '2.3.1';
export const SERVER_NAME = 'argos';
```

### Enum Arrays
Arrays of valid enum values.

```typescript
export const DATABASE_TYPES = ['mysql', 'postgresql', 'postgres', 'sqlite', 'mssql', 'sqlserver'] as const;
export const COMPLEXITY_RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const TOKEN_TYPES = ['KEYWORD', 'IDENTIFIER', 'STRING', 'OPERATOR', 'UNKNOWN'] as const;
export const LOG_SEVERITIES = ['INFO', 'WARNING', 'ERROR', 'CRITICAL'] as const;
export const SSH_AUTH_METHODS = ['password', 'privateKey', 'agent'] as const;
export const SSH_TUNNEL_STATUSES = ['connecting', 'connected', 'error', 'disconnected', 'reconnecting'] as const;
```

---

## Usage Examples

### Creating and Using SQLMCPServer
```typescript
import { SQLMCPServer } from '../../src/classes/SQLMCPServer.js';
import type { DatabaseConfig } from '../../src/types/index.js';

const server = new SQLMCPServer();

// Event handling
server.on('initialized', () => {
 console.log('Server initialized successfully');
});

server.on('error', (error) => {
 console.error('Server error:', error);
});

// Initialize and run
async function startServer() {
 try {
 await server.initialize('./config.ini');
 await server.run();
 } catch (error) {
 console.error('Failed to start server:', error);
 }
}

startServer();
```

### Custom Security Validation
```typescript
import { SecurityManager } from '../../src/classes/SecurityManager.js';
import type { SecurityValidation } from '../../src/types/index.js';

class CustomSecurityManager extends SecurityManager {
 validateCustomRule(query: string): SecurityValidation {
 if (/CUSTOM_FORBIDDEN_PATTERN/.test(query)) {
 return {
 allowed: false,
 reason: 'Custom forbidden pattern detected',
 blockedCommand: 'CUSTOM_PATTERN',
 confidence: 1.0,
 };
 }

 return { allowed: true, confidence: 1.0 };
 }
}
```

`confidence` is required on a `SecurityValidation`, and the field naming the
offending statement is `blockedCommand`.

### Type-Safe Configuration
```typescript
import { isDatabaseType, validateRequiredFields } from '../../src/types/index.js';
import type { DatabaseConfig } from '../../src/types/index.js';

function createDatabaseConfig(rawConfig: any): DatabaseConfig {
 // Validate database type
 if (!isDatabaseType(rawConfig.type)) {
 throw new Error(`Invalid database type: ${rawConfig.type}`);
 }
 
 // Check required fields
 const required = getRequiredFields(rawConfig.type);
 const missing = validateRequiredFields(rawConfig, required);
 
 if (missing.length > 0) {
 throw new Error(`Missing required fields: ${missing.join(', ')}`);
 }
 
 return {
 type: rawConfig.type,
 host: rawConfig.host,
 port: parseInt(rawConfig.port) || DEFAULT_DATABASE_PORTS[rawConfig.type],
 database: rawConfig.database,
 username: rawConfig.username,
 password: rawConfig.password,
 select_only: parseStringToBoolean(rawConfig.select_only, true)
 };
}
```

### Custom Database Adapter

A new database is added by extending the abstract `DatabaseAdapter`, not by
implementing `DatabaseConnection` — that type is the driver's connection handle,
not the adapter contract. The subclass must supply every abstract member:

```typescript
import { DatabaseAdapter } from '../../src/database/adapters/base.js';
import type { DatabaseConnection, QueryResult, DatabaseSchema } from '../../src/types/index.js';

class CustomAdapter extends DatabaseAdapter {
 async connect(): Promise<DatabaseConnection> { /* ... */ }
 async executeQuery(connection: DatabaseConnection, query: string, params?: unknown[]): Promise<QueryResult> { /* ... */ }
 async disconnect(connection: DatabaseConnection): Promise<void> { /* ... */ }
 async captureSchema(connection: DatabaseConnection): Promise<DatabaseSchema> { /* ... */ }
 isConnected(connection: DatabaseConnection): boolean { /* ... */ }
 async beginTransaction(connection: DatabaseConnection): Promise<void> { /* ... */ }
 async commitTransaction(connection: DatabaseConnection): Promise<void> { /* ... */ }
 async rollbackTransaction(connection: DatabaseConnection): Promise<void> { /* ... */ }
 buildExplainQuery(query: string): string { /* ... */ }

 protected extractRawRows(result: unknown): unknown[] { /* ... */ }
 protected extractFieldNames(result: unknown): string[] { /* ... */ }
}
```

`examples/custom-adapters/adapter-template.ts` is a complete version of the
above with each method commented, and is a better starting point than this
outline. Register the finished class in
`src/database/adapters/AdapterFactory.ts`.

Optionally override `getPerformanceRecommendations(explainResult, query)` to
turn the output of your `buildExplainQuery` into advice; the base implementation
returns nothing.


### Error Handling with Type Safety
```typescript
import {
 SQLMCPError,
 SecurityViolationError,
 ConnectionError,
} from '../../src/utils/error-handler.js';
import { isSecurityViolationError } from '../../src/types/index.js';

async function handleDatabaseOperation() {
 try {
 // Database operation
 await server.executeQuery('SELECT * FROM users');
 } catch (error) {
 if (isSecurityViolationError(error)) {
 console.log('Security violation:', error.message);
 console.log('Blocked operation:', error.details?.blockedOperation);
 } else if (error instanceof ConnectionError) {
 console.log('Connection error:', error.message);
 console.log('Database:', error.details?.database);
 } else if (error instanceof SQLMCPError) {
 console.log('Argos Error:', error.code, error.message);
 } else {
 console.log('Unknown error:', error);
 }
 }
}
```

This comprehensive TypeScript API reference provides developers with all the types, interfaces, and classes needed to work with or extend the Argos effectively.
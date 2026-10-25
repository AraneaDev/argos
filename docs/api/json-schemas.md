# JSON Schemas Reference

This document provides comprehensive JSON schema definitions for all request and response formats used in the Argos.

## Table of Contents

- [MCP Protocol Schemas](#mcp-protocol-schemas)
- [Tool Input Schemas](#tool-input-schemas) 
- [Tool Output Schemas](#tool-output-schemas)
- [Database Configuration Schemas](#database-configuration-schemas)
- [Error Response Schemas](#error-response-schemas)
- [Internal Type Schemas](#internal-type-schemas)

---

## MCP Protocol Schemas

### MCP Request Schema
```json
{
 "$schema": "http://json-schema.org/draft-07/schema#",
 "type": "object",
 "properties": {
 "jsonrpc": {
 "type": "string",
 "const": "2.0"
 },
 "id": {
 "oneOf": [
 { "type": "string" },
 { "type": "number" },
 { "type": "null" }
 ]
 },
 "method": {
 "type": "string",
 "enum": [
 "initialize",
 "tools/list", 
 "tools/call",
 "notifications/initialized"
 ]
 },
 "params": {
 "type": "object"
 }
 },
 "required": ["jsonrpc", "method"],
 "additionalProperties": false
}
```

### MCP Response Schema
```json
{
 "$schema": "http://json-schema.org/draft-07/schema#",
 "type": "object",
 "properties": {
 "jsonrpc": {
 "type": "string",
 "const": "2.0"
 },
 "id": {
 "oneOf": [
 { "type": "string" },
 { "type": "number" },
 { "type": "null" }
 ]
 },
 "result": {
 "type": "object"
 },
 "error": {
 "$ref": "#/definitions/MCPError"
 }
 },
 "required": ["jsonrpc", "id"],
 "oneOf": [
 { "required": ["result"] },
 { "required": ["error"] }
 ],
 "additionalProperties": false,
 "definitions": {
 "MCPError": {
 "type": "object",
 "properties": {
 "code": {
 "type": "number"
 },
 "message": {
 "type": "string"
 },
 "data": {
 "type": "object"
 }
 },
 "required": ["code", "message"],
 "additionalProperties": false
 }
 }
}
```

### Initialize Result Schema
```json
{
 "$schema": "http://json-schema.org/draft-07/schema#",
 "type": "object",
 "properties": {
 "protocolVersion": {
 "type": "string",
 "pattern": "^\\d+\\.\\d+\\.\\d+$"
 },
 "capabilities": {
 "type": "object",
 "properties": {
 "tools": {
 "type": "object"
 },
 "logging": {
 "type": "object"
 }
 },
 "required": ["tools", "logging"]
 },
 "serverInfo": {
 "type": "object",
 "properties": {
 "name": {
 "type": "string"
 },
 "version": {
 "type": "string"
 }
 },
 "required": ["name", "version"]
 }
 },
 "required": ["protocolVersion", "capabilities", "serverInfo"],
 "additionalProperties": false
}
```

### Tools List Result Schema
```json
{
 "$schema": "http://json-schema.org/draft-07/schema#",
 "type": "object",
 "properties": {
 "tools": {
 "type": "array",
 "items": {
 "$ref": "#/definitions/MCPTool"
 }
 }
 },
 "required": ["tools"],
 "additionalProperties": false,
 "definitions": {
 "MCPTool": {
 "type": "object",
 "properties": {
 "name": {
 "type": "string"
 },
 "description": {
 "type": "string"
 },
 "inputSchema": {
 "type": "object",
 "properties": {
 "type": {
 "type": "string",
 "const": "object"
 },
 "properties": {
 "type": "object"
 },
 "required": {
 "type": "array",
 "items": {
 "type": "string"
 }
 },
 "additionalProperties": {
 "type": "boolean"
 }
 },
 "required": ["type", "properties"],
 "additionalProperties": false
 }
 },
 "required": ["name", "description", "inputSchema"],
 "additionalProperties": false
 }
 }
}
```

---

## Tool Input Schemas

### sql_query Input Schema
```json
{
 "$schema": "http://json-schema.org/draft-07/schema#",
 "type": "object",
 "properties": {
 "database": {
 "type": "string",
 "description": "Database name from configuration",
 "minLength": 1,
 "maxLength": 100,
 "pattern": "^[a-zA-Z][a-zA-Z0-9_-]*$"
 },
 "query": {
 "type": "string",
 "description": "SQL query to execute", 
 "minLength": 1,
 "maxLength": 50000
 },
 "params": {
 "type": "array",
 "description": "Optional query parameters for prepared statements",
 "items": {
 "type": "string"
 },
 "maxItems": 100,
 "default": []
 }
 },
 "required": ["database", "query"],
 "additionalProperties": false
}
```

### sql_batch_query Input Schema
```json
{
 "$schema": "http://json-schema.org/draft-07/schema#",
 "type": "object",
 "properties": {
 "database": {
 "type": "string",
 "description": "Database name from configuration",
 "minLength": 1,
 "maxLength": 100,
 "pattern": "^[a-zA-Z][a-zA-Z0-9_-]*$"
 },
 "queries": {
 "type": "array",
 "description": "Array of SQL queries to execute in batch",
 "items": {
 "$ref": "#/definitions/BatchQueryItem"
 },
 "minItems": 1,
 "maxItems": 50
 },
 "transaction": {
 "type": "boolean",
 "description": "Execute all queries in a single transaction",
 "default": false
 }
 },
 "required": ["database", "queries"],
 "additionalProperties": false,
 "definitions": {
 "BatchQueryItem": {
 "type": "object",
 "properties": {
 "query": {
 "type": "string",
 "description": "SQL query to execute",
 "minLength": 1,
 "maxLength": 50000
 },
 "params": {
 "type": "array",
 "description": "Optional query parameters",
 "items": {
 "type": "string"
 },
 "maxItems": 100
 },
 "label": {
 "type": "string",
 "description": "Optional label to identify this query in results",
 "maxLength": 200
 }
 },
 "required": ["query"],
 "additionalProperties": false
 }
 }
}
```

### sql_analyze_performance Input Schema
```json
{
 "$schema": "http://json-schema.org/draft-07/schema#",
 "type": "object",
 "properties": {
 "database": {
 "type": "string",
 "description": "Database name from configuration",
 "minLength": 1,
 "maxLength": 100,
 "pattern": "^[a-zA-Z][a-zA-Z0-9_-]*$"
 },
 "query": {
 "type": "string",
 "description": "SQL query to analyze",
 "minLength": 1,
 "maxLength": 50000
 }
 },
 "required": ["database", "query"],
 "additionalProperties": false
}
```

### sql_list_databases Input Schema
```json
{
 "$schema": "http://json-schema.org/draft-07/schema#",
 "type": "object",
 "properties": {},
 "additionalProperties": false
}
```

### sql_get_schema Input Schema
```json
{
 "$schema": "http://json-schema.org/draft-07/schema#",
 "type": "object",
 "properties": {
 "database": {
 "type": "string",
 "description": "Database name to get schema for",
 "minLength": 1,
 "maxLength": 100,
 "pattern": "^[a-zA-Z][a-zA-Z0-9_-]*$"
 },
 "table": {
 "type": "string",
 "description": "Optional: Get schema for specific table only",
 "minLength": 1,
 "maxLength": 200,
 "pattern": "^[a-zA-Z_][a-zA-Z0-9_]*$"
 }
 },
 "required": ["database"],
 "additionalProperties": false
}
```

### sql_test_connection Input Schema
```json
{
 "$schema": "http://json-schema.org/draft-07/schema#",
 "type": "object",
 "properties": {
 "database": {
 "type": "string",
 "description": "Database name to test",
 "minLength": 1,
 "maxLength": 100,
 "pattern": "^[a-zA-Z][a-zA-Z0-9_-]*$"
 }
 },
 "required": ["database"],
 "additionalProperties": false
}
```

### sql_refresh_schema Input Schema
```json
{
 "$schema": "http://json-schema.org/draft-07/schema#",
 "type": "object",
 "properties": {
 "database": {
 "type": "string",
 "description": "Database name to refresh schema for",
 "minLength": 1,
 "maxLength": 100,
 "pattern": "^[a-zA-Z][a-zA-Z0-9_-]*$"
 }
 },
 "required": ["database"],
 "additionalProperties": false
}
```

---

## Tool Output Schemas

### MCP Tool Response Schema
```json
{
 "$schema": "http://json-schema.org/draft-07/schema#",
 "type": "object",
 "properties": {
 "content": {
 "type": "array",
 "items": {
 "$ref": "#/definitions/ContentItem"
 },
 "minItems": 1
 },
 "isError": {
 "type": "boolean",
 "default": false
 },
 "_meta": {
 "$ref": "#/definitions/MetaData"
 }
 },
 "required": ["content", "_meta"],
 "additionalProperties": false,
 "definitions": {
 "ContentItem": {
 "type": "object",
 "properties": {
 "type": {
 "type": "string",
 "enum": ["text", "image", "resource"]
 },
 "text": {
 "type": "string"
 },
 "data": {
 "type": "string"
 },
 "mimeType": {
 "type": "string"
 }
 },
 "required": ["type"],
 "additionalProperties": false,
 "allOf": [
 {
 "if": { "properties": { "type": { "const": "text" } } },
 "then": { "required": ["text"] }
 },
 {
 "if": { "properties": { "type": { "const": "image" } } },
 "then": { "required": ["data", "mimeType"] }
 }
 ]
 },
 "MetaData": {
 "type": "object",
 "properties": {
 "progressToken": {
 "oneOf": [
 { "type": "string" },
 { "type": "null" }
 ]
 }
 },
 "required": ["progressToken"],
 "additionalProperties": false
 }
 }
}
```

### Query Result Data Schema
```json
{
 "$schema": "http://json-schema.org/draft-07/schema#",
 "type": "object",
 "properties": {
 "rows": {
 "type": "array",
 "items": {
 "type": "object",
 "additionalProperties": true
 }
 },
 "fields": {
 "type": "array", 
 "items": {
 "type": "string"
 }
 },
 "rowCount": {
 "type": "number",
 "minimum": 0
 },
 "executionTime": {
 "type": "number",
 "minimum": 0,
 "description": "Execution time in milliseconds"
 },
 "truncated": {
 "type": "boolean",
 "default": false,
 "description": "Whether results were truncated due to limits"
 }
 },
 "required": ["rows", "fields", "rowCount"],
 "additionalProperties": false
}
```

### Batch Query Result Schema
```json
{
 "$schema": "http://json-schema.org/draft-07/schema#",
 "type": "object",
 "properties": {
 "results": {
 "type": "array",
 "items": {
 "$ref": "#/definitions/BatchQueryResult"
 }
 },
 "totalExecutionTime": {
 "type": "number",
 "minimum": 0,
 "description": "Total execution time in milliseconds"
 },
 "successCount": {
 "type": "number",
 "minimum": 0
 },
 "failureCount": {
 "type": "number",
 "minimum": 0
 },
 "transactionUsed": {
 "type": "boolean",
 "default": false
 }
 },
 "required": ["results", "totalExecutionTime", "successCount", "failureCount"],
 "additionalProperties": false,
 "definitions": {
 "BatchQueryResult": {
 "type": "object",
 "properties": {
 "index": {
 "type": "number",
 "minimum": 0
 },
 "label": {
 "type": "string"
 },
 "query": {
 "type": "string"
 },
 "success": {
 "type": "boolean"
 },
 "data": {
 "$ref": "../#/definitions/QueryResultData"
 },
 "error": {
 "type": "string"
 }
 },
 "required": ["index", "success"],
 "additionalProperties": false,
 "allOf": [
 {
 "if": { "properties": { "success": { "const": true } } },
 "then": { "required": ["data"] }
 },
 {
 "if": { "properties": { "success": { "const": false } } },
 "then": { "required": ["error"] }
 }
 ]
 }
 }
}
```

### Performance Analysis Result Schema 
```json
{
 "$schema": "http://json-schema.org/draft-07/schema#",
 "type": "object",
 "properties": {
 "executionTime": {
 "type": "number",
 "minimum": 0,
 "description": "Query execution time in milliseconds"
 },
 "explainTime": {
 "type": "number", 
 "minimum": 0,
 "description": "Explain analysis time in milliseconds"
 },
 "rowCount": {
 "type": "number",
 "minimum": 0,
 "description": "Number of rows returned by the query"
 },
 "columnCount": {
 "type": "number",
 "minimum": 0,
 "description": "Number of columns in the result set"
 },
 "executionPlan": {
 "type": "string",
 "description": "Raw database execution plan output"
 },
 "recommendations": {
 "type": "string",
 "description": "Basic performance optimization recommendations"
 }
 },
 "required": [
 "executionTime", 
 "explainTime", 
 "rowCount", 
 "columnCount", 
 "executionPlan", 
 "recommendations"
 ],
 "additionalProperties": false
}
```

---

## Database Configuration Schemas

### Database Configuration Schema
```json
{
 "$schema": "http://json-schema.org/draft-07/schema#",
 "type": "object",
 "properties": {
 "type": {
 "type": "string",
 "enum": ["postgresql", "mysql", "sqlite", "mssql", "sqlserver"],
 "description": "Database type"
 },
 "host": {
 "type": "string",
 "description": "Database host (not required for SQLite)",
 "minLength": 1,
 "maxLength": 255
 },
 "port": {
 "type": "number",
 "minimum": 1,
 "maximum": 65535,
 "description": "Database port"
 },
 "database": {
 "type": "string",
 "description": "Database name",
 "minLength": 1,
 "maxLength": 255
 },
 "username": {
 "type": "string",
 "description": "Database username",
 "minLength": 1,
 "maxLength": 255
 },
 "password": {
 "type": "string",
 "description": "Database password",
 "maxLength": 1000
 },
 "file": {
 "type": "string",
 "description": "SQLite database file path",
 "maxLength": 1000
 },
 "ssl": {
 "type": "boolean",
 "default": false,
 "description": "Enable SSL/TLS connection"
 },
 "select_only": {
 "type": "boolean", 
 "default": true,
 "description": "Restrict to SELECT-only queries"
 },
 "timeout": {
 "type": "number",
 "minimum": 1000,
 "maximum": 300000,
 "default": 30000,
 "description": "Connection timeout in milliseconds"
 },
 "ssh_host": {
 "type": "string",
 "description": "SSH tunnel host",
 "maxLength": 255
 },
 "ssh_port": {
 "type": "number",
 "minimum": 1,
 "maximum": 65535,
 "default": 22,
 "description": "SSH port"
 },
 "ssh_username": {
 "type": "string",
 "description": "SSH username",
 "maxLength": 255
 },
 "ssh_password": {
 "type": "string",
 "description": "SSH password",
 "maxLength": 1000
 },
 "ssh_private_key": {
 "type": "string",
 "description": "Path to SSH private key",
 "maxLength": 1000
 },
 "ssh_passphrase": {
 "type": "string",
 "description": "SSH private key passphrase",
 "maxLength": 1000
 }
 },
 "required": ["type", "select_only"],
 "additionalProperties": false,
 "allOf": [
 {
 "if": {
 "properties": {
 "type": { "const": "sqlite" }
 }
 },
 "then": {
 "required": ["file"],
 "not": {
 "anyOf": [
 { "required": ["host"] },
 { "required": ["port"] },
 { "required": ["username"] },
 { "required": ["password"] }
 ]
 }
 },
 "else": {
 "required": ["host", "username"]
 }
 }
 ]
}
```

### Server Configuration Schema
```json
{
 "$schema": "http://json-schema.org/draft-07/schema#",
 "type": "object",
 "properties": {
 "databases": {
 "type": "object",
 "patternProperties": {
 "^[a-zA-Z][a-zA-Z0-9_-]*$": {
 "$ref": "#/definitions/DatabaseConfig"
 }
 },
 "minProperties": 1,
 "additionalProperties": false
 },
 "security": {
 "$ref": "#/definitions/SecurityConfig"
 },
 "extension": {
 "$ref": "#/definitions/ExtensionConfig"
 }
 },
 "required": ["databases"],
 "additionalProperties": false,
 "definitions": {
 "DatabaseConfig": {
 "$ref": "./database-config.json"
 },
 "SecurityConfig": {
 "type": "object",
 "properties": {
 "max_joins": {
 "type": "number",
 "minimum": 1,
 "maximum": 100,
 "default": 10
 },
 "max_subqueries": {
 "type": "number",
 "minimum": 1,
 "maximum": 50,
 "default": 5
 },
 "max_unions": {
 "type": "number",
 "minimum": 1,
 "maximum": 20,
 "default": 3
 },
 "max_group_bys": {
 "type": "number",
 "minimum": 1,
 "maximum": 50,
 "default": 5
 },
 "max_complexity_score": {
 "type": "number",
 "minimum": 10,
 "maximum": 1000,
 "default": 100
 },
 "max_query_length": {
 "type": "number",
 "minimum": 100,
 "maximum": 100000,
 "default": 10000
 }
 },
 "additionalProperties": false
 },
 "ExtensionConfig": {
 "type": "object",
 "properties": {
 "max_rows": {
 "type": "number",
 "minimum": 1,
 "maximum": 100000,
 "default": 1000
 },
 "max_batch_size": {
 "type": "number",
 "minimum": 1,
 "maximum": 100,
 "default": 10
 },
 "query_timeout": {
 "type": "number",
 "minimum": 1000,
 "maximum": 600000,
 "default": 30000
 }
 },
 "additionalProperties": false
 }
 }
}
```

---

## Error Response Schemas

### MCP Error Schema
```json
{
 "$schema": "http://json-schema.org/draft-07/schema#",
 "type": "object",
 "properties": {
 "code": {
 "type": "number",
 "description": "Numeric error code"
 },
 "message": {
 "type": "string",
 "description": "Human-readable error message"
 },
 "data": {
 "type": "object",
 "description": "Additional error context",
 "properties": {
 "database": {
 "type": "string"
 },
 "query": {
 "type": "string"
 },
 "host": {
 "type": "string"
 },
 "originalError": {
 "type": "string"
 },
 "details": {
 "type": "object",
 "additionalProperties": true
 }
 },
 "additionalProperties": true
 }
 },
 "required": ["code", "message"],
 "additionalProperties": false
}
```

### Security Violation Error Schema
```json
{
 "$schema": "http://json-schema.org/draft-07/schema#",
 "type": "object",
 "properties": {
 "code": {
 "type": "number",
 "minimum": 4000,
 "maximum": 4999
 },
 "message": {
 "type": "string"
 },
 "data": {
 "type": "object",
 "properties": {
 "database": {
 "type": "string"
 },
 "query": {
 "type": "string"
 },
 "reason": {
 "type": "string"
 },
 "blockedOperation": {
 "type": "string"
 },
 "securityMode": {
 "type": "string",
 "enum": ["select_only", "full_access"]
 }
 },
 "required": ["database", "reason"],
 "additionalProperties": false
 }
 },
 "required": ["code", "message", "data"],
 "additionalProperties": false
}
```

---

## Internal Type Schemas

### Database Schema Definition
```json
{
 "$schema": "http://json-schema.org/draft-07/schema#",
 "type": "object",
 "properties": {
 "tables": {
 "type": "object",
 "patternProperties": {
 "^[a-zA-Z_][a-zA-Z0-9_]*$": {
 "$ref": "#/definitions/TableDefinition"
 }
 }
 },
 "views": {
 "type": "object",
 "patternProperties": {
 "^[a-zA-Z_][a-zA-Z0-9_]*$": {
 "$ref": "#/definitions/ViewDefinition"
 }
 }
 },
 "summary": {
 "$ref": "#/definitions/SchemaSummary"
 }
 },
 "required": ["tables", "views", "summary"],
 "additionalProperties": false,
 "definitions": {
 "TableDefinition": {
 "type": "object",
 "properties": {
 "columns": {
 "type": "object",
 "patternProperties": {
 "^[a-zA-Z_][a-zA-Z0-9_]*$": {
 "$ref": "#/definitions/ColumnDefinition"
 }
 }
 },
 "primaryKey": {
 "type": "array",
 "items": {
 "type": "string"
 }
 },
 "foreignKeys": {
 "type": "array",
 "items": {
 "$ref": "#/definitions/ForeignKeyDefinition"
 }
 },
 "indexes": {
 "type": "array",
 "items": {
 "$ref": "#/definitions/IndexDefinition"
 }
 }
 },
 "required": ["columns"],
 "additionalProperties": false
 },
 "ViewDefinition": {
 "type": "object",
 "properties": {
 "columns": {
 "type": "object",
 "patternProperties": {
 "^[a-zA-Z_][a-zA-Z0-9_]*$": {
 "$ref": "#/definitions/ColumnDefinition"
 }
 }
 },
 "definition": {
 "type": "string"
 }
 },
 "required": ["columns"],
 "additionalProperties": false
 },
 "ColumnDefinition": {
 "type": "object",
 "properties": {
 "type": {
 "type": "string"
 },
 "nullable": {
 "type": "boolean"
 },
 "default": {
 "type": ["string", "number", "boolean", "null"]
 },
 "maxLength": {
 "type": "number"
 },
 "precision": {
 "type": "number"
 },
 "scale": {
 "type": "number"
 },
 "autoIncrement": {
 "type": "boolean"
 },
 "unique": {
 "type": "boolean"
 }
 },
 "required": ["type", "nullable"],
 "additionalProperties": false
 },
 "ForeignKeyDefinition": {
 "type": "object",
 "properties": {
 "column": {
 "type": "string"
 },
 "referencedTable": {
 "type": "string"
 },
 "referencedColumn": {
 "type": "string"
 },
 "onDelete": {
 "type": "string",
 "enum": ["CASCADE", "SET NULL", "RESTRICT", "NO ACTION"]
 },
 "onUpdate": {
 "type": "string",
 "enum": ["CASCADE", "SET NULL", "RESTRICT", "NO ACTION"]
 }
 },
 "required": ["column", "referencedTable", "referencedColumn"],
 "additionalProperties": false
 },
 "IndexDefinition": {
 "type": "object",
 "properties": {
 "name": {
 "type": "string"
 },
 "columns": {
 "type": "array",
 "items": {
 "type": "string"
 },
 "minItems": 1
 },
 "unique": {
 "type": "boolean"
 },
 "type": {
 "type": "string",
 "enum": ["BTREE", "HASH", "GIN", "GIST", "FULLTEXT"]
 }
 },
 "required": ["name", "columns"],
 "additionalProperties": false
 },
 "SchemaSummary": {
 "type": "object",
 "properties": {
 "table_count": {
 "type": "number",
 "minimum": 0
 },
 "view_count": {
 "type": "number",
 "minimum": 0
 },
 "total_columns": {
 "type": "number",
 "minimum": 0
 },
 "foreign_key_count": {
 "type": "number",
 "minimum": 0
 },
 "index_count": {
 "type": "number",
 "minimum": 0
 }
 },
 "required": [
 "table_count",
 "view_count", 
 "total_columns"
 ],
 "additionalProperties": false
 }
 }
}
```

---

## Schema Usage Examples

### Validating Tool Input
```javascript
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

// Load schema
const sqlQuerySchema = {
 // ... schema definition from above
};

const validate = ajv.compile(sqlQuerySchema);

// Validate input
const input = {
 database: "production",
 query: "SELECT * FROM users LIMIT 10"
};

const isValid = validate(input);
if (!isValid) {
 console.log('Validation errors:', validate.errors);
}
```

### TypeScript Type Generation
```bash
# Generate TypeScript types from JSON schemas
npm install -g json-schema-to-typescript
json2ts -i schemas/ -o types/
```

### Schema Validation in Tests
```typescript
import { validate } from 'jsonschema';
import { mcpRequestSchema } from './schemas';

describe('MCP Request Validation', () => {
 it('should validate correct MCP request', () => {
 const request = {
 jsonrpc: '2.0',
 id: 1,
 method: 'tools/call',
 params: {
 name: 'sql_query',
 arguments: {
 database: 'test',
 query: 'SELECT 1'
 }
 }
 };

 const result = validate(request, mcpRequestSchema);
 expect(result.valid).toBe(true);
 });
});
```

This comprehensive JSON schema reference ensures consistent data structures and enables robust validation throughout the Argos ecosystem.
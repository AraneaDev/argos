/**
 * MCP Protocol Types for SQL Database Server
 * Based on MCP Protocol 2025-06-18
 */

import type { SchemaChange } from '../schema/diff.js';

// ============================================================================
// MCP Core Protocol Types
// ============================================================================

export interface MCPMessage {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: MCPError;
}

export interface MCPError {
  code: number;
  message: string;
  data?: unknown;
}

export interface MCPRequest extends MCPMessage {
  id: string | number;
  method: string;
  params?: unknown;
}

// ============================================================================
// MCP Capabilities and Server Info
// ============================================================================

// ============================================================================
// MCP Tool Types
// ============================================================================

export interface MCPToolCallParams {
  name: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolContent {
  type: 'text';
  text: string;
}

export interface MCPToolResponse {
  content: MCPToolContent[];
  isError?: boolean;
  _meta: {
    progressToken: null;
    argos?: {
      journalId: string | null;
      spool: string | null;
      schemaChange?: SchemaChange[];
    };
  };
}

// ============================================================================
// SQL-specific MCP Tool Argument Types
// ============================================================================

export interface SQLQueryArgs {
  database: string;
  query: string;
  params?: string[];
}

export interface SQLBatchQueryArgs {
  database: string;
  queries: Array<{
    query: string;
    params?: string[];
    label?: string;
  }>;
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

// Type alias for list_databases (no arguments required)
// ============================================================================
// MCP Tool Validation Types
// ============================================================================

// ============================================================================
// MCP Message Handlers Type
// ============================================================================

// ============================================================================
// Type Guards for MCP Messages
// ============================================================================

// ============================================================================
// Tool-specific Type Guards
// ============================================================================

/**
 *
 */
export function isSQLQueryArgs(args: unknown): args is SQLQueryArgs {
  return (
    typeof args === 'object' &&
    args !== null &&
    'database' in args &&
    'query' in args &&
    typeof (args as SQLQueryArgs).database === 'string' &&
    typeof (args as SQLQueryArgs).query === 'string'
  );
}

/**
 *
 */
export function isSQLBatchQueryArgs(args: unknown): args is SQLBatchQueryArgs {
  return (
    typeof args === 'object' &&
    args !== null &&
    'database' in args &&
    'queries' in args &&
    typeof (args as SQLBatchQueryArgs).database === 'string' &&
    Array.isArray((args as SQLBatchQueryArgs).queries)
  );
}

/**
 *
 */
export function isSQLGetSchemaArgs(args: unknown): args is SQLGetSchemaArgs {
  return (
    typeof args === 'object' &&
    args !== null &&
    'database' in args &&
    typeof (args as SQLGetSchemaArgs).database === 'string'
  );
}

/**
 *
 */
export function isSQLTestConnectionArgs(args: unknown): args is SQLTestConnectionArgs {
  return (
    typeof args === 'object' &&
    args !== null &&
    'database' in args &&
    typeof (args as SQLTestConnectionArgs).database === 'string'
  );
}

/**
 * Core type definitions for Argos
 */

import type { Client as PgClient, PoolClient as PgPoolClient } from 'pg';
import { SecurityViolationError } from '../utils/error-handler.js';
import type {
  Connection as MySQLConnection,
  PoolConnection as MySQLPoolConnection,
} from 'mysql2/promise';
import type { Database as SQLiteConnection } from 'sqlite3';
import type { ConnectionPool as MSSQLConnection } from 'mssql';

// ============================================================================
// Database Types
// ============================================================================

// Database type enum - exported for external use
// Note: Some values kept for backward compatibility but may be unused internally
/* eslint-disable no-unused-vars */
export enum DatabaseType {
  // Commonly used values
  MYSQL = 'mysql',
  POSTGRESQL = 'postgresql',
  POSTGRES = 'postgres',
  SQLITE = 'sqlite',
  MSSQL = 'mssql',
  SQLSERVER = 'sqlserver',
}
/* eslint-enable no-unused-vars */

// For backward compatibility, also export as type
export type DatabaseTypeString =
  | 'mysql'
  | 'postgresql'
  | 'postgres'
  | 'sqlite'
  | 'mssql'
  | 'sqlserver';

/**
 * Authentication modes supported by the SQL Server adapter.
 */
export const MSSQL_AUTHENTICATION_MODES = ['sql', 'azure-cli'] as const;

export type MSSQLAuthenticationMode = (typeof MSSQL_AUTHENTICATION_MODES)[number];

export interface DatabaseConfig {
  type: DatabaseTypeString;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  ssl?: boolean;
  ssl_verify?: boolean; // Verify SSL certificates (default: true)
  select_only?: boolean;
  // Ask the database itself to refuse writes for the whole session (PostgreSQL and
  // MySQL only). Never read from config.ini: the pane CLI sets it on its own copy of
  // each connection so the MCP server's behaviour is unchanged.
  read_only_session?: boolean;
  timeout?: number;
  file?: string; // For SQLite
  encrypt?: boolean; // For MSSQL

  // Authentication mode. Only meaningful for MSSQL; omitted means SQL
  // authentication with username/password. 'azure-cli' delegates to the
  // signed-in Azure CLI, so no credentials live in config.ini.
  authentication?: MSSQLAuthenticationMode;

  // Tenant to acquire the Azure CLI token from. Only meaningful alongside
  // authentication='azure-cli'. Needed when the CLI's active context is a
  // different tenant from the one the server lives in, which is the normal
  // case for an account with access to several.
  azure_tenant_id?: string;

  // SSH Tunnel Configuration
  ssh_host?: string;
  ssh_port?: number;
  ssh_username?: string;
  ssh_password?: string;
  ssh_private_key?: string;
  ssh_passphrase?: string;
  local_port?: number;
  ssh_local_host?: string; // SSH tunnel bind address (default: '127.0.0.1')
  ssh_host_fingerprint?: string; // Expected SSH host key fingerprint (SHA256:base64, base64, or hex)
  ssh_strict_host_key_checking?: boolean; // Reject unknown/unpinned host keys (default: true)

  // Field Redaction Configuration
  redaction?: DatabaseRedactionConfig;

  // MCP Configuration Access Control
  mcp_configurable?: boolean; // Whether this database can be modified via MCP tools

  // Caching and Auditing
  cache_ttl_seconds?: number;
  audit_log?: boolean;

  // Query execution
  query_timeout?: number; // Per-query timeout in ms (default: 30000)
  max_rows?: number; // Max rows returned per query (default: 1000)
}

export type DatabaseConnection =
  | PgClient
  | PgPoolClient
  | MySQLConnection
  | MySQLPoolConnection
  | SQLiteConnection
  | MSSQLConnection;

export interface ConnectionInfo {
  connection: DatabaseConnection;
  type: DatabaseTypeString;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  fields: string[];
  truncated: boolean;
  execution_time_ms: number;
}

// ============================================================================
// Schema Types
// ============================================================================

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

export interface ForeignKey {
  column: string;
  references: { table: string; column: string };
}

export interface TableInfo {
  name: string;
  type: string;
  comment?: string;
  columns: ColumnInfo[];
  primary_key?: string[];
  foreign_keys?: ForeignKey[];
  row_estimate?: number | null;
}

export interface DatabaseSchema {
  database: string;
  type: DatabaseTypeString;
  captured_at: string;
  fingerprint?: string;
  tables: Record<string, TableInfo>;
  views: Record<string, TableInfo>;
  summary: {
    table_count: number;
    view_count: number;
    total_columns: number;
  };
}

export interface SchemaInfo {
  table_count: number;
  view_count: number;
  function_count: number;
  sequence_count: number;
  total_columns: number;
  total_indexes: number;
  foreign_key_count: number;
}

// ============================================================================
// SSH Tunnel Types
// ============================================================================

// ============================================================================
// Query and Batch Types
// ============================================================================

export interface QueryObject {
  query: string;
  params?: unknown[];
  label?: string;
}

export interface BatchResultItem {
  index: number;
  label: string;
  success: boolean;
  data?: QueryResult;
  error?: string;
  query: string;
  execution_time_ms?: number;
}

export interface BatchResult {
  results: BatchResultItem[];
  successCount: number;
  failureCount: number;
  totalExecutionTime: number;
  transactionUsed: boolean;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface SecurityConfig {
  max_joins: number;
  max_subqueries: number;
  max_unions: number;
  max_group_bys: number;
  max_complexity_score: number;
  max_query_length: number;
}

export interface ExtensionConfig {
  max_rows: number;
  max_batch_size: number;
  query_timeout: number;
  debug?: boolean;
}

// ============================================================================
// Error Types
// ============================================================================

// Error classes are defined in ../utils/error-handler.ts and re-exported via types/index.ts

// ============================================================================
// Utility Types
// ============================================================================

export interface DatabaseListItem {
  name: string;
  type: DatabaseTypeString;
  host?: string;
  database?: string;
  ssh_enabled: boolean;
  ssl_enabled: boolean;
  select_only_mode: boolean;
  mcp_configurable: boolean;
  schema_cached: boolean;
  schema_info?: {
    table_count: number;
    view_count: number;
    total_columns: number;
  };
}

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

// ============================================================================
// Field Redaction Types
// ============================================================================

/**
 * Pattern matching types for field redaction
 */
export type FieldPatternType = 'exact' | 'wildcard' | 'regex';

/**
 * Available redaction strategies
 */
export type RedactionType = 'full_mask' | 'partial_mask' | 'replace' | 'custom';

/**
 * Configuration for a single field redaction rule
 */
export interface FieldRedactionRule {
  field_pattern: string; // Field name or pattern to match
  pattern_type: FieldPatternType; // How to interpret the pattern
  redaction_type: RedactionType; // Type of redaction to apply
  replacement_text?: string; // For 'replace' type redaction
  mask_character?: string; // Character to use for masking (default: '*')
  preserve_format?: boolean; // Keep original structure (e.g., email format)
  custom_pattern?: string; // For advanced redaction patterns
  description?: string; // Human-readable description of the rule
}

/**
 * Database-level redaction configuration
 */
export interface DatabaseRedactionConfig {
  enabled: boolean; // Whether redaction is enabled
  rules: FieldRedactionRule[]; // List of redaction rules
  default_redaction?: Omit<FieldRedactionRule, 'field_pattern' | 'pattern_type'>; // Default redaction for unmatched sensitive fields
  log_redacted_access?: boolean; // Log when redacted fields are accessed
  audit_redacted_queries?: boolean; // Keep audit trail of queries accessing redacted data
  case_sensitive_matching?: boolean; // Whether field matching is case sensitive (default: false)
}

/**
 * Result of applying redaction to query results
 */
export interface RedactionResult {
  fields_redacted: string[]; // List of fields that were redacted
  redaction_count: number; // Total number of values redacted
  rules_applied: string[]; // List of rule patterns that were applied
  warnings?: string[]; // Any warnings during redaction
}

/**
 * Extended QueryResult with redaction information
 */
export interface QueryResultWithRedaction extends QueryResult {
  redaction?: RedactionResult; // Information about applied redaction
}

/**
 * Audit log entry for redacted field access
 */
export interface RedactionAuditEntry {
  timestamp: string; // When the redaction occurred
  database: string; // Database name
  query_hash: string; // Hash of the query
  fields_redacted: string[]; // Fields that were redacted
  rules_applied: string[]; // Rules that were applied
  redaction_count: number; // Number of values redacted
  user_context?: string; // User or session context if available
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 *
 */
export function isDatabaseType(value: string): value is DatabaseTypeString {
  return ['mysql', 'postgresql', 'postgres', 'sqlite', 'mssql', 'sqlserver'].includes(value);
}

/**
 *
 */
export function isQueryObject(value: unknown): value is QueryObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    'query' in value &&
    typeof (value as QueryObject).query === 'string'
  );
}

/**
 *
 */
export function isSecurityViolationError(error: unknown): error is SecurityViolationError {
  return error instanceof SecurityViolationError;
}

/**
 *
 */
export function isValidRedactionType(value: string): value is RedactionType {
  return ['full_mask', 'partial_mask', 'replace', 'custom'].includes(value);
}

/**
 *
 */
export function isValidFieldPatternType(value: string): value is FieldPatternType {
  return ['exact', 'wildcard', 'regex'].includes(value);
}

/**
 *
 */
export function isFieldRedactionRule(value: unknown): value is FieldRedactionRule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'field_pattern' in value &&
    'pattern_type' in value &&
    'redaction_type' in value &&
    typeof (value as FieldRedactionRule).field_pattern === 'string' &&
    isValidFieldPatternType((value as FieldRedactionRule).pattern_type) &&
    isValidRedactionType((value as FieldRedactionRule).redaction_type)
  );
}

/**
 *
 */
export function isDatabaseRedactionConfig(value: unknown): value is DatabaseRedactionConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    'enabled' in value &&
    'rules' in value &&
    typeof (value as DatabaseRedactionConfig).enabled === 'boolean' &&
    Array.isArray((value as DatabaseRedactionConfig).rules) &&
    (value as DatabaseRedactionConfig).rules.every(isFieldRedactionRule)
  );
}

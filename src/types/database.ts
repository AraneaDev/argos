/**
 * Core type definitions for Argos
 */

import type { Client as PgClient, PoolClient as PgPoolClient } from 'pg';
import type {
  Connection as MySQLConnection,
  PoolConnection as MySQLPoolConnection,
} from 'mysql2/promise';
import type { Database as SQLiteConnection } from 'sqlite3';
import type { ConnectionPool as MSSQLConnection } from 'mssql';
import type { PrivilegeProbe } from '../database/privileges.js';

// ============================================================================
// Database Types
// ============================================================================

// Database type enum - exported for external use
// Note: Some values kept for backward compatibility but may be unused internally

export enum DatabaseType {
  // Commonly used values
  MYSQL = 'mysql',
  POSTGRESQL = 'postgresql',
  POSTGRES = 'postgres',
  SQLITE = 'sqlite',
  MSSQL = 'mssql',
  SQLSERVER = 'sqlserver',
}

// For backward compatibility, also export as type
export type DatabaseTypeString =
  'mysql' | 'postgresql' | 'postgres' | 'sqlite' | 'mssql' | 'sqlserver';

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
  name_check?: boolean; // Check table/column names against the cached schema before running a query
  // Refuse a select_only connection whose database role can write, or whose
  // privileges could not be checked. Off by default: the check then only warns.
  require_readonly_role?: boolean;
  // Ask the database itself to refuse writes for the whole session (PostgreSQL and
  // MySQL only). Never read from config.ini: the pane CLI sets it on its own copy of
  // each connection so the MCP server's behaviour is unchanged.
  read_only_session?: boolean;
  // The database's own hostname, set by ConnectionManager on the copy of the config it
  // points at an SSH tunnel (host then reads 127.0.0.1). A verified TLS connection checks
  // the certificate against this name instead. Never read from config.ini.
  tls_servername?: string;
  timeout?: number;
  file?: string; // For SQLite
  encrypt?: boolean; // For MSSQL

  // Authentication mode, for MSSQL and PostgreSQL; omitted means username and
  // password. 'azure-cli' takes an Entra access token from the signed-in Azure
  // CLI, so no secret lives in config.ini. On PostgreSQL the username is still
  // needed: it is the Entra principal's name as mapped in the database.
  authentication?: MSSQLAuthenticationMode;

  // Tenant to acquire the Azure CLI token from. Only meaningful alongside
  // authentication='azure-cli'. Needed when the CLI's active context is a
  // different tenant from the one the server lives in, which is the normal
  // case for an account with access to several.
  azure_tenant_id?: string;

  // Azure CLI profile directory to take the token from, as AZURE_CONFIG_DIR, so
  // this database can use its own (reader) identity. Only alongside
  // authentication='azure-cli'; unset, the server's own profile is used.
  azure_config_dir?: string;

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

// ============================================================================
// SSH Tunnel Types
// ============================================================================

// ============================================================================
// Query and Batch Types
// ============================================================================

export interface BatchResultItem {
  index: number;
  label: string;
  success: boolean;
  data?: QueryResult;
  error?: string;
  /** The original thrown value for a failed query (not serialized to clients). */
  cause?: unknown;
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
  /** The last privilege check of a select_only database, if one ran. */
  privileges?: PrivilegeProbe;
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

// ============================================================================
// Type Guards
// ============================================================================

/**
 *
 */
export function isValidRedactionType(value: string): value is RedactionType {
  return ['full_mask', 'partial_mask', 'replace', 'custom'].includes(value);
}

/**
 * Main type exports for Argos
 */

// Database types
export type {
  DatabaseType,
  DatabaseTypeString,
  DatabaseConfig,
  MSSQLAuthenticationMode,
  DatabaseConnection,
  ConnectionInfo,
  QueryResult,
  ColumnInfo,
  TableInfo,
  ForeignKey,
  DatabaseSchema,
  BatchResultItem,
  BatchResult,
  ExtensionConfig,
  DatabaseListItem,
  TestConnectionResult,
  // Field Redaction types
  FieldPatternType,
  RedactionType,
  FieldRedactionRule,
  DatabaseRedactionConfig,
  RedactionResult,
  QueryResultWithRedaction,
} from './database.js';

export { MSSQL_AUTHENTICATION_MODES } from './database.js';

// MCP protocol types
export type {
  MCPMessage,
  MCPError,
  MCPRequest,
  MCPToolContent,
  MCPToolResponse,
  SQLQueryArgs,
  SQLBatchQueryArgs,
  SQLAnalyzePerformanceArgs,
  SQLGetSchemaArgs,
  SQLTestConnectionArgs,
  SQLRefreshSchemaArgs,
} from './mcp.js';

// Security types
export type {
  SecurityValidation,
  ComplexityRiskLevel,
  QueryComplexityAnalysis,
  ComplexityLimits,
  TokenType,
  SQLToken,
  LogSeverity,
  SecurityConfig,
  SecurityManagerConfig,
  ISecurityManager,
} from './security.js';

// SSH types
export type {
  SSHConnectionConfig,
  SSHForwardConfig,
  SSHTunnelInfo,
  SSHTunnelCreateOptions,
  ISSHTunnelManager,
  SSHConnectionEvent,
  SSHEventPayload,
  SSHTunnelStatus,
  SSHTunnelStatusInfo,
  SSHTunnelValidationResult,
} from './ssh.js';

// Configuration types
export type { ParsedServerConfig, ParsedSecurityConfig, ParsedExtensionConfig } from './config.js';

// Performance types

// Enhanced Schema types

// Error classes (single source of truth in error-handler.ts)
export {
  SQLMCPError,
  SecurityViolationError,
  ConnectionError,
  ConfigurationError,
  CircuitOpenError,
  ValidationError,
} from '../utils/error-handler.js';

// Type guards
export { isValidRedactionType } from './database.js';

export {
  isSQLQueryArgs,
  isSQLBatchQueryArgs,
  isSQLGetSchemaArgs,
  isSQLTestConnectionArgs,
} from './mcp.js';

export { validateSSHConfig } from './ssh.js';

export {} from './performance.js';

// Constants
export {
  DEFAULT_SECURITY_CONFIG,
  DEFAULT_EXTENSION_CONFIG,
  DEFAULT_DATABASE_PORTS,
  DEFAULT_CONNECTION_TIMEOUT,
  DEFAULT_SSH_PORT,
} from './config.js';

// ============================================================================
// Version Information
// ============================================================================

export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const SERVER_VERSION = '5.0.0'; // x-release-please-version
export const SERVER_NAME = 'argos';

// ============================================================================
// Common Enums (as const assertions for better type safety)
// ============================================================================

export const DATABASE_TYPES = [
  'mysql',
  'postgresql',
  'postgres',
  'sqlite',
  'mssql',
  'sqlserver',
] as const;
export const COMPLEXITY_RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const TOKEN_TYPES = ['KEYWORD', 'IDENTIFIER', 'STRING', 'OPERATOR', 'UNKNOWN'] as const;
export const LOG_SEVERITIES = ['INFO', 'WARNING', 'ERROR', 'CRITICAL'] as const;
export const SSH_AUTH_METHODS = ['password', 'privateKey', 'agent'] as const;
export const SSH_TUNNEL_STATUSES = [
  'connecting',
  'connected',
  'error',
  'disconnected',
  'reconnecting',
] as const;

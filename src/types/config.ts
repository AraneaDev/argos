/**
 * Configuration-related types and validation
 */

import type {
  SecurityConfig,
  ExtensionConfig,
  DatabaseTypeString,
  DatabaseConfig,
} from './database.js';

// Re-export types that should be available from config module
export type {
  DatabaseType,
  DatabaseTypeString,
  SecurityConfig,
  ExtensionConfig,
  DatabaseConfig,
  DatabaseRedactionConfig,
  FieldRedactionRule,
} from './database.js';

// ============================================================================
// Setup and Wizard Types (for setup module)
// ============================================================================

export interface SetupConfig {
  security?: SecurityConfig;
  extension?: ExtensionConfig;
  [key: string]: unknown; // This allows database.* keys
}

export interface GeneratedConfigFile {
  content: string;
  filepath?: string;
  databases?: string[];
  metadata: {
    version: string;
    generated: Date;
    description: string;
    database_count: number;
    security_enabled: boolean;
    ssh_enabled: boolean;
    generated_at: string;
  };
}

export interface SetupWizardAction {
  action:
    | 'save_and_test'
    | 'test_only'
    | 'add_database'
    | 'edit_database'
    | 'remove_database'
    | 'configure_security'
    | 'configure_extension'
    | 'save_config'
    | 'test_connections'
    | 'exit';
  databases: string[];
}

// ============================================================================
// Configuration File Types
// ============================================================================

// ============================================================================
// Parsed Configuration Types
// ============================================================================

export interface ParsedSecurityConfig {
  max_joins: number;
  max_subqueries: number;
  max_unions: number;
  max_group_bys: number;
  max_complexity_score: number;
  max_query_length: number;
}

export interface ParsedExtensionConfig {
  max_rows: number;
  max_batch_size: number;
  query_timeout: number;
}

export interface ParsedServerConfig {
  databases: Record<string, DatabaseConfig>;
  security?: ParsedSecurityConfig;
  extension?: ParsedExtensionConfig;
}

// ============================================================================
// Configuration Validation Types
// ============================================================================

// ============================================================================
// Configuration Loading Interface
// ============================================================================

// ============================================================================
// Configuration Defaults
// ============================================================================

export const DEFAULT_SECURITY_CONFIG: Required<SecurityConfig> = {
  max_joins: 10,
  max_subqueries: 5,
  max_unions: 3,
  max_group_bys: 5,
  max_complexity_score: 100,
  max_query_length: 10000,
};

export const DEFAULT_EXTENSION_CONFIG: Required<ExtensionConfig> = {
  max_rows: 1000,
  max_batch_size: 10,
  query_timeout: 30000,
  debug: false,
};

export const DEFAULT_DATABASE_PORTS: Record<DatabaseTypeString, number> = {
  mysql: 3306,
  postgresql: 5432,
  postgres: 5432,
  sqlite: 0, // Not applicable
  mssql: 1433,
  sqlserver: 1433,
};

export const DEFAULT_CONNECTION_TIMEOUT = 30000;
export const DEFAULT_SSH_PORT = 22;

// ============================================================================
// Configuration Utilities
// ============================================================================

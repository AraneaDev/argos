/**
 * Shared types for tool handlers
 */

import type { ConnectionManager } from '../../classes/ConnectionManager.js';
import type { SecurityManager } from '../../classes/SecurityManager.js';
import type { SchemaManager } from '../../classes/SchemaManager.js';
import type { PaneStore } from '../../pane/store.js';
import type { SchemaWatch } from '../../schema/watch.js';
import type { EnhancedSSHTunnelManager } from '../../classes/EnhancedSSHTunnelManager.js';
import type { MetricsManager } from '../../classes/MetricsManager.js';
import type { ParsedServerConfig, DatabaseConfig } from '../../types/index.js';
import type { Logger } from '../../utils/logger.js';
import { ConfigurationError } from '../../utils/error-handler.js';

export interface ToolHandlerContext {
  connectionManager: ConnectionManager;
  securityManager: SecurityManager;
  schemaManager: SchemaManager;
  schemaWatch: SchemaWatch;
  paneStore: PaneStore | null;
  sshTunnelManager: EnhancedSSHTunnelManager;
  metricsManager: MetricsManager;
  config: ParsedServerConfig;
  configPath: string;
  logger: Logger;
}

/**
 * Get database config or throw a typed error
 */
export function requireDbConfig(config: ParsedServerConfig, database: string): DatabaseConfig {
  const dbConfig = config.databases[database];
  if (!dbConfig) {
    throw new ConfigurationError(`Database configuration '${database}' not found`);
  }
  return dbConfig;
}

/**
 * Database Adapter Factory
 */

import type { DatabaseConfig, DatabaseTypeString } from '../../types/index.js';
import { needsUsername, usesAzureCliAuth } from '../../utils/config.js';
import type { DatabaseAdapter } from './base.js';
import { MySQLAdapter } from './mysql.js';
import { PostgreSQLAdapter } from './postgresql.js';
import { SQLiteAdapter } from './sqlite.js';
import { MSSQLAdapter } from './mssql.js';

// ============================================================================
// Adapter Factory
// ============================================================================

/**
 *
 */
export class AdapterFactory {
  /**
   * Create a database adapter instance based on the database type
   */
  static createAdapter(config: DatabaseConfig): DatabaseAdapter {
    const type = config.type.toLowerCase() as DatabaseTypeString;

    switch (type) {
      case 'mysql':
        return new MySQLAdapter(config);

      case 'postgresql':
      case 'postgres':
        return new PostgreSQLAdapter(config);

      case 'sqlite':
        return new SQLiteAdapter(config);

      case 'mssql':
      case 'sqlserver':
        return new MSSQLAdapter(config);

      default:
        throw new Error(`Unsupported database type: ${config.type}`);
    }
  }

  /**
   * Get list of supported database types
   */
  static getSupportedTypes(): DatabaseTypeString[] {
    return ['mysql', 'postgresql', 'postgres', 'sqlite', 'mssql', 'sqlserver'];
  }

  /**
   * Check if a database type is supported
   */
  static isSupported(type: string): boolean {
    return this.getSupportedTypes().includes(type.toLowerCase() as DatabaseTypeString);
  }

  /**
   * Get required configuration fields for a database type
   */
  static getRequiredFields(type: DatabaseTypeString, config?: DatabaseConfig): string[] {
    switch (type.toLowerCase() as DatabaseTypeString) {
      case 'sqlite':
        return ['file'];
      case 'mysql':
      case 'postgresql':
      case 'postgres':
      case 'mssql':
      case 'sqlserver':
        // An mssql database authenticating through the Azure CLI has no username
        // or password to give: the credential comes from the CLI's own context.
        // MSSQLAdapter already narrows its required fields the same way, and the
        // config loader exempts the pair too. Without this branch a valid
        // azure-cli database parses and loads but is rejected here, before the
        // adapter that knows how to connect it is ever built.
        // PostgreSQL still needs the username: the Entra principal's name.
        if (config && usesAzureCliAuth(config)) {
          return needsUsername(config) ? ['host', 'database', 'username'] : ['host', 'database'];
        }
        return ['host', 'database', 'username', 'password'];
      default:
        return [];
    }
  }

  /**
   * Validate database configuration
   */
  static validateConfig(config: DatabaseConfig): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.type) {
      errors.push('Database type is required');
      return { isValid: false, errors };
    }

    if (!this.isSupported(config.type)) {
      errors.push(`Unsupported database type: ${config.type}`);
      return { isValid: false, errors };
    }

    const requiredFields = this.getRequiredFields(config.type as DatabaseTypeString, config);

    for (const field of requiredFields) {
      const value = config[field as keyof DatabaseConfig];
      if (typeof value !== 'string' || value.trim() === '') {
        errors.push(`Required field '${field}' is missing or empty`);
      }
    }

    // Validate SSH configuration if present
    if (config.ssh_host) {
      if (!config.ssh_username) {
        errors.push('SSH username is required when SSH host is specified');
      }
      if (!config.ssh_password && !config.ssh_private_key) {
        errors.push('Either SSH password or private key is required');
      }
    }

    return { isValid: errors.length === 0, errors };
  }
}

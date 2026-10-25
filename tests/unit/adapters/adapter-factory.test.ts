/**
 * Adapter Factory Tests
 * Tests the AdapterFactory class from database/adapters/index.ts
 */

import { AdapterFactory } from '../../../src/database/adapters/index.js';
import { MySQLAdapter } from '../../../src/database/adapters/mysql.js';
import { PostgreSQLAdapter } from '../../../src/database/adapters/postgresql.js';
import { SQLiteAdapter } from '../../../src/database/adapters/sqlite.js';
import { MSSQLAdapter } from '../../../src/database/adapters/mssql.js';
import type { DatabaseConfig, DatabaseTypeString } from '../../../src/types/index.js';

// ============================================================================
// Test Suite
// ============================================================================

describe('AdapterFactory', () => {
  // ============================================================================
  // createAdapter (lines 22-40)
  // ============================================================================

  describe('createAdapter', () => {
    it('should create a MySQLAdapter for mysql type', () => {
      const config: DatabaseConfig = {
        type: 'mysql',
        host: 'localhost',
        database: 'testdb',
        username: 'user',
        password: 'pass',
      };
      const adapter = AdapterFactory.createAdapter(config);
      expect(adapter).toBeInstanceOf(MySQLAdapter);
    });

    it('should create a PostgreSQLAdapter for postgresql type', () => {
      const config: DatabaseConfig = {
        type: 'postgresql',
        host: 'localhost',
        database: 'testdb',
        username: 'user',
        password: 'pass',
      };
      const adapter = AdapterFactory.createAdapter(config);
      expect(adapter).toBeInstanceOf(PostgreSQLAdapter);
    });

    it('should create a PostgreSQLAdapter for postgres type', () => {
      const config: DatabaseConfig = {
        type: 'postgres',
        host: 'localhost',
        database: 'testdb',
        username: 'user',
        password: 'pass',
      };
      const adapter = AdapterFactory.createAdapter(config);
      expect(adapter).toBeInstanceOf(PostgreSQLAdapter);
    });

    it('should create a SQLiteAdapter for sqlite type', () => {
      const config: DatabaseConfig = {
        type: 'sqlite',
        file: '/tmp/test.db',
      };
      const adapter = AdapterFactory.createAdapter(config);
      expect(adapter).toBeInstanceOf(SQLiteAdapter);
    });

    it('should create a MSSQLAdapter for mssql type', () => {
      const config: DatabaseConfig = {
        type: 'mssql',
        host: 'localhost',
        database: 'testdb',
        username: 'user',
        password: 'pass',
      };
      const adapter = AdapterFactory.createAdapter(config);
      expect(adapter).toBeInstanceOf(MSSQLAdapter);
    });

    it('should create a MSSQLAdapter for sqlserver type', () => {
      const config: DatabaseConfig = {
        type: 'sqlserver' as DatabaseTypeString,
        host: 'localhost',
        database: 'testdb',
        username: 'user',
        password: 'pass',
      };
      const adapter = AdapterFactory.createAdapter(config);
      expect(adapter).toBeInstanceOf(MSSQLAdapter);
    });

    it('should handle case-insensitive type matching', () => {
      const config: DatabaseConfig = {
        type: 'MySQL' as DatabaseTypeString,
        host: 'localhost',
        database: 'testdb',
        username: 'user',
        password: 'pass',
      };
      const adapter = AdapterFactory.createAdapter(config);
      expect(adapter).toBeInstanceOf(MySQLAdapter);
    });

    it('should throw error for unsupported database type', () => {
      const config: DatabaseConfig = {
        type: 'oracle' as DatabaseTypeString,
        host: 'localhost',
        database: 'testdb',
      };
      expect(() => AdapterFactory.createAdapter(config)).toThrow(
        'Unsupported database type: oracle'
      );
    });
  });

  // ============================================================================
  // getSupportedTypes
  // ============================================================================

  describe('getSupportedTypes', () => {
    it('should return all supported database types', () => {
      const types = AdapterFactory.getSupportedTypes();
      expect(types).toContain('mysql');
      expect(types).toContain('postgresql');
      expect(types).toContain('postgres');
      expect(types).toContain('sqlite');
      expect(types).toContain('mssql');
      expect(types).toContain('sqlserver');
      expect(types).toHaveLength(6);
    });
  });

  // ============================================================================
  // isSupported
  // ============================================================================

  describe('isSupported', () => {
    it('should return true for supported types', () => {
      expect(AdapterFactory.isSupported('mysql')).toBe(true);
      expect(AdapterFactory.isSupported('postgresql')).toBe(true);
      expect(AdapterFactory.isSupported('sqlite')).toBe(true);
      expect(AdapterFactory.isSupported('mssql')).toBe(true);
    });

    it('should return true for case-insensitive types', () => {
      expect(AdapterFactory.isSupported('MySQL')).toBe(true);
      expect(AdapterFactory.isSupported('SQLITE')).toBe(true);
    });

    it('should return false for unsupported types', () => {
      expect(AdapterFactory.isSupported('oracle')).toBe(false);
      expect(AdapterFactory.isSupported('redis')).toBe(false);
      expect(AdapterFactory.isSupported('')).toBe(false);
    });
  });

  // ============================================================================
  // getDefaultPort (line 62)
  // ============================================================================

  // ============================================================================
  // getRequiredFields (lines 79, 90-91)
  // ============================================================================

  describe('getRequiredFields', () => {
    it('should return file for sqlite', () => {
      expect(AdapterFactory.getRequiredFields('sqlite')).toEqual(['file']);
    });

    it('should return connection fields for mysql', () => {
      expect(AdapterFactory.getRequiredFields('mysql')).toEqual([
        'host',
        'database',
        'username',
        'password',
      ]);
    });

    it('should return connection fields for postgresql', () => {
      expect(AdapterFactory.getRequiredFields('postgresql')).toEqual([
        'host',
        'database',
        'username',
        'password',
      ]);
    });

    it('should return connection fields for postgres alias', () => {
      expect(AdapterFactory.getRequiredFields('postgres')).toEqual([
        'host',
        'database',
        'username',
        'password',
      ]);
    });

    it('should return connection fields for mssql', () => {
      expect(AdapterFactory.getRequiredFields('mssql')).toEqual([
        'host',
        'database',
        'username',
        'password',
      ]);
    });

    it('should return connection fields for sqlserver', () => {
      expect(AdapterFactory.getRequiredFields('sqlserver' as DatabaseTypeString)).toEqual([
        'host',
        'database',
        'username',
        'password',
      ]);
    });

    it('should return empty array for unknown type', () => {
      expect(AdapterFactory.getRequiredFields('unknown' as DatabaseTypeString)).toEqual([]);
    });

    it('should drop username and password for mssql with azure-cli auth', () => {
      // The credential comes from the CLI's own context, so there is no pair to
      // supply. MSSQLAdapter already narrows its fields the same way; before this
      // the factory rejected such a database before the adapter was ever built.
      expect(
        AdapterFactory.getRequiredFields('mssql', {
          name: 'azure_db',
          type: 'mssql',
          authentication: 'azure-cli',
          host: 'example.database.windows.net',
          database: 'YCI',
        } as unknown as DatabaseConfig)
      ).toEqual(['host', 'database']);
    });

    it('should still require the pair for mssql without azure-cli auth', () => {
      expect(
        AdapterFactory.getRequiredFields('mssql', {
          name: 'sql_db',
          type: 'mssql',
          host: 'example.database.windows.net',
          database: 'YCI',
        } as unknown as DatabaseConfig)
      ).toEqual(['host', 'database', 'username', 'password']);
    });

    it('should accept an azure-cli mssql config that has no username or password', () => {
      const result = AdapterFactory.validateConfig({
        name: 'azure_db',
        type: 'mssql',
        authentication: 'azure-cli',
        host: 'example.database.windows.net',
        database: 'YCI',
      } as unknown as DatabaseConfig);
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  // ============================================================================
  // validateConfig (lines 86-118)
  // ============================================================================

  describe('validateConfig', () => {
    it('should validate a valid mysql config', () => {
      const config: DatabaseConfig = {
        type: 'mysql',
        host: 'localhost',
        database: 'testdb',
        username: 'user',
        password: 'pass',
      };
      const result = AdapterFactory.validateConfig(config);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate a valid sqlite config', () => {
      const config: DatabaseConfig = {
        type: 'sqlite',
        file: '/tmp/test.db',
      };
      const result = AdapterFactory.validateConfig(config);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when type is missing', () => {
      const config = {} as DatabaseConfig;
      const result = AdapterFactory.validateConfig(config);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Database type is required');
    });

    it('should fail for unsupported type', () => {
      const config: DatabaseConfig = {
        type: 'oracle' as DatabaseTypeString,
      };
      const result = AdapterFactory.validateConfig(config);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Unsupported database type: oracle');
    });

    it('should fail when required fields are missing', () => {
      const config: DatabaseConfig = {
        type: 'mysql',
        host: 'localhost',
        // missing database, username, password
      };
      const result = AdapterFactory.validateConfig(config);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("'database'"))).toBe(true);
    });

    it('should fail when required fields are empty strings', () => {
      const config: DatabaseConfig = {
        type: 'mysql',
        host: 'localhost',
        database: '  ',
        username: 'user',
        password: 'pass',
      };
      const result = AdapterFactory.validateConfig(config);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("'database'"))).toBe(true);
    });

    it('should fail when a required field has a non-string runtime value', () => {
      const config: DatabaseConfig = {
        type: 'mysql',
        host: 'localhost',
        database: 123 as unknown as string,
        username: 'user',
        password: 'pass',
      };
      const result = AdapterFactory.validateConfig(config);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Required field 'database' is missing or empty");
    });

    // SSH validation (lines 109-116)
    it('should fail when SSH host is set but SSH username is missing', () => {
      const config: DatabaseConfig = {
        type: 'mysql',
        host: 'localhost',
        database: 'testdb',
        username: 'user',
        password: 'pass',
        ssh_host: 'ssh.example.com',
      };
      const result = AdapterFactory.validateConfig(config);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('SSH username'))).toBe(true);
    });

    it('should fail when SSH host is set but no SSH auth provided', () => {
      const config: DatabaseConfig = {
        type: 'mysql',
        host: 'localhost',
        database: 'testdb',
        username: 'user',
        password: 'pass',
        ssh_host: 'ssh.example.com',
        ssh_username: 'sshuser',
      };
      const result = AdapterFactory.validateConfig(config);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('SSH password or private key'))).toBe(true);
    });

    it('should pass with SSH password auth', () => {
      const config: DatabaseConfig = {
        type: 'mysql',
        host: 'localhost',
        database: 'testdb',
        username: 'user',
        password: 'pass',
        ssh_host: 'ssh.example.com',
        ssh_username: 'sshuser',
        ssh_password: 'sshpass',
      };
      const result = AdapterFactory.validateConfig(config);
      expect(result.isValid).toBe(true);
    });

    it('should pass with SSH private key auth', () => {
      const config: DatabaseConfig = {
        type: 'mysql',
        host: 'localhost',
        database: 'testdb',
        username: 'user',
        password: 'pass',
        ssh_host: 'ssh.example.com',
        ssh_username: 'sshuser',
        ssh_private_key: '/path/to/key',
      };
      const result = AdapterFactory.validateConfig(config);
      expect(result.isValid).toBe(true);
    });
  });
});

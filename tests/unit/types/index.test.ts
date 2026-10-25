/**
 * Types Runtime Code Tests
 * Tests exported constants, type guards, validators, and utility functions
 * from types/index.ts, types/mcp.ts, types/database.ts, types/config.ts
 */

import {
  // Constants from types/index.ts
  MCP_PROTOCOL_VERSION,
  SERVER_VERSION,
  SERVER_NAME,
  DATABASE_TYPES,
  COMPLEXITY_RISK_LEVELS,
  TOKEN_TYPES,
  LOG_SEVERITIES,
  SSH_AUTH_METHODS,
  SSH_TUNNEL_STATUSES,
  // Type guards from types/database.ts
  isDatabaseType,
  isQueryObject,
  isSecurityViolationError,
  isValidRedactionType,
  isValidFieldPatternType,
  isFieldRedactionRule,
  isDatabaseRedactionConfig,
  // Type guards from types/mcp.ts
  isMCPRequest,
  isMCPResponse,
  isMCPNotification,
  isMCPToolCallRequest,
  isSQLQueryArgs,
  isSQLBatchQueryArgs,
  isSQLGetSchemaArgs,
  isSQLTestConnectionArgs,
  // Config utilities from types/config.ts
  isDatabaseSectionConfig,
  isRawConfigFile,
  parseStringToNumber,
  parseStringToBoolean,
  validateDatabaseType,
  getRequiredFields,
  validateRequiredFields,
  DEFAULT_SECURITY_CONFIG,
  DEFAULT_EXTENSION_CONFIG,
  DEFAULT_DATABASE_PORTS,
  DEFAULT_CONNECTION_TIMEOUT,
  DEFAULT_SSH_PORT,
  // Error classes
  SecurityViolationError,
} from '../../../src/types/index.js';

// ============================================================================
// Constants Tests (types/index.ts)
// ============================================================================

describe('types/index.ts constants', () => {
  it('should export version constants', () => {
    expect(MCP_PROTOCOL_VERSION).toBe('2025-06-18');
    expect(typeof SERVER_VERSION).toBe('string');
    expect(SERVER_NAME).toBe('argos');
  });

  it('should export DATABASE_TYPES array', () => {
    expect(DATABASE_TYPES).toContain('mysql');
    expect(DATABASE_TYPES).toContain('postgresql');
    expect(DATABASE_TYPES).toContain('postgres');
    expect(DATABASE_TYPES).toContain('sqlite');
    expect(DATABASE_TYPES).toContain('mssql');
    expect(DATABASE_TYPES).toContain('sqlserver');
    expect(DATABASE_TYPES).toHaveLength(6);
  });

  it('should export COMPLEXITY_RISK_LEVELS', () => {
    expect(COMPLEXITY_RISK_LEVELS).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
  });

  it('should export TOKEN_TYPES', () => {
    expect(TOKEN_TYPES).toEqual(['KEYWORD', 'IDENTIFIER', 'STRING', 'OPERATOR', 'UNKNOWN']);
  });

  it('should export LOG_SEVERITIES', () => {
    expect(LOG_SEVERITIES).toEqual(['INFO', 'WARNING', 'ERROR', 'CRITICAL']);
  });

  it('should export SSH_AUTH_METHODS', () => {
    expect(SSH_AUTH_METHODS).toEqual(['password', 'privateKey', 'agent']);
  });

  it('should export SSH_TUNNEL_STATUSES', () => {
    expect(SSH_TUNNEL_STATUSES).toEqual([
      'connecting',
      'connected',
      'error',
      'disconnected',
      'reconnecting',
    ]);
  });
});

// ============================================================================
// Config Constants Tests (types/config.ts)
// ============================================================================

describe('types/config.ts constants', () => {
  it('should export DEFAULT_SECURITY_CONFIG', () => {
    expect(DEFAULT_SECURITY_CONFIG.max_joins).toBe(10);
    expect(DEFAULT_SECURITY_CONFIG.max_subqueries).toBe(5);
    expect(DEFAULT_SECURITY_CONFIG.max_unions).toBe(3);
    expect(DEFAULT_SECURITY_CONFIG.max_group_bys).toBe(5);
    expect(DEFAULT_SECURITY_CONFIG.max_complexity_score).toBe(100);
    expect(DEFAULT_SECURITY_CONFIG.max_query_length).toBe(10000);
  });

  it('should export DEFAULT_EXTENSION_CONFIG', () => {
    expect(DEFAULT_EXTENSION_CONFIG.max_rows).toBe(1000);
    expect(DEFAULT_EXTENSION_CONFIG.max_batch_size).toBe(10);
    expect(DEFAULT_EXTENSION_CONFIG.query_timeout).toBe(30000);
    expect(DEFAULT_EXTENSION_CONFIG.debug).toBe(false);
  });

  it('should export DEFAULT_DATABASE_PORTS', () => {
    expect(DEFAULT_DATABASE_PORTS.mysql).toBe(3306);
    expect(DEFAULT_DATABASE_PORTS.postgresql).toBe(5432);
    expect(DEFAULT_DATABASE_PORTS.postgres).toBe(5432);
    expect(DEFAULT_DATABASE_PORTS.sqlite).toBe(0);
    expect(DEFAULT_DATABASE_PORTS.mssql).toBe(1433);
    expect(DEFAULT_DATABASE_PORTS.sqlserver).toBe(1433);
  });

  it('should export DEFAULT_CONNECTION_TIMEOUT', () => {
    expect(DEFAULT_CONNECTION_TIMEOUT).toBe(30000);
  });

  it('should export DEFAULT_SSH_PORT', () => {
    expect(DEFAULT_SSH_PORT).toBe(22);
  });
});

// ============================================================================
// Database Type Guards (types/database.ts)
// ============================================================================

describe('database type guards', () => {
  describe('isDatabaseType', () => {
    it('should return true for valid database types', () => {
      expect(isDatabaseType('mysql')).toBe(true);
      expect(isDatabaseType('postgresql')).toBe(true);
      expect(isDatabaseType('postgres')).toBe(true);
      expect(isDatabaseType('sqlite')).toBe(true);
      expect(isDatabaseType('mssql')).toBe(true);
      expect(isDatabaseType('sqlserver')).toBe(true);
    });

    it('should return false for invalid types', () => {
      expect(isDatabaseType('oracle')).toBe(false);
      expect(isDatabaseType('redis')).toBe(false);
      expect(isDatabaseType('')).toBe(false);
      expect(isDatabaseType('MySQL')).toBe(false);
    });
  });

  describe('isQueryObject', () => {
    it('should return true for valid query objects', () => {
      expect(isQueryObject({ query: 'SELECT 1' })).toBe(true);
      expect(isQueryObject({ query: 'SELECT 1', params: [1] })).toBe(true);
    });

    it('should return false for invalid values', () => {
      expect(isQueryObject(null)).toBe(false);
      expect(isQueryObject(undefined)).toBe(false);
      expect(isQueryObject('string')).toBe(false);
      expect(isQueryObject({})).toBe(false);
      expect(isQueryObject({ query: 123 })).toBe(false);
    });
  });

  describe('isSecurityViolationError', () => {
    it('should return true for SecurityViolationError instances', () => {
      const err = new SecurityViolationError('test', { pattern: 'DANGEROUS_PATTERN' });
      expect(isSecurityViolationError(err)).toBe(true);
    });

    it('should return false for regular errors', () => {
      expect(isSecurityViolationError(new Error('test'))).toBe(false);
      expect(isSecurityViolationError(null)).toBe(false);
      expect(isSecurityViolationError('error')).toBe(false);
    });
  });

  describe('isValidRedactionType', () => {
    it('should return true for valid redaction types', () => {
      expect(isValidRedactionType('full_mask')).toBe(true);
      expect(isValidRedactionType('partial_mask')).toBe(true);
      expect(isValidRedactionType('replace')).toBe(true);
      expect(isValidRedactionType('custom')).toBe(true);
    });

    it('should return false for invalid types', () => {
      expect(isValidRedactionType('hash')).toBe(false);
      expect(isValidRedactionType('')).toBe(false);
    });
  });

  describe('isValidFieldPatternType', () => {
    it('should return true for valid pattern types', () => {
      expect(isValidFieldPatternType('exact')).toBe(true);
      expect(isValidFieldPatternType('wildcard')).toBe(true);
      expect(isValidFieldPatternType('regex')).toBe(true);
    });

    it('should return false for invalid types', () => {
      expect(isValidFieldPatternType('glob')).toBe(false);
      expect(isValidFieldPatternType('')).toBe(false);
    });
  });

  describe('isFieldRedactionRule', () => {
    it('should return true for valid rules', () => {
      expect(
        isFieldRedactionRule({
          field_pattern: 'email',
          pattern_type: 'exact',
          redaction_type: 'full_mask',
        })
      ).toBe(true);
    });

    it('should return false for invalid rules', () => {
      expect(isFieldRedactionRule(null)).toBe(false);
      expect(isFieldRedactionRule({})).toBe(false);
      expect(
        isFieldRedactionRule({
          field_pattern: 'email',
          pattern_type: 'invalid',
          redaction_type: 'full_mask',
        })
      ).toBe(false);
      expect(
        isFieldRedactionRule({
          field_pattern: 'email',
          pattern_type: 'exact',
          redaction_type: 'invalid',
        })
      ).toBe(false);
    });
  });

  describe('isDatabaseRedactionConfig', () => {
    it('should return true for valid config', () => {
      expect(
        isDatabaseRedactionConfig({
          enabled: true,
          rules: [
            {
              field_pattern: 'email',
              pattern_type: 'exact',
              redaction_type: 'full_mask',
            },
          ],
        })
      ).toBe(true);
    });

    it('should return true for empty rules array', () => {
      expect(isDatabaseRedactionConfig({ enabled: false, rules: [] })).toBe(true);
    });

    it('should return false for invalid configs', () => {
      expect(isDatabaseRedactionConfig(null)).toBe(false);
      expect(isDatabaseRedactionConfig({})).toBe(false);
      expect(isDatabaseRedactionConfig({ enabled: 'yes', rules: [] })).toBe(false);
      expect(
        isDatabaseRedactionConfig({
          enabled: true,
          rules: [{ field_pattern: 'x', pattern_type: 'bad', redaction_type: 'full_mask' }],
        })
      ).toBe(false);
    });
  });
});

// ============================================================================
// MCP Type Guards (types/mcp.ts)
// ============================================================================

describe('MCP type guards', () => {
  describe('isMCPRequest', () => {
    it('should return true for valid MCP requests', () => {
      expect(isMCPRequest({ jsonrpc: '2.0', id: 1, method: 'test' })).toBe(true);
      expect(isMCPRequest({ jsonrpc: '2.0', id: 'abc', method: 'test' })).toBe(true);
    });

    it('should return false for non-requests', () => {
      // No id means not a request
      expect(isMCPRequest({ jsonrpc: '2.0', method: 'test' })).toBe(false);
      // Has id but no method - still not a valid request
      expect(isMCPRequest({ jsonrpc: '2.0', id: 1 })).toBe(false);
    });
  });

  describe('isMCPResponse', () => {
    it('should return true for valid responses', () => {
      expect(isMCPResponse({ jsonrpc: '2.0', id: 1, result: {} })).toBe(true);
      expect(isMCPResponse({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'fail' } })).toBe(
        true
      );
    });

    it('should return false for non-responses', () => {
      expect(isMCPResponse({ jsonrpc: '2.0', method: 'test' })).toBe(false);
    });
  });

  describe('isMCPNotification', () => {
    it('should return true for valid notifications', () => {
      expect(isMCPNotification({ jsonrpc: '2.0', method: 'test' })).toBe(true);
    });

    it('should return false for requests (has id)', () => {
      expect(isMCPNotification({ jsonrpc: '2.0', id: 1, method: 'test' })).toBe(false);
    });
  });

  describe('isMCPToolCallRequest', () => {
    it('should return true for valid tool call requests', () => {
      const msg = {
        jsonrpc: '2.0' as const,
        id: 1,
        method: 'tools/call',
        params: { name: 'sql_query', arguments: { database: 'test' } },
      };
      expect(isMCPToolCallRequest(msg)).toBe(true);
    });

    it('should return false for non-tool-call requests', () => {
      expect(isMCPToolCallRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).toBe(false);
      expect(
        isMCPToolCallRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} })
      ).toBe(false);
    });
  });

  describe('isSQLQueryArgs', () => {
    it('should return true for valid query args', () => {
      expect(isSQLQueryArgs({ database: 'test', query: 'SELECT 1' })).toBe(true);
    });

    it('should return false for invalid args', () => {
      expect(isSQLQueryArgs(null)).toBe(false);
      expect(isSQLQueryArgs({})).toBe(false);
      expect(isSQLQueryArgs({ database: 'test' })).toBe(false);
      expect(isSQLQueryArgs({ query: 'SELECT 1' })).toBe(false);
      expect(isSQLQueryArgs({ database: 123, query: 'SELECT 1' })).toBe(false);
    });
  });

  describe('isSQLBatchQueryArgs', () => {
    it('should return true for valid batch args', () => {
      expect(
        isSQLBatchQueryArgs({
          database: 'test',
          queries: [{ query: 'SELECT 1' }],
        })
      ).toBe(true);
    });

    it('should return false for invalid args', () => {
      expect(isSQLBatchQueryArgs(null)).toBe(false);
      expect(isSQLBatchQueryArgs({ database: 'test' })).toBe(false);
      expect(isSQLBatchQueryArgs({ database: 'test', queries: 'not array' })).toBe(false);
    });
  });

  describe('isSQLGetSchemaArgs', () => {
    it('should return true for valid schema args', () => {
      expect(isSQLGetSchemaArgs({ database: 'test' })).toBe(true);
    });

    it('should return false for invalid args', () => {
      expect(isSQLGetSchemaArgs(null)).toBe(false);
      expect(isSQLGetSchemaArgs({})).toBe(false);
      expect(isSQLGetSchemaArgs({ database: 123 })).toBe(false);
    });
  });

  describe('isSQLTestConnectionArgs', () => {
    it('should return true for valid test connection args', () => {
      expect(isSQLTestConnectionArgs({ database: 'test' })).toBe(true);
    });

    it('should return false for invalid args', () => {
      expect(isSQLTestConnectionArgs(null)).toBe(false);
      expect(isSQLTestConnectionArgs({})).toBe(false);
    });
  });
});

// ============================================================================
// Config Type Guards and Utilities (types/config.ts)
// ============================================================================

describe('config type guards and utilities', () => {
  describe('isDatabaseSectionConfig', () => {
    it('should return true for valid database section configs', () => {
      expect(isDatabaseSectionConfig({ type: 'mysql', host: 'localhost' })).toBe(true);
    });

    it('should return false for invalid values', () => {
      expect(isDatabaseSectionConfig(null)).toBe(false);
      expect(isDatabaseSectionConfig({})).toBe(false);
      expect(isDatabaseSectionConfig('string')).toBe(false);
      expect(isDatabaseSectionConfig({ type: 123 })).toBe(false);
    });
  });

  describe('isRawConfigFile', () => {
    it('should return true for any non-null object', () => {
      expect(isRawConfigFile({})).toBe(true);
      expect(isRawConfigFile({ key: 'value' })).toBe(true);
    });

    it('should return false for non-objects', () => {
      expect(isRawConfigFile(null)).toBe(false);
      expect(isRawConfigFile('string')).toBe(false);
      expect(isRawConfigFile(undefined)).toBe(false);
    });
  });

  describe('parseStringToNumber', () => {
    it('should return number values as-is', () => {
      expect(parseStringToNumber(42, 0)).toBe(42);
    });

    it('should parse string numbers', () => {
      expect(parseStringToNumber('123', 0)).toBe(123);
    });

    it('should return default for non-parseable strings', () => {
      expect(parseStringToNumber('abc', 99)).toBe(99);
    });

    it('should return default for undefined', () => {
      expect(parseStringToNumber(undefined, 50)).toBe(50);
    });
  });

  describe('parseStringToBoolean', () => {
    it('should return boolean values as-is', () => {
      expect(parseStringToBoolean(true, false)).toBe(true);
      expect(parseStringToBoolean(false, true)).toBe(false);
    });

    it('should parse string booleans', () => {
      expect(parseStringToBoolean('true', false)).toBe(true);
      expect(parseStringToBoolean('TRUE', false)).toBe(true);
      expect(parseStringToBoolean('false', true)).toBe(false);
    });

    it('should return default for undefined', () => {
      expect(parseStringToBoolean(undefined, true)).toBe(true);
      expect(parseStringToBoolean(undefined, false)).toBe(false);
    });
  });

  describe('validateDatabaseType', () => {
    it('should return the type for valid database types', () => {
      expect(validateDatabaseType('mysql')).toBe('mysql');
      expect(validateDatabaseType('postgresql')).toBe('postgresql');
      expect(validateDatabaseType('sqlite')).toBe('sqlite');
      expect(validateDatabaseType('MYSQL')).toBe('mysql');
    });

    it('should return null for invalid types', () => {
      expect(validateDatabaseType('oracle')).toBeNull();
      expect(validateDatabaseType('')).toBeNull();
    });
  });

  describe('getRequiredFields', () => {
    it('should return file for sqlite', () => {
      expect(getRequiredFields('sqlite')).toEqual(['file']);
    });

    it('should return connection fields for server databases', () => {
      const expected = ['host', 'database', 'username', 'password'];
      expect(getRequiredFields('mysql')).toEqual(expected);
      expect(getRequiredFields('postgresql')).toEqual(expected);
      expect(getRequiredFields('mssql')).toEqual(expected);
    });

    it('should return empty array for unknown type', () => {
      expect(getRequiredFields('unknown' as any)).toEqual([]);
    });
  });

  describe('validateRequiredFields', () => {
    it('should return no errors for complete config', () => {
      const config = {
        type: 'mysql',
        host: 'localhost',
        database: 'testdb',
        username: 'user',
        password: 'pass',
      };
      const errors = validateRequiredFields(config as any, 'mydb', 'mysql');
      expect(errors).toHaveLength(0);
    });

    it('should return errors for missing fields', () => {
      const config = { type: 'mysql' };
      const errors = validateRequiredFields(config as any, 'mydb', 'mysql');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].section).toBe('database.mydb');
      expect(errors[0].severity).toBe('error');
    });

    it('should return errors for empty string fields', () => {
      const config = {
        type: 'mysql',
        host: '',
        database: 'testdb',
        username: 'user',
        password: 'pass',
      };
      const errors = validateRequiredFields(config as any, 'mydb', 'mysql');
      expect(errors.length).toBe(1);
      expect(errors[0].field).toBe('host');
    });

    it('should validate sqlite requires file field', () => {
      const config = { type: 'sqlite' };
      const errors = validateRequiredFields(config as any, 'mydb', 'sqlite');
      expect(errors.length).toBe(1);
      expect(errors[0].field).toBe('file');
    });
  });
});

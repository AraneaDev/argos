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
  isValidRedactionType,
  // Type guards from types/mcp.ts
  isSQLQueryArgs,
  isSQLBatchQueryArgs,
  isSQLGetSchemaArgs,
  isSQLTestConnectionArgs,
  // Config utilities from types/config.ts
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
});

// ============================================================================
// MCP Type Guards (types/mcp.ts)
// ============================================================================

describe('MCP type guards', () => {
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

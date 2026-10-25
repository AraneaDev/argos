/**
 * MySQL Database Adapter Tests
 * Tests the MySQL-specific database adapter implementation
 */

import { EventEmitter } from 'events';
import { MySQLAdapter } from '../../../src/database/adapters/mysql.js';
import type {
  DatabaseConnection,
  DatabaseConfig,
  QueryResult,
  DatabaseSchema,
} from '../../../src/types/index.js';

// Mock variables must be declared before jest.mock() calls
const mockExecute = jest.fn();
const mockBeginTransaction = jest.fn();
const mockCommit = jest.fn();
const mockRollback = jest.fn();
const mockEnd = jest.fn();

const mockRelease = jest.fn();
const mockConnection = {
  execute: mockExecute,
  beginTransaction: mockBeginTransaction,
  commit: mockCommit,
  rollback: mockRollback,
  end: mockEnd,
  release: mockRelease,
};

// Mock the 'mysql2/promise' module
const mockGetConnection = jest.fn();
const mockPoolEnd = jest.fn();

jest.mock('mysql2/promise', () => ({
  createPool: jest.fn(),
}));

import mysql from 'mysql2/promise';

// ============================================================================
// Test Suite
// ============================================================================

describe('MySQLAdapter', () => {
  let config: DatabaseConfig;
  let adapter: MySQLAdapter;

  beforeEach(() => {
    config = {
      type: 'mysql',
      host: 'localhost',
      port: 3306,
      database: 'testdb',
      username: 'testuser',
      password: 'testpass',
      timeout: 30000,
      ssl: false,
    };

    adapter = new MySQLAdapter(config);

    // Reset mocks
    jest.clearAllMocks();
    mockGetConnection.mockResolvedValue(mockConnection);
    mockPoolEnd.mockResolvedValue(undefined);
    (mysql.createPool as jest.Mock).mockReturnValue({
      getConnection: mockGetConnection,
      end: mockPoolEnd,
    });
    mockExecute.mockResolvedValue([[{ id: 1, name: 'test' }], [{ name: 'id' }, { name: 'name' }]]);
    mockBeginTransaction.mockResolvedValue(undefined);
    mockCommit.mockResolvedValue(undefined);
    mockRollback.mockResolvedValue(undefined);
    mockEnd.mockResolvedValue(undefined);
    mockRelease.mockReturnValue(undefined);
  });

  // ============================================================================
  // Constructor and Configuration Tests
  // ============================================================================

  describe('constructor', () => {
    it('should initialize with valid MySQL config', () => {
      expect(adapter.getType()).toBe('mysql');
      expect(adapter.getConfig().host).toBe('localhost');
      expect(adapter.getConfig().port).toBe(3306);
    });

    it('should handle port as string', () => {
      const stringPortConfig = { ...config, port: '3307' as any };
      const stringAdapter = new MySQLAdapter(stringPortConfig);
      expect(stringAdapter.getConfig().port).toBe('3307');
    });
  });

  // ============================================================================
  // Connection Management Tests
  // ============================================================================

  describe('read-only session', () => {
    const withQuery = (query: jest.Mock) => {
      mockGetConnection.mockResolvedValue({ ...mockConnection, query });
    };

    it('should not make the session read-only when read_only_session is unset', async () => {
      const query = jest.fn().mockResolvedValue([[], []]);
      withQuery(query);

      await adapter.connect();

      expect(query).not.toHaveBeenCalledWith('SET SESSION TRANSACTION READ ONLY');
    });

    it('should make the session read-only when read_only_session is set', async () => {
      const query = jest.fn().mockResolvedValue([[], []]);
      withQuery(query);

      await new MySQLAdapter({ ...config, read_only_session: true }).connect();

      expect(query).toHaveBeenCalledWith('SET SESSION TRANSACTION READ ONLY');
    });

    it('should release the connection and fail when the session cannot be made read-only', async () => {
      const query = jest.fn(async (sql: string) => {
        if (sql === 'SET SESSION TRANSACTION READ ONLY') throw new Error('nope');
        return [[], []];
      });
      withQuery(query);

      await expect(
        new MySQLAdapter({ ...config, read_only_session: true }).connect()
      ).rejects.toThrow();
      expect(mockRelease).toHaveBeenCalled();
    });
  });

  describe('connect', () => {
    it('should connect to MySQL database successfully', async () => {
      const connection = await adapter.connect();

      expect(mysql.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 3306,
          database: 'testdb',
          user: 'testuser',
          password: 'testpass',
          connectTimeout: 30000,
        })
      );
      expect(mockGetConnection).toHaveBeenCalled();
      expect(connection).toBe(mockConnection);
    });

    it('should handle SSL configuration enabled', async () => {
      const sslConfig = { ...config, ssl: true };
      const sslAdapter = new MySQLAdapter(sslConfig);

      await sslAdapter.connect();

      expect(mysql.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          ssl: { rejectUnauthorized: true },
        })
      );
    });

    it('should default ssl_verify to true when SSL is enabled but ssl_verify is not set', async () => {
      const sslConfig = { ...config, ssl: true };
      // ssl_verify is intentionally NOT set
      const sslAdapter = new MySQLAdapter(sslConfig);

      await sslAdapter.connect();

      expect(mysql.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          ssl: { rejectUnauthorized: true },
        })
      );
    });

    it('should allow ssl_verify=false to explicitly disable certificate verification', async () => {
      const sslConfig = { ...config, ssl: true, ssl_verify: false };
      const sslAdapter = new MySQLAdapter(sslConfig);

      await sslAdapter.connect();

      expect(mysql.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          ssl: { rejectUnauthorized: false },
        })
      );
    });

    // A security control must not be switched off by a value nobody recognises.
    // ssl_verify reaches the adapter as a boolean when it came through the
    // config-file parser, but nothing guarantees that for every caller.
    it('should keep verifying when ssl_verify holds an unrecognised value', async () => {
      const sslAdapter = new MySQLAdapter({ ...config, ssl: true, ssl_verify: 'yes' as never });

      await sslAdapter.connect();

      expect(mysql.createPool).toHaveBeenCalledWith(
        expect.objectContaining({ ssl: { rejectUnauthorized: true } })
      );
    });

    it('should stop verifying for a recognised false spelling', async () => {
      const sslAdapter = new MySQLAdapter({ ...config, ssl: true, ssl_verify: 'false' as never });

      await sslAdapter.connect();

      expect(mysql.createPool).toHaveBeenCalledWith(
        expect.objectContaining({ ssl: { rejectUnauthorized: false } })
      );
    });

    it('should not configure SSL when it is not asked for', async () => {
      const { ssl: _ssl, ...withoutSsl } = config;
      const plainAdapter = new MySQLAdapter(withoutSsl as DatabaseConfig);

      await plainAdapter.connect();

      expect(mysql.createPool).toHaveBeenCalledWith(
        expect.not.objectContaining({ ssl: expect.anything() })
      );
    });

    it('should queue callers rather than fail when the pool is exhausted', async () => {
      await adapter.connect();

      expect(mysql.createPool).toHaveBeenCalledWith(
        expect.objectContaining({ waitForConnections: true, connectionLimit: 10 })
      );
    });

    it('should handle SSL configuration disabled', async () => {
      const sslConfig = { ...config, ssl: false };
      const sslAdapter = new MySQLAdapter(sslConfig);

      await sslAdapter.connect();

      expect(mysql.createPool).toHaveBeenCalledWith(
        expect.not.objectContaining({
          ssl: expect.anything(),
        })
      );
    });

    it('should handle Azure MariaDB configuration', async () => {
      const azureConfig = {
        ...config,
        host: 'myserver.mariadb.database.azure.com',
        username: 'testuser',
      };
      const azureAdapter = new MySQLAdapter(azureConfig);

      await azureAdapter.connect();

      expect(mysql.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          ssl: { rejectUnauthorized: true },
          user: 'testuser@myserver',
        })
      );
    });

    it('should handle Azure MySQL configuration', async () => {
      const azureConfig = {
        ...config,
        host: 'myserver.mysql.database.azure.com',
        username: 'testuser',
      };
      const azureAdapter = new MySQLAdapter(azureConfig);

      await azureAdapter.connect();

      expect(mysql.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          ssl: { rejectUnauthorized: true },
          user: 'testuser@myserver',
        })
      );
    });

    it('should not modify username if already contains @', async () => {
      const azureConfig = {
        ...config,
        host: 'myserver.mysql.database.azure.com',
        username: 'testuser@myserver',
      };
      const azureAdapter = new MySQLAdapter(azureConfig);

      await azureAdapter.connect();

      expect(mysql.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          user: 'testuser@myserver',
        })
      );
    });

    it('should validate required configuration fields', async () => {
      const incompleteConfig = { type: 'mysql' as const };
      const incompleteAdapter = new MySQLAdapter(incompleteConfig);

      await expect(incompleteAdapter.connect()).rejects.toThrow(
        'Missing required configuration fields: host, database, username, password'
      );
    });

    it('should handle connection errors', async () => {
      const connectionError = new Error('Connection failed');
      mockGetConnection.mockRejectedValueOnce(connectionError);

      await expect(adapter.connect()).rejects.toThrow(
        'mysql adapter error: Failed to acquire MySQL connection from pool - Connection failed'
      );
    });

    it('should use default port when not specified', async () => {
      const noPortConfig = { ...config };
      delete noPortConfig.port;
      const noPortAdapter = new MySQLAdapter(noPortConfig);

      await noPortAdapter.connect();

      expect(mysql.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 3306,
        })
      );
    });
  });

  describe('disconnect', () => {
    it('should release pool connection (not call end) on disconnect', async () => {
      const mockRelease = jest.fn();
      mockGetConnection.mockResolvedValueOnce({ ...mockConnection, release: mockRelease });

      const connection = await adapter.connect();
      await adapter.disconnect(connection);

      expect(mockRelease).toHaveBeenCalled();
      expect(mockEnd).not.toHaveBeenCalled();
    });

    it('should handle disconnect errors', async () => {
      const disconnectError = new Error('Disconnect failed');
      const mockRelease = jest.fn().mockImplementation(() => {
        throw disconnectError;
      });
      mockGetConnection.mockResolvedValueOnce({ ...mockConnection, release: mockRelease });

      const connection = await adapter.connect();
      await expect(adapter.disconnect(connection)).rejects.toThrow(
        'mysql adapter error: Failed to release MySQL connection to pool - Disconnect failed'
      );
    });
  });

  describe('isConnected', () => {
    it('should return true for valid connection', async () => {
      const connection = await adapter.connect();

      expect(adapter.isConnected(connection)).toBe(true);
    });

    it('should return false for invalid connection', () => {
      expect(adapter.isConnected(null as any)).toBe(false);
      expect(adapter.isConnected({} as any)).toBe(false);
    });

    it('should handle exceptions gracefully', () => {
      const badConnection = {
        get execute() {
          throw new Error('Property access failed');
        },
      };

      expect(adapter.isConnected(badConnection as any)).toBe(false);
    });
  });

  // ============================================================================
  // Query Execution Tests
  // ============================================================================

  describe('executeQuery', () => {
    let connection: DatabaseConnection;

    beforeEach(async () => {
      connection = await adapter.connect();
    });

    it('should execute query successfully', async () => {
      const mockResult = [
        [
          { id: 1, name: 'John' },
          { id: 2, name: 'Jane' },
        ],
        [{ name: 'id' }, { name: 'name' }],
      ];
      mockExecute.mockResolvedValueOnce(mockResult);

      const result = await adapter.executeQuery(connection, 'SELECT * FROM users');

      expect(mockExecute).toHaveBeenCalledWith('SELECT * FROM users', []);
      expect(result.rows).toEqual([
        { id: 1, name: 'John' },
        { id: 2, name: 'Jane' },
      ]);
      expect(result.fields).toEqual(['id', 'name']);
      expect(result.rowCount).toBe(2);
      expect(result.truncated).toBe(false);
      expect(result.execution_time_ms).toBeGreaterThanOrEqual(0);
    });

    it('should execute query with parameters', async () => {
      const mockResult = [[{ id: 1, name: 'John' }], [{ name: 'id' }, { name: 'name' }]];
      mockExecute.mockResolvedValueOnce(mockResult);

      await adapter.executeQuery(connection, 'SELECT * FROM users WHERE id = ?', [1]);

      expect(mockExecute).toHaveBeenCalledWith('SELECT * FROM users WHERE id = ?', [1]);
    });

    it('should handle query execution errors', async () => {
      const queryError = new Error('Query execution failed');
      mockExecute.mockRejectedValueOnce(queryError);

      await expect(adapter.executeQuery(connection, 'INVALID SQL')).rejects.toThrow(
        'mysql adapter error: Failed to execute MySQL query - Query execution failed'
      );
    });

    it('should handle empty result sets', async () => {
      const mockResult = [[], []];
      mockExecute.mockResolvedValueOnce(mockResult);

      const result = await adapter.executeQuery(connection, 'SELECT * FROM empty_table');

      expect(result.rows).toEqual([]);
      expect(result.fields).toEqual([]);
      expect(result.rowCount).toBe(0);
      expect(result.truncated).toBe(false);
    });

    it('should handle result truncation', async () => {
      // Create mock result with more rows than the limit
      const largeRowSet = Array(1500)
        .fill(0)
        .map((_, i) => ({ id: i + 1, name: `User${i + 1}` }));
      const mockResult = [largeRowSet, [{ name: 'id' }, { name: 'name' }]];
      mockExecute.mockResolvedValueOnce(mockResult);

      const result = await adapter.executeQuery(connection, 'SELECT * FROM large_table');

      expect(result.rows).toHaveLength(1000); // Should be truncated to max_rows
      expect(result.rowCount).toBe(1500); // Original count before truncation
      expect(result.truncated).toBe(true);
    });

    it('should handle malformed query results gracefully', async () => {
      // Mock a result that doesn't destructure properly
      mockExecute.mockResolvedValueOnce('not an array');

      await expect(adapter.executeQuery(connection, 'SELECT 1')).rejects.toThrow();
    });
  });

  // ============================================================================
  // Transaction Management Tests
  // ============================================================================

  describe('transaction management', () => {
    let connection: DatabaseConnection;

    beforeEach(async () => {
      connection = await adapter.connect();
    });

    describe('beginTransaction', () => {
      it('should begin transaction successfully', async () => {
        await adapter.beginTransaction(connection);
        expect(mockBeginTransaction).toHaveBeenCalled();
      });

      it('should handle begin transaction errors', async () => {
        const transactionError = new Error('Begin failed');
        mockBeginTransaction.mockRejectedValueOnce(transactionError);

        await expect(adapter.beginTransaction(connection)).rejects.toThrow(
          'mysql adapter error: Failed to begin MySQL transaction - Begin failed'
        );
      });
    });

    describe('commitTransaction', () => {
      it('should commit transaction successfully', async () => {
        await adapter.commitTransaction(connection);
        expect(mockCommit).toHaveBeenCalled();
      });

      it('should handle commit transaction errors', async () => {
        const commitError = new Error('Commit failed');
        mockCommit.mockRejectedValueOnce(commitError);

        await expect(adapter.commitTransaction(connection)).rejects.toThrow(
          'mysql adapter error: Failed to commit MySQL transaction - Commit failed'
        );
      });
    });

    describe('rollbackTransaction', () => {
      it('should rollback transaction successfully', async () => {
        await adapter.rollbackTransaction(connection);
        expect(mockRollback).toHaveBeenCalled();
      });

      it('should handle rollback transaction errors', async () => {
        const rollbackError = new Error('Rollback failed');
        mockRollback.mockRejectedValueOnce(rollbackError);

        await expect(adapter.rollbackTransaction(connection)).rejects.toThrow(
          'mysql adapter error: Failed to rollback MySQL transaction - Rollback failed'
        );
      });
    });
  });

  // ============================================================================
  // Performance Analysis Tests
  // ============================================================================

  describe('buildExplainQuery', () => {
    it('should build MySQL explain query with JSON format', () => {
      const query = 'SELECT * FROM users WHERE active = 1';
      const explainQuery = adapter.buildExplainQuery(query);

      expect(explainQuery).toBe('EXPLAIN FORMAT=JSON SELECT * FROM users WHERE active = 1');
    });

    it('should handle complex queries', () => {
      const complexQuery = `
 SELECT u.name, p.title 
 FROM users u 
 JOIN posts p ON u.id = p.user_id 
 WHERE u.created_at > '2023-01-01'
 `;

      const explainQuery = adapter.buildExplainQuery(complexQuery);
      expect(explainQuery).toContain('EXPLAIN FORMAT=JSON');
      expect(explainQuery).toContain(complexQuery);
    });
  });

  // ============================================================================
  // Schema Capture Tests
  // ============================================================================

  describe('captureSchema', () => {
    let connection: DatabaseConnection;

    beforeEach(async () => {
      connection = await adapter.connect();
    });

    it('should capture database schema successfully', async () => {
      // Mock tables query result
      const tablesResult = [
        [
          { TABLE_NAME: 'users', TABLE_TYPE: 'BASE TABLE', TABLE_COMMENT: 'User accounts' },
          { TABLE_NAME: 'posts', TABLE_TYPE: 'BASE TABLE', TABLE_COMMENT: '' },
          { TABLE_NAME: 'user_stats', TABLE_TYPE: 'VIEW', TABLE_COMMENT: 'User statistics view' },
        ],
      ];

      // Mock columns query results
      const usersColumnsResult = [
        [
          {
            COLUMN_NAME: 'id',
            DATA_TYPE: 'int',
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: null,
            CHARACTER_MAXIMUM_LENGTH: null,
            NUMERIC_PRECISION: 10,
            NUMERIC_SCALE: 0,
            COLUMN_COMMENT: 'Primary key',
            COLUMN_KEY: 'PRI',
            EXTRA: 'auto_increment',
          },
          {
            COLUMN_NAME: 'name',
            DATA_TYPE: 'varchar',
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: null,
            CHARACTER_MAXIMUM_LENGTH: 100,
            NUMERIC_PRECISION: null,
            NUMERIC_SCALE: null,
            COLUMN_COMMENT: 'Full name',
            COLUMN_KEY: '',
            EXTRA: '',
          },
        ],
      ];

      const postsColumnsResult = [
        [
          {
            COLUMN_NAME: 'id',
            DATA_TYPE: 'int',
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: null,
            CHARACTER_MAXIMUM_LENGTH: null,
            NUMERIC_PRECISION: 10,
            NUMERIC_SCALE: 0,
            COLUMN_COMMENT: '',
            COLUMN_KEY: 'PRI',
            EXTRA: 'auto_increment',
          },
        ],
      ];

      const userStatsColumnsResult = [
        [
          {
            COLUMN_NAME: 'user_id',
            DATA_TYPE: 'int',
            IS_NULLABLE: 'YES',
            COLUMN_DEFAULT: null,
            CHARACTER_MAXIMUM_LENGTH: null,
            NUMERIC_PRECISION: 10,
            NUMERIC_SCALE: 0,
            COLUMN_COMMENT: 'User ID reference',
            COLUMN_KEY: '',
            EXTRA: '',
          },
        ],
      ];

      // Set up query responses in order
      mockExecute
        .mockResolvedValueOnce(tablesResult)
        .mockResolvedValueOnce(usersColumnsResult)
        .mockResolvedValueOnce(postsColumnsResult)
        .mockResolvedValueOnce(userStatsColumnsResult);

      const schema = await adapter.captureSchema(connection);

      expect(schema.database).toBe('testdb');
      expect(schema.type).toBe('mysql');
      expect(schema.captured_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // Check tables
      expect(Object.keys(schema.tables)).toHaveLength(2);
      expect(schema.tables.users).toBeDefined();
      expect(schema.tables.users.name).toBe('users');
      expect(schema.tables.users.comment).toBe('User accounts');
      expect(schema.tables.users.columns).toHaveLength(2);
      expect(schema.tables.users.columns[0].name).toBe('id');
      expect(schema.tables.users.columns[0].nullable).toBe(false);
      expect(schema.tables.users.columns[0].key).toBe('PRI');
      expect(schema.tables.users.columns[0].extra).toBe('auto_increment');
      expect(schema.tables.users.columns[1].name).toBe('name');
      expect(schema.tables.users.columns[1].max_length).toBe(100);

      // Check views
      expect(Object.keys(schema.views)).toHaveLength(1);
      expect(schema.views.user_stats).toBeDefined();
      expect(schema.views.user_stats.name).toBe('user_stats');
      expect(schema.views.user_stats.type).toBe('VIEW');

      // Check summary
      expect(schema.summary.table_count).toBe(2);
      expect(schema.summary.view_count).toBe(1);
      expect(schema.summary.total_columns).toBe(4);

      // Verify query calls
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('FROM information_schema.TABLES'),
        ['testdb']
      );
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('FROM information_schema.COLUMNS'),
        ['testdb', 'users']
      );
    });

    it('should handle schema capture errors', async () => {
      const schemaError = new Error('Schema query failed');
      mockExecute.mockRejectedValueOnce(schemaError);

      await expect(adapter.captureSchema(connection)).rejects.toThrow(
        'mysql adapter error: Failed to capture MySQL schema - Schema query failed'
      );
    });

    it('should handle empty schema results', async () => {
      const emptyResult = [[]];
      mockExecute.mockResolvedValueOnce(emptyResult);

      const schema = await adapter.captureSchema(connection);

      expect(schema.tables).toEqual({});
      expect(schema.views).toEqual({});
      expect(schema.summary.table_count).toBe(0);
      expect(schema.summary.view_count).toBe(0);
      expect(schema.summary.total_columns).toBe(0);
    });

    it('should handle missing column metadata gracefully', async () => {
      const tablesResult = [
        [{ TABLE_NAME: 'test_table', TABLE_TYPE: 'BASE TABLE', TABLE_COMMENT: null }],
      ];

      const columnsResult = [
        [
          {
            COLUMN_NAME: 'id',
            DATA_TYPE: 'int',
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: null,
            CHARACTER_MAXIMUM_LENGTH: null,
            NUMERIC_PRECISION: null,
            NUMERIC_SCALE: null,
            COLUMN_COMMENT: null,
            COLUMN_KEY: null,
            EXTRA: null,
          },
        ],
      ];

      mockExecute.mockResolvedValueOnce(tablesResult).mockResolvedValueOnce(columnsResult);

      const schema = await adapter.captureSchema(connection);

      expect(schema.tables.test_table.comment).toBe('');
      expect(schema.tables.test_table.columns[0].comment).toBe('');
      expect(schema.tables.test_table.columns[0].key).toBe('');
      expect(schema.tables.test_table.columns[0].extra).toBe('');
    });
  });

  // ============================================================================
  // Integration Scenarios Tests
  // ============================================================================

  describe('integration scenarios', () => {
    it('should handle complete workflow: connect -> query -> transaction -> disconnect', async () => {
      // Connect
      const connection = await adapter.connect();
      expect(adapter.isConnected(connection)).toBe(true);

      // Execute query
      const result = await adapter.executeQuery(connection, 'SELECT * FROM users');
      expect(result).toBeDefined();

      // Transaction workflow
      await adapter.beginTransaction(connection);
      await adapter.executeQuery(connection, 'INSERT INTO users (name) VALUES (?)', ['John']);
      await adapter.commitTransaction(connection);

      // Disconnect (pool connection uses release, not end)
      await adapter.disconnect(connection);
    });

    it('should handle transaction rollback scenario', async () => {
      const connection = await adapter.connect();

      await adapter.beginTransaction(connection);

      // Simulate error during transaction
      // Simulate error during transaction execution
      mockExecute.mockRejectedValueOnce(new Error('Insert failed'));

      try {
        await adapter.executeQuery(connection, 'INSERT INTO users (invalid_column) VALUES (?)', [
          'value',
        ]);
      } catch (error) {
        await adapter.rollbackTransaction(connection);
      }

      expect(mockBeginTransaction).toHaveBeenCalled();
      expect(mockRollback).toHaveBeenCalled();
    });

    it('should handle concurrent connection attempts', async () => {
      const connections = await Promise.all([
        adapter.connect(),
        adapter.connect(),
        adapter.connect(),
      ]);

      expect(connections).toHaveLength(3);
      expect(mockGetConnection).toHaveBeenCalledTimes(3);

      // Clean up connections
      await Promise.all(connections.map((conn) => adapter.disconnect(conn)));
    });

    it('should handle Azure MySQL edge cases', async () => {
      // Test complex Azure hostname
      const complexAzureConfig = {
        ...config,
        host: 'my-very-long-server-name.mysql.database.azure.com',
        username: 'user_name_with_underscores',
      };
      const complexAzureAdapter = new MySQLAdapter(complexAzureConfig);

      await complexAzureAdapter.connect();

      expect(mysql.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          user: 'user_name_with_underscores@my-very-long-server-name',
        })
      );
    });
  });

  // ============================================================================
  // Error Handling and Edge Cases
  // ============================================================================

  describe('error handling and edge cases', () => {
    it('should handle missing field information in query results', async () => {
      const connection = await adapter.connect();

      const resultWithoutFields = [
        [{ id: 1, name: 'test' }],
        // fields array is missing or malformed
        undefined,
      ];
      mockExecute.mockResolvedValueOnce(resultWithoutFields);

      const result = await adapter.executeQuery(connection, 'SELECT * FROM test');
      expect(result.fields).toEqual([]);
    });

    it('should handle SSL configuration edge cases', async () => {
      // Test with SSL as string 'false'
      const sslStringConfig = { ...config, ssl: 'false' as any };
      const sslStringAdapter = new MySQLAdapter(sslStringConfig);

      await sslStringAdapter.connect();

      // Should parse 'false' string as boolean false
      expect(mysql.createPool).toHaveBeenCalledWith(
        expect.not.objectContaining({
          ssl: expect.anything(),
        })
      );
    });

    it('should handle undefined Azure hostname edge cases', async () => {
      const undefinedHostConfig = { ...config, host: undefined };
      const undefinedAdapter = new MySQLAdapter(undefinedHostConfig);

      await expect(undefinedAdapter.connect()).rejects.toThrow(
        'Missing required configuration fields: host'
      );
    });

    it('should handle malformed Azure hostnames', async () => {
      const malformedAzureConfig = {
        ...config,
        host: 'invalid.azure.hostname',
        username: 'testuser',
      };
      const malformedAdapter = new MySQLAdapter(malformedAzureConfig);

      await malformedAdapter.connect();

      // Should not modify username for non-Azure hostnames
      expect(mysql.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          user: 'testuser',
        })
      );
    });

    it('should handle query results with null or undefined rows', async () => {
      const connection = await adapter.connect();

      // Clear the default mock and set specific behavior
      mockExecute.mockReset();
      const nullRowsResult = [
        [], // empty rows array
        [{ name: 'id' }],
      ];
      mockExecute.mockResolvedValueOnce(nullRowsResult);

      const result = await adapter.executeQuery(connection, 'SELECT * FROM test');
      expect(result.rows).toEqual([]);
    });
  });

  // ============================================================================
  // isConnected - dead connection detection (H4)
  // ============================================================================

  describe('isConnected - dead connection detection (H4)', () => {
    // Audit H4: isConnected previously only checked `typeof execute === 'function'`,
    // which is true even after the underlying socket is dead. Now it inspects
    // the core connection's stream.destroyed state.
    it('should return false when the underlying stream is destroyed', () => {
      const mockConn = {
        execute: jest.fn(),
        connection: {
          stream: { destroyed: true },
        },
      };
      expect(adapter.isConnected(mockConn as any)).toBe(false);
    });

    it('should return true when stream is alive and execute is a function', () => {
      const mockConn = {
        execute: jest.fn(),
        connection: {
          stream: { destroyed: false },
        },
      };
      expect(adapter.isConnected(mockConn as any)).toBe(true);
    });

    it('should return true when no stream info is present but execute exists', () => {
      // Fallback for mocked connections without the internal .connection property
      const mockConn = {
        execute: jest.fn(),
      };
      expect(adapter.isConnected(mockConn as any)).toBe(true);
    });

    it('should return false for a missing connection', () => {
      expect(adapter.isConnected(null as any)).toBe(false);
      expect(adapter.isConnected(undefined as any)).toBe(false);
    });
  });

  // ============================================================================
  // Server-side Statement Timeout
  // ============================================================================

  // A runaway query has to be cancelled by the server, not just abandoned by the
  // client, or the connection stays busy. MySQL spells this max_execution_time
  // (milliseconds); MariaDB spells it max_statement_time (seconds).
  describe('applyStatementTimeout', () => {
    const connectWith = async (
      query: jest.Mock,
      overrides: Partial<DatabaseConfig> = {}
    ): Promise<void> => {
      mockGetConnection.mockResolvedValueOnce({ ...mockConnection, query });
      const timeoutAdapter = new MySQLAdapter({ ...config, ...overrides });
      await timeoutAdapter.connect();
    };

    it('should set the MySQL statement timeout in milliseconds', async () => {
      const query = jest.fn().mockResolvedValue(undefined);

      await connectWith(query);

      expect(query).toHaveBeenCalledWith('SET SESSION max_execution_time = ?', [30000]);
    });

    it('should fall back to the MariaDB variable in seconds', async () => {
      const query = jest
        .fn()
        .mockRejectedValueOnce(new Error('Unknown system variable'))
        .mockResolvedValueOnce(undefined);

      await connectWith(query);

      expect(query).toHaveBeenNthCalledWith(2, 'SET SESSION max_statement_time = ?', [30]);
    });

    it('should round the MariaDB timeout up to a whole second', async () => {
      const query = jest
        .fn()
        .mockRejectedValueOnce(new Error('Unknown system variable'))
        .mockResolvedValueOnce(undefined);

      await connectWith(query, { query_timeout: 500 });

      expect(query).toHaveBeenNthCalledWith(2, 'SET SESSION max_statement_time = ?', [1]);
    });

    it('should still connect when the server supports neither variable', async () => {
      const query = jest.fn().mockRejectedValue(new Error('Unknown system variable'));

      await expect(connectWith(query)).resolves.toBeUndefined();
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('should not set a timeout when it is disabled', async () => {
      const query = jest.fn().mockResolvedValue(undefined);

      await connectWith(query, { query_timeout: 0 });

      expect(query).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Pool Teardown
  // ============================================================================

  describe('destroyPool', () => {
    it('should end the pool so the next connect builds a fresh one', async () => {
      await adapter.connect();

      await adapter.destroyPool();

      expect(mockPoolEnd).toHaveBeenCalled();
      await adapter.connect();
      expect(mysql.createPool).toHaveBeenCalledTimes(2);
    });

    it('should do nothing when no pool was ever created', async () => {
      await adapter.destroyPool();

      expect(mockPoolEnd).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Row Streaming
  // ============================================================================

  // executeQuery streams rows rather than buffering them, so a huge result set
  // never fully materializes in the heap. Only the connections that expose the
  // core .connection take this path; the others fall back to buffered execute.
  describe('row streaming', () => {
    const streamingConnection = (
      rows: Record<string, unknown>[],
      opts: { error?: Error; throwOnQuery?: Error; trailing?: () => void } = {}
    ): Record<string, unknown> => {
      const stream = new EventEmitter();
      const core = {
        query: jest.fn(() => {
          if (opts.throwOnQuery) throw opts.throwOnQuery;
          return { stream: () => stream };
        }),
      };

      // Emit once the adapter has attached its listeners.
      process.nextTick(() => {
        for (const row of rows) stream.emit('data', row);
        if (opts.error) stream.emit('error', opts.error);
        else stream.emit('end');
        opts.trailing?.();
      });

      return { ...mockConnection, connection: core };
    };

    const streamAdapter = (overrides: Partial<DatabaseConfig> = {}): MySQLAdapter =>
      new MySQLAdapter({ ...config, ...overrides });

    it('should fall back to buffered execute when the core cannot stream', async () => {
      // A connection object that has .connection but no usable query on it.
      const conn = { ...mockConnection, connection: { notQuery: true } };

      const result = await streamAdapter().executeQuery(conn as any, 'SELECT id FROM users');

      expect(mockExecute).toHaveBeenCalled();
      expect(result.rows).toEqual([{ id: 1, name: 'test' }]);
    });

    it('should return the streamed rows', async () => {
      const conn = streamingConnection([{ id: 1 }, { id: 2 }]);

      const result = await streamAdapter().executeQuery(conn as any, 'SELECT id FROM users');

      expect(result.rows).toEqual([{ id: 1 }, { id: 2 }]);
      expect(result.rowCount).toBe(2);
      expect(result.fields).toEqual(['id']);
      expect(result.truncated).toBe(false);
    });

    it('should retain only max_rows and report the full observed count', async () => {
      const conn = streamingConnection([{ id: 1 }, { id: 2 }, { id: 3 }]);

      const result = await streamAdapter({ max_rows: 2 }).executeQuery(conn as any, 'SELECT 1');

      expect(result.rows).toEqual([{ id: 1 }, { id: 2 }]);
      expect(result.rowCount).toBe(3);
      expect(result.truncated).toBe(true);
    });

    it('should not mark a result truncated at exactly max_rows', async () => {
      const conn = streamingConnection([{ id: 1 }, { id: 2 }]);

      const result = await streamAdapter({ max_rows: 2 }).executeQuery(conn as any, 'SELECT 1');

      expect(result.rows).toHaveLength(2);
      expect(result.truncated).toBe(false);
    });

    it('should reject when the stream errors', async () => {
      const conn = streamingConnection([{ id: 1 }], { error: new Error('connection lost') });

      await expect(streamAdapter().executeQuery(conn as any, 'SELECT 1')).rejects.toThrow(
        'mysql adapter error: Failed to execute MySQL query - connection lost'
      );
    });

    it('should reject when the stream cannot be created', async () => {
      const conn = streamingConnection([], { throwOnQuery: new Error('bad SQL') });

      await expect(streamAdapter().executeQuery(conn as any, 'SELECT 1')).rejects.toThrow(
        'mysql adapter error: Failed to execute MySQL query - bad SQL'
      );
    });

    it('should ignore an error that arrives after the stream ended', async () => {
      const conn = streamingConnection([{ id: 1 }]);
      const stream = ((conn.connection as any).query() as { stream: () => EventEmitter }).stream();

      const result = streamAdapter().executeQuery(conn as any, 'SELECT 1');
      process.nextTick(() => {
        stream.emit('end');
        stream.emit('error', new Error('too late'));
      });

      await expect(result).resolves.toMatchObject({ rowCount: 1 });
    });
  });
});

describe('MySQLAdapter - connection pooling', () => {
  it('returns pool connections (has release method)', async () => {
    const adapter = new MySQLAdapter({
      type: 'mysql',
      host: 'localhost',
      port: 3306,
      database: 'test',
      username: 'root',
      password: 'test',
      select_only: true,
      mcp_configurable: false,
    });
    // Inject a mock pool directly
    const mockRelease = jest.fn();
    const mockConn = { release: mockRelease, execute: jest.fn(), end: jest.fn() };
    const mockPool = { getConnection: jest.fn().mockResolvedValue(mockConn), end: jest.fn() };
    (adapter as unknown as Record<string, unknown>)._pool = mockPool;
    const conn = await adapter.connect();
    expect(conn).toBe(mockConn);
    await adapter.disconnect(conn);
    expect(mockRelease).toHaveBeenCalled();
    expect(mockConn.end).not.toHaveBeenCalled();
  });

  // ============================================================================
  // Performance Recommendations
  // ============================================================================

  describe('getPerformanceRecommendations', () => {
    let adapter: MySQLAdapter;

    beforeEach(() => {
      adapter = new MySQLAdapter({
        type: 'mysql',
        host: 'localhost',
        port: 3306,
        database: 'test',
        username: 'root',
        password: 'test',
        select_only: true,
        mcp_configurable: false,
      });
    });

    const explain = (rows: Record<string, unknown>[]): QueryResult => ({
      rows,
      rowCount: rows.length,
      fields: rows.length > 0 ? Object.keys(rows[0]!) : [],
      truncated: false,
      execution_time_ms: 1,
    });

    const advise = (rows: Record<string, unknown>[], query = 'SELECT id FROM users'): string =>
      adapter.getPerformanceRecommendations(explain(rows), query).join('\n');

    it('should flag a full table scan', () => {
      expect(advise([{ type: 'ALL' }])).toContain('Full table scan detected');
    });

    // Each branch asserts the advice it does NOT give as well. A guard that
    // fired on the mere presence of an Extra column, rather than on what that
    // column says, would otherwise pass every positive assertion here while
    // recommending an index on ORDER BY for a query that never sorts.
    it('should flag a filesort in the Extra column', () => {
      const output = advise([{ type: 'ref', Extra: 'Using where; Using filesort' }]);

      expect(output).toContain('Filesort operation');
      expect(output).not.toContain('Temporary table created');
    });

    it('should flag a temporary table in the Extra column', () => {
      const output = advise([{ type: 'ref', Extra: 'Using temporary' }]);

      expect(output).toContain('Temporary table created');
      expect(output).not.toContain('Filesort operation');
    });

    it('should report each row of a multi-row plan', () => {
      const output = advise([{ type: 'ALL' }, { type: 'ref', Extra: 'Using temporary' }]);

      expect(output).toContain('Full table scan detected');
      expect(output).toContain('Temporary table created');
    });

    // buildExplainQuery asks for EXPLAIN FORMAT=JSON, which returns a single
    // column holding the whole plan rather than the tabular `type` / `Extra`
    // columns. Advice that only reads those columns never fires in production.
    describe('EXPLAIN FORMAT=JSON plans', () => {
      // Pretty-printed, because that is how MySQL returns the plan: the value
      // arrives indented, with a space after each colon.
      const jsonPlan = (queryBlock: Record<string, unknown>): Record<string, unknown>[] => [
        { EXPLAIN: JSON.stringify({ query_block: { select_id: 1, ...queryBlock } }, null, 2) },
      ];

      it('should flag a full table scan', () => {
        const output = advise(
          jsonPlan({
            table: { table_name: 'users', access_type: 'ALL', rows_examined_per_scan: 425 },
          })
        );

        expect(output).toContain('Full table scan detected');
      });

      it('should flag a filesort', () => {
        const output = advise(
          jsonPlan({
            ordering_operation: {
              using_filesort: true,
              table: { table_name: 'users', access_type: 'ref' },
            },
          })
        );

        expect(output).toContain('Filesort operation');
        expect(output).not.toContain('Temporary table created');
      });

      it('should flag a temporary table', () => {
        const output = advise(
          jsonPlan({
            grouping_operation: {
              using_temporary_table: true,
              using_filesort: false,
              table: { table_name: 'users', access_type: 'ref' },
            },
          })
        );

        expect(output).toContain('Temporary table created');
        expect(output).not.toContain('Filesort operation');
      });

      it('should read a plan that is not pretty-printed', () => {
        const compact = JSON.stringify({
          query_block: {
            select_id: 1,
            grouping_operation: {
              using_temporary_table: true,
              using_filesort: true,
              table: { table_name: 'users', access_type: 'ALL' },
            },
          },
        });

        const output = advise([{ EXPLAIN: compact }]);

        expect(output).toContain('Full table scan detected');
        expect(output).toContain('Filesort operation');
        expect(output).toContain('Temporary table created');
      });

      it('should say nothing about a healthy plan', () => {
        const output = advise(
          jsonPlan({ table: { table_name: 'users', access_type: 'const', key: 'PRIMARY' } })
        );

        expect(output).toBe('');
      });
    });

    it('should say nothing about a plan with no problems', () => {
      expect(
        adapter.getPerformanceRecommendations(explain([{ type: 'const' }]), 'SELECT 1')
      ).toEqual([]);
    });

    it('should say nothing about an empty plan', () => {
      expect(adapter.getPerformanceRecommendations(explain([]), 'SELECT 1')).toEqual([]);
    });
  });
});

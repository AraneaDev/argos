/**
 * PostgreSQL Database Adapter Tests
 * Tests the PostgreSQL-specific database adapter implementation
 */

import { PostgreSQLAdapter } from '../../../src/database/adapters/postgresql.js';
import type {
  DatabaseConnection,
  DatabaseConfig,
  QueryResult,
  DatabaseSchema,
} from '../../../src/types/index.js';

// Mock the 'pg' module
const mockQuery = jest.fn();
const mockRelease = jest.fn();
const mockEnd = jest.fn();

const mockStream = { destroyed: false };
const mockClient = {
  query: mockQuery,
  release: mockRelease,
  end: mockEnd,
  connection: { stream: mockStream },
};

const mockPoolConnect = jest.fn().mockResolvedValue(mockClient);
const mockPoolEnd = jest.fn().mockResolvedValue(undefined);

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({
    connect: mockPoolConnect,
    end: mockPoolEnd,
  })),
}));

import * as pg from 'pg';

// ============================================================================
// Test Suite
// ============================================================================

describe('PostgreSQLAdapter', () => {
  let config: DatabaseConfig;
  let adapter: PostgreSQLAdapter;

  beforeEach(() => {
    config = {
      type: 'postgresql',
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      username: 'testuser',
      password: 'testpass',
      timeout: 30000,
      ssl: false,
    };

    adapter = new PostgreSQLAdapter(config);

    // Reset mocks
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({
      rows: [{ id: 1, name: 'test' }],
      fields: [{ name: 'id' }, { name: 'name' }],
      rowCount: 1,
    });
    mockPoolConnect.mockResolvedValue(mockClient);
    mockPoolEnd.mockResolvedValue(undefined);
    mockRelease.mockResolvedValue(undefined);
    mockEnd.mockResolvedValue(undefined);
    mockStream.destroyed = false;
  });

  // ============================================================================
  // Constructor and Configuration Tests
  // ============================================================================

  describe('constructor', () => {
    it('should initialize with valid PostgreSQL config', () => {
      expect(adapter.getType()).toBe('postgresql');
      expect(adapter.getConfig().host).toBe('localhost');
      expect(adapter.getConfig().port).toBe(5432);
    });

    it('should handle port as string', () => {
      const stringPortConfig = { ...config, port: '5433' as any };
      const stringAdapter = new PostgreSQLAdapter(stringPortConfig);
      expect(stringAdapter.getConfig().port).toBe('5433'); // Port remains as string in this implementation
    });
  });

  // ============================================================================
  // Connection Management Tests
  // ============================================================================

  describe('connect', () => {
    it('should connect to PostgreSQL database successfully', async () => {
      const connection = await adapter.connect();

      expect(pg.Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 5432,
          database: 'testdb',
          user: 'testuser',
          password: 'testpass',
          connectionTimeoutMillis: 30000,
          ssl: false,
        })
      );
      expect(mockPoolConnect).toHaveBeenCalled();
      expect(connection).toBe(mockClient);
    });

    it('should handle SSL configuration', async () => {
      const sslConfig = { ...config, ssl: true };
      const sslAdapter = new PostgreSQLAdapter(sslConfig);

      await sslAdapter.connect();

      expect(pg.Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          ssl: { rejectUnauthorized: true },
        })
      );
    });

    it('should default ssl_verify to true when SSL is enabled but ssl_verify is not set', async () => {
      const sslConfig = { ...config, ssl: true };
      // ssl_verify is intentionally NOT set
      const sslAdapter = new PostgreSQLAdapter(sslConfig);

      await sslAdapter.connect();

      expect(pg.Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          ssl: { rejectUnauthorized: true },
        })
      );
    });

    it('should allow ssl_verify=false to explicitly disable certificate verification', async () => {
      const sslConfig = { ...config, ssl: true, ssl_verify: false };
      const sslAdapter = new PostgreSQLAdapter(sslConfig);

      await sslAdapter.connect();

      expect(pg.Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          ssl: { rejectUnauthorized: false },
        })
      );
    });

    it('should handle SSL disabled', async () => {
      const sslConfig = { ...config, ssl: false };
      const sslAdapter = new PostgreSQLAdapter(sslConfig);

      await sslAdapter.connect();

      expect(pg.Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          ssl: false,
        })
      );
    });

    it('should validate required configuration fields', async () => {
      const incompleteConfig = { type: 'postgresql' as const };
      const incompleteAdapter = new PostgreSQLAdapter(incompleteConfig);

      await expect(incompleteAdapter.connect()).rejects.toThrow(
        'Missing required configuration fields: host, database, username, password'
      );
    });

    it('should handle connection errors', async () => {
      const connectionError = new Error('Connection failed');
      mockPoolConnect.mockRejectedValueOnce(connectionError);

      await expect(adapter.connect()).rejects.toThrow(
        'postgresql adapter error: Failed to acquire PostgreSQL connection from pool - Connection failed'
      );
    });

    it('should use default port when not specified', async () => {
      const noPortConfig = { ...config };
      delete noPortConfig.port;
      const noPortAdapter = new PostgreSQLAdapter(noPortConfig);

      await noPortAdapter.connect();

      expect(pg.Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 5432,
        })
      );
    });
  });

  describe('disconnect', () => {
    it('should release pool client on disconnect', async () => {
      const connection = await adapter.connect();
      await adapter.disconnect(connection);

      expect(mockRelease).toHaveBeenCalled();
      expect(mockEnd).not.toHaveBeenCalled();
    });

    it('should handle disconnect errors', async () => {
      const disconnectError = new Error('Disconnect failed');
      mockRelease.mockImplementationOnce(() => {
        throw disconnectError;
      });

      const connection = await adapter.connect();
      await expect(adapter.disconnect(connection)).rejects.toThrow(
        'postgresql adapter error: Failed to release PostgreSQL connection to pool - Disconnect failed'
      );
    });
  });

  // ============================================================================
  // Pool Configuration
  // ============================================================================

  describe('read-only session', () => {
    it('should not touch the session when read_only_session is unset', async () => {
      await adapter.connect();

      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should make the session read-only when read_only_session is set', async () => {
      const ro = new PostgreSQLAdapter({ ...config, read_only_session: true });

      await ro.connect();

      expect(mockQuery).toHaveBeenCalledWith(
        'SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY'
      );
    });

    it('should release the client and fail when the session cannot be made read-only', async () => {
      mockQuery.mockRejectedValueOnce(new Error('nope'));
      const ro = new PostgreSQLAdapter({ ...config, read_only_session: true });

      await expect(ro.connect()).rejects.toThrow();
      expect(mockRelease).toHaveBeenCalled();
    });
  });

  describe('pool configuration', () => {
    const poolConfigAfterConnect = async (
      overrides: Partial<DatabaseConfig>
    ): Promise<Record<string, unknown>> => {
      await new PostgreSQLAdapter({ ...config, ...overrides } as DatabaseConfig).connect();
      const calls = (pg.Pool as unknown as jest.Mock).mock.calls;
      return calls[calls.length - 1][0] as Record<string, unknown>;
    };

    // PostgreSQL cancels the statement itself, so this value is the only thing
    // stopping a runaway query from holding the connection open.
    it('should apply the configured query timeout to the server', async () => {
      const poolConfig = await poolConfigAfterConnect({ query_timeout: 4000 });

      expect(poolConfig.statement_timeout).toBe(4000);
      expect(poolConfig.query_timeout).toBe(4000);
    });

    it('should fall back to the connection timeout', async () => {
      const poolConfig = await poolConfigAfterConnect({
        query_timeout: undefined,
        timeout: 9000,
      });

      expect(poolConfig.statement_timeout).toBe(9000);
    });

    it('should leave SSL unset when it is not configured', async () => {
      const { ssl: _ssl, ...withoutSsl } = config;
      await new PostgreSQLAdapter(withoutSsl as DatabaseConfig).connect();
      const calls = (pg.Pool as unknown as jest.Mock).mock.calls;

      expect(calls[calls.length - 1][0]).not.toHaveProperty('ssl');
    });

    it('should disable SSL explicitly when it is configured off', async () => {
      const poolConfig = await poolConfigAfterConnect({ ssl: false });

      expect(poolConfig.ssl).toBe(false);
    });

    it('should treat a null SSL setting as off rather than on', async () => {
      const poolConfig = await poolConfigAfterConnect({ ssl: null as never });

      expect(poolConfig.ssl).toBe(false);
    });
  });

  describe('destroyPool', () => {
    it('should end the pool so the next connect builds a fresh one', async () => {
      await adapter.connect();

      await adapter.destroyPool();

      expect(mockPoolEnd).toHaveBeenCalled();
      await adapter.connect();
      expect(pg.Pool as unknown as jest.Mock).toHaveBeenCalledTimes(2);
    });

    it('should do nothing when no pool was ever created', async () => {
      await adapter.destroyPool();

      expect(mockPoolEnd).not.toHaveBeenCalled();
    });
  });

  describe('isConnected', () => {
    it('should return false when the client has no stream', async () => {
      expect(adapter.isConnected({ connection: {} } as never)).toBe(false);
    });

    it('should return true for connected client', async () => {
      const connection = await adapter.connect();
      mockStream.destroyed = false;

      expect(adapter.isConnected(connection)).toBe(true);
    });

    it('should return false for disconnected client', async () => {
      const connection = await adapter.connect();
      mockStream.destroyed = true;

      expect(adapter.isConnected(connection)).toBe(false);
    });

    it('should return false for invalid connection', () => {
      expect(adapter.isConnected(null as any)).toBe(false);
      expect(adapter.isConnected({} as any)).toBe(false);
    });

    it('should handle exceptions gracefully', () => {
      const badConnection = {
        connection: {
          get stream() {
            throw new Error('Property access failed');
          },
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
      const mockResult = {
        rows: [
          { id: 1, name: 'John' },
          { id: 2, name: 'Jane' },
        ],
        fields: [{ name: 'id' }, { name: 'name' }],
        rowCount: 2,
      };
      mockQuery.mockResolvedValueOnce(mockResult);

      const result = await adapter.executeQuery(connection, 'SELECT * FROM users');

      expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM users', []);
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
      const mockResult = {
        rows: [{ id: 1, name: 'John' }],
        fields: [{ name: 'id' }, { name: 'name' }],
        rowCount: 1,
      };
      mockQuery.mockResolvedValueOnce(mockResult);

      await adapter.executeQuery(connection, 'SELECT * FROM users WHERE id = $1', [1]);

      expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM users WHERE id = $1', [1]);
    });

    it('should handle query execution errors', async () => {
      const queryError = new Error('Query execution failed');
      mockQuery.mockRejectedValueOnce(queryError);

      await expect(adapter.executeQuery(connection, 'INVALID SQL')).rejects.toThrow(
        'postgresql adapter error: Failed to execute PostgreSQL query - Query execution failed'
      );
    });

    it('should handle empty result sets', async () => {
      const mockResult = {
        rows: [],
        fields: [],
        rowCount: 0,
      };
      mockQuery.mockResolvedValueOnce(mockResult);

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
      const mockResult = {
        rows: largeRowSet,
        fields: [{ name: 'id' }, { name: 'name' }],
        rowCount: 1500,
      };
      mockQuery.mockResolvedValueOnce(mockResult);

      const result = await adapter.executeQuery(connection, 'SELECT * FROM large_table');

      expect(result.rows).toHaveLength(1000); // Should be truncated to max_rows
      expect(result.rowCount).toBe(1500); // Original count before truncation
      expect(result.truncated).toBe(true);
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
        expect(mockQuery).toHaveBeenCalledWith('BEGIN');
      });

      it('should handle begin transaction errors', async () => {
        const transactionError = new Error('Begin failed');
        mockQuery.mockRejectedValueOnce(transactionError);

        await expect(adapter.beginTransaction(connection)).rejects.toThrow(
          'postgresql adapter error: Failed to begin PostgreSQL transaction - Begin failed'
        );
      });
    });

    describe('commitTransaction', () => {
      it('should commit transaction successfully', async () => {
        await adapter.commitTransaction(connection);
        expect(mockQuery).toHaveBeenCalledWith('COMMIT');
      });

      it('should handle commit transaction errors', async () => {
        const commitError = new Error('Commit failed');
        mockQuery.mockRejectedValueOnce(commitError);

        await expect(adapter.commitTransaction(connection)).rejects.toThrow(
          'postgresql adapter error: Failed to commit PostgreSQL transaction - Commit failed'
        );
      });
    });

    describe('rollbackTransaction', () => {
      it('should rollback transaction successfully', async () => {
        await adapter.rollbackTransaction(connection);
        expect(mockQuery).toHaveBeenCalledWith('ROLLBACK');
      });

      it('should handle rollback transaction errors', async () => {
        const rollbackError = new Error('Rollback failed');
        mockQuery.mockRejectedValueOnce(rollbackError);

        await expect(adapter.rollbackTransaction(connection)).rejects.toThrow(
          'postgresql adapter error: Failed to rollback PostgreSQL transaction - Rollback failed'
        );
      });
    });
  });

  // ============================================================================
  // Performance Analysis Tests
  // ============================================================================

  describe('buildExplainQuery', () => {
    it('should build PostgreSQL explain query with analysis', () => {
      const query = 'SELECT * FROM users WHERE active = true';
      const explainQuery = adapter.buildExplainQuery(query);

      expect(explainQuery).toBe(
        'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM users WHERE active = true'
      );
    });

    it('should handle complex queries', () => {
      const complexQuery = `
 SELECT u.name, p.title 
 FROM users u 
 JOIN posts p ON u.id = p.user_id 
 WHERE u.created_at > '2023-01-01'
 `;

      const explainQuery = adapter.buildExplainQuery(complexQuery);
      expect(explainQuery).toContain('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)');
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
      const tablesResult = {
        rows: [
          { table_name: 'users', table_type: 'BASE TABLE', table_comment: 'User accounts' },
          { table_name: 'posts', table_type: 'BASE TABLE', table_comment: '' },
          { table_name: 'user_stats', table_type: 'VIEW', table_comment: 'User statistics view' },
        ],
      };

      // Mock columns query results
      const usersColumnsResult = {
        rows: [
          {
            column_name: 'id',
            data_type: 'integer',
            is_nullable: 'NO',
            column_default: "nextval('users_id_seq'::regclass)",
            character_maximum_length: null,
            numeric_precision: 32,
            numeric_scale: 0,
            column_comment: 'Primary key',
          },
          {
            column_name: 'name',
            data_type: 'character varying',
            is_nullable: 'NO',
            column_default: null,
            character_maximum_length: 100,
            numeric_precision: null,
            numeric_scale: null,
            column_comment: 'Full name',
          },
        ],
      };

      const postsColumnsResult = {
        rows: [
          {
            column_name: 'id',
            data_type: 'integer',
            is_nullable: 'NO',
            column_default: "nextval('posts_id_seq'::regclass)",
            character_maximum_length: null,
            numeric_precision: 32,
            numeric_scale: 0,
            column_comment: '',
          },
        ],
      };

      const userStatsColumnsResult = {
        rows: [
          {
            column_name: 'user_id',
            data_type: 'integer',
            is_nullable: 'YES',
            column_default: null,
            character_maximum_length: null,
            numeric_precision: 32,
            numeric_scale: 0,
            column_comment: 'User ID reference',
          },
        ],
      };

      // Set up query responses in order
      mockQuery
        .mockResolvedValueOnce(tablesResult)
        .mockResolvedValueOnce(usersColumnsResult)
        .mockResolvedValueOnce(postsColumnsResult)
        .mockResolvedValueOnce(userStatsColumnsResult);

      const schema = await adapter.captureSchema(connection);

      expect(schema.database).toBe('testdb');
      expect(schema.type).toBe('postgresql');
      expect(schema.captured_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // Check tables
      expect(Object.keys(schema.tables)).toHaveLength(2);
      expect(schema.tables.users).toBeDefined();
      expect(schema.tables.users.name).toBe('users');
      expect(schema.tables.users.comment).toBe('User accounts');
      expect(schema.tables.users.columns).toHaveLength(2);
      expect(schema.tables.users.columns[0].name).toBe('id');
      expect(schema.tables.users.columns[0].nullable).toBe(false);
      expect(schema.tables.users.columns[1].name).toBe('name');
      expect(schema.tables.users.columns[1].max_length).toBe(100);

      // Nullability is read off the 'YES'/'NO' text, so both spellings need an
      // assertion or a mapping that always answers the same way looks correct.
      expect(schema.views.user_stats.columns[0].nullable).toBe(true);
      expect(schema.tables.users.columns[0].comment).toBe('Primary key');
      expect(schema.tables.posts.columns[0].comment).toBe('');

      // Check views
      expect(Object.keys(schema.views)).toHaveLength(1);
      expect(schema.views.user_stats).toBeDefined();
      expect(schema.views.user_stats.name).toBe('user_stats');
      expect(schema.views.user_stats.type).toBe('VIEW');

      // Check summary
      expect(schema.summary.table_count).toBe(2);
      expect(schema.summary.view_count).toBe(1);
      expect(schema.summary.total_columns).toBe(4);
    });

    it('should handle schema capture errors', async () => {
      const schemaError = new Error('Schema query failed');
      mockQuery.mockRejectedValueOnce(schemaError);

      await expect(adapter.captureSchema(connection)).rejects.toThrow(
        'postgresql adapter error: Failed to capture PostgreSQL schema - Schema query failed'
      );
    });

    it('should handle empty schema results', async () => {
      const emptyResult = { rows: [] };
      mockQuery.mockResolvedValueOnce(emptyResult);

      const schema = await adapter.captureSchema(connection);

      expect(schema.tables).toEqual({});
      expect(schema.views).toEqual({});
      expect(schema.summary.table_count).toBe(0);
      expect(schema.summary.view_count).toBe(0);
      expect(schema.summary.total_columns).toBe(0);
    });
  });

  // ============================================================================
  // PostgreSQL-specific Methods Tests
  // ============================================================================

  describe('PostgreSQL-specific methods', () => {
    let connection: DatabaseConnection;

    beforeEach(async () => {
      connection = await adapter.connect();
    });

    describe('getVersion', () => {
      it('should get PostgreSQL version successfully', async () => {
        const versionResult = {
          rows: [{ version: 'PostgreSQL 13.4 on x86_64-pc-linux-gnu' }],
        };
        mockQuery.mockResolvedValueOnce(versionResult);

        const version = await adapter.getVersion(connection);

        expect(mockQuery).toHaveBeenCalledWith('SELECT version()');
        expect(version).toBe('PostgreSQL 13.4 on x86_64-pc-linux-gnu');
      });

      it('should handle version query errors', async () => {
        const versionError = new Error('Version query failed');
        mockQuery.mockRejectedValueOnce(versionError);

        await expect(adapter.getVersion(connection)).rejects.toThrow(
          'postgresql adapter error: Failed to get PostgreSQL version - Version query failed'
        );
      });

      it('should handle empty version result', async () => {
        const emptyResult = { rows: [] };
        mockQuery.mockResolvedValueOnce(emptyResult);

        const version = await adapter.getVersion(connection);
        expect(version).toBe('Unknown');
      });
    });

    describe('getDatabaseSize', () => {
      it('should get database size successfully', async () => {
        const sizeResult = {
          rows: [{ size: '42 MB' }],
        };
        mockQuery.mockResolvedValueOnce(sizeResult);

        const size = await adapter.getDatabaseSize(connection);

        expect(mockQuery).toHaveBeenCalledWith(
          `
 SELECT pg_size_pretty(pg_database_size($1)) as size
 `,
          ['testdb']
        );
        expect(size).toBe('42 MB');
      });

      it('should report an unknown size when the query returns nothing', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });

        expect(await adapter.getDatabaseSize(connection)).toBe('Unknown');
      });

      it('should handle database size query errors', async () => {
        const sizeError = new Error('Size query failed');
        mockQuery.mockRejectedValueOnce(sizeError);

        await expect(adapter.getDatabaseSize(connection)).rejects.toThrow(
          'postgresql adapter error: Failed to get PostgreSQL database size - Size query failed'
        );
      });
    });

    describe('getTableStats', () => {
      it('should get table statistics successfully', async () => {
        const statsResult = {
          rows: [
            {
              schemaname: 'public',
              tablename: 'users',
              attname: 'id',
              n_distinct: -1,
              correlation: 1,
            },
            {
              schemaname: 'public',
              tablename: 'users',
              attname: 'name',
              n_distinct: 100,
              correlation: 0.1,
            },
          ],
        };
        mockQuery.mockResolvedValueOnce(statsResult);

        const stats = await adapter.getTableStats(connection, 'users');

        expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM pg_stats'), ['users']);
        expect(stats.table).toBe('users');
        expect(stats.columns).toHaveLength(2);
      });

      it('should handle table stats query errors', async () => {
        const statsError = new Error('Stats query failed');
        mockQuery.mockRejectedValueOnce(statsError);

        await expect(adapter.getTableStats(connection, 'users')).rejects.toThrow(
          'postgresql adapter error: Failed to get PostgreSQL table statistics - Stats query failed'
        );
      });
    });
  });

  // ============================================================================
  // Error Handling and Edge Cases
  // ============================================================================

  describe('error handling and edge cases', () => {
    it('should handle malformed query results gracefully', async () => {
      const connection = await adapter.connect();

      // Mock a result without the expected structure
      const malformedResult = {
        // Missing rows and fields properties
        rowCount: 0,
      };
      mockQuery.mockResolvedValueOnce(malformedResult);

      const result = await adapter.executeQuery(connection, 'SELECT 1');

      // Should handle gracefully and return empty results
      expect(result.rows).toEqual([]);
      expect(result.fields).toEqual([]);
    });

    it('should handle SSL configuration edge cases', async () => {
      // Test with SSL as string 'true'
      const sslStringConfig = { ...config, ssl: 'true' as any };
      const sslStringAdapter = new PostgreSQLAdapter(sslStringConfig);

      await sslStringAdapter.connect();

      expect(pg.Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          ssl: { rejectUnauthorized: true }, // Should be parsed as SSL object since it's truthy
        })
      );
    });

    it('should handle missing field information in query results', async () => {
      const connection = await adapter.connect();

      const resultWithoutFields = {
        rows: [{ id: 1, name: 'test' }],
        // fields property is missing
        rowCount: 1,
      };
      mockQuery.mockResolvedValueOnce(resultWithoutFields);

      const result = await adapter.executeQuery(connection, 'SELECT * FROM test');
      expect(result.fields).toEqual([]);
    });

    it('should handle concurrent connection attempts', async () => {
      const connections = await Promise.all([
        adapter.connect(),
        adapter.connect(),
        adapter.connect(),
      ]);

      expect(connections).toHaveLength(3);
      expect(mockPoolConnect).toHaveBeenCalledTimes(3);

      // Clean up connections
      await Promise.all(connections.map((conn) => adapter.disconnect(conn)));
    });
  });

  // ============================================================================
  // Integration-style Tests
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
      await adapter.executeQuery(connection, 'INSERT INTO users (name) VALUES ($1)', ['John']);
      await adapter.commitTransaction(connection);

      // Disconnect (releases back to pool)
      await adapter.disconnect(connection);
      expect(mockRelease).toHaveBeenCalled();
    });

    it('should handle transaction rollback scenario', async () => {
      const connection = await adapter.connect();

      await adapter.beginTransaction(connection);

      // Simulate error during transaction by setting up the mock to fail on the INSERT
      mockQuery.mockRejectedValueOnce(new Error('Operation failed'));

      try {
        await adapter.executeQuery(connection, 'INSERT INTO users (invalid_column) VALUES ($1)', [
          'value',
        ]);
      } catch (error) {
        await adapter.rollbackTransaction(connection);
      }

      expect(mockQuery).toHaveBeenCalledWith('BEGIN');
      expect(mockQuery).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  // ============================================================================
  // Connection Pooling Tests
  // ============================================================================

  describe('PostgreSQLAdapter - connection pooling', () => {
    it('returns pool clients (has release method)', async () => {
      const poolAdapter = new PostgreSQLAdapter({
        type: 'postgresql',
        host: 'localhost',
        port: 5432,
        database: 'test',
        username: 'postgres',
        password: 'test',
        select_only: true,
        mcp_configurable: false,
      });
      const mockReleaseInner = jest.fn();
      const mockClientInner = { release: mockReleaseInner, query: jest.fn(), end: jest.fn() };
      const mockPoolInner = {
        connect: jest.fn().mockResolvedValue(mockClientInner),
        end: jest.fn(),
      };
      (poolAdapter as unknown as Record<string, unknown>)._pool = mockPoolInner;
      const conn = await poolAdapter.connect();
      expect(conn).toBe(mockClientInner);
      await poolAdapter.disconnect(conn);
      expect(mockReleaseInner).toHaveBeenCalled();
      expect(mockClientInner.end).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Performance Recommendations
  // ============================================================================

  describe('getPerformanceRecommendations', () => {
    const explain = (rows: Record<string, unknown>[]): QueryResult => ({
      rows,
      rowCount: rows.length,
      fields: rows.length > 0 ? Object.keys(rows[0]!) : [],
      truncated: false,
      execution_time_ms: 1,
    });

    const advise = (rows: Record<string, unknown>[], query = 'SELECT id FROM users'): string =>
      adapter.getPerformanceRecommendations(explain(rows), query).join('\n');

    it('should flag a sequential scan', () => {
      expect(advise([{ 'QUERY PLAN': 'Seq Scan on users  (cost=0.00..1.00 rows=1)' }])).toContain(
        'Sequential scan detected'
      );
    });

    it('should flag nested loops that report buffer usage', () => {
      const output = advise([
        { 'QUERY PLAN': 'Nested Loop  (cost=0.00..8.00 rows=1)' },
        { 'QUERY PLAN': '  Buffers: shared hit=4' },
      ]);

      expect(output).toContain('Nested loops with buffer usage');
    });

    it('should not flag nested loops without buffer usage', () => {
      expect(advise([{ 'QUERY PLAN': 'Nested Loop  (cost=0.00..8.00 rows=1)' }])).not.toContain(
        'Nested loops with buffer usage'
      );
    });

    it('should not flag buffer usage without nested loops', () => {
      const output = advise([
        { 'QUERY PLAN': 'Index Scan using users_pkey on users' },
        { 'QUERY PLAN': '  Buffers: shared hit=4' },
      ]);

      expect(output).not.toContain('Nested loops with buffer usage');
    });

    it('should suggest full-text search for a wildcard LIKE', () => {
      const output = advise(
        [{ 'QUERY PLAN': 'Index Scan using users_pkey on users' }],
        "SELECT id FROM users WHERE name LIKE '%ab%'"
      );

      expect(output).toContain('full-text search');
    });

    it('should not suggest full-text search for a LIKE without wildcards', () => {
      const output = advise(
        [{ 'QUERY PLAN': 'Index Scan using users_pkey on users' }],
        "SELECT id FROM users WHERE name LIKE 'ab'"
      );

      expect(output).not.toContain('full-text search');
    });

    it('should not suggest full-text search for a wildcard outside a LIKE', () => {
      const output = advise(
        [{ 'QUERY PLAN': 'Index Scan using users_pkey on users' }],
        'SELECT id FROM users WHERE id % 2 = 0'
      );

      expect(output).not.toContain('full-text search');
    });

    // The plan is flattened to one string before it is searched for multi-word
    // phrases, so the separators are load-bearing: drop them and adjacent
    // tokens fuse into words that no longer match.
    it('should keep plan columns from running together', () => {
      const output = advise([{ node: 'Seq', detail: 'Scan on users' }]);

      expect(output).toContain('Sequential scan detected');
    });

    it('should keep plan rows from running together', () => {
      const output = advise([{ 'QUERY PLAN': 'Seq' }, { 'QUERY PLAN': 'Scan on users' }]);

      expect(output).toContain('Sequential scan detected');
    });

    it('should say nothing about a plan with no problems', () => {
      const result = adapter.getPerformanceRecommendations(
        explain([{ 'QUERY PLAN': 'Index Scan using users_pkey on users' }]),
        'SELECT id FROM users'
      );

      expect(result).toEqual([]);
    });
  });
});

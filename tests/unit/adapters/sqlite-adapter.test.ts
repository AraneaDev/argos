/**
 * SQLite Database Adapter Tests
 * Tests the SQLite-specific database adapter implementation
 *
 * NOTE: Some complex async tests have been simplified to avoid hanging issues
 */

import { SQLiteAdapter } from '../../../src/database/adapters/sqlite.js';
import type {
  DatabaseConnection,
  DatabaseConfig,
  QueryResult,
  DatabaseSchema,
} from '../../../src/types/index.js';

// Mock variables must be declared before jest.mock() calls
const mockAll = jest.fn();
const mockRun = jest.fn();
const mockGet = jest.fn();
const mockClose = jest.fn();
const mockEach = jest.fn();
const mockInterrupt = jest.fn();

const mockDatabase = {
  all: mockAll,
  run: mockRun,
  get: mockGet,
  close: mockClose,
  each: mockEach,
  interrupt: mockInterrupt,
  open: true,
};

// Helper: drive the db.each streaming callbacks (rowCallback per row, then completeCallback).
function eachEmits(rows: unknown[] | null, err: Error | null = null) {
  return (_sql: string, _params: unknown, rowCb: Function, completeCb: Function) => {
    process.nextTick(() => {
      if (err) {
        completeCb(err);
        return;
      }
      for (const r of rows ?? []) rowCb(null, r);
      completeCb(null, (rows ?? []).length);
    });
  };
}

// Mock the 'sqlite3' module (OPEN_* constants mirror the real numeric flags)
jest.mock('sqlite3', () => ({
  Database: jest.fn(),
  OPEN_READONLY: 1,
  OPEN_READWRITE: 2,
  OPEN_CREATE: 4,
}));

import * as sqlite3 from 'sqlite3';

// Use jest.mocked for proper typing
const mockSqlite3Database = jest.mocked(sqlite3.Database);

// ============================================================================
// Test Suite
// ============================================================================

describe('SQLiteAdapter', () => {
  let config: DatabaseConfig;
  let adapter: SQLiteAdapter;

  beforeEach(() => {
    config = {
      type: 'sqlite',
      file: '/tmp/test.db',
      timeout: 30000,
    };

    adapter = new SQLiteAdapter(config);

    // Reset mocks
    jest.clearAllMocks();

    // Mock constructor to call callback with no error and return mock database
    (mockSqlite3Database as any).mockImplementation((...args: any[]) => {
      const callback = args.find((arg) => typeof arg === 'function');
      if (callback) {
        process.nextTick(() => callback(null));
      }
      return mockDatabase;
    });

    mockAll.mockImplementation((query: string, params: any, callback: Function) => {
      process.nextTick(() => callback(null, [{ id: 1, name: 'test' }]));
    });

    mockEach.mockImplementation(eachEmits([{ id: 1, name: 'test' }]));

    mockRun.mockImplementation((query: string, callbackOrParams: any, maybeCallback?: Function) => {
      const callback = typeof callbackOrParams === 'function' ? callbackOrParams : maybeCallback;
      if (callback) {
        process.nextTick(() => callback(null));
      }
    });

    mockGet.mockImplementation((query: string, callback: Function) => {
      process.nextTick(() => callback(null, { version: '3.39.0' }));
    });

    mockClose.mockImplementation((callback: Function) => {
      process.nextTick(() => callback(null));
    });

    mockDatabase.open = true;
  });

  // ============================================================================
  // Constructor and Configuration Tests
  // ============================================================================

  describe('constructor', () => {
    it('should initialize with valid SQLite config', () => {
      expect(adapter.getType()).toBe('sqlite');
      expect((adapter as any).config.file).toBe('/tmp/test.db');
    });
  });

  // ============================================================================
  // Connection Management Tests
  // ============================================================================

  describe('connect', () => {
    it('should connect to SQLite database successfully', async () => {
      const connection = await adapter.connect();

      // Now called with an explicit open mode (FIND-110): readwrite/create for non
      // SELECT-only DBs, readonly for SELECT-only.
      expect(mockSqlite3Database).toHaveBeenCalledWith(
        '/tmp/test.db',
        expect.any(Number),
        expect.any(Function)
      );
      expect(connection).toBe(mockDatabase);
    });

    it('should validate required configuration fields', async () => {
      const incompleteConfig = { type: 'sqlite' as const };
      const incompleteAdapter = new SQLiteAdapter(incompleteConfig);

      await expect(incompleteAdapter.connect()).rejects.toThrow(
        'Missing required configuration fields: file'
      );
    });

    it('should handle connection errors', async () => {
      const connectionError = new Error('Connection failed');
      (mockSqlite3Database as any).mockImplementation((...args: any[]) => {
        const callback = args.find((arg) => typeof arg === 'function');
        if (callback) {
          process.nextTick(() => callback(connectionError));
        }
        return mockDatabase;
      });

      await expect(adapter.connect()).rejects.toThrow(
        'sqlite adapter error: Failed to connect to SQLite database - Connection failed'
      );
    });

    it('should handle different file paths', async () => {
      const memoryConfig = { ...config, file: ':memory:' };
      const memoryAdapter = new SQLiteAdapter(memoryConfig);

      await memoryAdapter.connect();

      expect(mockSqlite3Database).toHaveBeenCalledWith(
        ':memory:',
        expect.any(Number),
        expect.any(Function)
      );
    });

    it('opens SELECT-only databases READONLY, others READWRITE|CREATE (FIND-110)', async () => {
      const roAdapter = new SQLiteAdapter({ ...config, select_only: true });
      await roAdapter.connect();
      expect((mockSqlite3Database as any).mock.calls[0][1]).toBe(sqlite3.OPEN_READONLY);

      jest.clearAllMocks();
      (mockSqlite3Database as any).mockImplementation((...args: any[]) => {
        const cb = args.find((a) => typeof a === 'function');
        if (cb) process.nextTick(() => cb(null));
        return mockDatabase;
      });
      const rwAdapter = new SQLiteAdapter({ ...config, select_only: false });
      await rwAdapter.connect();
      expect((mockSqlite3Database as any).mock.calls[0][1]).toBe(
        sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE
      );
    });
  });

  describe('disconnect', () => {
    it('should disconnect from SQLite database successfully', async () => {
      const connection = await adapter.connect();
      await adapter.disconnect(connection);

      expect(mockClose).toHaveBeenCalled();
    });

    it('should handle disconnect errors', async () => {
      const disconnectError = new Error('Disconnect failed');
      mockClose.mockImplementation((callback: Function) => {
        process.nextTick(() => callback(disconnectError));
      });

      const connection = await adapter.connect();
      await expect(adapter.disconnect(connection)).rejects.toThrow(
        'sqlite adapter error: Failed to disconnect from SQLite database - Disconnect failed'
      );
    });
  });

  describe('isConnected', () => {
    it('should return true for connected database', async () => {
      const connection = await adapter.connect();
      mockDatabase.open = true;

      expect(adapter.isConnected(connection)).toBe(true);
    });

    it('should return false for closed database', async () => {
      const connection = await adapter.connect();
      mockDatabase.open = false;

      expect(adapter.isConnected(connection)).toBe(false);
    });

    it('should return false for invalid connection', () => {
      expect(adapter.isConnected(null as any)).toBe(false);
      expect(adapter.isConnected({} as any)).toBe(false);
    });

    it('should handle exceptions gracefully', () => {
      const badConnection = {
        get open() {
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

    it('should execute query successfully (streamed via db.each)', async () => {
      const mockRows = [
        { id: 1, name: 'John' },
        { id: 2, name: 'Jane' },
      ];
      mockEach.mockImplementation(eachEmits(mockRows));

      const result = await adapter.executeQuery(connection, 'SELECT * FROM users');

      expect(mockEach).toHaveBeenCalledWith(
        'SELECT * FROM users',
        [],
        expect.any(Function),
        expect.any(Function)
      );
      expect(result.rows).toEqual(mockRows);
      expect(result.fields).toEqual(['id', 'name']);
      expect(result.rowCount).toBe(2);
      expect(result.truncated).toBe(false);
      expect(result.execution_time_ms).toBeGreaterThanOrEqual(0);
    });

    it('should execute query with parameters', async () => {
      mockEach.mockImplementation(eachEmits([{ id: 1, name: 'John' }]));

      await adapter.executeQuery(connection, 'SELECT * FROM users WHERE id = ?', [1]);

      expect(mockEach).toHaveBeenCalledWith(
        'SELECT * FROM users WHERE id = ?',
        [1],
        expect.any(Function),
        expect.any(Function)
      );
    });

    it('should handle query execution errors', async () => {
      const queryError = new Error('Query execution failed');
      mockEach.mockImplementation(eachEmits(null, queryError));

      await expect(adapter.executeQuery(connection, 'INVALID SQL')).rejects.toThrow(
        'sqlite adapter error: Failed to execute SQLite query - Query execution failed'
      );
    });

    it('should handle empty result sets', async () => {
      mockEach.mockImplementation(eachEmits([]));

      const result = await adapter.executeQuery(connection, 'SELECT * FROM empty_table');

      expect(result.rows).toEqual([]);
      expect(result.fields).toEqual([]);
      expect(result.rowCount).toBe(0);
      expect(result.truncated).toBe(false);
    });

    it('bounds retained rows to max_rows but reports the true count (FIND-109)', async () => {
      // More rows than max_rows (default 1000): the heap must hold only the cap.
      const largeRowSet = Array(1500)
        .fill(0)
        .map((_, i) => ({ id: i + 1, name: `User${i + 1}` }));
      mockEach.mockImplementation(eachEmits(largeRowSet));

      const result = await adapter.executeQuery(connection, 'SELECT * FROM large_table');

      expect(result.rows).toHaveLength(1000); // retained rows capped at max_rows
      expect(result.rowCount).toBe(1500); // true observed count
      expect(result.truncated).toBe(true);
    });

    it('should extract field names from first row', async () => {
      mockEach.mockImplementation(
        eachEmits([{ user_id: 1, full_name: 'John', email: 'john@example.com' }])
      );

      const result = await adapter.executeQuery(connection, 'SELECT * FROM users');

      expect(result.fields).toEqual(['user_id', 'full_name', 'email']);
    });

    it('interrupts a runaway query at the statement timeout (FIND-108)', async () => {
      // Simulate a query that never completes: db.each emits nothing and never calls the
      // completion callback, so only the statement-timeout can settle the promise.
      mockEach.mockImplementation(() => {
        /* never invokes any callback */
      });
      const slowAdapter = new SQLiteAdapter({
        type: 'sqlite',
        file: '/tmp/test.db',
        select_only: true,
        query_timeout: 40,
      } as unknown as DatabaseConfig);
      const conn = await slowAdapter.connect();

      await expect(slowAdapter.executeQuery(conn, 'SELECT * FROM huge')).rejects.toThrow(
        /timed out after 40ms/i
      );
      expect(mockInterrupt).toHaveBeenCalled();
    });

    it('should not arm a timer when the timeout is disabled', async () => {
      // A query that never completes: with the timeout disabled there is no
      // timer to fire, so nothing ever interrupts it.
      mockEach.mockImplementation(() => {
        /* never invokes any callback */
      });
      const untimedAdapter = new SQLiteAdapter({
        type: 'sqlite',
        file: '/tmp/test.db',
        select_only: true,
        query_timeout: 0,
      } as unknown as DatabaseConfig);
      const conn = await untimedAdapter.connect();

      void untimedAdapter.executeQuery(conn, 'SELECT * FROM huge');
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(mockInterrupt).not.toHaveBeenCalled();
    });

    it('should not interrupt a query that finished before the timeout', async () => {
      mockEach.mockImplementation(eachEmits([{ id: 1 }]));
      const timedAdapter = new SQLiteAdapter({
        type: 'sqlite',
        file: '/tmp/test.db',
        select_only: true,
        query_timeout: 40,
      } as unknown as DatabaseConfig);
      const conn = await timedAdapter.connect();

      const result = await timedAdapter.executeQuery(conn, 'SELECT 1');

      expect(result.rowCount).toBe(1);
      // The timer is cleared on completion, so the interrupt never runs.
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(mockInterrupt).not.toHaveBeenCalled();
    });

    it('should reject when a row callback reports an error', async () => {
      mockEach.mockImplementation(
        (_sql: string, _params: unknown, rowCb: Function, _completeCb: Function) => {
          process.nextTick(() => rowCb(new Error('row decode failed'), undefined));
        }
      );

      await expect(adapter.executeQuery(connection, 'SELECT * FROM users')).rejects.toThrow(
        'sqlite adapter error: Failed to execute SQLite query - row decode failed'
      );
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
        expect(mockRun).toHaveBeenCalledWith('BEGIN TRANSACTION', expect.any(Function));
      });

      it('should handle begin transaction errors', async () => {
        const transactionError = new Error('Begin failed');
        mockRun.mockImplementation((query: string, callback: Function) => {
          if (query === 'BEGIN TRANSACTION') {
            process.nextTick(() => callback(transactionError));
          } else {
            process.nextTick(() => callback(null));
          }
        });

        await expect(adapter.beginTransaction(connection)).rejects.toThrow(
          'sqlite adapter error: Failed to begin SQLite transaction - Begin failed'
        );
      });
    });

    describe('commitTransaction', () => {
      it('should commit transaction successfully', async () => {
        await adapter.commitTransaction(connection);
        expect(mockRun).toHaveBeenCalledWith('COMMIT', expect.any(Function));
      });

      it('should handle commit transaction errors', async () => {
        const commitError = new Error('Commit failed');
        mockRun.mockImplementation((query: string, callback: Function) => {
          if (query === 'COMMIT') {
            process.nextTick(() => callback(commitError));
          } else {
            process.nextTick(() => callback(null));
          }
        });

        await expect(adapter.commitTransaction(connection)).rejects.toThrow(
          'sqlite adapter error: Failed to commit SQLite transaction - Commit failed'
        );
      });
    });

    describe('rollbackTransaction', () => {
      it('should rollback transaction successfully', async () => {
        await adapter.rollbackTransaction(connection);
        expect(mockRun).toHaveBeenCalledWith('ROLLBACK', expect.any(Function));
      });

      it('should handle rollback transaction errors', async () => {
        const rollbackError = new Error('Rollback failed');
        mockRun.mockImplementation((query: string, callback: Function) => {
          if (query === 'ROLLBACK') {
            process.nextTick(() => callback(rollbackError));
          } else {
            process.nextTick(() => callback(null));
          }
        });

        await expect(adapter.rollbackTransaction(connection)).rejects.toThrow(
          'sqlite adapter error: Failed to rollback SQLite transaction - Rollback failed'
        );
      });
    });
  });

  // ============================================================================
  // Performance Analysis Tests
  // ============================================================================

  describe('buildExplainQuery', () => {
    it('should build SQLite explain query plan', () => {
      const query = 'SELECT * FROM users WHERE active = 1';
      const explainQuery = adapter.buildExplainQuery(query);

      expect(explainQuery).toBe('EXPLAIN QUERY PLAN SELECT * FROM users WHERE active = 1');
    });

    it('should handle complex queries', () => {
      const complexQuery = `
 SELECT u.name, p.title 
 FROM users u 
 JOIN posts p ON u.id = p.user_id 
 WHERE u.created_at > '2023-01-01'
 `;

      const explainQuery = adapter.buildExplainQuery(complexQuery);
      expect(explainQuery).toContain('EXPLAIN QUERY PLAN');
      expect(explainQuery).toContain(complexQuery);
    });
  });

  // ============================================================================
  // Schema Capture Tests (Simplified)
  // ============================================================================

  describe('captureSchema', () => {
    let connection: DatabaseConnection;

    beforeEach(async () => {
      connection = await adapter.connect();
    });

    it('should capture basic database schema', async () => {
      // Mock simple schema result
      const tablesResult = [{ name: 'users', type: 'table' }];

      const usersColumnsResult = [
        {
          cid: 0,
          name: 'id',
          type: 'INTEGER',
          notnull: 1,
          dflt_value: null,
          pk: 1,
        },
        {
          cid: 1,
          name: 'name',
          type: 'TEXT',
          notnull: 1,
          dflt_value: null,
          pk: 0,
        },
      ];

      mockAll
        .mockImplementationOnce((query: string, callback: Function) => {
          process.nextTick(() => callback(null, tablesResult));
        })
        .mockImplementationOnce((query: string, callback: Function) => {
          process.nextTick(() => callback(null, usersColumnsResult));
        })
        // foreign_key_list for the table, issued after every column lookup
        .mockImplementationOnce((query: string, callback: Function) => {
          process.nextTick(() => callback(null, []));
        });

      const schema = await adapter.captureSchema(connection);

      expect(schema.database).toBe('/tmp/test.db');
      expect(schema.type).toBe('sqlite');
      expect(schema.tables.users).toBeDefined();
      expect(schema.tables.users.columns).toHaveLength(2);
      expect(schema.summary.table_count).toBe(1);
    });

    it('should handle schema capture errors', async () => {
      const schemaError = new Error('Schema query failed');
      mockAll.mockImplementation((query: string, callback: Function) => {
        process.nextTick(() => callback(schemaError, null));
      });

      // The whole chain, not just the outer wrapper: asserting only the outer
      // message passes just as well when the table listing ignores the error and
      // the failure surfaces later as something unrelated.
      await expect(adapter.captureSchema(connection)).rejects.toThrow(
        'sqlite adapter error: Failed to capture SQLite schema - sqlite adapter error: ' +
          'Failed to get SQLite tables - Schema query failed'
      );
    });

    it('should handle empty schema results', async () => {
      mockAll.mockImplementation((query: string, callback: Function) => {
        process.nextTick(() => callback(null, []));
      });

      const schema = await adapter.captureSchema(connection);

      expect(schema.tables).toEqual({});
      expect(schema.views).toEqual({});
      expect(schema.summary.table_count).toBe(0);
    });
  });

  // ============================================================================
  // SQLite-specific Methods Tests (Simplified)
  // ============================================================================

  // ============================================================================
  // Integration Scenarios Tests (Simplified)
  // ============================================================================

  describe('integration scenarios', () => {
    it('should handle basic workflow', async () => {
      // Connect
      const connection = await adapter.connect();
      expect(adapter.isConnected(connection)).toBe(true);

      // Execute query
      const result = await adapter.executeQuery(connection, 'SELECT * FROM users');
      expect(result).toBeDefined();

      // Transaction workflow
      await adapter.beginTransaction(connection);
      await adapter.commitTransaction(connection);

      // Disconnect
      await adapter.disconnect(connection);
      expect(mockClose).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Error Handling and Edge Cases (Simplified)
  // ============================================================================

  describe('error handling and edge cases', () => {
    it('should handle a query that yields no rows gracefully', async () => {
      const connection = await adapter.connect();

      // db.each emits no rows and completes cleanly.
      mockEach.mockImplementation(eachEmits([]));

      const result = await adapter.executeQuery(connection, 'SELECT 1');
      expect(result.rows).toEqual([]);
      expect(result.fields).toEqual([]);
    });

    it('should handle empty rows when extracting field names', async () => {
      const connection = await adapter.connect();

      mockEach.mockImplementation(eachEmits([]));

      const result = await adapter.executeQuery(connection, 'SELECT * FROM empty_table');
      expect(result.fields).toEqual([]);
    });
  });

  // ============================================================================
  // Schema Capture - Views (line 181)
  // ============================================================================

  describe('captureSchema with views', () => {
    let connection: DatabaseConnection;

    beforeEach(async () => {
      connection = await adapter.connect();
    });

    it('should categorize views separately from tables', async () => {
      const tablesResult = [
        { name: 'users', type: 'table' },
        { name: 'active_users', type: 'view' },
      ];

      const usersColumns = [
        { cid: 0, name: 'id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 1 },
        { cid: 1, name: 'name', type: 'TEXT', notnull: 0, dflt_value: "'unknown'", pk: 0 },
      ];

      const viewColumns = [
        { cid: 0, name: 'id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 1 },
      ];

      mockAll
        .mockImplementationOnce((query: string, callback: Function) => {
          process.nextTick(() => callback(null, tablesResult));
        })
        .mockImplementationOnce((query: string, callback: Function) => {
          process.nextTick(() => callback(null, usersColumns));
        })
        .mockImplementationOnce((query: string, callback: Function) => {
          process.nextTick(() => callback(null, viewColumns));
        })
        // foreign_key_list for the table, issued after every column lookup
        .mockImplementationOnce((query: string, callback: Function) => {
          process.nextTick(() => callback(null, []));
        });

      const schema = await adapter.captureSchema(connection);

      expect(schema.tables.users).toBeDefined();
      expect(schema.tables.users.type).toBe('table');
      expect(schema.views.active_users).toBeDefined();
      expect(schema.views.active_users.type).toBe('view');
      expect(schema.summary.table_count).toBe(1);
      expect(schema.summary.view_count).toBe(1);
      expect(schema.summary.total_columns).toBe(3);
    });

    it('should map column properties correctly', async () => {
      const tablesResult = [{ name: 'test', type: 'table' }];
      const columns = [
        { cid: 0, name: 'id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 1 },
        { cid: 1, name: 'email', type: 'TEXT', notnull: 0, dflt_value: "'none'", pk: 0 },
      ];

      mockAll
        .mockImplementationOnce((query: string, callback: Function) => {
          process.nextTick(() => callback(null, tablesResult));
        })
        .mockImplementationOnce((query: string, callback: Function) => {
          process.nextTick(() => callback(null, columns));
        })
        // foreign_key_list for the table, issued after every column lookup
        .mockImplementationOnce((query: string, callback: Function) => {
          process.nextTick(() => callback(null, []));
        });

      const schema = await adapter.captureSchema(connection);
      const cols = schema.tables.test.columns;

      expect(cols[0].name).toBe('id');
      expect(cols[0].nullable).toBe(false);
      expect(cols[0].key).toBe('PRI');
      expect(cols[0].default).toBeNull();

      expect(cols[1].name).toBe('email');
      expect(cols[1].nullable).toBe(true);
      expect(cols[1].key).toBe('');
      expect(cols[1].default).toBe("'none'");
    });
  });

  describe('captureSchema rowid primary keys', () => {
    const capture = async (columns: unknown[]) => {
      const connection = await adapter.connect();
      mockAll
        .mockImplementationOnce((query: string, callback: Function) => {
          process.nextTick(() => callback(null, [{ name: 't', type: 'table' }]));
        })
        .mockImplementationOnce((query: string, callback: Function) => {
          process.nextTick(() => callback(null, columns));
        })
        .mockImplementationOnce((query: string, callback: Function) => {
          process.nextTick(() => callback(null, []));
        });
      return (await adapter.captureSchema(connection)).tables.t.columns;
    };

    it('reports a single-column INTEGER PRIMARY KEY as NOT NULL although table_info says notnull=0', async () => {
      const cols = await capture([
        { cid: 0, name: 'id', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 1 },
        { cid: 1, name: 'name', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
      ]);
      expect(cols[0].nullable).toBe(false);
      expect(cols[1].nullable).toBe(true);
    });

    it('leaves a TEXT primary key and a composite key as table_info reports them', async () => {
      const text = await capture([
        { cid: 0, name: 'code', type: 'TEXT', notnull: 0, dflt_value: null, pk: 1 },
      ]);
      expect(text[0].nullable).toBe(true);
      const composite = await capture([
        { cid: 0, name: 'a', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 1 },
        { cid: 1, name: 'b', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 2 },
      ]);
      expect(composite[0].nullable).toBe(true);
    });
  });

  // ============================================================================
  // captureTableColumns error path (line 226)
  // ============================================================================

  describe('captureSchema column errors', () => {
    it('should propagate column capture errors', async () => {
      const connection = await adapter.connect();

      const tablesResult = [{ name: 'bad_table', type: 'table' }];

      mockAll
        .mockImplementationOnce((query: string, callback: Function) => {
          process.nextTick(() => callback(null, tablesResult));
        })
        .mockImplementationOnce((query: string, callback: Function) => {
          process.nextTick(() => callback(new Error('PRAGMA failed'), null));
        });

      await expect(adapter.captureSchema(connection)).rejects.toThrow(
        'sqlite adapter error: Failed to capture SQLite schema'
      );
    });
  });

  // ============================================================================
  // getDatabaseInfo (lines 282-320)
  // ============================================================================

  // ============================================================================
  // analyzeTable (lines 325-338)
  // ============================================================================

  // ============================================================================
  // vacuum (lines 343-355)
  // ============================================================================

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

    it('should flag a table scan', () => {
      expect(advise([{ detail: 'SCAN TABLE users' }])).toContain('Table scan detected');
    });

    it('should flag a temporary b-tree', () => {
      expect(advise([{ detail: 'USE TEMP B-TREE FOR ORDER BY' }])).toContain(
        'Temporary B-tree created'
      );
    });

    it('should always advise running ANALYZE', () => {
      expect(advise([{ detail: 'SEARCH TABLE users USING INDEX users_name' }])).toContain(
        'Run ANALYZE command periodically'
      );
    });

    it('should advise running ANALYZE even for an empty plan', () => {
      expect(adapter.getPerformanceRecommendations(explain([]), 'SELECT 1')).toEqual([
        expect.stringContaining('Run ANALYZE command periodically'),
      ]);
    });
  });
});

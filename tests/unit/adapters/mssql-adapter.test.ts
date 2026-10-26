/**
 * SQL Server (MSSQL) Database Adapter Tests
 * Tests the MSSQL-specific database adapter implementation
 */

import { MSSQLAdapter } from '../../../src/database/adapters/mssql.js';
import type {
  DatabaseConnection,
  DatabaseConfig,
  QueryResult,
  DatabaseSchema,
} from '../../../src/types/index.js';

// Mock variables must be declared before jest.mock() calls
const mockRequest = jest.fn(() => ({
  input: jest.fn().mockReturnThis(),
  query: jest.fn(),
}));

const mockConnect = jest.fn();
const mockClose = jest.fn();

const mockConnectionPool = {
  connect: mockConnect,
  close: mockClose,
  connected: true,
  request: mockRequest,
};

// Mock the 'mssql' module
jest.mock('mssql', () => ({
  ConnectionPool: jest.fn(),
}));

// Mock '@azure/identity' so the adapter's Azure CLI branch can be exercised
// without an `az` binary or a signed-in Azure account.
const mockAzureCliCredentialCtor = jest.fn();
jest.mock('@azure/identity', () => ({
  AzureCliCredential: jest.fn().mockImplementation(function (this: any, ...args: unknown[]) {
    mockAzureCliCredentialCtor(...args);
    this.getToken = jest.fn();
  }),
}));

import * as mssql from 'mssql';

// Use jest.mocked for proper typing
const mockMSSQLConnectionPool = jest.mocked(mssql.ConnectionPool);

// ============================================================================
// Test Suite
// ============================================================================

describe('MSSQLAdapter', () => {
  let config: DatabaseConfig;
  let adapter: MSSQLAdapter;
  let mockRequestInstance: any;

  beforeEach(() => {
    config = {
      type: 'mssql',
      host: 'localhost',
      port: 1433,
      database: 'testdb',
      username: 'testuser',
      password: 'testpass',
      timeout: 30000,
      encrypt: true,
    };

    adapter = new MSSQLAdapter(config);

    // Create a mock request instance
    mockRequestInstance = {
      input: jest.fn().mockReturnThis(),
      query: jest.fn(),
    };

    // Reset mocks
    jest.clearAllMocks();
    mockMSSQLConnectionPool.mockReturnValue(mockConnectionPool as any);
    mockConnect.mockResolvedValue(undefined);
    mockClose.mockResolvedValue(undefined);
    mockRequest.mockReturnValue(mockRequestInstance);
    mockRequestInstance.query.mockResolvedValue({
      recordset: [{ id: 1, name: 'test' }],
      recordsets: [[{ id: 1, name: 'test' }]],
    });
    mockConnectionPool.connected = true;
  });

  // ============================================================================
  // Constructor and Configuration Tests
  // ============================================================================

  describe('constructor', () => {
    it('should initialize with valid MSSQL config', () => {
      expect(adapter.getType()).toBe('mssql');
      expect((adapter as any).config.host).toBe('localhost');
      expect((adapter as any).config.port).toBe(1433);
    });

    it('should handle port as string', () => {
      const stringPortConfig = { ...config, port: '1434' as any };
      const stringAdapter = new MSSQLAdapter(stringPortConfig);
      expect((stringAdapter as any).config.port).toBe('1434');
    });
  });

  // ============================================================================
  // Connection Management Tests
  // ============================================================================

  describe('connect', () => {
    it('should connect to SQL Server database successfully', async () => {
      const connection = await adapter.connect();

      expect(mockMSSQLConnectionPool).toHaveBeenCalledWith({
        server: 'localhost',
        port: 1433,
        database: 'testdb',
        user: 'testuser',
        password: 'testpass',
        connectionTimeout: 30000,
        requestTimeout: 30000,
        options: {
          encrypt: true,
          trustServerCertificate: false,
          enableArithAbort: true,
        },
        pool: {
          max: 10,
          min: 0,
          idleTimeoutMillis: 30000,
        },
      });
      expect(mockConnect).toHaveBeenCalled();
      expect(connection).toBe(mockConnectionPool);
    });

    describe('azure-cli authentication', () => {
      const azureConfig = (): DatabaseConfig =>
        ({
          type: 'mssql',
          host: 'myserver.database.windows.net',
          port: 1433,
          database: 'testdb',
          authentication: 'azure-cli',
          timeout: 30000,
        }) as DatabaseConfig;

      it('should authenticate with an AzureCliCredential token credential', async () => {
        await new MSSQLAdapter(azureConfig()).connect();

        expect(mockAzureCliCredentialCtor).toHaveBeenCalled();
        const passed = mockMSSQLConnectionPool.mock.calls[0][0] as any;
        expect(passed.authentication.type).toBe('token-credential');
        expect(typeof passed.authentication.options.credential.getToken).toBe('function');
      });

      it('should not send a user or password when using azure-cli authentication', async () => {
        await new MSSQLAdapter(azureConfig()).connect();

        const passed = mockMSSQLConnectionPool.mock.calls[0][0] as any;
        expect(passed).not.toHaveProperty('user');
        expect(passed).not.toHaveProperty('password');
      });

      it('should connect without a username or password in the configuration', async () => {
        await expect(new MSSQLAdapter(azureConfig()).connect()).resolves.toBe(mockConnectionPool);
      });

      it('should force encryption on even when the config disables it', async () => {
        // A bearer token on an unencrypted wire is worse than a password:
        // encrypt=false must not be honoured for token authentication.
        await new MSSQLAdapter({ ...azureConfig(), encrypt: false }).connect();

        const passed = mockMSSQLConnectionPool.mock.calls[0][0] as any;
        expect(passed.options.encrypt).toBe(true);
      });

      it('should pass the configured tenant to AzureCliCredential', async () => {
        await new MSSQLAdapter({
          ...azureConfig(),
          azure_tenant_id: 'd958da54-24bc-444a-981b-317de09e73ee',
        }).connect();

        expect(mockAzureCliCredentialCtor).toHaveBeenCalledWith({
          tenantId: 'd958da54-24bc-444a-981b-317de09e73ee',
        });
      });

      it('should construct AzureCliCredential with no options when no tenant is set', async () => {
        await new MSSQLAdapter(azureConfig()).connect();

        expect(mockAzureCliCredentialCtor).toHaveBeenCalledWith();
      });

      it('should not blame az login for a failure that is not a credential failure', async () => {
        // A network or policy rejection arrives as a mssql ConnectionError, and
        // telling the user to run `az login` for one sends them nowhere.
        const networkError = Object.assign(new Error('Deny Public Network Access is set to Yes'), {
          name: 'ConnectionError',
          code: 'ELOGIN',
        });
        mockConnect.mockRejectedValueOnce(networkError);

        const attempt = new MSSQLAdapter(azureConfig()).connect();
        await expect(attempt).rejects.toThrow('Deny Public Network Access');
        await expect(attempt).rejects.not.toThrow('az login');
      });

      it('should still require host and database under azure-cli authentication', async () => {
        // Dropping username and password from the required list must not drop
        // the two fields that have nothing to do with credentials.
        await expect(
          new MSSQLAdapter({ ...azureConfig(), host: undefined }).connect()
        ).rejects.toThrow('host');

        await expect(
          new MSSQLAdapter({ ...azureConfig(), database: undefined }).connect()
        ).rejects.toThrow('database');
      });

      it('should verify the server certificate even when ssl_verify is false', async () => {
        // encrypt=true without certificate verification is not protection: an
        // attacker presenting a forged certificate still terminates the TLS and
        // captures the bearer token. ssl_verify=false must not reach this path.
        await new MSSQLAdapter({ ...azureConfig(), ssl_verify: false }).connect();

        const passed = mockMSSQLConnectionPool.mock.calls[0][0] as any;
        expect(passed.options.trustServerCertificate).toBe(false);
      });

      it('should still honour ssl_verify=false for sql authentication', async () => {
        await new MSSQLAdapter({ ...config, ssl_verify: false }).connect();

        const passed = mockMSSQLConnectionPool.mock.calls[0][0] as any;
        expect(passed.options.trustServerCertificate).toBe(true);
      });

      it('should tell the user to run az login when the CLI credential is unavailable', async () => {
        // The real shape, confirmed against @azure/identity 4.13.1: a missing or
        // signed-out CLI raises CredentialUnavailableError, not a bare Error.
        mockConnect.mockRejectedValueOnce(
          Object.assign(new Error("Please run 'az login' from a command prompt to authenticate"), {
            name: 'CredentialUnavailableError',
          })
        );

        await expect(new MSSQLAdapter(azureConfig()).connect()).rejects.toThrow('az login');
      });

      it('should keep using user and password when authentication is not azure-cli', async () => {
        await adapter.connect();

        const passed = mockMSSQLConnectionPool.mock.calls[0][0] as any;
        expect(passed.user).toBe('testuser');
        expect(passed.password).toBe('testpass');
        expect(passed.authentication).toBeUndefined();
      });
    });

    it('should handle encryption configuration', async () => {
      const encryptConfig = { ...config, encrypt: false };
      const encryptAdapter = new MSSQLAdapter(encryptConfig);

      await encryptAdapter.connect();

      expect(mockMSSQLConnectionPool).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            encrypt: false,
          }),
        })
      );
    });

    it('should use default encryption when not specified', async () => {
      const noEncryptConfig = { ...config };
      delete noEncryptConfig.encrypt;
      const noEncryptAdapter = new MSSQLAdapter(noEncryptConfig);

      await noEncryptAdapter.connect();

      expect(mockMSSQLConnectionPool).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            encrypt: true, // Default value
          }),
        })
      );
    });

    it('should default ssl_verify to true (trustServerCertificate false)', async () => {
      const noSslVerifyConfig = { ...config };
      delete noSslVerifyConfig.ssl_verify;
      const noSslVerifyAdapter = new MSSQLAdapter(noSslVerifyConfig);

      await noSslVerifyAdapter.connect();

      expect(mockMSSQLConnectionPool).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            trustServerCertificate: false, // ssl_verify defaults to true, negated = false
          }),
        })
      );
    });

    it('should respect explicit ssl_verify=false (trustServerCertificate true)', async () => {
      const sslVerifyFalseConfig = { ...config, ssl_verify: false };
      const sslVerifyFalseAdapter = new MSSQLAdapter(sslVerifyFalseConfig);

      await sslVerifyFalseAdapter.connect();

      expect(mockMSSQLConnectionPool).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            trustServerCertificate: true, // ssl_verify=false, negated = true
          }),
        })
      );
    });

    it('should validate required configuration fields', async () => {
      const incompleteConfig = { type: 'mssql' as const };
      const incompleteAdapter = new MSSQLAdapter(incompleteConfig);

      await expect(incompleteAdapter.connect()).rejects.toThrow(
        'Missing required configuration fields: host, database, username, password'
      );
    });

    it('should handle connection errors', async () => {
      const connectionError = new Error('Connection failed');
      mockConnect.mockRejectedValueOnce(connectionError);

      await expect(adapter.connect()).rejects.toThrow(
        'mssql adapter error: Failed to connect to SQL Server database - Connection failed'
      );
    });

    it('should use default port when not specified', async () => {
      const noPortConfig = { ...config };
      delete noPortConfig.port;
      const noPortAdapter = new MSSQLAdapter(noPortConfig);

      await noPortAdapter.connect();

      expect(mockMSSQLConnectionPool).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 1433,
        })
      );
    });
  });

  describe('disconnect', () => {
    it('should disconnect from SQL Server database successfully', async () => {
      const connection = await adapter.connect();
      await adapter.disconnect(connection);

      expect(mockClose).toHaveBeenCalled();
    });

    it('should handle disconnect errors', async () => {
      const disconnectError = new Error('Disconnect failed');
      mockClose.mockRejectedValueOnce(disconnectError);

      const connection = await adapter.connect();
      await expect(adapter.disconnect(connection)).rejects.toThrow(
        'mssql adapter error: Failed to disconnect from SQL Server database - Disconnect failed'
      );
    });
  });

  describe('isConnected', () => {
    it('should return true for connected pool', async () => {
      const connection = await adapter.connect();
      mockConnectionPool.connected = true;

      expect(adapter.isConnected(connection)).toBe(true);
    });

    it('should return false for disconnected pool', async () => {
      const connection = await adapter.connect();
      mockConnectionPool.connected = false;

      expect(adapter.isConnected(connection)).toBe(false);
    });

    it('should return false for invalid connection', () => {
      expect(adapter.isConnected(null as any)).toBe(false);
      expect(adapter.isConnected({} as any)).toBe(false);
    });

    it('should handle exceptions gracefully', () => {
      const badConnection = {
        get connected() {
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
      const mockResult = {
        recordset: [
          { id: 1, name: 'John' },
          { id: 2, name: 'Jane' },
        ],
        recordsets: [
          [
            { id: 1, name: 'John' },
            { id: 2, name: 'Jane' },
          ],
        ],
      };
      mockRequestInstance.query.mockResolvedValueOnce(mockResult);

      const result = await adapter.executeQuery(connection, 'SELECT * FROM users');

      expect(mockRequest).toHaveBeenCalled();
      expect(mockRequestInstance.query).toHaveBeenCalledWith('SELECT * FROM users');
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
        recordset: [{ id: 1, name: 'John' }],
        recordsets: [[{ id: 1, name: 'John' }]],
      };
      mockRequestInstance.query.mockResolvedValueOnce(mockResult);

      await adapter.executeQuery(connection, 'SELECT * FROM users WHERE id = ?', [1]);

      expect(mockRequestInstance.input).toHaveBeenCalledWith('param0', 1);
      expect(mockRequestInstance.query).toHaveBeenCalledWith(
        'SELECT * FROM users WHERE id = @param0'
      );
    });

    it('should handle multiple parameters', async () => {
      const mockResult = {
        recordset: [{ id: 1, name: 'John' }],
        recordsets: [[{ id: 1, name: 'John' }]],
      };
      mockRequestInstance.query.mockResolvedValueOnce(mockResult);

      await adapter.executeQuery(connection, 'SELECT * FROM users WHERE id = ? AND active = ?', [
        1,
        true,
      ]);

      expect(mockRequestInstance.input).toHaveBeenCalledWith('param0', 1);
      expect(mockRequestInstance.input).toHaveBeenCalledWith('param1', true);
      expect(mockRequestInstance.query).toHaveBeenCalledWith(
        'SELECT * FROM users WHERE id = @param0 AND active = @param1'
      );
    });

    // Parameters bind positionally as @param0..@paramN-1, so anything that
    // wrongly consumes a placeholder slot misaligns every parameter after it.
    describe('placeholder conversion', () => {
      const convert = async (query: string): Promise<string> => {
        mockRequestInstance.query.mockResolvedValueOnce({ recordset: [], recordsets: [[]] });
        await adapter.executeQuery(connection, query, [1]);
        const calls = mockRequestInstance.query.mock.calls;
        return calls[calls.length - 1][0] as string;
      };

      it('should number placeholders in order', async () => {
        expect(await convert('SELECT ? , ? , ?')).toBe('SELECT @param0 , @param1 , @param2');
      });

      it('should leave a question mark inside a string literal alone', async () => {
        expect(await convert("SELECT '?' , ?")).toBe("SELECT '?' , @param0");
      });

      it('should treat a doubled quote as staying inside the string', async () => {
        expect(await convert("SELECT 'it''s ?' , ?")).toBe("SELECT 'it''s ?' , @param0");
      });

      it('should leave a question mark inside a quoted identifier alone', async () => {
        expect(await convert('SELECT "col?" , ?')).toBe('SELECT "col?" , @param0');
      });

      it('should leave a question mark inside a bracketed identifier alone', async () => {
        expect(await convert('SELECT [col?] , ?')).toBe('SELECT [col?] , @param0');
      });

      it('should leave a question mark inside a line comment alone', async () => {
        expect(await convert('SELECT 1 -- really?\nWHERE id = ?')).toBe(
          'SELECT 1 -- really?\nWHERE id = @param0'
        );
      });

      it('should leave a question mark inside a block comment alone', async () => {
        expect(await convert('SELECT /* really? */ ?')).toBe('SELECT /* really? */ @param0');
      });

      it('should keep tracking nested block comments', async () => {
        expect(await convert('SELECT /* a /* b? */ c? */ ?')).toBe(
          'SELECT /* a /* b? */ c? */ @param0'
        );
      });

      it('should not treat a dash inside a string as starting a comment', async () => {
        expect(await convert("SELECT '-- ?' , ?")).toBe("SELECT '-- ?' , @param0");
      });

      it('should treat a doubled bracket as staying inside the identifier', async () => {
        expect(await convert('SELECT [a]]?] , ?')).toBe('SELECT [a]]?] , @param0');
      });

      it('should treat a doubled double-quote as staying inside the identifier', async () => {
        expect(await convert('SELECT "a""?" , ?')).toBe('SELECT "a""?" , @param0');
      });

      // A lone slash or star inside a comment is ordinary text; only the paired
      // sequences open and close one.
      it('should not let a lone slash inside a block comment open a nested one', async () => {
        expect(await convert('SELECT /* a / b */ ?')).toBe('SELECT /* a / b */ @param0');
      });

      it('should not let a lone star inside a block comment close it', async () => {
        expect(await convert('SELECT /* a * b? */ ?')).toBe('SELECT /* a * b? */ @param0');
      });

      // Arithmetic is not a comment opener.
      it('should not treat subtraction as a line comment', async () => {
        expect(await convert('SELECT 1 - 2 , ?')).toBe('SELECT 1 - 2 , @param0');
      });

      it('should not treat division as a block comment', async () => {
        expect(await convert('SELECT 1 / 2 , ?')).toBe('SELECT 1 / 2 , @param0');
      });
    });

    it('should handle query execution errors', async () => {
      const queryError = new Error('Query execution failed');
      mockRequestInstance.query.mockRejectedValueOnce(queryError);

      await expect(adapter.executeQuery(connection, 'INVALID SQL')).rejects.toThrow(
        'mssql adapter error: Failed to execute SQL Server query - Query execution failed'
      );
    });

    it('should handle empty result sets', async () => {
      const mockResult = {
        recordset: [],
        recordsets: [[]],
      };
      mockRequestInstance.query.mockResolvedValueOnce(mockResult);

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
        recordset: largeRowSet,
        recordsets: [largeRowSet],
      };
      mockRequestInstance.query.mockResolvedValueOnce(mockResult);

      const result = await adapter.executeQuery(connection, 'SELECT * FROM large_table');

      expect(result.rows).toHaveLength(1000); // Should be truncated to max_rows
      expect(result.rowCount).toBe(1500); // Original count before truncation
      expect(result.truncated).toBe(true);
    });

    it('should handle malformed query results gracefully', async () => {
      // Mock a result without the expected structure
      const malformedResult = {
        // Missing recordset property
        someOtherProperty: 'value',
      };
      mockRequestInstance.query.mockResolvedValueOnce(malformedResult);

      const result = await adapter.executeQuery(connection, 'SELECT 1');

      // Should handle gracefully and return empty results
      expect(result.rows).toEqual([]);
      expect(result.fields).toEqual([]);
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
        expect(mockRequestInstance.query).toHaveBeenCalledWith('BEGIN TRANSACTION');
      });

      it('should handle begin transaction errors', async () => {
        const transactionError = new Error('Begin failed');
        mockRequestInstance.query.mockRejectedValueOnce(transactionError);

        await expect(adapter.beginTransaction(connection)).rejects.toThrow(
          'mssql adapter error: Failed to begin SQL Server transaction - Begin failed'
        );
      });
    });

    describe('commitTransaction', () => {
      it('should commit transaction successfully', async () => {
        await adapter.commitTransaction(connection);
        expect(mockRequestInstance.query).toHaveBeenCalledWith('COMMIT TRANSACTION');
      });

      it('should handle commit transaction errors', async () => {
        const commitError = new Error('Commit failed');
        mockRequestInstance.query.mockRejectedValueOnce(commitError);

        await expect(adapter.commitTransaction(connection)).rejects.toThrow(
          'mssql adapter error: Failed to commit SQL Server transaction - Commit failed'
        );
      });
    });

    describe('rollbackTransaction', () => {
      it('should rollback transaction successfully', async () => {
        await adapter.rollbackTransaction(connection);
        expect(mockRequestInstance.query).toHaveBeenCalledWith('ROLLBACK TRANSACTION');
      });

      it('should handle rollback transaction errors', async () => {
        const rollbackError = new Error('Rollback failed');
        mockRequestInstance.query.mockRejectedValueOnce(rollbackError);

        await expect(adapter.rollbackTransaction(connection)).rejects.toThrow(
          'mssql adapter error: Failed to rollback SQL Server transaction - Rollback failed'
        );
      });
    });
  });

  // ============================================================================
  // Performance Analysis Tests
  // ============================================================================

  describe('buildExplainQuery', () => {
    it('should build SQL Server explain query with showplan', () => {
      const query = 'SELECT * FROM users WHERE active = 1';
      const explainQuery = adapter.buildExplainQuery(query);

      expect(explainQuery).toBe(
        'SET SHOWPLAN_ALL ON; SELECT * FROM users WHERE active = 1; SET SHOWPLAN_ALL OFF'
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
      expect(explainQuery).toContain('SET SHOWPLAN_ALL ON;');
      expect(explainQuery).toContain(complexQuery);
      expect(explainQuery).toContain('SET SHOWPLAN_ALL OFF');
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
        recordset: [
          { TABLE_NAME: 'users', TABLE_TYPE: 'BASE TABLE', TABLE_COMMENT: '' },
          { TABLE_NAME: 'posts', TABLE_TYPE: 'BASE TABLE', TABLE_COMMENT: '' },
          { TABLE_NAME: 'user_stats', TABLE_TYPE: 'VIEW', TABLE_COMMENT: '' },
        ],
      };

      // Mock columns query results
      const usersColumnsResult = {
        recordset: [
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
          },
          {
            COLUMN_NAME: 'name',
            DATA_TYPE: 'nvarchar',
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: null,
            CHARACTER_MAXIMUM_LENGTH: 100,
            NUMERIC_PRECISION: null,
            NUMERIC_SCALE: null,
            COLUMN_COMMENT: 'Full name',
            COLUMN_KEY: '',
          },
        ],
      };

      const postsColumnsResult = {
        recordset: [
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
          },
        ],
      };

      const userStatsColumnsResult = {
        recordset: [
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
          },
        ],
      };

      // Set up query responses in order
      mockRequestInstance.query
        .mockResolvedValueOnce(tablesResult)
        .mockResolvedValueOnce(usersColumnsResult)
        .mockResolvedValueOnce(postsColumnsResult)
        .mockResolvedValueOnce(userStatsColumnsResult);

      const schema = await adapter.captureSchema(connection);

      expect(schema.database).toBe('testdb');
      expect(schema.type).toBe('mssql');
      expect(schema.captured_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // Check tables
      expect(Object.keys(schema.tables)).toHaveLength(2);
      expect(schema.tables.users).toBeDefined();
      expect(schema.tables.users.name).toBe('users');
      expect(schema.tables.users.columns).toHaveLength(2);
      expect(schema.tables.users.columns[0].name).toBe('id');
      expect(schema.tables.users.columns[0].nullable).toBe(false);
      expect(schema.tables.users.columns[0].key).toBe('PRI');
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
      expect(mockRequestInstance.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM INFORMATION_SCHEMA.TABLES')
      );
      expect(mockRequestInstance.input).toHaveBeenCalledWith('tableName', 'users');
    });

    it('should handle schema capture errors', async () => {
      const schemaError = new Error('Schema query failed');
      mockRequestInstance.query.mockRejectedValueOnce(schemaError);

      await expect(adapter.captureSchema(connection)).rejects.toThrow(
        'mssql adapter error: Failed to capture SQL Server schema - Schema query failed'
      );
    });

    it('should handle empty schema results', async () => {
      const emptyResult = { recordset: [] };
      mockRequestInstance.query.mockResolvedValueOnce(emptyResult);

      const schema = await adapter.captureSchema(connection);

      expect(schema.tables).toEqual({});
      expect(schema.views).toEqual({});
      expect(schema.summary.table_count).toBe(0);
      expect(schema.summary.view_count).toBe(0);
      expect(schema.summary.total_columns).toBe(0);
    });

    it('should handle missing column metadata gracefully', async () => {
      const tablesResult = {
        recordset: [{ TABLE_NAME: 'test_table', TABLE_TYPE: 'BASE TABLE', TABLE_COMMENT: null }],
      };

      const columnsResult = {
        recordset: [
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
          },
        ],
      };

      mockRequestInstance.query
        .mockResolvedValueOnce(tablesResult)
        .mockResolvedValueOnce(columnsResult);

      const schema = await adapter.captureSchema(connection);

      expect(schema.tables.test_table.comment).toBe('');
      expect(schema.tables.test_table.columns[0].comment).toBe('');
      expect(schema.tables.test_table.columns[0].key).toBe('');
    });
  });

  // ============================================================================
  // SQL Server-specific Methods Tests
  // ============================================================================

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

      // Disconnect
      await adapter.disconnect(connection);
      expect(mockClose).toHaveBeenCalled();
    });

    it('should handle transaction rollback scenario', async () => {
      const connection = await adapter.connect();

      await adapter.beginTransaction(connection);

      // Simulate error during transaction
      // Simulate error during transaction execution
      const insertError = new Error('Insert failed');
      mockRequestInstance.query.mockRejectedValueOnce(insertError);

      try {
        await adapter.executeQuery(connection, 'INSERT INTO users (invalid_column) VALUES (?)', [
          'value',
        ]);
      } catch (error) {
        await adapter.rollbackTransaction(connection);
      }

      expect(mockRequestInstance.query).toHaveBeenCalledWith('BEGIN TRANSACTION');
      expect(mockRequestInstance.query).toHaveBeenCalledWith('ROLLBACK TRANSACTION');
    });

    it('should handle concurrent operations', async () => {
      const connection = await adapter.connect();

      // Execute multiple queries concurrently
      const queries = [
        adapter.executeQuery(connection, 'SELECT 1'),
        adapter.executeQuery(connection, 'SELECT 2'),
        adapter.executeQuery(connection, 'SELECT 3'),
      ];

      const results = await Promise.all(queries);
      expect(results).toHaveLength(3);
      expect(mockRequest).toHaveBeenCalledTimes(3);
    });
  });

  // ============================================================================
  // Error Handling and Edge Cases
  // ============================================================================

  describe('error handling and edge cases', () => {
    it('should handle missing recordset in query results', async () => {
      const connection = await adapter.connect();

      const resultWithoutRecordset = {
        // recordset property is missing
        someOtherProperty: 'value',
      };
      mockRequestInstance.query.mockResolvedValueOnce(resultWithoutRecordset);

      const result = await adapter.executeQuery(connection, 'SELECT * FROM test');
      expect(result.rows).toEqual([]);
      expect(result.fields).toEqual([]);
    });

    it('should handle encrypt configuration edge cases', async () => {
      // Test with encrypt as string 'false'
      const encryptStringConfig = { ...config, encrypt: 'false' as any };
      const encryptStringAdapter = new MSSQLAdapter(encryptStringConfig);

      await encryptStringAdapter.connect();

      // Should parse 'false' string as boolean false
      expect(mockMSSQLConnectionPool).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            encrypt: false,
          }),
        })
      );
    });

    it('should handle null or undefined query parameters', async () => {
      const connection = await adapter.connect();

      await adapter.executeQuery(connection, 'SELECT * FROM users WHERE id = ? AND name = ?', [
        null,
        undefined,
      ]);

      expect(mockRequestInstance.input).toHaveBeenCalledWith('param0', null);
      expect(mockRequestInstance.input).toHaveBeenCalledWith('param1', undefined);
    });

    it('should handle complex parameter replacement', async () => {
      const connection = await adapter.connect();

      const complexQuery =
        'SELECT * FROM users WHERE id = ? AND name LIKE ? AND active = ? ORDER BY created_at';
      await adapter.executeQuery(connection, complexQuery, [1, '%John%', true]);

      expect(mockRequestInstance.query).toHaveBeenCalledWith(
        'SELECT * FROM users WHERE id = @param0 AND name LIKE @param1 AND active = @param2 ORDER BY created_at'
      );
    });

    it('should handle connection pool configuration edge cases', async () => {
      // Test with very small timeout
      const smallTimeoutConfig = { ...config, timeout: 1000 };
      const smallTimeoutAdapter = new MSSQLAdapter(smallTimeoutConfig);

      await smallTimeoutAdapter.connect();

      expect(mockMSSQLConnectionPool).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionTimeout: 1000,
          requestTimeout: 1000,
        })
      );
    });
  });

  // ============================================================================
  // Performance Recommendations
  // ============================================================================

  describe('getPerformanceRecommendations', () => {
    it('should return no dialect-specific advice', () => {
      // MSSQL has no SHOWPLAN-specific analysis yet; it inherits the empty base default.
      const explainResult: QueryResult = {
        rows: [{ StmtText: 'SELECT * FROM users', EstimateRows: 1000 }],
        rowCount: 1,
        fields: ['StmtText', 'EstimateRows'],
        truncated: false,
        execution_time_ms: 1,
      };

      expect(adapter.getPerformanceRecommendations(explainResult, 'SELECT * FROM users')).toEqual(
        []
      );
    });
  });
});

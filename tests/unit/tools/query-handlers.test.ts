/**
 * Query Handlers Tests
 * Tests for sql_query, sql_batch_query, sql_analyze_performance handlers
 */

import {
  handleSqlQuery,
  handleBatchQuery,
  handleAnalyzePerformance,
} from '../../../src/tools/handlers/query-handlers.js';
import type { ToolHandlerContext } from '../../../src/tools/handlers/types.js';
import type { ParsedServerConfig, DatabaseConfig } from '../../../src/types/index.js';
import { SchemaWatch } from '../../../src/schema/watch.js';
import { SecurityViolationError } from '../../../src/types/index.js';
import { preflightNames } from '../../../src/tools/handlers/name-check.js';
import { ValidationError, ConfigurationError } from '../../../src/utils/error-handler.js';

// Mock response-formatter
jest.mock('../../../src/utils/response-formatter.js', () => ({
  createToolResponse: jest.fn((text: string, isError = false) => ({
    content: [{ type: 'text', text }],
    _meta: { progressToken: null },
    ...(isError ? { isError: true } : {}),
  })),
  formatTableResults: jest.fn(() => '| col1 |\n|---|\n| val1 |\n'),
  formatCondensedTableResults: jest.fn(() => '| col1 |\n'),
}));

function createMockContext(
  databases: Record<string, DatabaseConfig> = {},
  extensionConfig?: any
): ToolHandlerContext {
  return {
    connectionManager: {
      registerDatabase: jest.fn(),
      unregisterDatabase: jest.fn(),
      getConnection: jest.fn(),
      executeQuery: jest.fn(),
      executeBatch: jest.fn(),
      analyzePerformance: jest.fn(),
    } as any,
    securityManager: {
      validateSelectOnlyQuery: jest.fn().mockReturnValue({ allowed: true }),
      validateAnyQuery: jest.fn().mockReturnValue({ allowed: true }),
    } as any,
    schemaManager: {
      getSchema: jest.fn(),
      hasSchema: jest.fn().mockReturnValue(true),
      captureSchema: jest.fn(),
      captureSchemaOnce: jest.fn().mockResolvedValue(null),
      refreshSchema: jest.fn(),
      generateSchemaContext: jest.fn(),
    } as any,
    schemaWatch: { check: jest.fn().mockResolvedValue([]) } as any,
    paneStore: null,
    sshTunnelManager: {
      hasTunnel: jest.fn().mockReturnValue(false),
      closeTunnel: jest.fn(),
    } as any,
    metricsManager: {
      getSnapshot: jest.fn().mockReturnValue({}),
    } as any,
    config: {
      databases,
      ...(extensionConfig ? { extension: extensionConfig } : {}),
    } as ParsedServerConfig,
    configPath: '/tmp/test-config.ini',
    logger: {
      info: jest.fn(),
      debug: jest.fn(),
      warning: jest.fn(),
      error: jest.fn(),
    } as any,
  };
}

describe('query-handlers', () => {
  describe('schema change reporting', () => {
    const changes = [
      { kind: 'column-added', table: 'orders', column: 'shipped_at', type: 'timestamptz' },
    ];
    const dbs = { db: { type: 'postgresql', select_only: true } as DatabaseConfig };

    it('appends the change line and sets _meta.argos.schemaChange on sql_query', async () => {
      const ctx = createMockContext(dbs);
      (ctx.schemaWatch.check as jest.Mock).mockResolvedValue(changes);
      (ctx.connectionManager.executeQuery as jest.Mock).mockResolvedValue({
        rows: [{ col1: 'v' }],
        rowCount: 1,
        fields: [],
      });
      const r = await handleSqlQuery(ctx, { database: 'db', query: 'SELECT 1' });
      expect(
        r.content[0].text.endsWith(
          '\nSchema changed since last look: orders + shipped_at (timestamptz).'
        )
      ).toBe(true);
      expect(r._meta).toEqual({
        progressToken: null,
        argos: { journalId: null, spool: null, schemaChange: changes },
      });
    });

    it('checks once per batch and reports on sql_batch_query', async () => {
      const ctx = createMockContext(dbs);
      (ctx.schemaWatch.check as jest.Mock).mockResolvedValue(changes);
      (ctx.connectionManager.executeBatch as jest.Mock).mockResolvedValue({
        results: [],
        successCount: 0,
        failureCount: 0,
        totalExecutionTime: 1,
      });
      const r = await handleBatchQuery(ctx, {
        database: 'db',
        queries: [{ query: 'SELECT 1' }, { query: 'SELECT 2' }],
      });
      expect(ctx.schemaWatch.check).toHaveBeenCalledTimes(1);
      expect(r._meta.argos?.schemaChange).toEqual(changes);
      expect(r.content[0].text).toContain('Schema changed since last look');
    });

    it('reports on sql_analyze_performance', async () => {
      const ctx = createMockContext(dbs);
      (ctx.schemaWatch.check as jest.Mock).mockResolvedValue(changes);
      (ctx.connectionManager.analyzePerformance as jest.Mock).mockResolvedValue({
        executionTime: 1,
        explainTime: 1,
        rowCount: 1,
        columnCount: 1,
        executionPlan: 'plan\n',
        recommendations: 'none',
      });
      const r = await handleAnalyzePerformance(ctx, { database: 'db', query: 'SELECT 1' });
      expect(r._meta.argos?.schemaChange).toEqual(changes);
    });

    it('leaves the response untouched when nothing changed', async () => {
      const ctx = createMockContext(dbs);
      (ctx.connectionManager.executeQuery as jest.Mock).mockResolvedValue({
        rows: [],
        rowCount: 0,
        fields: [],
      });
      const r = await handleSqlQuery(ctx, { database: 'db', query: 'SELECT 1' });
      expect(r._meta).toEqual({ progressToken: null });
      expect(r.content[0].text).not.toContain('Schema changed');
    });

    it('still runs the query when the fingerprint query throws', async () => {
      const ctx = createMockContext(dbs);
      ctx.schemaWatch = new SchemaWatch(
        {
          isConnected: () => true,
          schemaFingerprint: jest.fn().mockRejectedValue(new Error('boom')),
        } as any,
        { getSchema: () => ({ fingerprint: 'old' }) } as any
      );
      (ctx.connectionManager.executeQuery as jest.Mock).mockResolvedValue({
        rows: [{ col1: 'v' }],
        rowCount: 1,
        fields: [],
      });
      const r = await handleSqlQuery(ctx, { database: 'db', query: 'SELECT 1' });
      expect(ctx.connectionManager.executeQuery).toHaveBeenCalled();
      expect(r.isError).toBeUndefined();
      expect(r.content[0].text).not.toContain('Schema changed');
    });
  });

  describe('handleSqlQuery', () => {
    it('should execute a query successfully', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.connectionManager.executeQuery as jest.Mock).mockResolvedValue({
        rows: [{ id: 1, name: 'test' }],
        fields: ['id', 'name'],
        rowCount: 1,
        truncated: false,
      });

      const result = await handleSqlQuery(ctx, {
        database: 'testdb',
        query: 'SELECT * FROM users',
      });

      expect(result.content[0].text).toContain('Query executed successfully');
      expect(result.content[0].text).toContain('1 rows');
      expect(ctx.connectionManager.executeQuery).toHaveBeenCalledWith(
        'testdb',
        'SELECT * FROM users',
        []
      );
    });

    it('should pass params to executeQuery', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.connectionManager.executeQuery as jest.Mock).mockResolvedValue({
        rows: [],
        fields: [],
        rowCount: 0,
        truncated: false,
      });

      await handleSqlQuery(ctx, {
        database: 'testdb',
        query: 'SELECT * FROM users WHERE id = ?',
        params: ['42'],
      });

      expect(ctx.connectionManager.executeQuery).toHaveBeenCalledWith(
        'testdb',
        'SELECT * FROM users WHERE id = ?',
        ['42']
      );
    });

    it('should validate SELECT-only mode', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: true } as DatabaseConfig,
      });
      (ctx.securityManager.validateSelectOnlyQuery as jest.Mock).mockReturnValue({
        allowed: false,
        reason: 'DELETE statements are not allowed',
      });

      const result = await handleSqlQuery(ctx, {
        database: 'testdb',
        query: 'DELETE FROM users',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Query blocked');
      expect(result.content[0].text).toContain('Security Information');
    });

    it('should skip security validation when select_only is false', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.connectionManager.executeQuery as jest.Mock).mockResolvedValue({
        rows: [],
        fields: [],
        rowCount: 0,
        truncated: false,
      });

      await handleSqlQuery(ctx, {
        database: 'testdb',
        query: 'DELETE FROM users WHERE id = 1',
      });

      expect(ctx.securityManager.validateSelectOnlyQuery).not.toHaveBeenCalled();
    });

    it('should show truncation notice when results are truncated', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.connectionManager.executeQuery as jest.Mock).mockResolvedValue({
        rows: [{ id: 1 }],
        fields: ['id'],
        rowCount: 1000,
        truncated: true,
      });

      const result = await handleSqlQuery(ctx, {
        database: 'testdb',
        query: 'SELECT * FROM users',
      });

      expect(result.content[0].text).toContain('limited to 1');
    });

    it('should show "No results returned" for empty results', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.connectionManager.executeQuery as jest.Mock).mockResolvedValue({
        rows: [],
        fields: [],
        rowCount: 0,
        truncated: false,
      });

      const result = await handleSqlQuery(ctx, {
        database: 'testdb',
        query: 'SELECT * FROM empty_table',
      });

      expect(result.content[0].text).toContain('No results returned');
    });

    it('should capture schema if not cached', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.schemaManager.hasSchema as jest.Mock).mockReturnValue(false);
      (ctx.connectionManager.getConnection as jest.Mock).mockResolvedValue({ isConnected: true });
      (ctx.connectionManager.executeQuery as jest.Mock).mockResolvedValue({
        rows: [{ id: 1 }],
        fields: ['id'],
        rowCount: 1,
        truncated: false,
      });

      await handleSqlQuery(ctx, { database: 'testdb', query: 'SELECT 1' });

      expect(ctx.schemaManager.captureSchemaOnce).toHaveBeenCalledWith('testdb', expect.anything());
    });

    it('should handle schema capture failure gracefully', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.schemaManager.captureSchemaOnce as jest.Mock).mockRejectedValue(new Error('conn error'));
      (ctx.connectionManager.executeQuery as jest.Mock).mockResolvedValue({
        rows: [],
        fields: [],
        rowCount: 0,
        truncated: false,
      });

      const result = await handleSqlQuery(ctx, { database: 'testdb', query: 'SELECT 1' });

      // Should still succeed despite schema capture failure
      expect(result.content[0].text).toContain('Query executed successfully');
      expect(ctx.logger.warning).toHaveBeenCalled();
    });

    it('should show SSH tunnel info when tunnel exists', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.sshTunnelManager.hasTunnel as jest.Mock).mockReturnValue(true);
      (ctx.connectionManager.executeQuery as jest.Mock).mockResolvedValue({
        rows: [{ id: 1 }],
        fields: ['id'],
        rowCount: 1,
        truncated: false,
      });

      const result = await handleSqlQuery(ctx, { database: 'testdb', query: 'SELECT 1' });

      expect(result.content[0].text).toContain('SSH tunnel');
    });

    it('should show SELECT-only mode info in response', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: true } as DatabaseConfig,
      });
      (ctx.connectionManager.executeQuery as jest.Mock).mockResolvedValue({
        rows: [],
        fields: [],
        rowCount: 0,
        truncated: false,
      });

      const result = await handleSqlQuery(ctx, { database: 'testdb', query: 'SELECT 1' });

      expect(result.content[0].text).toContain('SELECT-only mode active');
    });

    it('should return error response on query execution failure', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.connectionManager.executeQuery as jest.Mock).mockRejectedValue(
        new Error('Syntax error near SELECT')
      );

      const result = await handleSqlQuery(ctx, { database: 'testdb', query: 'SELEC 1' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Query failed');
      expect(result.content[0].text).toContain('Syntax error');
    });

    it('should throw ConfigurationError for nonexistent database', async () => {
      const ctx = createMockContext();

      const result = await handleSqlQuery(ctx, { database: 'nonexistent', query: 'SELECT 1' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Query failed');
    });

    it('should log SSH info for SSH-enabled databases', async () => {
      const ctx = createMockContext({
        testdb: {
          type: 'mysql',
          host: 'localhost',
          ssh_host: 'bastion',
          select_only: false,
        } as DatabaseConfig,
      });
      (ctx.connectionManager.executeQuery as jest.Mock).mockResolvedValue({
        rows: [],
        fields: [],
        rowCount: 0,
        truncated: false,
      });

      await handleSqlQuery(ctx, { database: 'testdb', query: 'SELECT 1' });

      expect(ctx.logger.info).toHaveBeenCalledWith(expect.stringContaining('SSH tunnel'));
    });

    it('should block EXEC even on full-access (select_only=false) database', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mssql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.securityManager.validateAnyQuery as jest.Mock).mockReturnValue({
        allowed: false,
        reason: 'EXEC is not allowed',
      });

      const result = await handleSqlQuery(ctx, {
        database: 'testdb',
        query: 'EXEC xp_cmdshell "dir"',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Query blocked');
      expect(ctx.securityManager.validateAnyQuery).toHaveBeenCalled();
      expect(ctx.connectionManager.executeQuery).not.toHaveBeenCalled();
    });

    it('should block LOAD DATA even on full-access database', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.securityManager.validateAnyQuery as jest.Mock).mockReturnValue({
        allowed: false,
        reason: 'LOAD is not allowed',
      });

      const result = await handleSqlQuery(ctx, {
        database: 'testdb',
        query: "LOAD DATA INFILE '/etc/passwd' INTO TABLE t",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Query blocked');
      expect(ctx.connectionManager.executeQuery).not.toHaveBeenCalled();
    });

    it('should NOT block INSERT on full-access database', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      // validateAnyQuery returns allowed: true (default mock)
      (ctx.connectionManager.executeQuery as jest.Mock).mockResolvedValue({
        rows: [],
        fields: [],
        rowCount: 1,
        truncated: false,
      });

      const result = await handleSqlQuery(ctx, {
        database: 'testdb',
        query: "INSERT INTO t VALUES (1, 'a')",
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Query executed successfully');
      expect(ctx.connectionManager.executeQuery).toHaveBeenCalled();
    });
  });

  describe('handleBatchQuery', () => {
    it('should execute batch queries successfully', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.connectionManager.executeBatch as jest.Mock).mockResolvedValue({
        results: [
          {
            index: 1,
            success: true,
            query: 'SELECT 1',
            data: { rows: [{ '1': 1 }], fields: ['1'], rowCount: 1, truncated: false },
          },
        ],
        totalExecutionTime: 10,
        successCount: 1,
        failureCount: 0,
        transactionUsed: false,
      });

      const result = await handleBatchQuery(ctx, {
        database: 'testdb',
        queries: [{ query: 'SELECT 1' }],
      });

      expect(result.content[0].text).toContain('Batch Query Results');
      expect(result.content[0].text).toContain('Successful: 1');
    });

    it('should throw ValidationError when no queries provided', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });

      await expect(handleBatchQuery(ctx, { database: 'testdb', queries: [] })).rejects.toThrow(
        ValidationError
      );
    });

    it('should throw ValidationError when queries is undefined', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });

      await expect(
        handleBatchQuery(ctx, { database: 'testdb', queries: undefined as any })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError when batch size exceeds maximum', async () => {
      const ctx = createMockContext(
        { testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig },
        { max_batch_size: 3 }
      );

      const queries = Array.from({ length: 4 }, (_, i) => ({ query: `SELECT ${i}` }));

      await expect(handleBatchQuery(ctx, { database: 'testdb', queries })).rejects.toThrow(
        ValidationError
      );
    });

    it('should use default max batch size of 10', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });

      const queries = Array.from({ length: 11 }, (_, i) => ({ query: `SELECT ${i}` }));

      await expect(handleBatchQuery(ctx, { database: 'testdb', queries })).rejects.toThrow(
        ValidationError
      );
    });

    it('should validate all queries for SELECT-only mode', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: true } as DatabaseConfig,
      });
      (ctx.securityManager.validateSelectOnlyQuery as jest.Mock)
        .mockReturnValueOnce({ allowed: true })
        .mockReturnValueOnce({ allowed: false, reason: 'DELETE not allowed' });

      const result = await handleBatchQuery(ctx, {
        database: 'testdb',
        queries: [{ query: 'SELECT 1' }, { query: 'DELETE FROM users' }],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Security Information');
    });

    it('should block EXEC in batch on full-access database', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mssql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.securityManager.validateAnyQuery as jest.Mock)
        .mockReturnValueOnce({
          allowed: true,
        })
        .mockReturnValueOnce({
          allowed: false,
          reason: 'EXEC is not allowed',
        });

      const result = await handleBatchQuery(ctx, {
        database: 'testdb',
        queries: [{ query: 'SELECT 1' }, { query: 'EXEC xp_cmdshell "dir"' }],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Batch contains blocked query');
      expect(ctx.connectionManager.executeBatch).not.toHaveBeenCalled();
    });

    it('should pass transaction flag correctly', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.connectionManager.executeBatch as jest.Mock).mockResolvedValue({
        results: [],
        totalExecutionTime: 5,
        successCount: 0,
        failureCount: 0,
        transactionUsed: true,
      });

      await handleBatchQuery(ctx, {
        database: 'testdb',
        queries: [{ query: 'SELECT 1' }],
        transaction: true,
      });

      expect(ctx.connectionManager.executeBatch).toHaveBeenCalledWith(
        'testdb',
        [{ query: 'SELECT 1' }],
        true
      );
    });

    it('should disable transaction in SELECT-only mode', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: true } as DatabaseConfig,
      });
      (ctx.connectionManager.executeBatch as jest.Mock).mockResolvedValue({
        results: [],
        totalExecutionTime: 5,
        successCount: 0,
        failureCount: 0,
        transactionUsed: false,
      });

      await handleBatchQuery(ctx, {
        database: 'testdb',
        queries: [{ query: 'SELECT 1' }],
        transaction: true,
      });

      // transaction && !select_only = true && false = false
      expect(ctx.connectionManager.executeBatch).toHaveBeenCalledWith(
        'testdb',
        [{ query: 'SELECT 1' }],
        false
      );
    });

    it('should display individual query results with labels', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.connectionManager.executeBatch as jest.Mock).mockResolvedValue({
        results: [
          {
            index: 1,
            label: 'Get Users',
            success: true,
            query: 'SELECT * FROM users',
            data: {
              rows: [{ id: 1 }],
              fields: ['id'],
              rowCount: 1,
              truncated: false,
              execution_time_ms: 5,
            },
          },
          {
            index: 2,
            success: false,
            query: 'INVALID SQL',
            error: 'Syntax error',
          },
        ],
        totalExecutionTime: 10,
        successCount: 1,
        failureCount: 1,
        transactionUsed: false,
      });

      const result = await handleBatchQuery(ctx, {
        database: 'testdb',
        queries: [{ query: 'SELECT * FROM users', label: 'Get Users' }, { query: 'INVALID SQL' }],
      });

      expect(result.content[0].text).toContain('Get Users');
      expect(result.content[0].text).toContain('[OK] Success');
      expect(result.content[0].text).toContain('[ERROR] Failed');
      expect(result.content[0].text).toContain('5ms');
    });

    it('should show transaction info when transaction is used', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.connectionManager.executeBatch as jest.Mock).mockResolvedValue({
        results: [],
        totalExecutionTime: 5,
        successCount: 0,
        failureCount: 0,
        transactionUsed: true,
      });

      const result = await handleBatchQuery(ctx, {
        database: 'testdb',
        queries: [{ query: 'SELECT 1' }],
        transaction: true,
      });

      expect(result.content[0].text).toContain('Transaction');
    });

    it('should show SSH tunnel and SELECT-only info', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: true } as DatabaseConfig,
      });
      (ctx.sshTunnelManager.hasTunnel as jest.Mock).mockReturnValue(true);
      (ctx.connectionManager.executeBatch as jest.Mock).mockResolvedValue({
        results: [],
        totalExecutionTime: 5,
        successCount: 0,
        failureCount: 0,
        transactionUsed: false,
      });

      const result = await handleBatchQuery(ctx, {
        database: 'testdb',
        queries: [{ query: 'SELECT 1' }],
      });

      expect(result.content[0].text).toContain('SELECT-only mode active');
      expect(result.content[0].text).toContain('SSH tunnel');
    });

    it('should handle execution errors', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.connectionManager.executeBatch as jest.Mock).mockRejectedValue(
        new Error('Connection lost')
      );

      const result = await handleBatchQuery(ctx, {
        database: 'testdb',
        queries: [{ query: 'SELECT 1' }],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Batch Query Failed');
      expect(result.content[0].text).toContain('Connection lost');
    });

    it('should show "No results returned" for queries with empty rows', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.connectionManager.executeBatch as jest.Mock).mockResolvedValue({
        results: [
          {
            index: 1,
            success: true,
            query: 'INSERT INTO t VALUES (1)',
            data: { rows: [], fields: [], rowCount: 0, truncated: false },
          },
        ],
        totalExecutionTime: 5,
        successCount: 1,
        failureCount: 0,
        transactionUsed: false,
      });

      const result = await handleBatchQuery(ctx, {
        database: 'testdb',
        queries: [{ query: 'INSERT INTO t VALUES (1)' }],
      });

      expect(result.content[0].text).toContain('No results returned');
    });

    it('should show truncated row info in individual results', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.connectionManager.executeBatch as jest.Mock).mockResolvedValue({
        results: [
          {
            index: 1,
            success: true,
            query: 'SELECT * FROM big_table',
            data: { rows: [{ id: 1 }], fields: ['id'], rowCount: 1000, truncated: true },
          },
        ],
        totalExecutionTime: 20,
        successCount: 1,
        failureCount: 0,
        transactionUsed: false,
      });

      const result = await handleBatchQuery(ctx, {
        database: 'testdb',
        queries: [{ query: 'SELECT * FROM big_table' }],
      });

      expect(result.content[0].text).toContain('showing 1');
    });
  });

  describe('handleAnalyzePerformance', () => {
    it('should analyze query performance successfully', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.connectionManager.analyzePerformance as jest.Mock).mockResolvedValue({
        executionTime: 42,
        explainTime: 5,
        rowCount: 100,
        columnCount: 5,
        executionPlan: 'FULL TABLE SCAN on users',
        recommendations: 'Consider adding an index on users.email',
      });

      const result = await handleAnalyzePerformance(ctx, {
        database: 'testdb',
        query: 'SELECT * FROM users WHERE email = "test@example.com"',
      });

      expect(result.content[0].text).toContain('Query Performance Analysis');
      expect(result.content[0].text).toContain('42ms');
      expect(result.content[0].text).toContain('5ms');
      expect(result.content[0].text).toContain('100');
      expect(result.content[0].text).toContain('FULL TABLE SCAN');
      expect(result.content[0].text).toContain('Consider adding an index');
    });

    it('should return error response on failure', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.connectionManager.analyzePerformance as jest.Mock).mockRejectedValue(
        new Error('EXPLAIN not supported')
      );

      const result = await handleAnalyzePerformance(ctx, {
        database: 'testdb',
        query: 'SELECT 1',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Performance analysis failed');
    });

    it('should log SSH info for SSH-enabled databases', async () => {
      const ctx = createMockContext({
        testdb: {
          type: 'mysql',
          host: 'localhost',
          ssh_host: 'bastion',
          select_only: false,
        } as DatabaseConfig,
      });
      (ctx.connectionManager.analyzePerformance as jest.Mock).mockResolvedValue({
        executionTime: 10,
        explainTime: 2,
        rowCount: 0,
        columnCount: 0,
        executionPlan: '',
        recommendations: '',
      });

      await handleAnalyzePerformance(ctx, { database: 'testdb', query: 'SELECT 1' });

      expect(ctx.logger.info).toHaveBeenCalledWith(expect.stringContaining('SSH tunnel'));
    });

    it('should throw ConfigurationError for nonexistent database', async () => {
      const ctx = createMockContext();

      const result = await handleAnalyzePerformance(ctx, {
        database: 'nonexistent',
        query: 'SELECT 1',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Performance analysis failed');
    });
  });
});

describe('name check', () => {
  const col = (name: string) => ({ name, type: 'text', nullable: true, default: null });
  const table = (name: string, cols: string[]) => ({ name, type: 'table', columns: cols.map(col) });
  const makeSchema = (extra: Record<string, any> = {}): any => ({
    database: 'db',
    type: 'postgresql',
    captured_at: '',
    tables: {
      users: table('users', ['id', 'username', 'email']),
      orders: table('orders', ['id', 'user_id', 'total']),
      ...extra,
    },
    views: {},
    summary: { table_count: 2, view_count: 0, total_columns: 6 },
  });
  const dbs = (extra: Partial<DatabaseConfig> = {}) => ({
    db: { type: 'postgresql', select_only: true, ...extra } as DatabaseConfig,
  });
  const BAD = 'SELECT u.user_name FROM users u';

  function ctxWith(schema: any, extra: Partial<DatabaseConfig> = {}) {
    const ctx = createMockContext(dbs(extra));
    (ctx.schemaManager.getSchema as jest.Mock).mockReturnValue(schema);
    (ctx.connectionManager.executeQuery as jest.Mock).mockResolvedValue({
      rows: [],
      rowCount: 0,
      fields: [],
    });
    return ctx;
  }

  it('blocks a query naming a missing column and journals it as blocked', async () => {
    const ctx = ctxWith(makeSchema());
    const append = jest.fn();
    ctx.paneStore = { newId: () => 'j1', append, writeSpool: jest.fn() } as any;
    const r = await handleSqlQuery(ctx, { database: 'db', query: BAD });
    expect(ctx.connectionManager.executeQuery).not.toHaveBeenCalled();
    expect(r.isError).toBe(true);
    const text = r.content[0].text;
    expect(text).toContain('Query not run');
    expect(text).toContain('Did you mean: username');
    expect(text).toContain('Columns of users');
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'blocked' }));
  });

  it('runs the query when name_check is false', async () => {
    const ctx = ctxWith(makeSchema(), { name_check: false });
    await handleSqlQuery(ctx, { database: 'db', query: BAD });
    expect(ctx.connectionManager.executeQuery).toHaveBeenCalled();
  });

  it('re-reads the schema after a forced check and runs if the column now exists', async () => {
    const ctx = ctxWith(makeSchema());
    const fresh = makeSchema({ users: table('users', ['id', 'user_name']) });
    (ctx.schemaManager.getSchema as jest.Mock)
      .mockReturnValueOnce(makeSchema())
      .mockReturnValue(fresh);
    const forced = { kind: 'column-added', table: 'users', column: 'user_name', type: 'text' };
    (ctx.schemaWatch.check as jest.Mock).mockImplementation(async (_d, _c, opts) =>
      opts?.force ? [forced] : []
    );
    const r = await handleSqlQuery(ctx, { database: 'db', query: BAD });
    expect(ctx.connectionManager.executeQuery).toHaveBeenCalled();
    expect(ctx.schemaWatch.check).toHaveBeenCalledWith('db', expect.anything(), { force: true });
    expect(r.isError).toBeUndefined();
  });

  it('reports the forced check changes when it still blocks', async () => {
    const ctx = ctxWith(makeSchema());
    const forced = { kind: 'column-added', table: 'orders', column: 'shipped_at', type: 'text' };
    (ctx.schemaWatch.check as jest.Mock).mockImplementation(async (_d, _c, opts) =>
      opts?.force ? [forced] : []
    );
    const r = await handleSqlQuery(ctx, { database: 'db', query: BAD });
    expect(r.isError).toBe(true);
    expect(r._meta.argos?.schemaChange).toEqual([forced]);
  });

  it('captures the schema before running when none is cached', async () => {
    const ctx = ctxWith(undefined);
    const order: string[] = [];
    (ctx.schemaManager.captureSchemaOnce as jest.Mock).mockImplementation(async () => {
      order.push('capture');
      return null;
    });
    (ctx.connectionManager.executeQuery as jest.Mock).mockImplementation(async () => {
      order.push('execute');
      return { rows: [], rowCount: 0, fields: [] };
    });
    await handleSqlQuery(ctx, { database: 'db', query: 'SELECT 1' });
    expect(order).toEqual(['capture', 'execute']);
  });

  it('adds a correction after the sanitized driver error (layer 2)', async () => {
    const ctx = ctxWith(makeSchema());
    const err = Object.assign(new Error('query failed'), {
      cause: { code: '42703', message: 'column "emial" does not exist' },
    });
    (ctx.connectionManager.executeQuery as jest.Mock).mockRejectedValue(err);
    const r = await handleSqlQuery(ctx, {
      database: 'db',
      query: 'WITH x AS (SELECT * FROM users) SELECT emial FROM x, users',
    });
    const text = r.content[0].text;
    expect(text).toContain('Query failed on db: query failed');
    expect(text.indexOf('query failed')).toBeLessThan(text.indexOf('Did you mean: email'));
  });

  it('does not redact names in the correction (table called token)', async () => {
    const ctx = ctxWith(makeSchema({ token: table('token', ['id', 'secret']) }));
    const r = await handleSqlQuery(ctx, { database: 'db', query: 'SELECT t.secrt FROM token t' });
    const text = r.content[0].text;
    expect(text).toContain('Columns of token');
    expect(text).toContain('secret');
    expect(text).not.toContain('[REDACTED]');
  });

  it('blocks sql_analyze_performance too', async () => {
    const ctx = ctxWith(makeSchema());
    const r = await handleAnalyzePerformance(ctx, { database: 'db', query: BAD });
    expect(ctx.connectionManager.analyzePerformance).not.toHaveBeenCalled();
    expect(r.content[0].text).toContain('Did you mean: username');
  });

  it('preflightNames copies the statement index onto each problem', async () => {
    const ctx = ctxWith(makeSchema());
    const found = await preflightNames(ctx, 'db', dbs().db, BAD, 2);
    expect(found?.problems[0]).toMatchObject({ name: 'user_name', statement: 2 });
    expect(found?.correction).toContain('in statement 3');
  });
});

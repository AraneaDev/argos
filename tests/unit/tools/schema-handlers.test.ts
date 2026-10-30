/**
 * Schema Handlers Tests
 * Tests for sql_get_schema, sql_refresh_schema, sql_list_databases, sql_test_connection handlers
 */

import type { SchemaWatch } from '../../../src/schema/watch.js';
import {
  handleGetSchema,
  handleRefreshSchema,
  handleListDatabases,
  handleTestConnection,
} from '../../../src/tools/handlers/schema-handlers.js';
import type { ToolHandlerContext } from '../../../src/tools/handlers/types.js';
import type { ParsedServerConfig, DatabaseConfig } from '../../../src/types/index.js';
import { ConfigurationError } from '../../../src/utils/error-handler.js';
import { formatDatabaseSummary } from '../../../src/utils/response-formatter.js';

// Mock response-formatter
jest.mock('../../../src/utils/response-formatter.js', () => ({
  createToolResponse: jest.fn((text: string, isError = false) => ({
    content: [{ type: 'text', text }],
    _meta: { progressToken: null },
    ...(isError ? { isError: true } : {}),
  })),
  formatDatabaseSummary: jest.fn((db: any) => ` **${db.name}** (${db.type})\n`),
}));

function createMockContext(
  databases: Record<string, DatabaseConfig> = {},
  security?: any
): ToolHandlerContext {
  return {
    connectionManager: {
      registerDatabase: jest.fn(),
      unregisterDatabase: jest.fn(),
      getConnection: jest.fn(),
      executeQuery: jest.fn(),
      executeBatch: jest.fn(),
      analyzePerformance: jest.fn(),
      getPrivileges: jest.fn().mockReturnValue(undefined),
      checkPrivileges: jest.fn().mockResolvedValue(undefined),
    } as any,
    securityManager: {
      validateSelectOnlyQuery: jest.fn(),
    } as any,
    schemaManager: {
      getSchema: jest.fn(),
      hasSchema: jest.fn().mockReturnValue(false),
      captureSchema: jest.fn(),
      refreshSchema: jest.fn(),
      generateSchemaContext: jest.fn(),
    } as any,
    sshTunnelManager: {
      hasTunnel: jest.fn().mockReturnValue(false),
      closeTunnel: jest.fn(),
    } as any,
    metricsManager: {
      getSnapshot: jest.fn().mockReturnValue({}),
    } as any,
    config: {
      databases,
      ...(security ? { security } : {}),
    } as ParsedServerConfig,
    configPath: '/tmp/test-config.ini',
    schemaWatch: { check: jest.fn().mockResolvedValue([]) } as unknown as SchemaWatch,
    paneStore: null,
    logger: {
      info: jest.fn(),
      debug: jest.fn(),
      warning: jest.fn(),
      error: jest.fn(),
    } as any,
  };
}

describe('schema-handlers', () => {
  describe('handleGetSchema', () => {
    it('should return schema text when schema is available', async () => {
      const ctx = createMockContext();
      (ctx.schemaManager.getSchema as jest.Mock).mockReturnValue({ summary: {} });
      (ctx.schemaManager.generateSchemaContext as jest.Mock).mockReturnValue(
        'Schema for testdb...'
      );

      const result = await handleGetSchema(ctx, { database: 'testdb' });

      expect(result.content[0].text).toBe('Schema for testdb...');
      expect(ctx.schemaManager.generateSchemaContext).toHaveBeenCalledWith('testdb', undefined);
    });

    it('should return schema filtered by table name', async () => {
      const ctx = createMockContext();
      (ctx.schemaManager.getSchema as jest.Mock).mockReturnValue({ summary: {} });
      (ctx.schemaManager.generateSchemaContext as jest.Mock).mockReturnValue('Table: users');

      const result = await handleGetSchema(ctx, { database: 'testdb', table: 'users' });

      expect(ctx.schemaManager.generateSchemaContext).toHaveBeenCalledWith('testdb', 'users');
    });

    it('captures the schema when none is cached', async () => {
      const dbConfig = { type: 'mysql' } as DatabaseConfig;
      const ctx = createMockContext({ testdb: dbConfig });
      let captured = false;
      (ctx.schemaManager.getSchema as jest.Mock).mockImplementation(() =>
        captured ? { database: 'testdb', tables: {} } : null
      );
      (ctx.schemaManager as any).captureSchemaOnce = jest.fn().mockImplementation(async () => {
        captured = true;
        return { summary: {} };
      });
      (ctx.schemaManager.generateSchemaContext as jest.Mock).mockReturnValue('Captured schema');

      const result = await handleGetSchema(ctx, { database: 'testdb' });

      expect((ctx.schemaManager as any).captureSchemaOnce).toHaveBeenCalledWith('testdb', dbConfig);
      expect(result.content[0].text).toBe('Captured schema');
    });

    it('returns an error response for an unknown database', async () => {
      const ctx = createMockContext();

      const result = await handleGetSchema(ctx, { database: 'nope' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });

    it('reports a failed capture when no schema can be obtained', async () => {
      const ctx = createMockContext({ testdb: { type: 'mysql' } as DatabaseConfig });
      (ctx.schemaManager.getSchema as jest.Mock).mockReturnValue(null);
      (ctx.schemaManager as any).captureSchemaOnce = jest
        .fn()
        .mockRejectedValue(new Error('connection refused'));

      const result = await handleGetSchema(ctx, { database: 'testdb' });

      expect(result.content[0].text).toContain("Could not capture the schema for 'testdb'");
      expect(ctx.schemaManager.generateSchemaContext).not.toHaveBeenCalled();
    });

    it('should return error response when schema manager throws', async () => {
      const ctx = createMockContext();
      (ctx.schemaManager.getSchema as jest.Mock).mockImplementation(() => {
        throw new Error('Schema error');
      });

      const result = await handleGetSchema(ctx, { database: 'testdb' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to get schema');
    });
  });

  describe('handleRefreshSchema', () => {
    it('should refresh schema successfully when connection exists', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', select_only: true } as DatabaseConfig,
      });
      (ctx.connectionManager.getConnection as jest.Mock).mockResolvedValue({ isConnected: true });
      (ctx.schemaManager.refreshSchema as jest.Mock).mockResolvedValue({
        summary: { table_count: 5, total_columns: 20 },
      });

      const result = await handleRefreshSchema(ctx, { database: 'testdb' });

      expect(result.content[0].text).toContain('Schema refreshed');
      expect(result.content[0].text).toContain('5 tables');
      expect(result.content[0].text).toContain('20 columns');
      expect(ctx.connectionManager.executeQuery).not.toHaveBeenCalled();
      expect(ctx.logger.info).not.toHaveBeenCalled();
    });

    it('should establish connection if none exists', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', select_only: true } as DatabaseConfig,
      });
      (ctx.connectionManager.getConnection as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ isConnected: true });
      (ctx.schemaManager.refreshSchema as jest.Mock).mockResolvedValue({
        summary: { table_count: 3, total_columns: 10 },
      });

      const result = await handleRefreshSchema(ctx, { database: 'testdb' });

      expect(ctx.connectionManager.executeQuery).toHaveBeenCalledWith('testdb', 'SELECT 1', []);
      expect(result.content[0].text).toContain('Schema refreshed');
    });

    it('should throw ConnectionError if connection cannot be established', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', select_only: true } as DatabaseConfig,
      });
      (ctx.connectionManager.getConnection as jest.Mock).mockResolvedValue(null);

      const result = await handleRefreshSchema(ctx, { database: 'testdb' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to refresh schema');
      expect(ctx.schemaManager.refreshSchema).not.toHaveBeenCalled();
    });

    it('should log SSH info when ssh_host is configured', async () => {
      const ctx = createMockContext({
        testdb: {
          type: 'mysql',
          ssh_host: 'bastion.example.com',
          select_only: true,
        } as DatabaseConfig,
      });
      (ctx.connectionManager.getConnection as jest.Mock).mockResolvedValue(null);

      await handleRefreshSchema(ctx, { database: 'testdb' });

      expect(ctx.logger.info).toHaveBeenCalledWith(expect.stringContaining('SSH tunnel'));
    });

    it('should throw ConfigurationError for nonexistent database', async () => {
      const ctx = createMockContext();

      // requireDbConfig throws ConfigurationError, which is caught and returned as error response
      const result = await handleRefreshSchema(ctx, { database: 'nonexistent' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to refresh schema');
    });
  });

  describe('handleListDatabases', () => {
    it('should list all configured databases', async () => {
      const ctx = createMockContext({
        db1: { type: 'mysql', host: 'localhost', select_only: true } as DatabaseConfig,
        db2: {
          type: 'postgresql',
          host: 'pghost',
          ssl: true,
          ssh_host: 'bastion',
          mcp_configurable: true,
        } as DatabaseConfig,
      });

      const result = await handleListDatabases(ctx);

      expect(result.content[0].text).toContain('Configured Databases');
      expect(result.content[0].text).toContain('db1');
      expect(result.content[0].text).toContain('db2');
    });

    it('should include schema info when cached', async () => {
      const ctx = createMockContext({
        db1: { type: 'mysql', host: 'localhost', select_only: true } as DatabaseConfig,
      });
      (ctx.schemaManager.hasSchema as jest.Mock).mockReturnValue(true);
      (ctx.schemaManager.getSchema as jest.Mock).mockReturnValue({
        summary: { table_count: 10, view_count: 2, total_columns: 50 },
      });

      const result = await handleListDatabases(ctx);

      expect(result.content[0].text).toContain('Configured Databases');
      expect(ctx.schemaManager.getSchema).toHaveBeenCalledWith('db1');
      expect(formatDatabaseSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'db1',
          host: 'localhost',
          ssh_enabled: false,
          ssl_enabled: false,
          select_only_mode: true,
          mcp_configurable: false,
          schema_cached: true,
          schema_info: { table_count: 10, view_count: 2, total_columns: 50 },
        })
      );
    });

    it('should include security limits when configured', async () => {
      const ctx = createMockContext(
        { db1: { type: 'mysql', host: 'localhost', select_only: true } as DatabaseConfig },
        {
          max_joins: 5,
          max_subqueries: 3,
          max_unions: 2,
          max_group_bys: 4,
          max_complexity_score: 100,
          max_query_length: 10000,
        }
      );

      const result = await handleListDatabases(ctx);

      expect(result.content[0].text).toContain('Global Security Limits');
      expect(result.content[0].text).toContain('Max JOINs: 5');
    });

    it('should handle errors gracefully', async () => {
      const ctx = createMockContext();
      // Force an error by making Object.entries throw indirectly
      Object.defineProperty(ctx.config, 'databases', {
        get() {
          throw new Error('config broken');
        },
      });

      const result = await handleListDatabases(ctx);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to list databases');
    });

    it('should return empty list when no databases configured', async () => {
      const ctx = createMockContext({});

      const result = await handleListDatabases(ctx);

      expect(result.content[0].text).toContain('Configured Databases');
    });
  });

  describe('handleTestConnection', () => {
    it('should test connection successfully', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: true } as DatabaseConfig,
      });
      (ctx.connectionManager.getConnection as jest.Mock).mockResolvedValue({ isConnected: true });
      (ctx.connectionManager.executeQuery as jest.Mock).mockResolvedValue({ rows: [{ 1: 1 }] });
      (ctx.schemaManager.hasSchema as jest.Mock).mockReturnValue(true);
      (ctx.schemaManager.getSchema as jest.Mock).mockReturnValue({
        summary: { table_count: 5, total_columns: 20 },
      });

      const result = await handleTestConnection(ctx, { database: 'testdb' });

      expect(result.content[0].text).toContain('Connection successful');
      expect(result.content[0].text).toContain('SELECT-only mode active');
    });

    it('should capture schema if not cached', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.schemaManager.hasSchema as jest.Mock).mockReturnValue(false);
      (ctx.connectionManager.getConnection as jest.Mock).mockResolvedValue({ isConnected: true });
      (ctx.connectionManager.executeQuery as jest.Mock).mockResolvedValue({ rows: [{ 1: 1 }] });
      (ctx.schemaManager.getSchema as jest.Mock).mockReturnValue(null);

      await handleTestConnection(ctx, { database: 'testdb' });

      expect(ctx.schemaManager.captureSchema).toHaveBeenCalledWith('testdb', expect.anything());
    });

    it('should show SSH tunnel info when tunnel exists', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.connectionManager.getConnection as jest.Mock).mockResolvedValue({ isConnected: true });
      (ctx.connectionManager.executeQuery as jest.Mock).mockResolvedValue({ rows: [{ 1: 1 }] });
      (ctx.sshTunnelManager.hasTunnel as jest.Mock).mockReturnValue(true);
      (ctx.schemaManager.hasSchema as jest.Mock).mockReturnValue(true);
      (ctx.schemaManager.getSchema as jest.Mock).mockReturnValue(null);

      const result = await handleTestConnection(ctx, { database: 'testdb' });

      expect(result.content[0].text).toContain('SSH tunnel established');
    });

    it('should show schema info when schema is available', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.connectionManager.getConnection as jest.Mock).mockResolvedValue({ isConnected: true });
      (ctx.connectionManager.executeQuery as jest.Mock).mockResolvedValue({ rows: [{ 1: 1 }] });
      (ctx.schemaManager.hasSchema as jest.Mock).mockReturnValue(true);
      (ctx.schemaManager.getSchema as jest.Mock).mockReturnValue({
        summary: { table_count: 10, total_columns: 50 },
      });

      const result = await handleTestConnection(ctx, { database: 'testdb' });

      expect(result.content[0].text).toContain('Schema captured: 10 tables');
    });

    it('should report failure when getConnection fails', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: true } as DatabaseConfig,
      });
      (ctx.connectionManager.getConnection as jest.Mock).mockRejectedValue(
        new Error('Connection refused')
      );

      const result = await handleTestConnection(ctx, { database: 'testdb' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Connection test failed');
      expect(result.content[0].text).toContain('Connection refused');
    });

    it('should report failure when executeQuery health check fails', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.connectionManager.getConnection as jest.Mock).mockResolvedValue({ isConnected: true });
      (ctx.connectionManager.executeQuery as jest.Mock).mockRejectedValue(
        new Error('Connection lost')
      );

      const result = await handleTestConnection(ctx, { database: 'testdb' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Connection test failed');
      expect(result.content[0].text).toContain('Connection lost');
    });

    it('sanitizes sensitive driver errors before returning to the client (FIND-103)', async () => {
      const ctx = createMockContext({
        testdb: { type: 'postgresql', host: 'localhost', select_only: true } as DatabaseConfig,
      });
      // A driver error carrying credentials in a connection string must not reach the LLM.
      (ctx.connectionManager.getConnection as jest.Mock).mockRejectedValue(
        new Error('connection failed: postgresql://admin:s3cr3tP4ss@10.0.0.5:5432/prod')
      );

      const result = await handleTestConnection(ctx, { database: 'testdb' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Connection test failed');
      expect(result.content[0].text).not.toContain('s3cr3tP4ss');
      expect(result.content[0].text).toContain('<connection_string>');
    });

    it('should succeed even when schema capture fails', async () => {
      const ctx = createMockContext({
        testdb: { type: 'mysql', host: 'localhost', select_only: false } as DatabaseConfig,
      });
      (ctx.connectionManager.getConnection as jest.Mock).mockResolvedValue({ isConnected: true });
      (ctx.connectionManager.executeQuery as jest.Mock).mockResolvedValue({ rows: [{ 1: 1 }] });
      (ctx.schemaManager.hasSchema as jest.Mock).mockReturnValue(false);
      (ctx.schemaManager.captureSchema as jest.Mock).mockRejectedValue(
        new Error('Schema capture error')
      );
      (ctx.schemaManager.getSchema as jest.Mock).mockReturnValue(null);

      const result = await handleTestConnection(ctx, { database: 'testdb' });

      expect(result.content[0].text).toContain('Connection successful');
      expect(result.isError).toBeUndefined();
      expect(ctx.logger.warning).toHaveBeenCalledWith('Failed to capture schema', {
        database: 'testdb',
        error: 'Schema capture error',
      });
    });

    it('should throw ConfigurationError for nonexistent database', async () => {
      const ctx = createMockContext();

      const result = await handleTestConnection(ctx, { database: 'nonexistent' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Connection test failed');
    });

    it('should log SSH info for SSH-enabled databases', async () => {
      const ctx = createMockContext({
        testdb: {
          type: 'mysql',
          host: 'localhost',
          ssh_host: 'bastion',
          select_only: true,
        } as DatabaseConfig,
      });
      (ctx.connectionManager.getConnection as jest.Mock).mockResolvedValue({ isConnected: true });
      (ctx.connectionManager.executeQuery as jest.Mock).mockResolvedValue({ rows: [{ 1: 1 }] });
      (ctx.schemaManager.hasSchema as jest.Mock).mockReturnValue(true);
      (ctx.schemaManager.getSchema as jest.Mock).mockReturnValue(null);

      await handleTestConnection(ctx, { database: 'testdb' });

      expect(ctx.logger.info).toHaveBeenCalledWith(expect.stringContaining('SSH tunnel'));
    });
  });

  describe('privilege check', () => {
    const WRITER = {
      canWrite: true,
      principal: 'dbo',
      reasons: ['db_owner'],
      notes: [],
      checkedAt: '2026-10-30T00:00:00.000Z',
    };
    const connected = (ctx: ToolHandlerContext) => {
      (ctx.connectionManager.getConnection as jest.Mock).mockResolvedValue({ isConnected: true });
      (ctx.connectionManager.executeQuery as jest.Mock).mockResolvedValue({ rows: [{ 1: 1 }] });
    };

    it('sql_test_connection warns when a select_only connection can write', async () => {
      const ctx = createMockContext({
        az: { type: 'mssql', host: 'h', select_only: true } as DatabaseConfig,
      });
      connected(ctx);
      (ctx.connectionManager.checkPrivileges as jest.Mock).mockResolvedValue(WRITER);

      const text = (await handleTestConnection(ctx, { database: 'az' })).content[0].text;

      expect(ctx.connectionManager.checkPrivileges).toHaveBeenCalledWith('az');
      expect(text).toContain(
        'Warning: select_only is on, but this connection can write as dbo (db_owner).'
      );
      expect(text).toContain("Argos's filter is the only guard.");
    });

    it('sql_test_connection says when the role is read-only, and when it could not be checked', async () => {
      const ctx = createMockContext({
        ro: { type: 'postgresql', host: 'h', select_only: true } as DatabaseConfig,
      });
      connected(ctx);
      (ctx.connectionManager.checkPrivileges as jest.Mock).mockResolvedValue({
        ...WRITER,
        canWrite: false,
        principal: 'reader',
        reasons: [],
      });
      expect((await handleTestConnection(ctx, { database: 'ro' })).content[0].text).toContain(
        'Database role: read-only (reader)'
      );

      (ctx.connectionManager.checkPrivileges as jest.Mock).mockRejectedValueOnce(
        new Error('password=hunter2 rejected')
      );
      const leaked = (await handleTestConnection(ctx, { database: 'ro' })).content[0].text;
      expect(leaked).toContain('could not be checked (password=[REDACTED] rejected)');
      expect(leaked).not.toContain('hunter2');

      (ctx.connectionManager.checkPrivileges as jest.Mock).mockRejectedValue(
        new Error('timed out')
      );
      const text = (await handleTestConnection(ctx, { database: 'ro' })).content[0].text;
      expect(text).toContain('Connection successful');
      expect(text).toContain('Database role: could not be checked (timed out)');
    });

    it('sql_test_connection says nothing about the role of a full-access database', async () => {
      const ctx = createMockContext({
        rw: { type: 'postgresql', host: 'h', select_only: false } as DatabaseConfig,
      });
      connected(ctx);
      expect((await handleTestConnection(ctx, { database: 'rw' })).content[0].text).not.toContain(
        'Database role'
      );
    });

    it('sql_list_databases hands the last check to the summary', async () => {
      const ctx = createMockContext({
        az: { type: 'mssql', host: 'h', select_only: true } as DatabaseConfig,
      });
      (ctx.connectionManager.getPrivileges as jest.Mock).mockReturnValue(WRITER);
      await handleListDatabases(ctx);
      expect(formatDatabaseSummary).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'az', privileges: WRITER })
      );
    });
  });
});

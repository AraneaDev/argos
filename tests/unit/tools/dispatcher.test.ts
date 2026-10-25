/**
 * Tool Dispatcher Tests
 * Tests routing of tool calls to the correct handler
 */

import type { SchemaWatch } from '../../../src/schema/watch.js';
import { createToolDispatcher } from '../../../src/tools/dispatcher.js';
import type { ToolHandlerContext } from '../../../src/tools/handlers/types.js';
import type {
  ParsedServerConfig,
  DatabaseConfig,
  MCPToolResponse,
} from '../../../src/types/index.js';
import { ValidationError } from '../../../src/utils/error-handler.js';

// Mock all handler modules
jest.mock('../../../src/tools/handlers/query-handlers.js', () => ({
  handleSqlQuery: jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'query result' }],
    _meta: { progressToken: null },
  } satisfies MCPToolResponse),
  handleBatchQuery: jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'batch result' }],
    _meta: { progressToken: null },
  } satisfies MCPToolResponse),
  handleAnalyzePerformance: jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'perf result' }],
    _meta: { progressToken: null },
  } satisfies MCPToolResponse),
}));

jest.mock('../../../src/tools/handlers/schema-handlers.js', () => ({
  handleGetSchema: jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'schema result' }],
    _meta: { progressToken: null },
  } satisfies MCPToolResponse),
  handleRefreshSchema: jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'refresh result' }],
    _meta: { progressToken: null },
  } satisfies MCPToolResponse),
  handleListDatabases: jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'list result' }],
    _meta: { progressToken: null },
  } satisfies MCPToolResponse),
  handleTestConnection: jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'test result' }],
    _meta: { progressToken: null },
  } satisfies MCPToolResponse),
}));

jest.mock('../../../src/tools/handlers/config-handlers.js', () => ({
  handleAddDatabase: jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'add result' }],
    _meta: { progressToken: null },
  } satisfies MCPToolResponse),
  handleUpdateDatabase: jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'update result' }],
    _meta: { progressToken: null },
  } satisfies MCPToolResponse),
  handleRemoveDatabase: jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'remove result' }],
    _meta: { progressToken: null },
  } satisfies MCPToolResponse),
  handleGetConfig: jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'config result' }],
    _meta: { progressToken: null },
  } satisfies MCPToolResponse),
  handleSetMcpConfigurable: jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'mcp result' }],
    _meta: { progressToken: null },
  } satisfies MCPToolResponse),
}));

jest.mock('../../../src/tools/handlers/metrics-handlers.js', () => ({
  handleGetMetrics: jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'metrics result' }],
    _meta: { progressToken: null },
  } satisfies MCPToolResponse),
}));

import {
  handleSqlQuery,
  handleBatchQuery,
  handleAnalyzePerformance,
} from '../../../src/tools/handlers/query-handlers.js';
import {
  handleGetSchema,
  handleRefreshSchema,
  handleListDatabases,
  handleTestConnection,
} from '../../../src/tools/handlers/schema-handlers.js';
import {
  handleAddDatabase,
  handleUpdateDatabase,
  handleRemoveDatabase,
  handleGetConfig,
  handleSetMcpConfigurable,
} from '../../../src/tools/handlers/config-handlers.js';
import { handleGetMetrics } from '../../../src/tools/handlers/metrics-handlers.js';

function createMockContext(): ToolHandlerContext {
  return {
    connectionManager: {} as any,
    securityManager: {} as any,
    schemaManager: {} as any,
    sshTunnelManager: {} as any,
    metricsManager: {
      getSnapshot: jest.fn().mockReturnValue({}),
    } as any,
    config: { databases: {} } as ParsedServerConfig,
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

describe('dispatcher', () => {
  let dispatch: ReturnType<typeof createToolDispatcher>;
  let ctx: ToolHandlerContext;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = createMockContext();
    dispatch = createToolDispatcher(ctx);
  });

  describe('sql_query', () => {
    it('should route to handleSqlQuery with valid args', async () => {
      const result = await dispatch('sql_query', { database: 'testdb', query: 'SELECT 1' });

      expect(handleSqlQuery).toHaveBeenCalledWith(ctx, { database: 'testdb', query: 'SELECT 1' });
      expect(result.content[0].text).toBe('query result');
    });

    it('should throw ValidationError when missing required args', async () => {
      await expect(dispatch('sql_query', {})).rejects.toThrow(ValidationError);
      await expect(dispatch('sql_query', { database: 'db' })).rejects.toThrow(ValidationError);
    });
  });

  describe('sql_batch_query', () => {
    it('should route to handleBatchQuery with valid args', async () => {
      const args = { database: 'testdb', queries: [{ query: 'SELECT 1' }] };
      await dispatch('sql_batch_query', args);

      expect(handleBatchQuery).toHaveBeenCalledWith(ctx, args);
    });

    it('should throw ValidationError when missing required args', async () => {
      await expect(dispatch('sql_batch_query', {})).rejects.toThrow(ValidationError);
      await expect(dispatch('sql_batch_query', { database: 'db' })).rejects.toThrow(
        ValidationError
      );
    });
  });

  describe('sql_analyze_performance', () => {
    it('should route to handleAnalyzePerformance with valid args', async () => {
      await dispatch('sql_analyze_performance', { database: 'testdb', query: 'SELECT 1' });

      expect(handleAnalyzePerformance).toHaveBeenCalledWith(ctx, {
        database: 'testdb',
        query: 'SELECT 1',
      });
    });

    it('should throw ValidationError when missing required args', async () => {
      await expect(dispatch('sql_analyze_performance', {})).rejects.toThrow(ValidationError);
      await expect(dispatch('sql_analyze_performance', { database: 'db' })).rejects.toThrow(
        ValidationError
      );
      await expect(dispatch('sql_analyze_performance', { query: 'q' })).rejects.toThrow(
        ValidationError
      );
    });
  });

  describe('sql_list_databases', () => {
    it('should route to handleListDatabases', async () => {
      await dispatch('sql_list_databases', {});

      expect(handleListDatabases).toHaveBeenCalledWith(ctx);
    });
  });

  describe('sql_get_schema', () => {
    it('should route to handleGetSchema with valid args', async () => {
      await dispatch('sql_get_schema', { database: 'testdb' });

      expect(handleGetSchema).toHaveBeenCalledWith(ctx, { database: 'testdb' });
    });

    it('should throw ValidationError when missing database', async () => {
      await expect(dispatch('sql_get_schema', {})).rejects.toThrow(ValidationError);
    });
  });

  describe('sql_test_connection', () => {
    it('should route to handleTestConnection with valid args', async () => {
      await dispatch('sql_test_connection', { database: 'testdb' });

      expect(handleTestConnection).toHaveBeenCalledWith(ctx, { database: 'testdb' });
    });

    it('should throw ValidationError when missing database', async () => {
      await expect(dispatch('sql_test_connection', {})).rejects.toThrow(ValidationError);
    });
  });

  describe('sql_refresh_schema', () => {
    it('should route to handleRefreshSchema with valid args', async () => {
      await dispatch('sql_refresh_schema', { database: 'testdb' });

      expect(handleRefreshSchema).toHaveBeenCalledWith(ctx, { database: 'testdb' });
    });

    it('should throw ValidationError when missing database', async () => {
      await expect(dispatch('sql_refresh_schema', {})).rejects.toThrow(ValidationError);
    });
  });

  describe('sql_add_database', () => {
    it('should route to handleAddDatabase with valid args', async () => {
      await dispatch('sql_add_database', { name: 'newdb', type: 'mysql' });

      expect(handleAddDatabase).toHaveBeenCalledWith(ctx, { name: 'newdb', type: 'mysql' });
    });

    it('should throw ValidationError when missing required args', async () => {
      await expect(dispatch('sql_add_database', {})).rejects.toThrow(ValidationError);
      await expect(dispatch('sql_add_database', { name: 'db' })).rejects.toThrow(ValidationError);
      await expect(dispatch('sql_add_database', { type: 'mysql' })).rejects.toThrow(
        ValidationError
      );
    });
  });

  describe('sql_update_database', () => {
    it('should route to handleUpdateDatabase with valid args', async () => {
      await dispatch('sql_update_database', { database: 'mydb', host: 'new-host' });

      expect(handleUpdateDatabase).toHaveBeenCalledWith(ctx, {
        database: 'mydb',
        host: 'new-host',
      });
    });

    it('should throw ValidationError when missing database', async () => {
      await expect(dispatch('sql_update_database', {})).rejects.toThrow(ValidationError);
    });
  });

  describe('sql_remove_database', () => {
    it('should route to handleRemoveDatabase with database string', async () => {
      await dispatch('sql_remove_database', { database: 'mydb' });

      expect(handleRemoveDatabase).toHaveBeenCalledWith(ctx, 'mydb');
    });

    it('should throw ValidationError when missing database', async () => {
      await expect(dispatch('sql_remove_database', {})).rejects.toThrow(ValidationError);
    });
  });

  describe('sql_get_config', () => {
    it('should route to handleGetConfig with database string', async () => {
      await dispatch('sql_get_config', { database: 'mydb' });

      expect(handleGetConfig).toHaveBeenCalledWith(ctx, 'mydb');
    });

    it('should throw ValidationError when missing database', async () => {
      await expect(dispatch('sql_get_config', {})).rejects.toThrow(ValidationError);
    });
  });

  describe('sql_set_mcp_configurable', () => {
    it('should route to handleSetMcpConfigurable with args', async () => {
      await dispatch('sql_set_mcp_configurable', { database: 'mydb', enabled: false });

      expect(handleSetMcpConfigurable).toHaveBeenCalledWith(ctx, 'mydb', false);
    });

    it('should throw ValidationError when missing required args', async () => {
      await expect(dispatch('sql_set_mcp_configurable', {})).rejects.toThrow(ValidationError);
      await expect(dispatch('sql_set_mcp_configurable', { database: 'db' })).rejects.toThrow(
        ValidationError
      );
    });
  });

  describe('sql_get_metrics', () => {
    it('should route to handleGetMetrics', async () => {
      const args = { database: 'mydb' };
      await dispatch('sql_get_metrics', args);

      expect(handleGetMetrics).toHaveBeenCalledWith(args, ctx);
    });
  });

  describe('unknown tool', () => {
    it('should throw ValidationError for unknown tool names', async () => {
      await expect(dispatch('sql_unknown_tool', {})).rejects.toThrow(ValidationError);
      await expect(dispatch('sql_unknown_tool', {})).rejects.toThrow('Unknown tool');
    });
  });
});

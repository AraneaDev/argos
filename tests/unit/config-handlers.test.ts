import {
  handleUpdateDatabase,
  handleAddDatabase,
} from '../../src/tools/handlers/config-handlers.js';
import { writeAuditLog } from '../../src/utils/audit-logger.js';
import type { ToolHandlerContext } from '../../src/tools/handlers/types.js';
import type { ParsedServerConfig } from '../../src/types/index.js';

jest.mock('../../src/utils/audit-logger.js', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
  hashQuery: jest.fn(() => 'abc123'),
}));

jest.mock('../../src/utils/config.js', () => {
  const actual = jest.requireActual('../../src/utils/config.js');
  return {
    ...actual,
    saveConfigFile: jest.fn(),
  };
});

function createMockContext(configOverrides: Partial<ParsedServerConfig>): ToolHandlerContext {
  const config: ParsedServerConfig = {
    databases: {},
    ...configOverrides,
  };

  return {
    config,
    configPath: '/tmp/test-config.ini',
    connectionManager: {
      registerDatabase: jest.fn(),
      unregisterDatabase: jest.fn(),
    } as never,
    securityManager: {} as never,
    schemaManager: {} as never,
    sshTunnelManager: {} as never,
    metricsManager: {} as never,
    schemaWatch: { check: jest.fn().mockResolvedValue([]) } as never,
    paneStore: null,
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as never,
  };
}

describe('database name validation', () => {
  test('should reject database names with INI injection characters', async () => {
    const ctx = createMockContext({});
    await expect(
      handleAddDatabase(ctx, {
        name: 'evil]\n[security',
        type: 'mysql',
        host: 'localhost',
        username: 'root',
        password: 'pass',
      })
    ).rejects.toThrow(/invalid.*characters/i);
  });

  test('should reject database names with shell metacharacters', async () => {
    const ctx = createMockContext({});
    await expect(
      handleAddDatabase(ctx, {
        name: 'db;rm -rf',
        type: 'mysql',
        host: 'localhost',
        username: 'root',
        password: 'pass',
      })
    ).rejects.toThrow(/invalid.*characters/i);
  });
});

describe('validateDatabaseConfig integration', () => {
  test('should reject databases with embedded credentials in host', async () => {
    const ctx = createMockContext({});
    await expect(
      handleAddDatabase(ctx, {
        name: 'testdb',
        type: 'mysql',
        host: 'user:pass@localhost',
        username: 'root',
        password: 'pass',
      })
    ).rejects.toThrow(/embedded credentials/i);
  });
});

describe('SQLite path validation', () => {
  test('should reject path traversal in SQLite file', async () => {
    const ctx = createMockContext({});
    await expect(
      handleAddDatabase(ctx, {
        name: 'testdb',
        type: 'sqlite',
        file: '../../../etc/passwd',
      })
    ).rejects.toThrow(/path traversal/i);
  });

  test('should reject /dev/ paths', async () => {
    const ctx = createMockContext({});
    await expect(
      handleAddDatabase(ctx, {
        name: 'testdb',
        type: 'sqlite',
        file: '/dev/zero',
      })
    ).rejects.toThrow(/not allowed/i);
  });
});

describe('audit logging for config changes', () => {
  test('should audit log when adding a database', async () => {
    (writeAuditLog as jest.Mock).mockClear();
    const ctx = createMockContext({});
    await handleAddDatabase(ctx, {
      name: 'newdb',
      type: 'sqlite',
      file: '/tmp/test.db',
    });
    expect(writeAuditLog).toHaveBeenCalledWith(
      'newdb',
      expect.stringContaining('CONFIG_ADD'),
      expect.any(Number),
      'success'
    );
  });
});

describe('handleUpdateDatabase', () => {
  test('should reject select_only changes via MCP', async () => {
    const ctx = createMockContext({
      databases: {
        testdb: { type: 'mysql', select_only: true, mcp_configurable: true } as never,
      },
    });

    await expect(
      handleUpdateDatabase(ctx, { database: 'testdb', select_only: false })
    ).rejects.toThrow(/select_only.*cannot be changed via MCP/i);

    // Verify it wasn't changed
    expect(ctx.config.databases.testdb.select_only).toBe(true);
  });
});

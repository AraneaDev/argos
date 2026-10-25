import { SQLMCPServer, resolveConfigPathFromArgv } from '../../src/classes/SQLMCPServer.js';
import { TestConfigFixtures } from '../fixtures/test-configs.js';
import { SampleQueries } from '../fixtures/sample-queries.js';
import type { MCPRequest } from '../../src/types/mcp.js';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';

describe('SQLMCPServer Integration Tests', () => {
  let server: SQLMCPServer;
  let tempConfigPath: string;

  beforeEach(async () => {
    // Create temporary config file
    tempConfigPath = path.join(tmpdir(), `test-config-${Date.now()}.ini`);
    const configContent = TestConfigFixtures.generateConfigFileString(
      TestConfigFixtures.completeSetupConfig
    );
    fs.writeFileSync(tempConfigPath, configContent);

    server = new SQLMCPServer();
  });

  afterEach(async () => {
    try {
      await server.cleanup();
    } catch (error) {
      // Ignore cleanup errors
    }

    // Clean up temp config file
    try {
      fs.unlinkSync(tempConfigPath);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Server Initialization', () => {
    test('should initialize server with configuration', async () => {
      await expect(server.initialize(tempConfigPath)).resolves.not.toThrow();
    });

    test('should fail initialization with invalid config', async () => {
      const invalidConfigPath = path.join(tmpdir(), 'invalid-config.ini');
      // Write config with invalid database type that will cause parseDatabaseConfig to fail
      fs.writeFileSync(
        invalidConfigPath,
        '[database.test]\ntype = mysql\n# missing required host field'
      );

      await expect(server.initialize(invalidConfigPath)).rejects.toThrow(
        "missing required 'host' field"
      );

      // Cleanup
      fs.unlinkSync(invalidConfigPath);
    });
  });

  describe('MCP Protocol Handling', () => {
    beforeEach(async () => {
      await server.initialize(tempConfigPath);

      // Mock the managers after initialization
      const mockConnectionManager = {
        initialize: jest.fn(),
        registerDatabase: jest.fn(),
        getConnection: jest.fn().mockResolvedValue({ id: 'mock-connection' }),
        closeAllConnections: jest.fn().mockResolvedValue(undefined),
        executeQuery: jest.fn().mockResolvedValue({
          rows: [{ id: 1, name: 'test' }],
          rowCount: 1,
          fields: ['id', 'name'],
          truncated: false,
          execution_time_ms: 10,
        }),
      };
      (server as any).connectionManager = mockConnectionManager;

      // Mock schema manager
      const mockSchemaManager = {
        initialize: jest.fn().mockResolvedValue(undefined),
        hasSchema: jest.fn().mockReturnValue(true),
        captureSchema: jest.fn().mockResolvedValue({}),
        getSchema: jest.fn().mockReturnValue({ summary: { table_count: 5, total_columns: 25 } }),
      };
      (server as any).schemaManager = mockSchemaManager;

      // Mock SSH tunnel manager
      const mockSSHTunnelManager = {
        initialize: jest.fn(),
        hasTunnel: jest.fn().mockReturnValue(false),
        createTunnel: jest.fn().mockResolvedValue({}),
        closeTunnel: jest.fn().mockResolvedValue(undefined),
        closeAllTunnels: jest.fn().mockResolvedValue(undefined),
      };
      (server as any).sshTunnelManager = mockSSHTunnelManager;
    });

    test('should handle list_tools request', async () => {
      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      };

      const response = await server.handleRequest(request);

      // Assert response is not null/undefined
      expect(response).toBeDefined();
      if (!response) {
        fail('Expected response but got null/undefined');
      }

      expect(response.id).toBe(1);
      expect(response.result).toBeDefined();
      expect((response.result as any).tools).toBeDefined();
      expect(Array.isArray((response.result as any).tools)).toBe(true);
      expect((response.result as any).tools.length).toBeGreaterThan(0);

      // Check for expected tools
      const toolNames = (response.result as any).tools.map((tool: any) => tool.name);
      expect(toolNames).toContain('sql_query');
      expect(toolNames).toContain('sql_list_databases');
      expect(toolNames).toContain('sql_get_schema');
    });

    test('should handle tools/call request for execute_query', async () => {
      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'sql_query',
          arguments: {
            database: 'primary',
            query: SampleQueries.basicQueries.simple,
          },
        },
      };

      const response = await server.handleRequest(request);

      expect(response).toBeDefined();
      if (!response) {
        fail('Expected response but got null/undefined');
      }

      expect(response.id).toBe(2);
      expect(response.result).toBeDefined();
      expect((response.result as any).content).toBeDefined();
      expect(Array.isArray((response.result as any).content)).toBe(true);
      expect((response.result as any).content[0].type).toBe('text');
    });

    test('should return error for invalid tool name', async () => {
      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'nonexistent_tool',
          arguments: {},
        },
      };

      const response = await server.handleRequest(request);

      expect(response).toBeDefined();
      if (!response) {
        fail('Expected response but got null/undefined');
      }

      expect(response.id).toBe(6);
      expect((response as any).result).toBeDefined();
      expect((response as any).result.isError).toBe(true);
      expect((response as any).result.content[0].text).toContain('Unknown tool');
    });
  });

  describe('Query Execution', () => {
    beforeEach(async () => {
      // Initialize server first
      await server.initialize(tempConfigPath);

      // Then mock the connection manager that was created
      const mockConnectionManager = {
        initialize: jest.fn(),
        registerDatabase: jest.fn(),
        getConnection: jest.fn().mockResolvedValue({ id: 'mock-connection' }),
        closeAllConnections: jest.fn().mockResolvedValue(undefined),
        getAdapter: jest.fn(),
        executeQuery: jest.fn().mockResolvedValue({
          rows: [
            { id: 1, name: 'John', email: 'john@example.com' },
            { id: 2, name: 'Jane', email: 'jane@example.com' },
          ],
          rowCount: 2,
          fields: ['id', 'name', 'email'],
          truncated: false,
          execution_time_ms: 10,
        }),
      };
      (server as any).connectionManager = mockConnectionManager;

      // Mock schema manager methods directly on the server
      const mockSchemaManager = {
        initialize: jest.fn().mockResolvedValue(undefined),
        hasSchema: jest.fn().mockReturnValue(true),
        captureSchema: jest.fn().mockResolvedValue({}),
        getSchema: jest.fn().mockReturnValue({ summary: { table_count: 5, total_columns: 25 } }),
      };
      (server as any).schemaManager = mockSchemaManager;

      // Mock SSH tunnel manager methods
      const mockSSHTunnelManager = {
        initialize: jest.fn(),
        hasTunnel: jest.fn().mockReturnValue(false),
        createTunnel: jest.fn().mockResolvedValue({}),
        closeTunnel: jest.fn().mockResolvedValue(undefined),
        closeAllTunnels: jest.fn().mockResolvedValue(undefined),
      };
      (server as any).sshTunnelManager = mockSSHTunnelManager;
    });

    test('should execute safe queries successfully', async () => {
      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'sql_query',
          arguments: {
            database: 'primary',
            query: 'SELECT * FROM users',
          },
        },
      };

      const response = await server.handleRequest(request);

      expect(response).toBeDefined();
      if (!response) {
        fail('Expected response but got null/undefined');
      }

      expect(response.result as any).toBeDefined();
      expect((response.result as any).content[0].text).toContain('John');
      expect((response.result as any).content[0].text).toContain('jane@example.com');
    });

    test('should block unsafe queries in SELECT-only mode', async () => {
      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'sql_query',
          arguments: {
            database: 'primary',
            query: SampleQueries.modificationQueries.insert,
          },
        },
      };

      const response = await server.handleRequest(request);

      expect(response).toBeDefined();
      if (!response) {
        fail('Expected response but got null/undefined');
      }

      expect(response.result as any).toBeDefined();
      expect((response.result as any).isError).toBe(true);
      expect((response.result as any).content[0].text).toContain('blocked');
      expect((response.result as any).content[0].text).toContain('INSERT');
    });
  });

  describe('Error Handling and Recovery', () => {
    test('should handle server initialization failures gracefully', async () => {
      const invalidConfig = path.join(tmpdir(), 'broken-config.ini');
      // Write content that will cause parseConfig to fail due to missing required fields
      fs.writeFileSync(
        invalidConfig,
        '[database.test]\ntype = mysql\n# missing required fields like host, username'
      );

      await expect(server.initialize(invalidConfig)).rejects.toThrow();

      // Cleanup
      fs.unlinkSync(invalidConfig);
    });

    test('should handle connection failures gracefully', async () => {
      await server.initialize(tempConfigPath);

      // Mock the connection manager to simulate failure
      const mockConnectionManager = {
        initialize: jest.fn(),
        registerDatabase: jest.fn(),
        getConnection: jest.fn().mockRejectedValue(new Error('Connection failed')),
        closeAllConnections: jest.fn().mockResolvedValue(undefined),
        executeQuery: jest
          .fn()
          .mockRejectedValue(new Error("No active connection found for database 'primary'")),
      };
      (server as any).connectionManager = mockConnectionManager;

      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'sql_query',
          arguments: {
            database: 'primary',
            query: 'SELECT 1',
          },
        },
      };

      const response = await server.handleRequest(request);

      expect(response).toBeDefined();
      if (!response) {
        fail('Expected response but got null/undefined');
      }

      expect(response.result as any).toBeDefined();
      expect((response.result as any).isError).toBe(true);
      expect((response.result as any).content[0].text).toContain('No active connection found');
    });
  });

  describe('Config Loading Edge Cases', () => {
    test('should fail when config file does not exist', async () => {
      const nonExistentPath = path.join(tmpdir(), 'nonexistent-config-' + Date.now() + '.ini');

      await expect(server.initialize(nonExistentPath)).rejects.toThrow('No config.ini found');
    });

    test('should parse config with security section', async () => {
      const configWithSecurity = path.join(tmpdir(), `security-config-${Date.now()}.ini`);
      const content = `[database.testdb]
type=sqlite
file=./test.db

[security]
max_joins=5
max_subqueries=3
max_complexity_score=50

[extension]
max_rows=500
query_timeout=15000
max_batch_size=5
`;
      fs.writeFileSync(configWithSecurity, content);

      await expect(server.initialize(configWithSecurity)).resolves.not.toThrow();

      fs.unlinkSync(configWithSecurity);
    });

    test('should parse SQLite database config', async () => {
      const sqliteConfig = path.join(tmpdir(), `sqlite-config-${Date.now()}.ini`);
      const content = `[database.local]
type=sqlite
file=./test.db
select_only=true
`;
      fs.writeFileSync(sqliteConfig, content);

      await expect(server.initialize(sqliteConfig)).resolves.not.toThrow();

      fs.unlinkSync(sqliteConfig);
    });

    test('should fail for SQLite config missing file field', async () => {
      const badSqliteConfig = path.join(tmpdir(), `bad-sqlite-${Date.now()}.ini`);
      const content = `[database.local]
type=sqlite
`;
      fs.writeFileSync(badSqliteConfig, content);

      await expect(server.initialize(badSqliteConfig)).rejects.toThrow(
        "missing required 'file' field"
      );

      fs.unlinkSync(badSqliteConfig);
    });

    test('should fail for MySQL config missing username', async () => {
      const badMysqlConfig = path.join(tmpdir(), `bad-mysql-${Date.now()}.ini`);
      const content = `[database.testdb]
type=mysql
host=localhost
`;
      fs.writeFileSync(badMysqlConfig, content);

      await expect(server.initialize(badMysqlConfig)).rejects.toThrow(
        "missing required 'username' field"
      );

      fs.unlinkSync(badMysqlConfig);
    });

    test('should parse SSH tunnel configuration', async () => {
      const sshConfig = path.join(tmpdir(), `ssh-config-${Date.now()}.ini`);
      const content = `[database.remote]
type=mysql
host=internal-db.example.com
port=3306
database=mydb
username=dbuser
password=dbpass
ssh_host=bastion.example.com
ssh_port=22
ssh_username=tunneluser
ssh_private_key=/home/user/.ssh/id_rsa
`;
      fs.writeFileSync(sshConfig, content);

      await expect(server.initialize(sshConfig)).resolves.not.toThrow();

      fs.unlinkSync(sshConfig);
    });
  });

  describe('handleRequest Edge Cases', () => {
    beforeEach(async () => {
      await server.initialize(tempConfigPath);

      const mockConnectionManager = {
        initialize: jest.fn(),
        registerDatabase: jest.fn(),
        getConnection: jest.fn().mockResolvedValue({ id: 'mock-connection' }),
        closeAllConnections: jest.fn().mockResolvedValue(undefined),
        executeQuery: jest.fn().mockResolvedValue({
          rows: [{ id: 1 }],
          rowCount: 1,
          fields: ['id'],
          truncated: false,
          execution_time_ms: 5,
        }),
      };
      (server as any).connectionManager = mockConnectionManager;

      const mockSchemaManager = {
        initialize: jest.fn().mockResolvedValue(undefined),
        hasSchema: jest.fn().mockReturnValue(true),
        captureSchema: jest.fn().mockResolvedValue({}),
        getSchema: jest.fn().mockReturnValue({ summary: { table_count: 5, total_columns: 25 } }),
      };
      (server as any).schemaManager = mockSchemaManager;

      const mockSSHTunnelManager = {
        initialize: jest.fn(),
        hasTunnel: jest.fn().mockReturnValue(false),
        createTunnel: jest.fn().mockResolvedValue({}),
        closeTunnel: jest.fn().mockResolvedValue(undefined),
        closeAllTunnels: jest.fn().mockResolvedValue(undefined),
      };
      (server as any).sshTunnelManager = mockSSHTunnelManager;
    });

    test('should return null for unknown methods', async () => {
      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 10,
        method: 'unknown/method',
        params: {},
      };

      const response = await server.handleRequest(request);
      expect(response).toBeNull();
    });

    test('should handle missing id in request', async () => {
      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: undefined as any,
        method: 'tools/list',
        params: {},
      };

      const response = await server.handleRequest(request);
      expect(response).toBeDefined();
      expect(response?.id).toBe(0); // falls back to 0
    });

    test('should handle tools/call when dispatcher is not initialized', async () => {
      // Reset dispatcher to null
      (server as any).dispatchToolCall = null;

      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'sql_query',
          arguments: { database: 'primary', query: 'SELECT 1' },
        },
      };

      const response = await server.handleRequest(request);
      expect(response).toBeDefined();
      expect(response?.error).toBeDefined();
      expect(response?.error?.message).toContain('Server not initialized');
    });

    test('should handle tools/call with missing arguments', async () => {
      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'sql_query',
          arguments: {},
        },
      };

      const response = await server.handleRequest(request);
      expect(response).toBeDefined();
      // Should return a result (may be error) but not crash
      expect(response?.id).toBe(12);
    });

    test('should handle list_tools returning all expected tools', async () => {
      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/list',
        params: {},
      };

      const response = await server.handleRequest(request);
      expect(response).toBeDefined();
      const tools = (response?.result as any).tools;
      expect(tools.length).toBeGreaterThan(0);

      const toolNames = tools.map((t: any) => t.name);
      expect(toolNames).toContain('sql_query');
      expect(toolNames).toContain('sql_batch_query');
      expect(toolNames).toContain('sql_list_databases');
      expect(toolNames).toContain('sql_get_schema');
      expect(toolNames).toContain('sql_test_connection');
    });
  });

  describe('testConnection', () => {
    beforeEach(async () => {
      await server.initialize(tempConfigPath);
    });

    test('should return failure for unknown database', async () => {
      const result = await server.testConnection('nonexistent_db');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
      expect(result.database).toBe('nonexistent_db');
      expect(result.ssh_tunnel).toBe(false);
    });

    test('should return success for configured database with schema', async () => {
      const mockConnectionManager = {
        initialize: jest.fn(),
        registerDatabase: jest.fn(),
        getConnection: jest.fn().mockResolvedValue({ id: 'mock' }),
        closeAllConnections: jest.fn().mockResolvedValue(undefined),
      };
      (server as any).connectionManager = mockConnectionManager;

      const mockSchemaManager = {
        initialize: jest.fn().mockResolvedValue(undefined),
        hasSchema: jest.fn().mockReturnValue(true),
        captureSchema: jest.fn().mockResolvedValue({}),
        getSchema: jest.fn().mockReturnValue({
          summary: { table_count: 10, view_count: 2, total_columns: 50 },
        }),
      };
      (server as any).schemaManager = mockSchemaManager;

      const mockSSHTunnelManager = {
        initialize: jest.fn(),
        hasTunnel: jest.fn().mockReturnValue(false),
        closeAllTunnels: jest.fn().mockResolvedValue(undefined),
      };
      (server as any).sshTunnelManager = mockSSHTunnelManager;

      const result = await server.testConnection('primary');

      expect(result.success).toBe(true);
      expect(result.database).toBe('primary');
      expect(result.schema_captured).toBe(true);
      expect(result.schema_info?.table_count).toBe(10);
    });

    test('should capture schema when not already cached', async () => {
      const mockConnectionManager = {
        initialize: jest.fn(),
        registerDatabase: jest.fn(),
        getConnection: jest.fn().mockResolvedValue({ id: 'mock' }),
        closeAllConnections: jest.fn().mockResolvedValue(undefined),
      };
      (server as any).connectionManager = mockConnectionManager;

      const mockSchemaManager = {
        initialize: jest.fn().mockResolvedValue(undefined),
        hasSchema: jest.fn().mockReturnValue(false),
        captureSchema: jest.fn().mockResolvedValue({}),
        getSchema: jest.fn().mockReturnValue({
          summary: { table_count: 5, view_count: 0, total_columns: 20 },
        }),
      };
      (server as any).schemaManager = mockSchemaManager;

      const mockSSHTunnelManager = {
        initialize: jest.fn(),
        hasTunnel: jest.fn().mockReturnValue(false),
        closeAllTunnels: jest.fn().mockResolvedValue(undefined),
      };
      (server as any).sshTunnelManager = mockSSHTunnelManager;

      const result = await server.testConnection('primary');

      expect(result.success).toBe(true);
      expect(mockSchemaManager.captureSchema).toHaveBeenCalled();
    });

    test('should handle schema capture failure gracefully', async () => {
      const mockConnectionManager = {
        initialize: jest.fn(),
        registerDatabase: jest.fn(),
        getConnection: jest.fn().mockRejectedValue(new Error('Connection failed')),
        closeAllConnections: jest.fn().mockResolvedValue(undefined),
      };
      (server as any).connectionManager = mockConnectionManager;

      const mockSchemaManager = {
        initialize: jest.fn().mockResolvedValue(undefined),
        hasSchema: jest.fn().mockReturnValue(false),
        captureSchema: jest.fn().mockRejectedValue(new Error('Schema error')),
        getSchema: jest.fn().mockReturnValue(null),
      };
      (server as any).schemaManager = mockSchemaManager;

      const mockSSHTunnelManager = {
        initialize: jest.fn(),
        hasTunnel: jest.fn().mockReturnValue(false),
        closeAllTunnels: jest.fn().mockResolvedValue(undefined),
      };
      (server as any).sshTunnelManager = mockSSHTunnelManager;

      // Should not throw, should return success with schema_captured false
      const result = await server.testConnection('primary');
      expect(result.success).toBe(true);
      expect(result.schema_captured).toBe(false);
    });

    test('should detect SSH tunnel for database with ssh_host', async () => {
      // Create config with SSH
      const sshConfigPath = path.join(tmpdir(), `ssh-test-${Date.now()}.ini`);
      const content = `[database.remote]
type=mysql
host=internal-db
port=3306
database=mydb
username=user
password=pass
ssh_host=bastion.example.com
ssh_port=22
ssh_username=tunneluser
ssh_private_key=/tmp/fake_key
`;
      fs.writeFileSync(sshConfigPath, content);

      const sshServer = new SQLMCPServer();
      await sshServer.initialize(sshConfigPath);

      const mockConnectionManager = {
        initialize: jest.fn(),
        registerDatabase: jest.fn(),
        getConnection: jest.fn().mockResolvedValue({ id: 'mock' }),
        closeAllConnections: jest.fn().mockResolvedValue(undefined),
      };
      (sshServer as any).connectionManager = mockConnectionManager;

      const mockSchemaManager = {
        initialize: jest.fn(),
        hasSchema: jest.fn().mockReturnValue(true),
        getSchema: jest.fn().mockReturnValue({
          summary: { table_count: 3, view_count: 0, total_columns: 10 },
        }),
      };
      (sshServer as any).schemaManager = mockSchemaManager;

      const mockSSHTunnelManager = {
        initialize: jest.fn(),
        hasTunnel: jest.fn().mockReturnValue(true),
        closeAllTunnels: jest.fn().mockResolvedValue(undefined),
      };
      (sshServer as any).sshTunnelManager = mockSSHTunnelManager;

      const result = await sshServer.testConnection('remote');
      expect(result.success).toBe(true);
      expect(result.ssh_tunnel).toBe(true);

      await sshServer.cleanup();
      fs.unlinkSync(sshConfigPath);
    });
  });

  describe('Cleanup', () => {
    test('should cleanup without errors', async () => {
      await server.initialize(tempConfigPath);

      const mockConnectionManager = {
        closeAllConnections: jest.fn().mockResolvedValue(undefined),
        initialize: jest.fn(),
        registerDatabase: jest.fn(),
      };
      (server as any).connectionManager = mockConnectionManager;

      const mockSSHTunnelManager = {
        initialize: jest.fn(),
        closeAllTunnels: jest.fn().mockResolvedValue(undefined),
      };
      (server as any).sshTunnelManager = mockSSHTunnelManager;

      await expect(server.cleanup()).resolves.not.toThrow();
      expect(mockConnectionManager.closeAllConnections).toHaveBeenCalled();
      expect(mockSSHTunnelManager.closeAllTunnels).toHaveBeenCalled();
    });

    test('should propagate cleanup errors', async () => {
      await server.initialize(tempConfigPath);

      const mockConnectionManager = {
        closeAllConnections: jest.fn().mockRejectedValue(new Error('Cleanup failed')),
        initialize: jest.fn(),
        registerDatabase: jest.fn(),
      };
      (server as any).connectionManager = mockConnectionManager;

      const mockSSHTunnelManager = {
        initialize: jest.fn(),
        closeAllTunnels: jest.fn().mockResolvedValue(undefined),
      };
      (server as any).sshTunnelManager = mockSSHTunnelManager;

      await expect(server.cleanup()).rejects.toThrow('Cleanup failed');
    });
  });

  // The documented registration command passes --config, and an MCP client
  // starts the server from whatever working directory it happens to be in. If
  // the flag is ignored, the search falls back to ./config.ini and the server
  // reports no configuration while the operator is looking at the file they
  // pointed it at.
  describe('resolveConfigPathFromArgv', () => {
    const argv = (...args: string[]): string[] => ['node', '/path/dist/index.js', ...args];

    it('reads the path from a separate argument', () => {
      expect(resolveConfigPathFromArgv(argv('--config', '/etc/argos/config.ini'))).toBe(
        '/etc/argos/config.ini'
      );
    });

    it('reads the path from an = form', () => {
      expect(resolveConfigPathFromArgv(argv('--config=/etc/argos/config.ini'))).toBe(
        '/etc/argos/config.ini'
      );
    });

    it('ignores arguments it does not own', () => {
      expect(resolveConfigPathFromArgv(argv('--verbose', '--config', '/a/b.ini', '--other'))).toBe(
        '/a/b.ini'
      );
    });

    it('returns nothing when the flag is absent, leaving the existing search alone', () => {
      expect(resolveConfigPathFromArgv(argv())).toBeUndefined();
      expect(resolveConfigPathFromArgv(argv('--verbose'))).toBeUndefined();
    });

    it('returns nothing when the flag has no value', () => {
      expect(resolveConfigPathFromArgv(argv('--config'))).toBeUndefined();
    });
  });
});

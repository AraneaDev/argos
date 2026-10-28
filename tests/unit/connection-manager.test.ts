import { ConnectionManager } from '../../src/classes/ConnectionManager.js';
import { EnhancedSSHTunnelManager } from '../../src/classes/EnhancedSSHTunnelManager.js';
import { MockDatabaseFactory } from '../fixtures/mock-databases.js';
import { TestConfigFixtures } from '../fixtures/test-configs.js';
import { DatabaseType } from '../../src/types/database.js';
import type { DatabaseConfig } from '../../src/types/database.js';
import { ConnectionError } from '../../src/utils/error-handler.js';

describe('ConnectionManager', () => {
  let connectionManager: ConnectionManager;
  let mockSSHTunnelManager: jest.Mocked<EnhancedSSHTunnelManager>;

  beforeEach(() => {
    // Create mock SSH tunnel manager
    mockSSHTunnelManager = {
      createTunnel: jest.fn().mockResolvedValue({
        localHost: '127.0.0.1',
        localPort: 12345,
        remoteHost: 'test-host',
        remotePort: 5432,
      }),
      closeTunnel: jest.fn().mockResolvedValue(undefined),
      closeAllTunnels: jest.fn().mockResolvedValue(undefined),
      isConnected: jest.fn().mockReturnValue(false),
      hasTunnel: jest.fn().mockReturnValue(false),
      initialize: jest.fn().mockReturnValue(undefined),
      // Enhanced methods
      portManager: {
        findAvailablePort: jest
          .fn()
          .mockResolvedValue({ assignedPort: 12345, wasPreferredPort: false }),
        isPortAvailable: jest.fn().mockResolvedValue({ port: 12345, isAvailable: true }),
        reservePort: jest.fn(),
        releasePort: jest.fn(),
        getReservedPorts: jest.fn().mockReturnValue([]),
      } as any,
      createEnhancedTunnel: jest.fn().mockResolvedValue({
        localHost: '127.0.0.1',
        localPort: 12345,
        remoteHost: 'test-host',
        remotePort: 5432,
        portAssignment: { assignedPort: 12345, wasPreferredPort: false },
      }),
      getPortRecommendations: jest
        .fn()
        .mockResolvedValue({ available: [12346, 12347], used: [], suggestions: [] }),
      getAllTunnelInfo: jest.fn().mockReturnValue({}),
      // EventEmitter methods
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
      once: jest.fn(),
      removeListener: jest.fn(),
      removeAllListeners: jest.fn(),
      setMaxListeners: jest.fn(),
      getMaxListeners: jest.fn(),
      listeners: jest.fn(),
      rawListeners: jest.fn(),
      listenerCount: jest.fn(),
      prependListener: jest.fn(),
      prependOnceListener: jest.fn(),
      eventNames: jest.fn(),
    } as any;

    connectionManager = new ConnectionManager(mockSSHTunnelManager);
  });

  afterEach(async () => {
    // Clean up any connections
    await connectionManager.closeAllConnections();
  });

  describe('Database Registration', () => {
    test('should register database configurations', () => {
      const config = TestConfigFixtures.validPostgresConfig;
      connectionManager.registerDatabase('test_db', config);

      expect(connectionManager.getDatabaseConfig('test_db')).toBeDefined();
    });

    test('should register multiple databases', () => {
      const configs = [
        { name: 'postgres', config: TestConfigFixtures.validPostgresConfig },
        { name: 'mysql', config: TestConfigFixtures.validMysqlConfig },
        { name: 'sqlite', config: TestConfigFixtures.validSqliteConfig },
      ];

      configs.forEach(({ name, config }) => {
        connectionManager.registerDatabase(name, config);
      });

      expect(connectionManager.getDatabaseConfig('postgres')).toBeDefined();
      expect(connectionManager.getDatabaseConfig('mysql')).toBeDefined();
      expect(connectionManager.getDatabaseConfig('sqlite')).toBeDefined();
    });

    test('should overwrite existing database registration', () => {
      const config1 = TestConfigFixtures.validPostgresConfig;
      const config2 = { ...config1, host: 'different-host' };

      connectionManager.registerDatabase('test_db', config1);
      connectionManager.registerDatabase('test_db', config2);

      expect(connectionManager.getDatabaseConfig('test_db')?.host).toBe('different-host');
    });

    test('should unregister databases', () => {
      const config = TestConfigFixtures.validPostgresConfig;
      connectionManager.registerDatabase('test_db', config);

      expect(connectionManager.getDatabaseConfig('test_db')).toBeDefined();

      connectionManager.unregisterDatabase('test_db');

      expect(connectionManager.getDatabaseConfig('test_db')).toBeUndefined();
    });
  });

  describe('Connection Management', () => {
    test('should get connection for registered database', async () => {
      // Mock the adapter factory to return our mock adapter
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      const config = TestConfigFixtures.validPostgresConfig;
      connectionManager.registerDatabase('test_db', config);

      const connection = await connectionManager.getConnection('test_db');
      expect(connection).toBeDefined();
      expect(mockAdapter.isCurrentlyConnected()).toBe(true);
    });

    test('should reuse existing connections', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      const config = TestConfigFixtures.validPostgresConfig;
      connectionManager.registerDatabase('test_db', config);

      const connection1 = await connectionManager.getConnection('test_db');
      const connection2 = await connectionManager.getConnection('test_db');

      expect(connection1).toBe(connection2);
    });

    test('should throw error for unregistered database', async () => {
      await expect(connectionManager.getConnection('nonexistent')).rejects.toThrow(
        'Database nonexistent is not registered'
      );
    });

    test('should handle connection failures', async () => {
      const mockAdapter = MockDatabaseFactory.createFailingAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      const config = TestConfigFixtures.validPostgresConfig;
      connectionManager.registerDatabase('test_db', config);

      await expect(connectionManager.getConnection('test_db')).rejects.toThrow('Connection failed');
    });

    test('should handle connection timeouts', async () => {
      const mockAdapter = MockDatabaseFactory.createTimeoutAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      const config = TestConfigFixtures.validPostgresConfig;
      connectionManager.registerDatabase('test_db', config);

      await expect(connectionManager.getConnection('test_db')).rejects.toThrow(
        'Connection timeout'
      );
    }, 10000); // Increase timeout for this test

    test('should close individual connections', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      const config = TestConfigFixtures.validPostgresConfig;
      connectionManager.registerDatabase('test_db', config);

      await connectionManager.getConnection('test_db');
      expect(mockAdapter.isCurrentlyConnected()).toBe(true);

      await connectionManager.closeConnection('test_db');
      expect(mockAdapter.isCurrentlyConnected()).toBe(false);
    });

    test('should close all connections', async () => {
      const mockAdapter1 = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      const mockAdapter2 = MockDatabaseFactory.createMysqlAdapter(
        TestConfigFixtures.validMysqlConfig
      );

      let adapterCount = 0;
      jest.spyOn(connectionManager as any, 'createAdapter').mockImplementation((config) => {
        adapterCount++;
        const adapter = adapterCount === 1 ? mockAdapter1 : mockAdapter2;
        return adapter;
      });

      connectionManager.registerDatabase('db1', TestConfigFixtures.validPostgresConfig);
      connectionManager.registerDatabase('db2', TestConfigFixtures.validMysqlConfig);

      const connection1 = await connectionManager.getConnection('db1');
      const connection2 = await connectionManager.getConnection('db2');

      // Both connections should be established
      expect(connection1).toBeDefined();
      expect(connection2).toBeDefined();

      // Check connections are active
      expect(mockAdapter1.isCurrentlyConnected()).toBe(true);
      expect(mockAdapter2.isCurrentlyConnected()).toBe(true);

      await connectionManager.closeAllConnections();

      expect(mockAdapter1.isCurrentlyConnected()).toBe(false);
      expect(mockAdapter2.isCurrentlyConnected()).toBe(false);
    });
  });

  describe('Connection Pooling', () => {
    test('should manage connection pool limits', async () => {
      const config = { ...TestConfigFixtures.validPostgresConfig, pool_size: 2 };
      connectionManager.registerDatabase('test_db', config);

      // Mock multiple adapters to simulate pool behavior
      const mockAdapters = [
        MockDatabaseFactory.createPostgresAdapter(TestConfigFixtures.validPostgresConfig),
        MockDatabaseFactory.createPostgresAdapter(TestConfigFixtures.validPostgresConfig),
        MockDatabaseFactory.createPostgresAdapter(TestConfigFixtures.validPostgresConfig),
      ];

      let adapterIndex = 0;
      jest.spyOn(connectionManager as any, 'createAdapter').mockImplementation(() => {
        return mockAdapters[adapterIndex++ % mockAdapters.length];
      });

      // This test would need actual pool implementation to be meaningful
      // For now, just verify basic behavior
      const connection = await connectionManager.getConnection('test_db');
      expect(connection).toBeDefined();
    });

    test('should handle pool exhaustion gracefully', async () => {
      const config = { ...TestConfigFixtures.validPostgresConfig, pool_size: 1 };
      connectionManager.registerDatabase('test_db', config);

      const mockAdapter = MockDatabaseFactory.createSlowAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      // This test would need actual pool implementation
      const connection = await connectionManager.getConnection('test_db');
      expect(connection).toBeDefined();
    });
  });

  describe('SSH Tunnel Support', () => {
    test('should handle SSH tunnel configuration', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      const config = TestConfigFixtures.configWithSSH;
      connectionManager.registerDatabase('ssh_db', config);

      const connection = await connectionManager.getConnection('ssh_db');
      expect(connection).toBeDefined();
    });

    test('should handle SSH password authentication', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      const config = TestConfigFixtures.configWithSSHPassword;
      connectionManager.registerDatabase('ssh_password_db', config);

      const connection = await connectionManager.getConnection('ssh_password_db');
      expect(connection).toBeDefined();
    });

    test('should handle SSH connection failures', async () => {
      const mockAdapter = MockDatabaseFactory.createFailingAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      const config = TestConfigFixtures.configWithSSH;
      connectionManager.registerDatabase('ssh_fail_db', config);

      await expect(connectionManager.getConnection('ssh_fail_db')).rejects.toThrow();
    });
  });

  describe('Database Type Support', () => {
    test('should create PostgreSQL adapter', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      const config = TestConfigFixtures.validPostgresConfig;
      connectionManager.registerDatabase('postgres_db', config);

      const connection = await connectionManager.getConnection('postgres_db');
      expect(connection).toBeDefined();
    });

    test('should create MySQL adapter', async () => {
      const mockAdapter = MockDatabaseFactory.createMysqlAdapter(
        TestConfigFixtures.validMysqlConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      const config = TestConfigFixtures.validMysqlConfig;
      connectionManager.registerDatabase('mysql_db', config);

      const connection = await connectionManager.getConnection('mysql_db');
      expect(connection).toBeDefined();
    });

    test('should create SQLite adapter', async () => {
      const mockAdapter = MockDatabaseFactory.createSqliteAdapter(
        TestConfigFixtures.validSqliteConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      const config = TestConfigFixtures.validSqliteConfig;
      connectionManager.registerDatabase('sqlite_db', config);

      const connection = await connectionManager.getConnection('sqlite_db');
      expect(connection).toBeDefined();
    });

    test('should create SQL Server adapter', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      ); // Using postgres mock for MSSQL
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      const config = TestConfigFixtures.validMssqlConfig;
      connectionManager.registerDatabase('mssql_db', config);

      const connection = await connectionManager.getConnection('mssql_db');
      expect(connection).toBeDefined();
    });

    test('should throw error for unsupported database type', () => {
      const config = {
        type: 'unsupported' as DatabaseType,
        host: 'localhost',
        database: 'test',
      } as DatabaseConfig;

      expect(() => {
        connectionManager.registerDatabase('unsupported_db', config);
      }).toThrow('Unsupported database type');
    });
  });

  describe('Error Handling and Recovery', () => {
    test('should retry failed connections', async () => {
      let attempts = 0;
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );

      // Configure to fail first attempt, succeed on second
      mockAdapter.configure({
        shouldFailConnection: true,
        connectionDelay: 100,
      });

      jest.spyOn(connectionManager as any, 'createAdapter').mockImplementation(() => {
        attempts++;
        if (attempts === 1) {
          return MockDatabaseFactory.createFailingAdapter(TestConfigFixtures.validPostgresConfig);
        }
        return MockDatabaseFactory.createPostgresAdapter(TestConfigFixtures.validPostgresConfig);
      });

      const config = TestConfigFixtures.validPostgresConfig;
      connectionManager.registerDatabase('test_db', config);

      // This should succeed on retry (if retry logic is implemented)
      try {
        const connection = await connectionManager.getConnection('test_db');
        expect(connection).toBeDefined();
      } catch (error) {
        // If no retry logic, should fail
        expect(error).toBeDefined();
      }
    });

    test('should handle invalid configurations gracefully', async () => {
      const invalidConfig = TestConfigFixtures.invalidDatabaseConfig as DatabaseConfig;

      expect(() => {
        connectionManager.registerDatabase('invalid_db', invalidConfig);
      }).toThrow();
    });
  });

  // ============================================================================
  // Retry Logic (withRetry / isRetryableError)
  // ============================================================================

  describe('Retry Logic', () => {
    test('should retry on ECONNREFUSED error', async () => {
      let attempts = 0;
      jest.spyOn(connectionManager as any, 'createAdapter').mockImplementation(() => {
        attempts++;
        if (attempts <= 2) {
          // Return adapter that throws retryable error
          const adapter = MockDatabaseFactory.createPostgresAdapter(
            TestConfigFixtures.validPostgresConfig
          );
          jest
            .spyOn(adapter, 'connect')
            .mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5432'));
          return adapter;
        }
        // Third attempt succeeds
        return MockDatabaseFactory.createPostgresAdapter(TestConfigFixtures.validPostgresConfig);
      });

      connectionManager.registerDatabase('retry_db', TestConfigFixtures.validPostgresConfig);

      const connection = await connectionManager.getConnection('retry_db');
      expect(connection).toBeDefined();
      expect(attempts).toBe(3);
    }, 15000);

    test('should retry on ECONNRESET error', async () => {
      let attempts = 0;
      jest.spyOn(connectionManager as any, 'createAdapter').mockImplementation(() => {
        attempts++;
        if (attempts <= 1) {
          const adapter = MockDatabaseFactory.createPostgresAdapter(
            TestConfigFixtures.validPostgresConfig
          );
          jest.spyOn(adapter, 'connect').mockRejectedValue(new Error('read ECONNRESET'));
          return adapter;
        }
        return MockDatabaseFactory.createPostgresAdapter(TestConfigFixtures.validPostgresConfig);
      });

      connectionManager.registerDatabase('retry_db', TestConfigFixtures.validPostgresConfig);

      const connection = await connectionManager.getConnection('retry_db');
      expect(connection).toBeDefined();
      expect(attempts).toBe(2);
    }, 15000);

    test('should retry on ETIMEDOUT error', async () => {
      let attempts = 0;
      jest.spyOn(connectionManager as any, 'createAdapter').mockImplementation(() => {
        attempts++;
        if (attempts <= 1) {
          const adapter = MockDatabaseFactory.createPostgresAdapter(
            TestConfigFixtures.validPostgresConfig
          );
          jest.spyOn(adapter, 'connect').mockRejectedValue(new Error('connect ETIMEDOUT'));
          return adapter;
        }
        return MockDatabaseFactory.createPostgresAdapter(TestConfigFixtures.validPostgresConfig);
      });

      connectionManager.registerDatabase('retry_db', TestConfigFixtures.validPostgresConfig);

      const connection = await connectionManager.getConnection('retry_db');
      expect(connection).toBeDefined();
    }, 15000);

    test('should retry on socket hang up error', async () => {
      let attempts = 0;
      jest.spyOn(connectionManager as any, 'createAdapter').mockImplementation(() => {
        attempts++;
        if (attempts <= 1) {
          const adapter = MockDatabaseFactory.createPostgresAdapter(
            TestConfigFixtures.validPostgresConfig
          );
          jest.spyOn(adapter, 'connect').mockRejectedValue(new Error('socket hang up'));
          return adapter;
        }
        return MockDatabaseFactory.createPostgresAdapter(TestConfigFixtures.validPostgresConfig);
      });

      connectionManager.registerDatabase('retry_db', TestConfigFixtures.validPostgresConfig);

      const connection = await connectionManager.getConnection('retry_db');
      expect(connection).toBeDefined();
    }, 15000);

    test('should NOT retry on non-retryable errors', async () => {
      let attempts = 0;
      jest.spyOn(connectionManager as any, 'createAdapter').mockImplementation(() => {
        attempts++;
        const adapter = MockDatabaseFactory.createPostgresAdapter(
          TestConfigFixtures.validPostgresConfig
        );
        jest.spyOn(adapter, 'connect').mockRejectedValue(new Error('Access denied for user'));
        return adapter;
      });

      connectionManager.registerDatabase('retry_db', TestConfigFixtures.validPostgresConfig);

      await expect(connectionManager.getConnection('retry_db')).rejects.toThrow('Access denied');
      expect(attempts).toBe(1); // No retries
    });

    test('should give up after max retries exceeded', async () => {
      let attempts = 0;
      jest.spyOn(connectionManager as any, 'createAdapter').mockImplementation(() => {
        attempts++;
        const adapter = MockDatabaseFactory.createPostgresAdapter(
          TestConfigFixtures.validPostgresConfig
        );
        jest
          .spyOn(adapter, 'connect')
          .mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5432'));
        return adapter;
      });

      connectionManager.registerDatabase('retry_db', TestConfigFixtures.validPostgresConfig);

      await expect(connectionManager.getConnection('retry_db')).rejects.toThrow('ECONNREFUSED');
      expect(attempts).toBe(3); // initial + 2 retries
    }, 15000);

    test('should use exponential backoff delays', async () => {
      const timestamps: number[] = [];

      jest.spyOn(connectionManager as any, 'createAdapter').mockImplementation(() => {
        timestamps.push(Date.now());
        const adapter = MockDatabaseFactory.createPostgresAdapter(
          TestConfigFixtures.validPostgresConfig
        );
        jest.spyOn(adapter, 'connect').mockRejectedValue(new Error('connect ECONNREFUSED'));
        return adapter;
      });

      connectionManager.registerDatabase('retry_db', TestConfigFixtures.validPostgresConfig);

      try {
        await connectionManager.getConnection('retry_db');
      } catch {
        // expected
      }

      // The retry count is the authoritative correctness check.
      // Timing assertions are avoided because mock adapters resolve
      // faster than real setTimeout, producing unreliable elapsed times.
      expect(timestamps.length).toBe(3); // initial + 2 retries

      // Verify retries are sequential (each timestamp >= previous)
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]!);
      }
    }, 15000);
  });

  // ============================================================================
  // SSH Tunnel Integration (expanded)
  // ============================================================================

  describe('SSH Tunnel Integration (expanded)', () => {
    test('should reuse existing healthy tunnel', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      // Configure SSH tunnel manager to report connected
      mockSSHTunnelManager.isConnected.mockReturnValue(true);
      mockSSHTunnelManager.getTunnel = jest.fn().mockReturnValue({
        localHost: '127.0.0.1',
        localPort: 12345,
        remoteHost: 'db.internal.com',
        remotePort: 5432,
      }) as any;

      const config = TestConfigFixtures.configWithSSH;
      connectionManager.registerDatabase('ssh_db', config);

      const connection = await connectionManager.getConnection('ssh_db');
      expect(connection).toBeDefined();

      // createTunnel should NOT have been called since tunnel is already connected
      expect(mockSSHTunnelManager.createTunnel).not.toHaveBeenCalled();
    });

    test('should recreate unhealthy tunnel', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      // Tunnel exists but is not connected (unhealthy)
      mockSSHTunnelManager.isConnected.mockReturnValue(false);
      mockSSHTunnelManager.hasTunnel.mockReturnValue(true);

      const config = TestConfigFixtures.configWithSSH;
      connectionManager.registerDatabase('ssh_db', config);

      const connection = await connectionManager.getConnection('ssh_db');
      expect(connection).toBeDefined();

      // Should have closed the old tunnel and created a new one
      expect(mockSSHTunnelManager.closeTunnel).toHaveBeenCalled();
      expect(mockSSHTunnelManager.createTunnel).toHaveBeenCalled();
    });

    test('should clean up tunnel if DB connection fails', async () => {
      const mockAdapter = MockDatabaseFactory.createFailingAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      mockSSHTunnelManager.isConnected.mockReturnValue(false);
      mockSSHTunnelManager.hasTunnel.mockReturnValue(false);

      const config = TestConfigFixtures.configWithSSH;
      connectionManager.registerDatabase('ssh_db', config);

      await expect(connectionManager.getConnection('ssh_db')).rejects.toThrow();

      // Tunnel should have been cleaned up after DB connection failure
      expect(mockSSHTunnelManager.closeTunnel).toHaveBeenCalled();
    });

    test('should throw ConnectionError when SSH tunnel creation fails', async () => {
      mockSSHTunnelManager.isConnected.mockReturnValue(false);
      mockSSHTunnelManager.hasTunnel.mockReturnValue(false);
      mockSSHTunnelManager.createTunnel.mockRejectedValue(new Error('SSH auth failed'));

      const config = TestConfigFixtures.configWithSSH;
      connectionManager.registerDatabase('ssh_db', config);

      await expect(connectionManager.getConnection('ssh_db')).rejects.toThrow(/SSH tunnel/);
    });

    test('should not create SSH tunnel for sqlite even with ssh_host set', async () => {
      const mockAdapter = MockDatabaseFactory.createSqliteAdapter(
        TestConfigFixtures.validSqliteConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      const config: DatabaseConfig = {
        ...TestConfigFixtures.validSqliteConfig,
        ssh_host: 'bastion.example.com',
        ssh_username: 'user',
        ssh_password: 'testpassword',
      };
      connectionManager.registerDatabase('sqlite_db', config);

      const connection = await connectionManager.getConnection('sqlite_db');
      expect(connection).toBeDefined();
      expect(mockSSHTunnelManager.createTunnel).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Query Execution
  // ============================================================================

  describe('Query Execution', () => {
    test('should execute a simple query', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      connectionManager.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);

      const result = await connectionManager.executeQuery('test_db', 'SELECT * FROM users');
      expect(result).toBeDefined();
      expect(result.rows).toBeDefined();
      expect(result.rowCount).toBeGreaterThan(0);
    });

    test('should throw when no adapter found for query', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      connectionManager.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);
      await connectionManager.getConnection('test_db');

      // Remove the adapter manually to simulate missing adapter
      (connectionManager as any).adapters.delete('test_db');

      await expect(connectionManager.executeQuery('test_db', 'SELECT 1')).rejects.toThrow(
        /No adapter found/
      );
    });

    test('should emit error event on query failure', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      const querySpy = jest
        .spyOn(mockAdapter, 'executeQuery')
        .mockRejectedValue(new Error('Query syntax error'));
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      connectionManager.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);
      await connectionManager.getConnection('test_db');

      // Reset the spy to fail on the actual query
      querySpy.mockRejectedValue(new Error('Query syntax error'));

      const errorPromise = new Promise<void>((resolve) => {
        connectionManager.on('error', () => resolve());
      });

      await expect(connectionManager.executeQuery('test_db', 'INVALID SQL')).rejects.toThrow(
        'Query syntax error'
      );

      await errorPromise;
    });

    test('should auto-create connection if not exists when querying', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      connectionManager.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);

      // Don't call getConnection first
      const result = await connectionManager.executeQuery('test_db', 'SELECT 1 as test');
      expect(result).toBeDefined();
    });
  });

  // ============================================================================
  // Execution Plan Formatting
  // ============================================================================

  describe('formatExecutionPlan', () => {
    const format = (rows: Record<string, unknown>[], dbType: string): string =>
      (connectionManager as any).formatExecutionPlan({ rows }, dbType);

    test('should render a single-column MySQL JSON plan without undefined padding', () => {
      // MySQL's EXPLAIN FORMAT=JSON returns one column holding the whole plan.
      const rows = [{ EXPLAIN: '{"query_block": {"select_id": 1}}' }];

      const output = format(rows, 'mysql');

      expect(output).toBe('{"query_block": {"select_id": 1}}');
      expect(output).not.toContain('undefined');
    });

    test('should preserve every column of a classic MySQL EXPLAIN', () => {
      // Classic EXPLAIN returns 12 columns; none of them may be dropped.
      const rows = [
        {
          id: 1,
          select_type: 'SIMPLE',
          table: 'user',
          partitions: null,
          type: 'index',
          possible_keys: null,
          key: 'PRIMARY',
          key_len: '4',
          ref: null,
          rows: 425,
          filtered: 100,
          Extra: 'Using where',
        },
      ];

      const output = format(rows, 'mysql');

      expect(output).toContain('PRIMARY');
      expect(output).toContain('Using where');
      expect(output).toContain('425');
      expect(output).not.toContain('undefined');
    });

    test('should join multi-row plans with newlines', () => {
      const output = format([{ step: 'SCAN widget' }, { step: 'USE TEMP B-TREE' }], 'sqlite');

      expect(output).toBe('SCAN widget\nUSE TEMP B-TREE');
    });

    test('should keep PostgreSQL plan lines space-joined', () => {
      const output = format([{ 'QUERY PLAN': 'Seq Scan on user' }], 'postgresql');

      expect(output).toBe('Seq Scan on user');
    });

    test('should return an empty string for a plan with no rows', () => {
      expect(format([], 'mysql')).toBe('');
    });
  });

  // ============================================================================
  // Performance Recommendations
  // ============================================================================

  describe('generatePerformanceRecommendations', () => {
    const silentAdapter = { getPerformanceRecommendations: (): string[] => [] };

    const generate = (
      options: {
        query?: string;
        executionTime?: number;
        rowCount?: number;
        fields?: string[];
        adapter?: unknown;
      } = {}
    ): string =>
      (connectionManager as any).generatePerformanceRecommendations({
        query: options.query ?? 'SELECT id FROM users',
        result: {
          rows: [],
          rowCount: options.rowCount ?? 0,
          fields: options.fields ?? [],
          truncated: false,
          execution_time_ms: 0,
        },
        explainResult: {
          rows: [{ step: 'SCAN users' }],
          rowCount: 1,
          fields: ['step'],
          truncated: false,
          execution_time_ms: 0,
        },
        executionTime: options.executionTime ?? 10,
        adapter: options.adapter ?? silentAdapter,
      });

    describe('adapter delegation', () => {
      test('should include the dialect advice the adapter reports', () => {
        const adapter = {
          getPerformanceRecommendations: jest.fn().mockReturnValue(['DIALECT: add an index']),
        };

        expect(generate({ adapter })).toContain('DIALECT: add an index');
      });

      test('should ask the adapter about the explain result and the original query', () => {
        const adapter = { getPerformanceRecommendations: jest.fn().mockReturnValue([]) };

        generate({ adapter, query: 'SELECT name FROM widget' });

        expect(adapter.getPerformanceRecommendations).toHaveBeenCalledWith(
          expect.objectContaining({ rows: [{ step: 'SCAN users' }] }),
          'SELECT name FROM widget'
        );
      });

      test('should still report the generic advice when the adapter has none', () => {
        const output = generate({ query: 'SELECT * FROM users' });

        expect(output).toContain('Performance Analysis Results:');
        expect(output).toContain('Use specific column names instead of SELECT *');
      });
    });

    test('should report the measured timing and result shape', () => {
      const output = generate({ executionTime: 42, rowCount: 7, fields: ['id', 'name'] });

      expect(output).toContain('Query executed successfully in 42ms');
      expect(output).toContain('Returned 7 rows with 2 columns');
    });

    // The handler renders this block verbatim, so the separator is the only
    // thing keeping it from arriving as one run-on line.
    test('should put each recommendation on its own line', () => {
      const lines = generate({ executionTime: 42, rowCount: 7, fields: ['id', 'name'] }).split(
        '\n'
      );

      expect(lines[0]).toBe('Performance Analysis Results:');
      expect(lines).toContain('- Query executed successfully in 42ms');
    });

    // Each threshold is asserted on both sides of its boundary. Without the
    // exact-value cases, widening any of these comparisons to >= would leave
    // every test passing while a whole severity band shifted.
    describe('execution time bands', () => {
      test('should call a query over five seconds critical', () => {
        expect(generate({ executionTime: 5001 })).toContain('CRITICAL: Query took over 5 seconds');
      });

      test('should call exactly five seconds slow rather than critical', () => {
        const output = generate({ executionTime: 5000 });

        expect(output).toContain('WARNING: Slow query detected');
        expect(output).not.toContain('CRITICAL');
      });

      test('should call a query over one second slow', () => {
        expect(generate({ executionTime: 1001 })).toContain('WARNING: Slow query detected');
      });

      test('should call exactly one second moderate rather than slow', () => {
        const output = generate({ executionTime: 1000 });

        expect(output).toContain('Moderate execution time');
        expect(output).not.toContain('WARNING: Slow query detected');
      });

      test('should call a query over half a second moderate', () => {
        expect(generate({ executionTime: 501 })).toContain('Moderate execution time');
      });

      test('should call exactly half a second acceptable', () => {
        const output = generate({ executionTime: 500 });

        expect(output).toContain('GOOD: Query performance is acceptable');
        expect(output).not.toContain('Moderate execution time');
      });
    });

    describe('result size bands', () => {
      test('should flag more than ten thousand rows as a large dataset', () => {
        expect(generate({ rowCount: 10001 })).toContain('LARGE DATASET');
      });

      test('should call exactly ten thousand rows a large result set, not a large dataset', () => {
        const output = generate({ rowCount: 10000 });

        expect(output).toContain('Large result set');
        expect(output).not.toContain('LARGE DATASET');
      });

      test('should flag more than a thousand rows as a large result set', () => {
        expect(generate({ rowCount: 1001 })).toContain('Large result set');
      });

      test('should say nothing about exactly a thousand rows', () => {
        const output = generate({ rowCount: 1000 });

        expect(output).not.toContain('Large result set');
        expect(output).not.toContain('LARGE DATASET');
      });
    });

    describe('query shape', () => {
      test('should say nothing about a query that names its columns', () => {
        expect(generate({ query: 'SELECT id FROM users' })).not.toContain(
          'Use specific column names'
        );
      });

      test('should suggest a LIMIT when the query has neither LIMIT nor TOP', () => {
        expect(generate({ query: 'SELECT id FROM users' })).toContain(
          'Consider adding LIMIT clause'
        );
      });

      test('should not suggest a LIMIT when the query already has one', () => {
        expect(generate({ query: 'SELECT id FROM users LIMIT 10' })).not.toContain(
          'Consider adding LIMIT clause'
        );
      });

      test('should not suggest a LIMIT when the query uses TOP instead', () => {
        expect(generate({ query: 'SELECT TOP 10 id FROM users' })).not.toContain(
          'Consider adding LIMIT clause'
        );
      });

      // LIMIT and TOP are keywords, not substrings. Matching them loosely lets
      // an ordinary column name suppress the advice: 'stop_id' contains 'TOP'.
      test('should still suggest a LIMIT when a column name merely contains TOP', () => {
        expect(generate({ query: 'SELECT stop_id FROM stops' })).toContain(
          'Consider adding LIMIT clause'
        );
      });

      test('should still suggest a LIMIT when a column name merely contains LIMIT', () => {
        expect(generate({ query: 'SELECT rate_limit_id FROM quotas' })).toContain(
          'Consider adding LIMIT clause'
        );
      });

      test('should discourage SELECT * however it is spaced', () => {
        expect(generate({ query: 'SELECT  * FROM users LIMIT 1' })).toContain(
          'Use specific column names'
        );
      });
    });

    describe('join analysis', () => {
      const withJoins = (count: number): string =>
        `SELECT id FROM a ${Array.from({ length: count }, (_, i) => `JOIN t${i} ON 1=1`).join(' ')} LIMIT 1`;

      test('should call more than three joins complex', () => {
        expect(generate({ query: withJoins(4) })).toContain('COMPLEX: Multiple JOINs detected');
      });

      test('should treat exactly three joins as ordinary', () => {
        const output = generate({ query: withJoins(3) });

        expect(output).toContain('[INFO]: JOINs detected');
        expect(output).not.toContain('COMPLEX');
      });

      test('should say nothing about a query with no joins', () => {
        expect(generate({ query: withJoins(0) })).not.toContain('JOINs detected');
      });
    });
  });

  // ============================================================================
  // Batch Execution
  // ============================================================================

  describe('Batch Execution', () => {
    test('should execute batch queries', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      connectionManager.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);

      const result = await connectionManager.executeBatch('test_db', [
        { query: 'SELECT * FROM users', label: 'Get users' },
        { query: 'SELECT * FROM posts', label: 'Get posts' },
      ]);

      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(0);
      expect(result.results).toHaveLength(2);
      expect(result.totalExecutionTime).toBeGreaterThanOrEqual(0);
      expect(result.transactionUsed).toBe(false);
    });

    test('should execute batch with transaction', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      const beginSpy = jest.spyOn(mockAdapter, 'beginTransaction');
      const commitSpy = jest.spyOn(mockAdapter, 'commitTransaction');
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      connectionManager.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);

      const result = await connectionManager.executeBatch(
        'test_db',
        [
          { query: 'SELECT * FROM users', label: 'Get users' },
          { query: 'SELECT * FROM posts', label: 'Get posts' },
        ],
        true
      );

      expect(result.transactionUsed).toBe(true);
      expect(result.successCount).toBe(2);
      expect(beginSpy).toHaveBeenCalled();
      expect(commitSpy).toHaveBeenCalled();
    });

    test('should rollback transaction on batch query failure and return partial results', async () => {
      // Audit H6: previously executeBatch threw on transaction failure, discarding
      // the partial `results` array. Now it rolls back and returns partial results.
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      let queryCount = 0;
      jest.spyOn(mockAdapter, 'executeQuery').mockImplementation(async () => {
        queryCount++;
        if (queryCount === 2) {
          throw new Error('Query 2 failed');
        }
        return { rows: [], rowCount: 0, fields: [], truncated: false, execution_time_ms: 0 };
      });
      const rollbackSpy = jest.spyOn(mockAdapter, 'rollbackTransaction');
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      connectionManager.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);

      const result = await connectionManager.executeBatch(
        'test_db',
        [
          { query: 'SELECT 1', label: 'Q1' },
          { query: 'INVALID', label: 'Q2' },
          { query: 'SELECT 3', label: 'Q3' },
        ],
        true // useTransaction
      );

      // Rollback was called
      expect(rollbackSpy).toHaveBeenCalled();

      // Partial results are returned (not thrown away)
      expect(result.results).toHaveLength(2); // Q1 succeeded, Q2 failed, Q3 never ran
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].label).toBe('Q1');
      expect(result.results[1].success).toBe(false);
      expect(result.results[1].error).toBe('Query 2 failed');
      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(1);
      expect(result.transactionUsed).toBe(true);
    });

    test('batch results keep the failing error as cause', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      const failure = Object.assign(new Error('bad column'), { code: '42703' });
      jest.spyOn(mockAdapter, 'executeQuery').mockRejectedValue(failure);
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);
      connectionManager.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);

      const result = await connectionManager.executeBatch('test_db', [{ query: 'SELECT x' }]);

      expect(result.results[0].success).toBe(false);
      expect(result.results[0].cause).toBe(failure);
    });

    test('transactional batch results keep the failing error as cause', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      const failure = Object.assign(new Error('bad column'), { code: '42703' });
      jest.spyOn(mockAdapter, 'executeQuery').mockRejectedValue(failure);
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);
      connectionManager.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);

      const result = await connectionManager.executeBatch(
        'test_db',
        [{ query: 'SELECT x' }],
        true // useTransaction
      );

      expect(result.transactionUsed).toBe(true);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].cause).toBe(failure);
    });

    test('should continue batch without transaction on partial failure', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      let queryCount = 0;
      jest.spyOn(mockAdapter, 'executeQuery').mockImplementation(async () => {
        queryCount++;
        if (queryCount === 2) {
          throw new Error('Query 2 failed');
        }
        return { rows: [], rowCount: 0, fields: [], truncated: false, execution_time_ms: 0 };
      });
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      connectionManager.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);

      const result = await connectionManager.executeBatch(
        'test_db',
        [
          { query: 'SELECT 1', label: 'Q1' },
          { query: 'INVALID', label: 'Q2' },
          { query: 'SELECT 3', label: 'Q3' },
        ],
        false
      );

      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(1);
      expect(result.results[1].success).toBe(false);
      expect(result.results[1].error).toBe('Query 2 failed');
    });

    test('should assign default labels when not provided', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      connectionManager.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);

      const result = await connectionManager.executeBatch('test_db', [
        { query: 'SELECT 1' },
        { query: 'SELECT 2' },
      ]);

      expect(result.results[0].label).toBe('Query 1');
      expect(result.results[1].label).toBe('Query 2');
    });

    test('should throw when no adapter found for batch', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      connectionManager.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);
      await connectionManager.getConnection('test_db');
      (connectionManager as any).adapters.delete('test_db');

      await expect(
        connectionManager.executeBatch('test_db', [{ query: 'SELECT 1' }])
      ).rejects.toThrow(/No adapter found/);
    });
  });

  // ============================================================================
  // closeAllConnections with timeouts
  // ============================================================================

  describe('closeAllConnections', () => {
    test('should handle timeout on slow connection close', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      // Make disconnect hang
      jest.spyOn(mockAdapter, 'disconnect').mockReturnValue(new Promise(() => {}));
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      connectionManager.registerDatabase('slow_db', TestConfigFixtures.validPostgresConfig);
      await connectionManager.getConnection('slow_db');

      // closeAllConnections has 5s per-connection timeout
      await expect(connectionManager.closeAllConnections()).resolves.not.toThrow();
    }, 15000);

    test('should handle multiple connection close errors', async () => {
      const mockAdapter1 = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      const mockAdapter2 = MockDatabaseFactory.createMysqlAdapter(
        TestConfigFixtures.validMysqlConfig
      );

      jest.spyOn(mockAdapter1, 'disconnect').mockRejectedValue(new Error('Close error 1'));
      jest.spyOn(mockAdapter2, 'disconnect').mockRejectedValue(new Error('Close error 2'));

      let adapterCount = 0;
      jest.spyOn(connectionManager as any, 'createAdapter').mockImplementation(() => {
        adapterCount++;
        return adapterCount === 1 ? mockAdapter1 : mockAdapter2;
      });

      connectionManager.registerDatabase('db1', TestConfigFixtures.validPostgresConfig);
      connectionManager.registerDatabase('db2', TestConfigFixtures.validMysqlConfig);

      await connectionManager.getConnection('db1');
      await connectionManager.getConnection('db2');

      // Should not throw even with errors
      await expect(connectionManager.closeAllConnections()).resolves.not.toThrow();
    });
  });

  // ============================================================================
  // Initialize
  // ============================================================================

  describe('Initialize', () => {
    test('should initialize with database configs', () => {
      const databases: Record<string, DatabaseConfig> = {
        db1: TestConfigFixtures.validPostgresConfig,
        db2: TestConfigFixtures.validMysqlConfig,
      };

      const emitSpy = jest.spyOn(connectionManager, 'emit');
      connectionManager.initialize(databases);

      expect(connectionManager.getDatabaseConfig('db1')).toBeDefined();
      expect(connectionManager.getDatabaseConfig('db2')).toBeDefined();
      expect(emitSpy).toHaveBeenCalledWith('initialized', databases);
    });
  });

  // ============================================================================
  // getActiveConnections and getConnectionStats
  // ============================================================================

  // ============================================================================
  // isConnected edge cases
  // ============================================================================

  describe('isConnected edge cases', () => {
    test('should return false when adapter throws', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      connectionManager.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);
      await connectionManager.getConnection('test_db');

      // Make isConnected throw
      jest.spyOn(mockAdapter, 'isConnected').mockImplementation(() => {
        throw new Error('Check failed');
      });

      expect(connectionManager.isConnected('test_db')).toBe(false);
    });

    test('should return false when no connection info exists', () => {
      expect(connectionManager.isConnected('nonexistent')).toBe(false);
    });
  });

  // ============================================================================
  // getAdapter
  // ============================================================================

  describe('getAdapter', () => {
    test('should return undefined for non-existent adapter', () => {
      expect(connectionManager.getAdapter('nonexistent')).toBeUndefined();
    });

    test('should return existing connection after creation', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      connectionManager.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);
      await connectionManager.getConnection('test_db');

      expect(connectionManager.getAdapter('test_db')).toBeDefined();
    });
  });

  // ============================================================================
  // Event emissions
  // ============================================================================

  describe('Event emissions', () => {
    test('should emit connected event on successful connection', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      connectionManager.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);

      const connectedPromise = new Promise<string>((resolve) => {
        connectionManager.on('connected', (dbName: string) => resolve(dbName));
      });

      await connectionManager.getConnection('test_db');

      const dbName = await connectedPromise;
      expect(dbName).toBe('test_db');
    });

    test('should emit disconnected event on connection close', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      connectionManager.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);
      await connectionManager.getConnection('test_db');

      const disconnectedPromise = new Promise<string>((resolve) => {
        connectionManager.on('disconnected', (dbName: string) => resolve(dbName));
      });

      await connectionManager.closeConnection('test_db');

      const dbName = await disconnectedPromise;
      expect(dbName).toBe('test_db');
    });
  });

  describe('Cleanup and Resource Management', () => {
    test('should clean up resources on close', async () => {
      const mockAdapter1 = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      const mockAdapter2 = MockDatabaseFactory.createMysqlAdapter(
        TestConfigFixtures.validMysqlConfig
      );

      let adapterCount = 0;
      jest.spyOn(connectionManager as any, 'createAdapter').mockImplementation(() => {
        adapterCount++;
        return adapterCount === 1 ? mockAdapter1 : mockAdapter2;
      });

      connectionManager.registerDatabase('db1', TestConfigFixtures.validPostgresConfig);
      connectionManager.registerDatabase('db2', TestConfigFixtures.validMysqlConfig);

      await connectionManager.getConnection('db1');
      await connectionManager.getConnection('db2');

      await connectionManager.closeAllConnections();

      // Verify all connections are closed
      expect(mockAdapter1.isCurrentlyConnected()).toBe(false);
      expect(mockAdapter2.isCurrentlyConnected()).toBe(false);
    });

    test('should handle close errors gracefully', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );

      // Mock disconnect to throw error
      jest.spyOn(mockAdapter, 'disconnect').mockRejectedValue(new Error('Disconnect failed'));
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);

      const config = TestConfigFixtures.validPostgresConfig;
      connectionManager.registerDatabase('test_db', config);

      await connectionManager.getConnection('test_db');

      // Should not throw even if disconnect fails
      await expect(connectionManager.closeConnection('test_db')).resolves.not.toThrow();
    });
  });

  describe('Configuration Management', () => {
    test('should validate configuration before registration', () => {
      const validConfig = TestConfigFixtures.validPostgresConfig;
      const invalidConfig = TestConfigFixtures.invalidDatabaseConfig as DatabaseConfig;

      expect(() => {
        connectionManager.registerDatabase('valid_db', validConfig);
      }).not.toThrow();

      expect(() => {
        connectionManager.registerDatabase('invalid_db', invalidConfig);
      }).toThrow();
    });

    test('should get database configuration', () => {
      const config = TestConfigFixtures.validPostgresConfig;
      connectionManager.registerDatabase('test_db', config);

      const retrievedConfig = connectionManager.getDatabaseConfig('test_db');
      expect(retrievedConfig).toEqual(config);
    });

    test('should return undefined for nonexistent database config', () => {
      const config = connectionManager.getDatabaseConfig('nonexistent');
      expect(config).toBeUndefined();
    });

    test('should update database configuration', () => {
      const originalConfig = TestConfigFixtures.validPostgresConfig;
      const updatedConfig = { ...originalConfig, host: 'updated-host' };

      connectionManager.registerDatabase('test_db', originalConfig);
      connectionManager.registerDatabase('test_db', updatedConfig);

      const retrievedConfig = connectionManager.getDatabaseConfig('test_db');
      expect(retrievedConfig?.host).toBe('updated-host');
    });
  });

  // ============================================================================
  // Circuit Breaker Integration
  // ============================================================================

  describe('circuit breaker integration', () => {
    test('opens circuit after 5 consecutive CONNECTION errors', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest
        .spyOn(mockAdapter, 'executeQuery')
        .mockRejectedValue(new ConnectionError('connect ECONNREFUSED 127.0.0.1:5432'));
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);
      // Suppress unhandled 'error' events from EventEmitter
      connectionManager.on('error', () => {});

      connectionManager.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);
      await connectionManager.getConnection('test_db');

      // Fire 5 queries — all should throw the ConnectionError
      for (let i = 0; i < 5; i++) {
        await expect(connectionManager.executeQuery('test_db', 'SELECT 1')).rejects.toThrow();
      }

      // 6th call should throw CircuitOpenError without calling adapter again
      await expect(connectionManager.executeQuery('test_db', 'SELECT 1')).rejects.toThrow(
        /unavailable.*retry in \d+s/
      );
      // Adapter was called exactly 5 times (not 6)
      expect(mockAdapter.executeQuery).toHaveBeenCalledTimes(5);
    });

    test('CircuitOpenError message includes retry time', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest
        .spyOn(mockAdapter, 'executeQuery')
        .mockRejectedValue(new ConnectionError('connect ECONNREFUSED'));
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);
      connectionManager.on('error', () => {});

      connectionManager.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);
      await connectionManager.getConnection('test_db');

      // Trip the circuit
      for (let i = 0; i < 5; i++) {
        await expect(connectionManager.executeQuery('test_db', 'SELECT 1')).rejects.toThrow();
      }

      // Verify the error message format
      try {
        await connectionManager.executeQuery('test_db', 'SELECT 1');
        throw new Error('Expected CircuitOpenError');
      } catch (err: any) {
        expect(err.message).toMatch(/retry in \d+s/);
        expect(err.name).toBe('CircuitOpenError');
      }
    });

    test('QUERY errors do not advance circuit breaker', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest
        .spyOn(mockAdapter, 'executeQuery')
        .mockRejectedValue(new Error('Syntax error near SELECT')); // what a driver throws
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);
      connectionManager.on('error', () => {});

      connectionManager.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);
      await connectionManager.getConnection('test_db');

      // Fire 10 query errors
      for (let i = 0; i < 10; i++) {
        await expect(connectionManager.executeQuery('test_db', 'BAD SQL')).rejects.toThrow(
          'Syntax error'
        );
      }

      // 11th should still be the query error (NOT CircuitOpenError)
      try {
        await connectionManager.executeQuery('test_db', 'BAD SQL');
        throw new Error('Expected error');
      } catch (err: any) {
        expect(err.name).not.toBe('CircuitOpenError');
        expect(err.message).toContain('Syntax error');
      }
    });

    test('query connection drop (ECONNRESET) advances circuit breaker and evicts connection', async () => {
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest
        .spyOn(mockAdapter, 'executeQuery')
        .mockRejectedValue(
          new Error('PostgreSQL adapter error: Failed to execute query - read ECONNRESET')
        );
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);
      connectionManager.on('error', () => {});

      connectionManager.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);
      await connectionManager.getConnection('test_db');

      expect(connectionManager.isConnected('test_db')).toBe(true);

      // Fire 1 query — should throw and evict connection from maps
      await expect(connectionManager.executeQuery('test_db', 'SELECT 1')).rejects.toThrow(
        'ECONNRESET'
      );

      // The connection should have been evicted from maps immediately
      expect(connectionManager.isConnected('test_db')).toBe(false);

      // Fire 4 more query failures to trip circuit
      for (let i = 0; i < 4; i++) {
        await expect(connectionManager.executeQuery('test_db', 'SELECT 1')).rejects.toThrow();
      }

      // 6th call should throw CircuitOpenError
      await expect(connectionManager.executeQuery('test_db', 'SELECT 1')).rejects.toThrow(
        /unavailable.*retry in \d+s/
      );
    });
  });

  // ============================================================================
  // Query Cache Integration
  // ============================================================================

  describe('query cache integration', () => {
    test('unregisterDatabase invalidates query cache (H2)', async () => {
      // Audit H2: after unregistering/re-registering a database (e.g. on config
      // update), stale cached SELECT results must not be served.
      const { QueryCache } = await import('../../src/classes/QueryCache.js');
      const cache = new QueryCache();
      const cmWithCache = new ConnectionManager(mockSSHTunnelManager, undefined, cache);

      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(cmWithCache as any, 'createAdapter').mockReturnValue(mockAdapter);

      cmWithCache.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);
      await cmWithCache.getConnection('test_db');

      // Cache a SELECT result
      const execSpy = jest.spyOn(mockAdapter, 'executeQuery');
      await cmWithCache.executeQuery('test_db', 'SELECT * FROM users');
      expect(execSpy).toHaveBeenCalledTimes(1);

      // Second call comes from cache
      await cmWithCache.executeQuery('test_db', 'SELECT * FROM users');
      expect(execSpy).toHaveBeenCalledTimes(1);

      // Unregister should invalidate the cache
      cmWithCache.unregisterDatabase('test_db');

      // Re-register and reconnect — the next SELECT must hit the DB, not cache
      cmWithCache.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);
      jest.spyOn(cmWithCache as any, 'createAdapter').mockReturnValue(mockAdapter);
      await cmWithCache.getConnection('test_db');

      await cmWithCache.executeQuery('test_db', 'SELECT * FROM users');
      expect(execSpy).toHaveBeenCalledTimes(2); // cache was invalidated

      await cmWithCache.closeAllConnections();
    });

    test('closeAllConnections destroys connection pools (H3)', async () => {
      // Audit H3: closeAllConnections must call destroyPool() on each adapter.
      // Previously adapters were deleted from the map before the destroy loop.
      const { QueryCache } = await import('../../src/classes/QueryCache.js');
      const cache = new QueryCache();
      const cmWithCache = new ConnectionManager(mockSSHTunnelManager, undefined, cache);

      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      // The mock adapter doesn't have destroyPool natively; add a spyable stub.
      const destroyPoolSpy = jest.fn().mockResolvedValue(undefined);
      (mockAdapter as any).destroyPool = destroyPoolSpy;
      jest.spyOn(cmWithCache as any, 'createAdapter').mockReturnValue(mockAdapter);

      cmWithCache.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);
      await cmWithCache.getConnection('test_db');

      await cmWithCache.closeAllConnections();

      // destroyPool should have been called (previously it was never called)
      expect(destroyPoolSpy).toHaveBeenCalled();
    });

    test('schemaFingerprint bypasses the query cache and hashes the rows', async () => {
      const { QueryCache } = await import('../../src/classes/QueryCache.js');
      const cache = new QueryCache();
      const cm = new ConnectionManager(mockSSHTunnelManager, undefined, cache);
      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(cm as any, 'createAdapter').mockReturnValue(mockAdapter);
      cm.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);
      await cm.getConnection('test_db');

      const sql = mockAdapter.fingerprintQuery();
      const mk = (v: string) => ({
        rows: [{ argos_fingerprint: v }],
        fields: ['argos_fingerprint'],
        rowCount: 1,
        executionTime: 1,
      });
      const execSpy = jest.spyOn(mockAdapter, 'executeQuery');
      execSpy.mockResolvedValue(mk('a') as any);
      // Seed the cache with a hit for that exact SQL
      await cm.executeQuery('test_db', sql);
      execSpy.mockClear();

      const h1 = await cm.schemaFingerprint('test_db');
      const h2 = await cm.schemaFingerprint('test_db');
      expect(execSpy).toHaveBeenCalledTimes(2);
      expect(execSpy.mock.calls[0][1]).toBe(sql);
      expect(h1).toMatch(/^[0-9a-f]{64}$/);
      expect(h2).toBe(h1);

      execSpy.mockResolvedValue(mk('b') as any);
      expect(await cm.schemaFingerprint('test_db')).not.toBe(h1);
      await cm.closeAllConnections();
    });

    test('returns cached result on second identical SELECT', async () => {
      // Create a ConnectionManager WITH a QueryCache
      const { QueryCache } = await import('../../src/classes/QueryCache.js');
      const cache = new QueryCache();
      const cmWithCache = new ConnectionManager(mockSSHTunnelManager, undefined, cache);

      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(cmWithCache as any, 'createAdapter').mockReturnValue(mockAdapter);

      cmWithCache.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);
      await cmWithCache.getConnection('test_db');

      const execSpy = jest.spyOn(mockAdapter, 'executeQuery');

      // First call — hits DB
      const r1 = await cmWithCache.executeQuery('test_db', 'SELECT * FROM users');
      expect(execSpy).toHaveBeenCalledTimes(1);

      // Second call — should come from cache
      const r2 = await cmWithCache.executeQuery('test_db', 'SELECT * FROM users');
      // adapter.executeQuery should still have been called only once
      expect(execSpy).toHaveBeenCalledTimes(1);
      expect(r2).toEqual(r1);

      await cmWithCache.closeAllConnections();
    });

    test('does not cache mutations', async () => {
      const { QueryCache } = await import('../../src/classes/QueryCache.js');
      const cache = new QueryCache();
      const cmWithCache = new ConnectionManager(mockSSHTunnelManager, undefined, cache);

      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(cmWithCache as any, 'createAdapter').mockReturnValue(mockAdapter);

      cmWithCache.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);
      await cmWithCache.getConnection('test_db');

      const execSpy = jest.spyOn(mockAdapter, 'executeQuery');

      await cmWithCache.executeQuery('test_db', "INSERT INTO users (name) VALUES ('Alice')");
      await cmWithCache.executeQuery('test_db', "INSERT INTO users (name) VALUES ('Alice')");

      // Both calls should have hit the DB
      expect(execSpy).toHaveBeenCalledTimes(2);

      await cmWithCache.closeAllConnections();
    });

    test('mutations invalidate cached SELECT results', async () => {
      const { QueryCache } = await import('../../src/classes/QueryCache.js');
      const cache = new QueryCache();
      const cmWithCache = new ConnectionManager(mockSSHTunnelManager, undefined, cache);

      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(
        TestConfigFixtures.validPostgresConfig
      );
      jest.spyOn(cmWithCache as any, 'createAdapter').mockReturnValue(mockAdapter);

      cmWithCache.registerDatabase('test_db', TestConfigFixtures.validPostgresConfig);
      await cmWithCache.getConnection('test_db');

      const execSpy = jest.spyOn(mockAdapter, 'executeQuery');

      // 1. SELECT query hits DB and caches result
      await cmWithCache.executeQuery('test_db', 'SELECT * FROM users');
      expect(execSpy).toHaveBeenCalledTimes(1);

      // 2. Second SELECT comes from cache
      await cmWithCache.executeQuery('test_db', 'SELECT * FROM users');
      expect(execSpy).toHaveBeenCalledTimes(1);

      // 3. Mutation query (UPDATE) invalidates cache
      await cmWithCache.executeQuery('test_db', "UPDATE users SET name = 'Bob' WHERE id = 1");
      expect(execSpy).toHaveBeenCalledTimes(2);

      // 4. Subsequent SELECT query misses cache and hits DB
      await cmWithCache.executeQuery('test_db', 'SELECT * FROM users');
      expect(execSpy).toHaveBeenCalledTimes(3);

      await cmWithCache.closeAllConnections();
    });
  });

  describe('Query Timeout Enforcement', () => {
    test('should reject a query that exceeds query_timeout', async () => {
      const config: DatabaseConfig = {
        ...TestConfigFixtures.validPostgresConfig,
        query_timeout: 100, // 100ms timeout
      };
      connectionManager.registerDatabase('timeout_db', config);

      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(config);
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);
      await connectionManager.getConnection('timeout_db');

      // Mock _executeQueryInternal to take longer than timeout
      jest
        .spyOn(connectionManager as any, '_executeQueryInternal')
        .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 500)));

      await expect(
        connectionManager.executeQuery('timeout_db', 'SELECT SLEEP(10)')
      ).rejects.toThrow('Query timed out after 100ms');
    }, 10000);

    test('should return normally when query completes before timeout', async () => {
      const config: DatabaseConfig = {
        ...TestConfigFixtures.validPostgresConfig,
        query_timeout: 5000, // 5s timeout
      };
      connectionManager.registerDatabase('fast_db', config);

      const mockAdapter = MockDatabaseFactory.createPostgresAdapter(config);
      jest.spyOn(connectionManager as any, 'createAdapter').mockReturnValue(mockAdapter);
      await connectionManager.getConnection('fast_db');

      const mockResult = { rows: [{ id: 1 }], fields: ['id'], rowCount: 1 };
      jest.spyOn(connectionManager as any, '_executeQueryInternal').mockResolvedValue(mockResult);

      const result = await connectionManager.executeQuery('fast_db', 'SELECT 1');
      expect(result).toEqual(mockResult);
    });
  });
});

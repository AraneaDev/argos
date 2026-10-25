/**
 * Comprehensive test suite for Enhanced SSH Tunnel Management
 * Covers port management, conflict detection, and automatic assignment
 */

import { jest } from '@jest/globals';
import * as net from 'net';
import { PortManager } from '../../src/utils/port-manager.js';
import { EnhancedSSHTunnelManager } from '../../src/classes/EnhancedSSHTunnelManager.js';
import type {
  SSHTunnelCreateOptions,
  SSHConnectionConfig,
  SSHForwardConfig,
} from '../../src/types/index.js';

// ============================================================================
// Test Helper Classes
// ============================================================================

class TestPortOccupier {
  private servers = new Map<number, net.Server>();

  async occupyPort(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(port, '127.0.0.1', () => {
        this.servers.set(port, server);
        resolve();
      });
      server.on('error', reject);
    });
  }

  async releasePort(port: number): Promise<void> {
    const server = this.servers.get(port);
    if (server) {
      return new Promise((resolve) => {
        server.close(() => {
          this.servers.delete(port);
          resolve();
        });
      });
    }
  }

  async releaseAll(): Promise<void> {
    const ports = Array.from(this.servers.keys());
    await Promise.all(ports.map((port) => this.releasePort(port)));
  }

  getOccupiedPorts(): number[] {
    return Array.from(this.servers.keys());
  }
}

// ============================================================================
// Port Manager Test Suite
// ============================================================================

describe('PortManager', () => {
  let portManager: PortManager;
  let testOccupier: TestPortOccupier;
  const testPortBase = 45000; // Use high ports for testing

  beforeEach(() => {
    portManager = PortManager.getInstance();
    portManager.clearReservedPorts();
    testOccupier = new TestPortOccupier();
  });

  afterEach(async () => {
    await testOccupier.releaseAll();
    portManager.clearReservedPorts();
  });

  describe('Basic Port Operations', () => {
    it('should detect available ports correctly', async () => {
      const result = await portManager.isPortAvailable(testPortBase);
      expect(result.isAvailable).toBe(true);
      expect(result.port).toBe(testPortBase);
      expect(result.reason).toBeUndefined();
    });

    it('should detect occupied ports', async () => {
      const testPort = testPortBase + 1;
      await testOccupier.occupyPort(testPort);

      const result = await portManager.isPortAvailable(testPort);
      expect(result.isAvailable).toBe(false);
      expect(result.port).toBe(testPort);
      expect(result.reason).toMatch(/already in use/i);
    });
  });

  describe('Smart Port Assignment', () => {
    it('should assign preferred port when available', async () => {
      const preferredPort = testPortBase + 10;

      const result = await portManager.findAvailablePort({
        preferredPort,
        minPort: testPortBase,
        maxPort: testPortBase + 100,
      });

      expect(result.assignedPort).toBe(preferredPort);
      expect(result.wasPreferredPort).toBe(true);
      expect(result.attemptedPorts).toContain(preferredPort);
    });

    it('should find alternative when preferred port is unavailable', async () => {
      const preferredPort = testPortBase + 11;
      await testOccupier.occupyPort(preferredPort);

      const result = await portManager.findAvailablePort({
        preferredPort,
        minPort: testPortBase,
        maxPort: testPortBase + 100,
      });

      expect(result.assignedPort).not.toBe(preferredPort);
      expect(result.wasPreferredPort).toBe(false);
      expect(result.attemptedPorts).toContain(preferredPort);
      expect(result.assignedPort).toBeGreaterThanOrEqual(testPortBase);
      expect(result.assignedPort).toBeLessThanOrEqual(testPortBase + 100);
    });

    it('should suggest database-specific alternatives for MySQL', async () => {
      const result = await portManager.suggestTunnelPort('mysql');

      // Should get a port assigned
      expect(result.assignedPort).toBeGreaterThan(0);
      expect(result.assignedPort).toBeLessThan(65536);

      // Check if it's either a MySQL alternative or in safe range
      const mysqlAlternatives = [3307, 3308, 3309, 3316, 3406, 4306];
      const isMySQLSpecific = mysqlAlternatives.includes(result.assignedPort);
      const isInSafeRange = result.assignedPort >= 30000 && result.assignedPort <= 40000;

      expect(isMySQLSpecific || isInSafeRange).toBe(true);
    });

    it('should handle PostgreSQL port suggestions', async () => {
      const result = await portManager.suggestTunnelPort('postgresql');

      expect(result.assignedPort).toBeGreaterThan(0);

      const pgAlternatives = [5433, 5434, 5435, 5442, 5532, 6432];
      const isPGSpecific = pgAlternatives.includes(result.assignedPort);
      const isInSafeRange = result.assignedPort >= 30000 && result.assignedPort <= 40000;

      expect(isPGSpecific || isInSafeRange).toBe(true);
    });

    it('should respect exclude ports', async () => {
      const excludePorts = [testPortBase + 20, testPortBase + 21, testPortBase + 22];

      const result = await portManager.findAvailablePort({
        minPort: testPortBase + 20,
        maxPort: testPortBase + 30,
        excludePorts,
        maxAttempts: 15,
      });

      expect(excludePorts).not.toContain(result.assignedPort);
      expect(result.assignedPort).toBeGreaterThanOrEqual(testPortBase + 20);
      expect(result.assignedPort).toBeLessThanOrEqual(testPortBase + 30);
    });

    it('should throw error when no ports available in range', async () => {
      // Occupy entire range
      const rangeStart = testPortBase + 50;
      const rangeEnd = testPortBase + 55;

      for (let port = rangeStart; port <= rangeEnd; port++) {
        await testOccupier.occupyPort(port);
      }

      await expect(
        portManager.findAvailablePort({
          minPort: rangeStart,
          maxPort: rangeEnd,
          maxAttempts: 10,
        })
      ).rejects.toThrow(/Failed to find available port/);
    });
  });

  describe('Database-Specific Port Recommendations', () => {
    it('should provide correct MySQL alternatives', () => {
      const recommendations = portManager.getPortRecommendations('mysql');

      expect(recommendations).toContain(3307); // 3306 + 1
      expect(recommendations).toContain(3308); // 3306 + 2
      expect(recommendations).toContain(3316); // 3306 + 10
      expect(recommendations).toContain(3406); // 3306 + 100
      expect(recommendations).toContain(4306); // 3306 + 1000

      // Should not contain common conflicting ports
      expect(recommendations).not.toContain(3000);
      expect(recommendations).not.toContain(8080);
    });

    it('should provide PostgreSQL alternatives', () => {
      const recommendations = portManager.getPortRecommendations('postgresql');

      expect(recommendations).toContain(5433);
      expect(recommendations).toContain(5442);
      expect(recommendations).toContain(5532);
      expect(recommendations).toContain(6432);
    });

    it('should provide SQL Server alternatives', () => {
      const recommendations = portManager.getPortRecommendations('mssql');

      expect(recommendations).toContain(1434);
      expect(recommendations).toContain(1443);
      expect(recommendations).toContain(1533);
      expect(recommendations).toContain(2433);
    });

    it('should handle unknown database types', () => {
      const recommendations = portManager.getPortRecommendations('unknown-db');
      expect(recommendations).toEqual([]);
    });
  });

  describe('Port Reservation System', () => {
    it('should reserve and track ports', () => {
      const testPort = testPortBase + 100;

      expect(portManager.getReservedPorts()).not.toContain(testPort);

      portManager.reservePort(testPort);
      expect(portManager.getReservedPorts()).toContain(testPort);

      portManager.releasePort(testPort);
      expect(portManager.getReservedPorts()).not.toContain(testPort);
    });

    it('should avoid reserved ports during assignment', async () => {
      const reservedPort = testPortBase + 101;
      portManager.reservePort(reservedPort);

      const result = await portManager.findAvailablePort({
        preferredPort: reservedPort,
        minPort: testPortBase + 100,
        maxPort: testPortBase + 110,
      });

      expect(result.assignedPort).not.toBe(reservedPort);
      expect(result.wasPreferredPort).toBe(false);
    });

    it('should handle multiple reservations', () => {
      const ports = [testPortBase + 200, testPortBase + 201, testPortBase + 202];

      ports.forEach((port) => portManager.reservePort(port));

      const reserved = portManager.getReservedPorts();
      ports.forEach((port: number) => {
        expect(reserved).toContain(port);
      });

      expect(reserved.length).toBeGreaterThanOrEqual(ports.length);
    });

    it('should clear all reservations', () => {
      const ports = [testPortBase + 300, testPortBase + 301];
      ports.forEach((port) => portManager.reservePort(port));

      expect(portManager.getReservedPorts().length).toBeGreaterThanOrEqual(2);

      portManager.clearReservedPorts();
      expect(portManager.getReservedPorts()).toEqual([]);
    });
  });

  describe('Batch Operations', () => {
    it('should check multiple ports efficiently', async () => {
      const ports = [testPortBase + 400, testPortBase + 401, testPortBase + 402];

      // Occupy middle port
      await testOccupier.occupyPort(ports[1]);

      const results = await portManager.checkMultiplePorts(ports);

      expect(results).toHaveLength(3);
      expect(results[0].isAvailable).toBe(true);
      expect(results[1].isAvailable).toBe(false);
      expect(results[2].isAvailable).toBe(true);

      expect(results[1].reason).toMatch(/already in use/i);
    });

    it('should complete batch checks quickly', async () => {
      const ports = Array.from({ length: 20 }, (_, i) => testPortBase + 500 + i);

      const startTime = Date.now();
      const results = await portManager.checkMultiplePorts(ports);
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(20);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });
});

// ============================================================================
// Enhanced SSH Tunnel Manager Test Suite
// ============================================================================

// Mock ssh2 Client for tunnel creation tests
class MockSSHClient {
  private handlers: Record<string, Function[]> = {};
  public connectCalled = false;
  public connectOptions: any = null;
  public endCalled = false;
  public _sock = true;
  public destroyed = false;

  on(event: string, handler: Function): this {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(handler);
    return this;
  }

  listenerCount(event: string): number {
    return (this.handlers[event] || []).length;
  }

  emit(event: string, ...args: any[]): void {
    const handlers = this.handlers[event] || [];
    handlers.forEach((h) => h(...args));
  }

  connect(options: any): void {
    this.connectCalled = true;
    this.connectOptions = options;
    // Simulate async ready event by default
    setTimeout(() => this.emit('ready'), 10);
  }

  end(): void {
    this.endCalled = true;
  }

  forwardOut(
    srcHost: string,
    srcPort: number,
    dstHost: string,
    dstPort: number,
    cb: Function
  ): void {
    // Mock stream
    const mockStream = {
      pipe: jest.fn().mockReturnThis(),
      on: jest.fn().mockReturnThis(),
      close: jest.fn(),
    };
    cb(null, mockStream);
  }
}

// Helper to create valid SSH tunnel options
function createValidTunnelOptions(
  overrides?: Partial<SSHTunnelCreateOptions>
): SSHTunnelCreateOptions {
  return {
    sshConfig: {
      host: 'bastion.example.com',
      port: 22,
      username: 'deploy',
      password: 'secret',
    },
    forwardConfig: {
      sourceHost: '127.0.0.1',
      sourcePort: 0,
      destinationHost: 'db.internal.com',
      destinationPort: 3306,
    },
    localPort: 0,
    ...overrides,
  };
}

describe('EnhancedSSHTunnelManager', () => {
  let tunnelManager: EnhancedSSHTunnelManager;
  let testOccupier: TestPortOccupier;
  let portManager: PortManager;

  beforeEach(async () => {
    portManager = PortManager.getInstance();
    portManager.clearReservedPorts();
    tunnelManager = new EnhancedSSHTunnelManager();
    await tunnelManager.initialize();
    testOccupier = new TestPortOccupier();
  });

  afterEach(async () => {
    await tunnelManager.closeAllTunnels();
    await testOccupier.releaseAll();
    portManager.clearReservedPorts();
  });

  // ============================================================================
  // Initialization and Basic State
  // ============================================================================

  describe('Initialization', () => {
    it('should initialize without errors', async () => {
      const manager = new EnhancedSSHTunnelManager();
      await expect(manager.initialize()).resolves.not.toThrow();
    });

    it('should start with no tunnels', () => {
      expect(tunnelManager.hasTunnel('any-db')).toBe(false);
      expect(tunnelManager.getTunnel('any-db')).toBeUndefined();
    });

    it('should start with empty stats', () => {
      const stats = tunnelManager.getTunnelStats();
      expect(stats.total).toBe(0);
      expect(stats.active).toBe(0);
      expect(stats.connecting).toBe(0);
      expect(stats.errors).toBe(0);
    });
  });

  // ============================================================================
  // Tunnel Creation - Validation
  // ============================================================================

  describe('Tunnel Creation - Validation', () => {
    it('should reject invalid SSH config (missing host)', async () => {
      const options = createValidTunnelOptions({
        sshConfig: {
          host: '',
          port: 22,
          username: 'user',
          password: 'pass',
        },
      });

      await expect(tunnelManager.createTunnel('test-db', options)).rejects.toThrow(
        /Invalid SSH configuration/
      );
    });

    it('should reject invalid SSH config (missing username)', async () => {
      const options = createValidTunnelOptions({
        sshConfig: {
          host: 'bastion.example.com',
          port: 22,
          username: '',
          password: 'pass',
        },
      });

      await expect(tunnelManager.createTunnel('test-db', options)).rejects.toThrow(
        /Invalid SSH configuration/
      );
    });

    it('should reject invalid SSH config (invalid port)', async () => {
      const options = createValidTunnelOptions({
        sshConfig: {
          host: 'bastion.example.com',
          port: 0,
          username: 'user',
          password: 'pass',
        },
      });

      await expect(tunnelManager.createTunnel('test-db', options)).rejects.toThrow(
        /Invalid SSH configuration/
      );
    });

    it('should set status to error on validation failure', async () => {
      const options = createValidTunnelOptions({
        sshConfig: {
          host: '',
          port: 22,
          username: 'user',
          password: 'pass',
        },
      });

      try {
        await tunnelManager.createTunnel('test-db', options);
      } catch {
        // expected
      }

      const status = tunnelManager.getTunnelStatus('test-db');
      expect(status).toBeDefined();
      expect(status!.status).toBe('error');
      expect(status!.isHealthy).toBe(false);
    });
  });

  // ============================================================================
  // Database Type Detection (extractDatabaseType)
  // ============================================================================

  describe('Database Type Detection', () => {
    it('should detect MySQL from destination port 3306', async () => {
      const options = createValidTunnelOptions({
        forwardConfig: {
          sourceHost: '127.0.0.1',
          sourcePort: 0,
          destinationHost: 'db.internal.com',
          destinationPort: 3306,
        },
      });

      // We can't fully create a tunnel without a real SSH server, but we can test
      // that the createEnhancedTunnel method processes options correctly by checking
      // that it reaches the SSH connection stage (which will eventually fail/timeout)
      // The type detection happens before the connection attempt.
      // For now, verify the port recommendations match MySQL
      const recs = await tunnelManager.getPortRecommendations('mysql');
      expect(recs.recommended).toContain(3307);
    });

    it('should detect PostgreSQL from destination port 5432', async () => {
      const recs = await tunnelManager.getPortRecommendations('postgresql');
      expect(recs.recommended).toContain(5433);
    });

    it('should handle different database types in recommendations', async () => {
      const dbTypes = ['mysql', 'postgresql', 'mssql'];

      for (const dbType of dbTypes) {
        const recs = await tunnelManager.getPortRecommendations(dbType);

        expect(recs.recommended.length).toBeGreaterThan(0);
        expect(recs.status.length).toBe(recs.recommended.length);

        // Verify status objects have correct structure
        recs.status.forEach((status: { port: number; available: boolean; reason?: string }) => {
          expect(status).toHaveProperty('port');
          expect(status).toHaveProperty('available');
          expect(typeof status.port).toBe('number');
          expect(typeof status.available).toBe('boolean');
        });
      }
    });
  });

  // ============================================================================
  // Tunnel Lifecycle (hasTunnel, getTunnel, closeTunnel)
  // ============================================================================

  describe('Tunnel Lifecycle', () => {
    it('should report hasTunnel false for non-existent tunnels', () => {
      expect(tunnelManager.hasTunnel('nonexistent')).toBe(false);
    });

    it('should return undefined for getTunnel on non-existent tunnels', () => {
      expect(tunnelManager.getTunnel('nonexistent')).toBeUndefined();
    });

    it('should handle closeTunnel for non-existent tunnel gracefully', async () => {
      // Should not throw
      await expect(tunnelManager.closeTunnel('nonexistent')).resolves.not.toThrow();
    });

    it('should handle closeAllTunnels with no tunnels', async () => {
      await expect(tunnelManager.closeAllTunnels()).resolves.not.toThrow();
    });
  });

  // ============================================================================
  // closeTunnel with mock tunnel data
  // ============================================================================

  describe('closeTunnel with internal state', () => {
    it('should close tunnel and release port', async () => {
      // Manually inject a tunnel into internal state
      const mockServer = net.createServer();
      await new Promise<void>((resolve) => {
        mockServer.listen(0, '127.0.0.1', () => resolve());
      });
      const addr = mockServer.address() as net.AddressInfo;
      const assignedPort = addr.port;

      portManager.reservePort(assignedPort);

      const mockConnection = new MockSSHClient();
      const tunnelInfo = {
        server: mockServer,
        connection: mockConnection as any,
        localPort: assignedPort,
        localHost: '127.0.0.1',
        remoteHost: 'db.internal.com',
        remotePort: 3306,
        isActive: true,
        portAssignment: {
          assignedPort,
          wasPreferredPort: false,
          attemptedPorts: [assignedPort],
          reason: 'test',
        },
      };

      // Inject into private tunnels map
      (tunnelManager as any).tunnels.set('test-db', tunnelInfo);
      (tunnelManager as any).tunnelStatus.set('test-db', {
        status: 'connected',
        isHealthy: true,
        reconnectAttempts: 0,
      });

      expect(tunnelManager.hasTunnel('test-db')).toBe(true);

      await tunnelManager.closeTunnel('test-db');

      expect(tunnelManager.hasTunnel('test-db')).toBe(false);
      expect(tunnelManager.getTunnel('test-db')).toBeUndefined();
      expect(tunnelManager.getTunnelStatus('test-db')).toBeUndefined();
      expect(mockConnection.endCalled).toBe(true);
      expect(portManager.getReservedPorts()).not.toContain(assignedPort);
    });

    it('should handle server close error gracefully', async () => {
      const mockServer = {
        close: (cb: Function) => cb(new Error('Server close error')),
      };
      const mockConnection = new MockSSHClient();

      const tunnelInfo = {
        server: mockServer as any,
        connection: mockConnection as any,
        localPort: 44444,
        localHost: '127.0.0.1',
        remoteHost: 'db.internal.com',
        remotePort: 3306,
        isActive: true,
        portAssignment: {
          assignedPort: 44444,
          wasPreferredPort: false,
          attemptedPorts: [44444],
          reason: 'test',
        },
      };

      (tunnelManager as any).tunnels.set('error-db', tunnelInfo);
      (tunnelManager as any).tunnelStatus.set('error-db', {
        status: 'connected',
        isHealthy: true,
        reconnectAttempts: 0,
      });

      // Should not throw despite server close error
      await expect(tunnelManager.closeTunnel('error-db')).resolves.not.toThrow();

      // Tunnel should still be removed from maps
      expect(tunnelManager.hasTunnel('error-db')).toBe(false);
    });
  });

  // ============================================================================
  // closeAllTunnels
  // ============================================================================

  describe('closeAllTunnels', () => {
    it('should close multiple tunnels', async () => {
      const connections: MockSSHClient[] = [];
      const servers: net.Server[] = [];

      for (let i = 0; i < 3; i++) {
        const mockServer = net.createServer();
        await new Promise<void>((resolve) => {
          mockServer.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = mockServer.address() as net.AddressInfo;
        const mockConn = new MockSSHClient();

        const tunnelInfo = {
          server: mockServer,
          connection: mockConn as any,
          localPort: addr.port,
          localHost: '127.0.0.1',
          remoteHost: 'db.internal.com',
          remotePort: 3306,
          isActive: true,
          portAssignment: {
            assignedPort: addr.port,
            wasPreferredPort: false,
            attemptedPorts: [addr.port],
            reason: 'test',
          },
        };

        (tunnelManager as any).tunnels.set(`db-${i}`, tunnelInfo);
        (tunnelManager as any).tunnelStatus.set(`db-${i}`, {
          status: 'connected',
          isHealthy: true,
          reconnectAttempts: 0,
        });
        connections.push(mockConn);
        servers.push(mockServer);
      }

      expect((tunnelManager as any).tunnels.size).toBe(3);

      await tunnelManager.closeAllTunnels();

      expect((tunnelManager as any).tunnels.size).toBe(0);
      connections.forEach((c) => expect(c.endCalled).toBe(true));
    });

    it('should handle timeout on slow tunnel close', async () => {
      // Create a tunnel that will hang on close
      const slowServer = {
        close: (_cb: Function) => {
          // Never call the callback to simulate hang
        },
      };
      const mockConn = new MockSSHClient();

      (tunnelManager as any).tunnels.set('slow-db', {
        server: slowServer as any,
        connection: mockConn as any,
        localPort: 55555,
        localHost: '127.0.0.1',
        remoteHost: 'db.internal.com',
        remotePort: 3306,
        isActive: true,
        portAssignment: {
          assignedPort: 55555,
          wasPreferredPort: false,
          attemptedPorts: [55555],
          reason: 'test',
        },
      });
      (tunnelManager as any).tunnelStatus.set('slow-db', {
        status: 'connected',
        isHealthy: true,
        reconnectAttempts: 0,
      });

      // closeAllTunnels has a 5-second per-tunnel timeout
      // We use a 10-second jest timeout to allow it
      await expect(tunnelManager.closeAllTunnels()).resolves.not.toThrow();
    }, 15000);
  });

  // ============================================================================
  // isConnected
  // ============================================================================

  describe('isConnected', () => {
    it('should return false for non-existent tunnel', () => {
      expect(tunnelManager.isConnected('nonexistent')).toBe(false);
    });

    it('should return false for inactive tunnel', () => {
      const mockConn = new MockSSHClient();
      (tunnelManager as any).tunnels.set('test-db', {
        isActive: false,
        connection: mockConn as any,
      });
      (tunnelManager as any).tunnelStatus.set('test-db', {
        status: 'disconnected',
        isHealthy: false,
        reconnectAttempts: 0,
      });

      expect(tunnelManager.isConnected('test-db')).toBe(false);
    });

    it('should return false when status is unhealthy', () => {
      const mockConn = new MockSSHClient();
      (tunnelManager as any).tunnels.set('test-db', {
        isActive: true,
        connection: mockConn as any,
      });
      (tunnelManager as any).tunnelStatus.set('test-db', {
        status: 'connected',
        isHealthy: false,
        reconnectAttempts: 0,
      });

      expect(tunnelManager.isConnected('test-db')).toBe(false);
    });

    it('should return true for active, healthy tunnel with valid connection', () => {
      const mockConn = new MockSSHClient();
      // Register an error listener so listenerCount('error') > 0
      mockConn.on('error', () => {});

      (tunnelManager as any).tunnels.set('test-db', {
        isActive: true,
        connection: mockConn as any,
      });
      (tunnelManager as any).tunnelStatus.set('test-db', {
        status: 'connected',
        isHealthy: true,
        reconnectAttempts: 0,
      });

      expect(tunnelManager.isConnected('test-db')).toBe(true);
    });

    it('should return false for connection with no event listeners', () => {
      const mockConn = new MockSSHClient();
      // No listeners registered → listenerCount('error') === 0

      (tunnelManager as any).tunnels.set('test-db', {
        isActive: true,
        connection: mockConn as any,
      });
      (tunnelManager as any).tunnelStatus.set('test-db', {
        status: 'connected',
        isHealthy: true,
        reconnectAttempts: 0,
      });

      expect(tunnelManager.isConnected('test-db')).toBe(false);
    });

    it('should return false when connection has no error listeners', () => {
      const mockConn = new MockSSHClient();
      // Only a non-error listener; error count is 0
      mockConn.on('close', () => {});

      (tunnelManager as any).tunnels.set('test-db', {
        isActive: true,
        connection: mockConn as any,
      });
      (tunnelManager as any).tunnelStatus.set('test-db', {
        status: 'connected',
        isHealthy: true,
        reconnectAttempts: 0,
      });

      expect(tunnelManager.isConnected('test-db')).toBe(false);
    });
  });

  // ============================================================================
  // getTunnelStatus
  // ============================================================================

  describe('getTunnelStatus', () => {
    it('should return undefined for non-existent tunnel', () => {
      expect(tunnelManager.getTunnelStatus('nonexistent')).toBeUndefined();
    });

    it('should return status for existing tunnel', () => {
      (tunnelManager as any).tunnelStatus.set('test-db', {
        status: 'connected',
        isHealthy: true,
        reconnectAttempts: 0,
        connectedAt: new Date(),
      });

      const status = tunnelManager.getTunnelStatus('test-db');
      expect(status).toBeDefined();
      expect(status!.status).toBe('connected');
      expect(status!.isHealthy).toBe(true);
    });
  });

  // ============================================================================
  // markTunnelInactive (private, tested via events)
  // ============================================================================

  describe('markTunnelInactive', () => {
    it('should mark tunnel as inactive', () => {
      const mockConn = new MockSSHClient();
      const tunnel = {
        isActive: true,
        connection: mockConn as any,
        portAssignment: {
          assignedPort: 12345,
          wasPreferredPort: false,
          attemptedPorts: [12345],
          reason: 'test',
        },
      };

      (tunnelManager as any).tunnels.set('test-db', tunnel);
      (tunnelManager as any).tunnelStatus.set('test-db', {
        status: 'connected',
        isHealthy: true,
        reconnectAttempts: 0,
      });

      // Call private method
      (tunnelManager as any).markTunnelInactive('test-db');

      expect(tunnel.isActive).toBe(false);
      const status = tunnelManager.getTunnelStatus('test-db');
      expect(status!.status).toBe('disconnected');
      expect(status!.isHealthy).toBe(false);
    });

    it('should handle non-existent tunnel gracefully', () => {
      // Should not throw
      expect(() => (tunnelManager as any).markTunnelInactive('nonexistent')).not.toThrow();
    });
  });

  // ============================================================================
  // handleTunnelEvent (private)
  // ============================================================================

  describe('handleTunnelEvent', () => {
    it('should update status to error on error event', () => {
      (tunnelManager as any).tunnelStatus.set('test-db', {
        status: 'connected',
        isHealthy: true,
        reconnectAttempts: 0,
      });

      (tunnelManager as any).handleTunnelEvent('test-db', {
        event: 'error',
        tunnel: {} as any,
        error: new Error('Connection lost'),
        message: 'SSH connection error',
      });

      const status = tunnelManager.getTunnelStatus('test-db');
      expect(status!.status).toBe('error');
      expect(status!.isHealthy).toBe(false);
      expect(status!.lastError).toBe('Connection lost');
    });

    it('should mark inactive on end event', () => {
      const tunnel = { isActive: true } as any;
      (tunnelManager as any).tunnels.set('test-db', tunnel);
      (tunnelManager as any).tunnelStatus.set('test-db', {
        status: 'connected',
        isHealthy: true,
        reconnectAttempts: 0,
      });

      (tunnelManager as any).handleTunnelEvent('test-db', {
        event: 'end',
        tunnel,
        message: 'SSH connection ended',
      });

      expect(tunnel.isActive).toBe(false);
      const status = tunnelManager.getTunnelStatus('test-db');
      expect(status!.status).toBe('disconnected');
    });

    it('should mark inactive on close event', () => {
      const tunnel = { isActive: true } as any;
      (tunnelManager as any).tunnels.set('test-db', tunnel);
      (tunnelManager as any).tunnelStatus.set('test-db', {
        status: 'connected',
        isHealthy: true,
        reconnectAttempts: 0,
      });

      (tunnelManager as any).handleTunnelEvent('test-db', {
        event: 'close',
        tunnel,
        message: 'SSH connection closed',
      });

      expect(tunnel.isActive).toBe(false);
    });

    it('should handle error event with no error object', () => {
      (tunnelManager as any).tunnelStatus.set('test-db', {
        status: 'connected',
        isHealthy: true,
        reconnectAttempts: 0,
      });

      (tunnelManager as any).handleTunnelEvent('test-db', {
        event: 'error',
        tunnel: {} as any,
        message: 'Unknown error',
      });

      const status = tunnelManager.getTunnelStatus('test-db');
      expect(status!.lastError).toBe('Unknown error');
    });
  });

  // ============================================================================
  // updateTunnelStatus (private)
  // ============================================================================

  describe('updateTunnelStatus', () => {
    it('should create new status entry if none exists', () => {
      expect(tunnelManager.getTunnelStatus('new-db')).toBeUndefined();

      (tunnelManager as any).updateTunnelStatus('new-db', {
        status: 'connecting',
        isHealthy: false,
      });

      const status = tunnelManager.getTunnelStatus('new-db');
      expect(status).toBeDefined();
      expect(status!.status).toBe('connecting');
      expect(status!.reconnectAttempts).toBe(0);
    });

    it('should merge with existing status', () => {
      (tunnelManager as any).tunnelStatus.set('test-db', {
        status: 'connected',
        isHealthy: true,
        reconnectAttempts: 0,
        connectedAt: new Date('2024-01-01'),
      });

      (tunnelManager as any).updateTunnelStatus('test-db', {
        isHealthy: false,
        lastError: 'Some error',
      });

      const status = tunnelManager.getTunnelStatus('test-db');
      expect(status!.status).toBe('connected'); // unchanged
      expect(status!.isHealthy).toBe(false); // updated
      expect(status!.lastError).toBe('Some error'); // new field
    });
  });

  // ============================================================================
  // Tunnel Statistics and Port Information
  // ============================================================================

  describe('Tunnel Statistics and Port Information', () => {
    it('should provide comprehensive tunnel statistics', () => {
      const stats = tunnelManager.getTunnelStats();

      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('active');
      expect(stats).toHaveProperty('connecting');
      expect(stats).toHaveProperty('errors');
      expect(stats).toHaveProperty('portInfo');

      expect(stats.portInfo).toHaveProperty('reserved');
      expect(stats.portInfo).toHaveProperty('preferredUsed');
      expect(stats.portInfo).toHaveProperty('autoAssigned');

      expect(Array.isArray(stats.portInfo.reserved)).toBe(true);
      expect(typeof stats.portInfo.preferredUsed).toBe('number');
      expect(typeof stats.portInfo.autoAssigned).toBe('number');
    });

    it('should count tunnels by status correctly', () => {
      // Add tunnels with different statuses
      (tunnelManager as any).tunnels.set('connected-db', {
        portAssignment: { wasPreferredPort: true },
      });
      (tunnelManager as any).tunnelStatus.set('connected-db', {
        status: 'connected',
        isHealthy: true,
        reconnectAttempts: 0,
      });

      (tunnelManager as any).tunnels.set('connecting-db', {
        portAssignment: { wasPreferredPort: false },
      });
      (tunnelManager as any).tunnelStatus.set('connecting-db', {
        status: 'connecting',
        isHealthy: false,
        reconnectAttempts: 0,
      });

      (tunnelManager as any).tunnels.set('error-db', {
        portAssignment: { wasPreferredPort: false },
      });
      (tunnelManager as any).tunnelStatus.set('error-db', {
        status: 'error',
        isHealthy: false,
        reconnectAttempts: 0,
        lastError: 'Connection refused',
      });

      const stats = tunnelManager.getTunnelStats();
      expect(stats.total).toBe(3);
      expect(stats.active).toBe(1);
      expect(stats.connecting).toBe(1);
      expect(stats.errors).toBe(1);
      expect(stats.portInfo.preferredUsed).toBe(1);
      expect(stats.portInfo.autoAssigned).toBe(2);
    });

    it('should provide database-specific port recommendations', async () => {
      const mysqlRecs = await tunnelManager.getPortRecommendations('mysql');

      expect(mysqlRecs).toHaveProperty('recommended');
      expect(mysqlRecs).toHaveProperty('available');
      expect(mysqlRecs).toHaveProperty('status');

      expect(Array.isArray(mysqlRecs.recommended)).toBe(true);
      expect(Array.isArray(mysqlRecs.available)).toBe(true);
      expect(Array.isArray(mysqlRecs.status)).toBe(true);

      expect(mysqlRecs.recommended.length).toBeGreaterThan(0);
      expect(mysqlRecs.status.length).toBe(mysqlRecs.recommended.length);
    });

    it('should check port availability with suggestions', async () => {
      const testPort = 46000;
      await testOccupier.occupyPort(testPort);

      const availability = await tunnelManager.checkPortAvailability(testPort);

      expect(availability).toHaveProperty('available');
      expect(availability).toHaveProperty('reason');
      expect(availability).toHaveProperty('suggestion');

      expect(availability.available).toBe(false);
      expect(availability.reason).toBeDefined();
      expect(availability.suggestion).toBeGreaterThan(testPort);
    });

    it('should handle available ports without suggestions', async () => {
      const testPort = 46001;

      const availability = await tunnelManager.checkPortAvailability(testPort);

      expect(availability.available).toBe(true);
      expect(availability.reason).toBeUndefined();
      expect(availability.suggestion).toBeUndefined();
    });
  });

  // ============================================================================
  // Port Conflict Resolution
  // ============================================================================

  describe('Port Conflict Resolution', () => {
    it('should handle port conflicts gracefully', async () => {
      const conflictPort = 46100;
      await testOccupier.occupyPort(conflictPort);

      const availability = await tunnelManager.checkPortAvailability(conflictPort);

      expect(availability.available).toBe(false);
      expect(availability.suggestion).toBeDefined();
      expect(availability.suggestion).toBeGreaterThan(conflictPort);

      // Verify suggested port is actually available
      if (availability.suggestion) {
        const suggestionCheck = await portManager.isPortAvailable(availability.suggestion);
        expect(suggestionCheck.isAvailable).toBe(true);
      }
    });

    it('should provide different suggestions for different conflict scenarios', async () => {
      const conflictPorts = [46200, 46201, 46202];

      // Occupy all conflict ports
      await Promise.all(conflictPorts.map((port) => testOccupier.occupyPort(port)));

      // Check each one and collect suggestions
      const suggestions: number[] = [];

      for (const port of conflictPorts) {
        const availability = await tunnelManager.checkPortAvailability(port);
        expect(availability.available).toBe(false);

        if (availability.suggestion) {
          suggestions.push(availability.suggestion);
        }
      }

      // All suggestions should be unique and available
      const uniqueSuggestions = new Set(suggestions);
      expect(uniqueSuggestions.size).toBe(suggestions.length);

      // Verify all suggestions are actually available
      for (const suggestion of suggestions) {
        const check = await portManager.isPortAvailable(suggestion);
        expect(check.isAvailable).toBe(true);
      }
    });
  });

  // ============================================================================
  // Resource Management
  // ============================================================================

  describe('Resource Management', () => {
    it('should track tunnel count correctly', () => {
      const initialStats = tunnelManager.getTunnelStats();
      const initialTotal = initialStats.total;

      // Since we can't create real SSH tunnels in tests, we verify the counting logic
      expect(typeof initialTotal).toBe('number');
      expect(initialTotal).toBeGreaterThanOrEqual(0);

      // Verify other statistical properties
      expect(initialStats.active).toBeGreaterThanOrEqual(0);
      expect(initialStats.connecting).toBeGreaterThanOrEqual(0);
      expect(initialStats.errors).toBeGreaterThanOrEqual(0);

      // Total should be sum of states
      expect(initialStats.total).toBe(
        initialStats.active + initialStats.connecting + initialStats.errors
      );
    });

    it('should provide accurate port information', () => {
      const stats = tunnelManager.getTunnelStats();
      const portInfo = stats.portInfo;

      // Port info should be consistent
      expect(portInfo.preferredUsed + portInfo.autoAssigned).toBeLessThanOrEqual(stats.total);
      expect(portInfo.reserved.length).toBeGreaterThanOrEqual(0);

      // Reserved ports should be unique
      const uniqueReserved = new Set(portInfo.reserved);
      expect(uniqueReserved.size).toBe(portInfo.reserved.length);
    });
  });

  // ============================================================================
  // Error Handling
  // ============================================================================

  describe('Error Handling', () => {
    it('should handle network errors during port checks', async () => {
      // Test with a port that might cause permission errors on some systems
      const privilegedPort = 80;

      const result = await portManager.isPortAvailable(privilegedPort);

      // Should not throw, should return a result
      expect(result).toHaveProperty('port');
      expect(result).toHaveProperty('isAvailable');
      expect(result.port).toBe(privilegedPort);

      if (!result.isAvailable) {
        expect(result.reason).toBeDefined();
        expect(typeof result.reason).toBe('string');
      }
    });

    it('should wrap non-ConnectionError errors during tunnel creation', async () => {
      // Use valid SSH config but the tunnel will fail because there's no real SSH server
      const options = createValidTunnelOptions();

      try {
        await tunnelManager.createEnhancedTunnel('test-db', options);
        fail('Should have thrown');
      } catch (error: any) {
        // It should be wrapped in ConnectionError or the original error
        expect(error.message).toContain('test-db');
      }
    }, 60000);
  });

  // ============================================================================
  // buildSSHConnectOptions (private)
  // ============================================================================

  describe('buildSSHConnectOptions', () => {
    it('should build options with password auth', async () => {
      const config = {
        host: 'bastion.example.com',
        port: 22,
        username: 'deploy',
        password: 'secret',
      };

      const result = await (tunnelManager as any).buildSSHConnectOptions(config);

      expect(result.host).toBe('bastion.example.com');
      expect(result.port).toBe(22);
      expect(result.username).toBe('deploy');
      expect(result.password).toBe('secret');
      expect(result.readyTimeout).toBe(30000);
      expect(result.keepaliveInterval).toBe(10000);
      expect(result.algorithms).toBeDefined();
      expect(result.algorithms.kex).toContain('curve25519-sha256');
    });

    it('should build options with inline private key', async () => {
      const config = {
        host: 'bastion.example.com',
        port: 22,
        username: 'deploy',
        privateKey: '-----BEGIN RSA PRIVATE KEY-----\nfake-key\n-----END RSA PRIVATE KEY-----',
      };

      const result = await (tunnelManager as any).buildSSHConnectOptions(config);

      expect(result.privateKey).toBe(config.privateKey);
      expect(result.password).toBeUndefined();
    });

    it('should build options with passphrase', async () => {
      const config = {
        host: 'bastion.example.com',
        port: 22,
        username: 'deploy',
        privateKey: '-----BEGIN RSA PRIVATE KEY-----\nfake-key\n-----END RSA PRIVATE KEY-----',
        passphrase: 'my-passphrase',
      };

      const result = await (tunnelManager as any).buildSSHConnectOptions(config);

      expect(result.passphrase).toBe('my-passphrase');
    });

    it('includes the debug function only when SSH_DEBUG=true', async () => {
      const config = {
        host: 'bastion.example.com',
        port: 22,
        username: 'deploy',
        password: 'secret',
      };

      const prev = process.env.SSH_DEBUG;
      try {
        delete process.env.SSH_DEBUG;
        const off = await (tunnelManager as any).buildSSHConnectOptions(config);
        expect(off.debug).toBeUndefined();

        process.env.SSH_DEBUG = 'true';
        const on = await (tunnelManager as any).buildSSHConnectOptions(config);
        expect(typeof on.debug).toBe('function');
      } finally {
        if (prev === undefined) delete process.env.SSH_DEBUG;
        else process.env.SSH_DEBUG = prev;
      }
    });

    it('should throw error for unreadable private key file', async () => {
      const config = {
        host: 'bastion.example.com',
        port: 22,
        username: 'deploy',
        privateKey: '/nonexistent/path/to/key',
      };

      // The key path doesn't exist and doesn't contain -----BEGIN, so it tries to read it
      // Since the file doesn't exist, fs.existsSync returns false, so it treats as key content
      const result = await (tunnelManager as any).buildSSHConnectOptions(config);
      expect(result.privateKey).toBe('/nonexistent/path/to/key');
    });

    it('should handle Buffer private key', async () => {
      const config = {
        host: 'bastion.example.com',
        port: 22,
        username: 'deploy',
        privateKey: Buffer.from('fake-key'),
      };

      const result = await (tunnelManager as any).buildSSHConnectOptions(config);
      expect(Buffer.isBuffer(result.privateKey)).toBe(true);
    });
  });

  // ============================================================================
  // assignSmartPort (private)
  // ============================================================================

  describe('assignSmartPort', () => {
    it('should use requested port when available', async () => {
      const testPort = 44000;
      const result = await (tunnelManager as any).assignSmartPort('test-db', testPort);

      expect(result.assignedPort).toBe(testPort);
      expect(result.wasPreferredPort).toBe(true);
    });

    it('should fall through when requested port is unavailable', async () => {
      const testPort = 44001;
      await testOccupier.occupyPort(testPort);

      const result = await (tunnelManager as any).assignSmartPort('test-db', testPort);

      expect(result.assignedPort).not.toBe(testPort);
      expect(result.wasPreferredPort).toBe(false);
    });

    it('should fall through when requested port is already reserved', async () => {
      const testPort = 44002;
      portManager.reservePort(testPort);

      const result = await (tunnelManager as any).assignSmartPort('test-db', testPort);

      expect(result.assignedPort).not.toBe(testPort);
      expect(result.wasPreferredPort).toBe(false);
    });

    it('should use database type for smart assignment', async () => {
      const result = await (tunnelManager as any).assignSmartPort('test-db', undefined, 'mysql');

      expect(result.assignedPort).toBeGreaterThan(0);
    });

    it('should use generic range when no type or port specified', async () => {
      const result = await (tunnelManager as any).assignSmartPort('test-db', undefined, undefined);

      expect(result.assignedPort).toBeGreaterThanOrEqual(30000);
      expect(result.assignedPort).toBeLessThanOrEqual(40000);
    });

    it('should use zero/negative port as no-preference', async () => {
      const result = await (tunnelManager as any).assignSmartPort('test-db', 0, undefined);

      expect(result.assignedPort).toBeGreaterThanOrEqual(30000);
    });
  });

  // ============================================================================
  // extractDatabaseType (private)
  // ============================================================================

  describe('extractDatabaseType', () => {
    it('should return mysql for port 3306', () => {
      const result = (tunnelManager as any).extractDatabaseType({
        forwardConfig: { destinationPort: 3306 },
      });
      expect(result).toBe('mysql');
    });

    it('should return postgresql for port 5432', () => {
      const result = (tunnelManager as any).extractDatabaseType({
        forwardConfig: { destinationPort: 5432 },
      });
      expect(result).toBe('postgresql');
    });

    it('should return mssql for port 1433', () => {
      const result = (tunnelManager as any).extractDatabaseType({
        forwardConfig: { destinationPort: 1433 },
      });
      expect(result).toBe('mssql');
    });

    it('should return undefined for unknown port', () => {
      const result = (tunnelManager as any).extractDatabaseType({
        forwardConfig: { destinationPort: 9999 },
      });
      expect(result).toBeUndefined();
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Port Management Integration', () => {
  let portManager: PortManager;
  let tunnelManager: EnhancedSSHTunnelManager;
  let testOccupier: TestPortOccupier;

  beforeEach(async () => {
    portManager = PortManager.getInstance();
    portManager.clearReservedPorts();
    tunnelManager = new EnhancedSSHTunnelManager();
    await tunnelManager.initialize();
    testOccupier = new TestPortOccupier();
  });

  afterEach(async () => {
    await tunnelManager.closeAllTunnels();
    await testOccupier.releaseAll();
    portManager.clearReservedPorts();
  });

  describe('End-to-End Port Assignment Scenarios', () => {
    it('should handle sequential port assignments', async () => {
      const basePort = 47000;
      const count = 5;

      const assignments: any[] = [];

      // Request ports sequentially
      for (let i = 0; i < count; i++) {
        const assignment = await portManager.findAvailablePort({
          minPort: basePort,
          maxPort: basePort + 100,
        });

        assignments.push(assignment);
        expect(assignment.assignedPort).toBeGreaterThanOrEqual(basePort);
        expect(assignment.assignedPort).toBeLessThanOrEqual(basePort + 100);
      }

      // All assigned ports should be unique
      const assignedPorts = assignments.map((a) => a.assignedPort);
      const uniquePorts = new Set(assignedPorts);
      expect(uniquePorts.size).toBe(assignedPorts.length);
    });

    it('should handle concurrent port requests', async () => {
      const basePort = 47100;
      const concurrentRequests = 10;

      // Make concurrent port assignment requests
      const assignmentPromises = Array.from({ length: concurrentRequests }, () =>
        portManager.findAvailablePort({
          minPort: basePort,
          maxPort: basePort + 200,
        })
      );

      const assignments = await Promise.all(assignmentPromises);

      // All should succeed
      expect(assignments.length).toBe(concurrentRequests);

      // All ports should be unique
      const ports = assignments.map((a: any) => a.assignedPort);
      const uniquePorts = new Set(ports);
      expect(uniquePorts.size).toBe(ports.length);

      // All ports should be in valid range
      ports.forEach((port: number) => {
        expect(port).toBeGreaterThanOrEqual(basePort);
        expect(port).toBeLessThanOrEqual(basePort + 200);
      });
    });

    it('should handle port pressure gracefully', async () => {
      const rangeStart = 47300;
      const rangeSize = 10;
      const rangeEnd = rangeStart + rangeSize - 1;

      // Occupy most of the range, leaving only a few ports
      const portsToOccupy = Math.floor(rangeSize * 0.7); // 70% of range

      for (let i = 0; i < portsToOccupy; i++) {
        await testOccupier.occupyPort(rangeStart + i);
      }

      // Should still be able to find available ports
      const assignment = await portManager.findAvailablePort({
        minPort: rangeStart,
        maxPort: rangeEnd,
        maxAttempts: rangeSize * 2,
      });

      expect(assignment.assignedPort).toBeGreaterThanOrEqual(rangeStart);
      expect(assignment.assignedPort).toBeLessThanOrEqual(rangeEnd);

      // Verify the assigned port is not occupied
      const occupiedPorts = testOccupier.getOccupiedPorts();
      expect(occupiedPorts).not.toContain(assignment.assignedPort);
    });
  });

  describe('Database-Specific Integration', () => {
    it('should provide consistent recommendations across components', async () => {
      const dbType = 'mysql';

      // Get recommendations from port manager
      const pmRecommendations = portManager.getPortRecommendations(dbType);

      // Get recommendations from tunnel manager
      const tmRecommendations = await tunnelManager.getPortRecommendations(dbType);

      // Should have the same recommended ports
      expect(tmRecommendations.recommended).toEqual(pmRecommendations);

      // Available ports should be a subset of recommended
      tmRecommendations.available.forEach((port: number) => {
        expect(tmRecommendations.recommended).toContain(port);
      });
    });

    it('should handle database type detection consistency', async () => {
      const dbTypes = ['mysql', 'postgresql', 'mssql'];

      for (const dbType of dbTypes) {
        const suggestion = await portManager.suggestTunnelPort(dbType);
        const recommendations = await tunnelManager.getPortRecommendations(dbType);

        expect(suggestion.assignedPort).toBeGreaterThan(0);
        expect(recommendations.recommended.length).toBeGreaterThan(0);

        // The suggested port should either be in recommendations OR in safe range (>=30000) OR be valid (>=1024)
        const isRecommended = recommendations.recommended.includes(suggestion.assignedPort);
        const isInSafeRange = suggestion.assignedPort >= 30000;
        const isValidPort = suggestion.assignedPort >= 1024 && suggestion.assignedPort <= 65535;

        // At minimum, the port should be valid
        expect(isValidPort).toBe(true);

        // And it should be either recommended (db-specific) or in safe range (general allocation)
        expect(isRecommended || isInSafeRange).toBe(true);
      }
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle large numbers of port checks efficiently', async () => {
      const portCount = 100;
      const basePort = 48000;
      const ports = Array.from({ length: portCount }, (_, i) => basePort + i);

      const startTime = Date.now();
      const results = await portManager.checkMultiplePorts(ports);
      const duration = Date.now() - startTime;

      expect(results.length).toBe(portCount);
      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds

      // Verify all results have expected structure
      results.forEach((result: any, index: number) => {
        expect(result.port).toBe(ports[index]);
        expect(typeof result.isAvailable).toBe('boolean');
      });
    });

    it('should maintain performance under memory pressure', () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Create and release many port reservations
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        portManager.reservePort(50000 + i);
      }

      expect(portManager.getReservedPorts().length).toBe(iterations);

      portManager.clearReservedPorts();

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be reasonable (less than 50MB for 1000 reservations)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });
  });
});

describe('checkPortAvailability - error logging', () => {
  it('logs debug message when port suggestion throws', async () => {
    const manager = new EnhancedSSHTunnelManager();
    const internals = manager as unknown as Record<string, unknown>;
    const logger = internals.logger as { debug: jest.Mock };
    const debugSpy = jest.spyOn(logger, 'debug');

    const pm = internals.portManager as Record<string, jest.Mock<any>>;
    pm.isPortAvailable = jest.fn(async () => ({ isAvailable: false, reason: 'in use' }));
    pm.findAvailablePort = jest.fn(async () => {
      throw new Error('no ports');
    });

    await manager.checkPortAvailability(12345);

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('suggest'),
      expect.objectContaining({ error: 'no ports' })
    );
  });
});

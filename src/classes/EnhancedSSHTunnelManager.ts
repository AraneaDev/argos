/**
 * Enhanced SSH Tunnel Manager with intelligent port management
 */

import { Client as SSHClient, type ConnectConfig } from 'ssh2';
import { createHash } from 'crypto';
import * as net from 'net';
import * as fs from 'fs';
import { stat } from 'node:fs/promises';
import { EventEmitter } from 'events';
import type {
  SSHTunnelInfo,
  SSHTunnelCreateOptions,
  SSHConnectionConfig,
  SSHTunnelStatus,
  SSHTunnelStatusInfo,
  ISSHTunnelManager,
  SSHEventPayload,
} from '../types/index.js';
import { ConnectionError } from '../utils/error-handler.js';
import { validateSSHConfig } from '../types/index.js';
import { getLogger } from '../utils/logger.js';
import { ConfigurationError } from '../utils/error-handler.js';
import { PortManager, type PortAssignmentResult } from '../utils/port-manager.js';

// ============================================================================
// SSH Key Permission Check
// ============================================================================

async function checkKeyFilePermissions(keyPath: string): Promise<void> {
  const s = await stat(keyPath);
  const mode = s.mode & 0o777;
  if (mode & 0o077) {
    throw new ConfigurationError(
      `SSH private key '${keyPath}' has group or other permissions (mode ${mode.toString(8)}). Fix with: chmod 600 <keyfile>`
    );
  }
}

// ============================================================================
// Enhanced SSH Tunnel Types
// ============================================================================

export interface EnhancedTunnelInfo extends SSHTunnelInfo {
  portAssignment: PortAssignmentResult;
  databaseType?: string;
  originalRequestedPort?: number;
}

export interface TunnelCreationResult {
  tunnel: EnhancedTunnelInfo;
  portInfo: {
    requested: number | undefined;
    assigned: number;
    wasPreferred: boolean;
    reason: string;
  };
}

// ============================================================================
// Enhanced SSH Tunnel Manager Implementation
// ============================================================================

/**
 *
 */
export class EnhancedSSHTunnelManager extends EventEmitter implements ISSHTunnelManager {
  private tunnels = new Map<string, EnhancedTunnelInfo>();
  private tunnelStatus = new Map<string, SSHTunnelStatusInfo>();
  private portManager: PortManager;
  private logger = getLogger();

  constructor() {
    super();
    this.portManager = PortManager.getInstance();
    // Cleanup is handled centrally by gracefulShutdown() in index.ts
    // via SQLMCPServer.cleanup() -> sshTunnelManager.closeAllTunnels()
  }

  /**
   * Initialize the SSH tunnel manager
   */
  async initialize(): Promise<void> {
    this.logger.info('Enhanced SSH tunnel manager initialized');
  }

  /**
   * Check if a tunnel exists for the given database
   */
  hasTunnel(dbName: string): boolean {
    return this.tunnels.has(dbName);
  }

  // ============================================================================
  // Enhanced Public Interface Methods
  // ============================================================================

  /**
   * Create a new SSH tunnel with intelligent port assignment
   */
  async createTunnel(dbName: string, options: SSHTunnelCreateOptions): Promise<SSHTunnelInfo> {
    const result = await this.createEnhancedTunnel(dbName, options);
    return result.tunnel;
  }

  /**
   * Create a new SSH tunnel with detailed port information
   */
  async createEnhancedTunnel(
    dbName: string,
    options: SSHTunnelCreateOptions
  ): Promise<TunnelCreationResult> {
    try {
      // Validate SSH configuration
      const validation = validateSSHConfig(options.sshConfig);
      if (!validation.isValid) {
        throw new ConnectionError(
          `Invalid SSH configuration for '${dbName}': ${validation.errors.join(', ')}`,
          { database: dbName, errors: validation.errors }
        );
      }

      if (validation.warnings.length > 0) {
        this.logger.warning(`SSH configuration warnings for '${dbName}'`, {
          warnings: validation.warnings,
        });
      }

      // Extract database type from options or config if available
      const databaseType = this.extractDatabaseType(options);
      const originalRequestedPort = options.localPort;

      this.logger.info(`Creating enhanced SSH tunnel for '${dbName}'`, {
        sshHost: options.sshConfig.host,
        sshPort: options.sshConfig.port,
        destinationHost: options.forwardConfig.destinationHost,
        destinationPort: options.forwardConfig.destinationPort,
        requestedLocalPort: originalRequestedPort,
        databaseType,
      });

      // Close existing tunnel if it exists
      if (this.tunnels.has(dbName)) {
        await this.closeTunnel(dbName);
      }

      // Update status to connecting
      this.updateTunnelStatus(dbName, {
        status: 'connecting',
        reconnectAttempts: 0,
        isHealthy: false,
      });

      // Smart port assignment
      const portAssignment = await this.assignSmartPort(dbName, options.localPort, databaseType);

      this.logger.info(`Port assignment for '${dbName}'`, {
        requested: originalRequestedPort,
        assigned: portAssignment.assignedPort,
        wasPreferred: portAssignment.wasPreferredPort,
        reason: portAssignment.reason,
      });

      // Create enhanced tunnel options with assigned port
      const enhancedOptions: SSHTunnelCreateOptions = {
        ...options,
        localPort: portAssignment.assignedPort,
      };

      const tunnelInfo = await this.establishTunnel(
        dbName,
        enhancedOptions,
        portAssignment,
        databaseType
      );

      // Update status to connected
      this.updateTunnelStatus(dbName, {
        status: 'connected',
        connectedAt: new Date(),
        reconnectAttempts: 0,
        isHealthy: true,
      });

      this.logger.info(`Enhanced SSH tunnel established for '${dbName}'`, {
        localHost: tunnelInfo.localHost,
        localPort: tunnelInfo.localPort,
        remoteHost: tunnelInfo.remoteHost,
        remotePort: tunnelInfo.remotePort,
        portWasPreferred: portAssignment.wasPreferredPort,
      });

      return {
        tunnel: tunnelInfo,
        portInfo: {
          requested: originalRequestedPort,
          assigned: portAssignment.assignedPort,
          wasPreferred: portAssignment.wasPreferredPort,
          reason: portAssignment.reason || 'Port assigned automatically',
        },
      };
    } catch (error) {
      this.updateTunnelStatus(dbName, {
        status: 'error',
        lastError: (error as Error).message,
        reconnectAttempts: 0,
        isHealthy: false,
      });

      if (error instanceof ConnectionError) {
        throw error;
      }

      throw new ConnectionError(
        `Failed to create enhanced SSH tunnel for '${dbName}': ${(error as Error).message}`,
        { database: dbName, originalError: (error as Error).message }
      );
    }
  }

  /**
   * Get existing tunnel information
   */
  getTunnel(dbName: string): SSHTunnelInfo | undefined {
    return this.tunnels.get(dbName);
  }

  /**
   * Get enhanced tunnel information with port details
   */
  getEnhancedTunnel(dbName: string): EnhancedTunnelInfo | undefined {
    return this.tunnels.get(dbName);
  }

  /**
   * Close a specific SSH tunnel with proper port cleanup
   */
  async closeTunnel(dbName: string): Promise<void> {
    const tunnel = this.tunnels.get(dbName);

    if (!tunnel) {
      return; // Tunnel doesn't exist, nothing to close
    }

    this.logger.info(`Closing enhanced SSH tunnel for '${dbName}'`);

    try {
      // Release the port back to the pool
      if (tunnel.localPort) {
        this.portManager.releasePort(tunnel.localPort);
      }

      // Close the local server
      if (tunnel.server) {
        await new Promise<void>((resolve, reject) => {
          tunnel.server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      }

      // Close the SSH connection
      if (tunnel.connection) {
        tunnel.connection.end();
      }

      // Update tunnel status
      this.updateTunnelStatus(dbName, {
        status: 'disconnected',
        reconnectAttempts: 0,
        isHealthy: false,
      });

      this.logger.info(
        `Enhanced SSH tunnel closed for '${dbName}', port ${tunnel.localPort} released`
      );
    } catch (error) {
      this.logger.error(`Error closing enhanced SSH tunnel for '${dbName}'`, error as Error);
    } finally {
      // Always remove from maps
      this.tunnels.delete(dbName);
      this.tunnelStatus.delete(dbName);
    }
  }

  /**
   * Close all SSH tunnels
   */
  async closeAllTunnels(): Promise<void> {
    const dbNames = Array.from(this.tunnels.keys());

    if (dbNames.length === 0) {
      return;
    }

    this.logger.info(`Closing ${dbNames.length} enhanced SSH tunnels`);

    const PER_TUNNEL_TIMEOUT = 5000;
    const results = await Promise.allSettled(
      dbNames.map((dbName) =>
        Promise.race([
          this.closeTunnel(dbName),
          new Promise<void>((_, reject) => {
            const timer = setTimeout(
              () => reject(new Error(`Timeout closing tunnel '${dbName}'`)),
              PER_TUNNEL_TIMEOUT
            );
            timer.unref();
          }),
        ])
      )
    );

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        this.logger.error(
          `Error closing enhanced SSH tunnel for '${dbNames[i]}'`,
          (results[i] as PromiseRejectedResult).reason
        );
      }
    }

    this.logger.info('All enhanced SSH tunnels closed');
  }

  /**
   * Check if a tunnel is connected
   */
  isConnected(dbName: string): boolean {
    const tunnel = this.tunnels.get(dbName);
    const status = this.tunnelStatus.get(dbName);

    // Quick health check - return false if tunnel/status doesn't exist or is marked unhealthy
    if (!tunnel || !tunnel.isActive || !status || !status.isHealthy) {
      return false;
    }

    // Additional validation - check if SSH connection is still readable/writable
    // Check if SSH connection is still active using the public EventEmitter API.
    // If listenerCount > 0 the client has active event handlers → it's alive.
    try {
      return !!(tunnel.connection && tunnel.connection.listenerCount('error') > 0);
    } catch (error) {
      this.logger.debug(`Connection health check error for '${dbName}'`, {
        error: (error as Error).message,
      });
      return false;
    }
  }

  // ============================================================================
  // Enhanced Status and Information Methods
  // ============================================================================

  /**
   * Get tunnel status information
   */
  getTunnelStatus(dbName: string): SSHTunnelStatusInfo | undefined {
    return this.tunnelStatus.get(dbName);
  }

  /**
   * Get all active tunnels
   */
  getActiveTunnels(): string[] {
    return Array.from(this.tunnels.keys()).filter((dbName) => this.isConnected(dbName));
  }

  /**
   * Get tunnel statistics including port information
   */
  getTunnelStats(): {
    total: number;
    active: number;
    connecting: number;
    errors: number;
    portInfo: {
      reserved: number[];
      preferredUsed: number;
      autoAssigned: number;
    };
  } {
    const statuses = Array.from(this.tunnelStatus.values());
    const tunnels = Array.from(this.tunnels.values());

    const preferredUsed = tunnels.filter((t) => t.portAssignment.wasPreferredPort).length;
    const autoAssigned = tunnels.length - preferredUsed;

    return {
      total: statuses.length,
      active: statuses.filter((s) => s.status === 'connected' && s.isHealthy).length,
      connecting: statuses.filter((s) => s.status === 'connecting').length,
      errors: statuses.filter((s) => s.status === 'error').length,
      portInfo: {
        reserved: this.portManager.getReservedPorts(),
        preferredUsed,
        autoAssigned,
      },
    };
  }

  /**
   * Get port recommendations for a database type
   */
  async getPortRecommendations(databaseType: string): Promise<{
    recommended: number[];
    available: number[];
    status: Array<{ port: number; available: boolean; reason?: string }>;
  }> {
    const recommended = this.portManager.getPortRecommendations(databaseType, false); // Don't exclude used ports
    const statusChecks = await this.portManager.checkMultiplePorts(recommended);
    const available = statusChecks.filter((s) => s.isAvailable).map((s) => s.port);

    // Convert PortCheckResult to expected format
    const status = statusChecks.map((check) => ({
      port: check.port,
      available: check.isAvailable,
      reason: check.reason,
    }));

    return {
      recommended,
      available,
      status,
    };
  }

  /**
   * Check port availability
   */
  async checkPortAvailability(port: number): Promise<{
    available: boolean;
    reason?: string;
    suggestion?: number;
  }> {
    const result = await this.portManager.isPortAvailable(port);
    const response: { available: boolean; reason?: string; suggestion?: number } = {
      available: result.isAvailable,
      reason: result.reason,
    };

    if (!result.isAvailable) {
      // Try to suggest an alternative
      try {
        const suggestion = await this.portManager.findAvailablePort({
          minPort: Math.max(port, 30000),
          maxPort: port + 1000,
          maxAttempts: 5,
        });
        response.suggestion = suggestion.assignedPort;
      } catch (err) {
        this.logger.debug('Could not suggest alternative port', {
          port,
          error: (err as Error).message,
        });
      }
    }

    return response;
  }

  // ============================================================================
  // Private Enhanced Implementation Methods
  // ============================================================================

  private async assignSmartPort(
    dbName: string,
    requestedPort: number | undefined,
    databaseType?: string
  ): Promise<PortAssignmentResult> {
    if (requestedPort && requestedPort > 0) {
      // User specified a port, check if it's available
      const availability = await this.portManager.isPortAvailable(requestedPort);

      if (
        availability.isAvailable &&
        !this.portManager.getReservedPorts().includes(requestedPort)
      ) {
        // Preferred port is available, reserve and use it
        this.portManager.reservePort(requestedPort);
        return {
          assignedPort: requestedPort,
          wasPreferredPort: true,
          attemptedPorts: [requestedPort],
          reason: 'User-specified port was available',
        };
      } else {
        // Preferred port not available, log warning and fall through to smart assignment
        this.logger.warning(
          `Requested port ${requestedPort} for '${dbName}' is not available: ${availability.reason}. Finding alternative...`
        );
      }
    }

    // Smart port assignment
    if (databaseType) {
      return await this.portManager.suggestTunnelPort(databaseType, requestedPort);
    } else {
      return await this.portManager.findAvailablePort({
        preferredPort: requestedPort,
        minPort: 30000,
        maxPort: 40000,
        maxAttempts: 20,
      });
    }
  }

  private extractDatabaseType(options: SSHTunnelCreateOptions): string | undefined {
    // Try to extract database type from destination port
    const destPort = options.forwardConfig.destinationPort;

    switch (destPort) {
      case 3306:
        return 'mysql';
      case 5432:
        return 'postgresql';
      case 1433:
        return 'mssql';
      default:
        return undefined;
    }
  }

  private async establishTunnel(
    dbName: string,
    options: SSHTunnelCreateOptions,
    portAssignment: PortAssignmentResult,
    databaseType?: string
  ): Promise<EnhancedTunnelInfo> {
    const TUNNEL_TIMEOUT = 45000; // 45 second overall timeout

    // Build (and permission-check) SSH connect options before entering the Promise executor
    const connectOptions = await this.buildSSHConnectOptions(options.sshConfig);

    return new Promise<EnhancedTunnelInfo>((resolve, reject) => {
      const sshClient = new SSHClient();
      let server: net.Server;
      let assignedPort: number;
      let settled = false;

      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          sshClient.end();
          if (portAssignment.assignedPort) {
            this.portManager.releasePort(portAssignment.assignedPort);
          }
          reject(
            new Error(
              `SSH tunnel creation timed out after ${TUNNEL_TIMEOUT / 1000}s for '${dbName}'`
            )
          );
        }
      }, TUNNEL_TIMEOUT);

      const safeResolve = (value: EnhancedTunnelInfo) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          resolve(value);
        }
      };

      const safeReject = (error: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          reject(error);
        }
      };

      // Set up SSH client event handlers
      sshClient.on('ready', () => {
        this.logger.debug(`SSH connection established for '${dbName}'`);

        // Create server to listen for local connections
        server = net.createServer((clientSocket) => {
          this.logger.debug(`Local connection received for tunnel '${dbName}', creating forward`);

          sshClient.forwardOut(
            options.forwardConfig.sourceHost,
            options.forwardConfig.sourcePort,
            options.forwardConfig.destinationHost,
            options.forwardConfig.destinationPort,
            (err, sshStream) => {
              if (err) {
                this.logger.error(`SSH forward error for '${dbName}'`, err);
                clientSocket.end();
                return;
              }

              // Pipe data between client and SSH stream
              clientSocket.pipe(sshStream);
              sshStream.pipe(clientSocket);

              // Handle stream events
              sshStream.on('close', () => {
                clientSocket.end();
              });

              sshStream.on('error', (streamError: Error) => {
                this.logger.error(`SSH stream error for '${dbName}'`, streamError);
                clientSocket.end();
              });

              clientSocket.on('close', () => {
                sshStream.close();
              });

              clientSocket.on('error', (clientError) => {
                this.logger.error(`Client socket error for '${dbName}'`, clientError);
                sshStream.close();
              });
            }
          );
        });

        // Listen on the assigned port
        const localPort = options.localPort || 0;
        const bindAddress = options.localHost ?? '127.0.0.1';
        if (bindAddress !== '127.0.0.1' && bindAddress !== 'localhost' && bindAddress !== '::1') {
          this.logger.warning(
            `SSH tunnel for '${dbName}' is binding to non-loopback address ${bindAddress}. ` +
              `This exposes the unauthenticated tunnel entrance to the network; use 127.0.0.1 unless intentional.`
          );
        }
        server.listen(localPort, bindAddress, () => {
          const address = server.address();
          assignedPort = typeof address === 'object' && address ? address.port : localPort;

          this.logger.debug(
            `Enhanced SSH tunnel server listening on port ${assignedPort} for '${dbName}'`
          );

          const enhancedTunnelInfo: EnhancedTunnelInfo = {
            server,
            connection: sshClient,
            localPort: assignedPort,
            localHost: bindAddress,
            remoteHost: options.forwardConfig.destinationHost,
            remotePort: options.forwardConfig.destinationPort,
            isActive: true,
            portAssignment,
            databaseType,
            originalRequestedPort: options.localPort,
          };

          // Store tunnel info
          this.tunnels.set(dbName, enhancedTunnelInfo);

          // Set up tunnel monitoring
          this.setupTunnelMonitoring(dbName, enhancedTunnelInfo);

          safeResolve(enhancedTunnelInfo);
        });

        server.on('error', (serverError) => {
          this.logger.error(`Enhanced SSH tunnel server error for '${dbName}'`, serverError);

          // Release the reserved port on server error
          if (portAssignment.assignedPort) {
            this.portManager.releasePort(portAssignment.assignedPort);
          }

          safeReject(new Error(`SSH tunnel server failed: ${serverError.message}`));
        });
      });

      sshClient.on('error', (sshError) => {
        this.logger.error(`SSH client error for '${dbName}'`, sshError);

        // Release the reserved port on connection error
        if (portAssignment.assignedPort) {
          this.portManager.releasePort(portAssignment.assignedPort);
        }

        safeReject(new Error(`SSH connection failed: ${sshError.message}`));
      });

      sshClient.on('end', () => {
        this.logger.warning(`SSH connection ended for '${dbName}'`);
        this.markTunnelInactive(dbName);
      });

      (sshClient as unknown as NodeJS.EventEmitter).on('close', (_hadError: boolean) => {
        this.logger.info(`SSH connection closed for '${dbName}'`, { hadError: _hadError });
        this.markTunnelInactive(dbName);
      });

      // Connect to SSH server
      this.logger.debug(`Connecting to SSH server for '${dbName}'`, {
        host: connectOptions.host,
        port: connectOptions.port,
        username: connectOptions.username,
        authMethod: connectOptions.password ? 'password' : 'key',
      });

      sshClient.connect(connectOptions);
    });
  }

  private async buildSSHConnectOptions(config: SSHConnectionConfig): Promise<ConnectConfig> {
    const connectOptions: ConnectConfig = {
      host: config.host,
      port: config.port,
      username: config.username,
      readyTimeout: 30000,
      keepaliveInterval: 10000, // Send keepalive every 10 seconds
      keepaliveCountMax: 3, // Max 3 failed keepalives before disconnect
      algorithms: {
        kex: [
          'curve25519-sha256',
          'curve25519-sha256@libssh.org',
          'ecdh-sha2-nistp256',
          'ecdh-sha2-nistp384',
          'ecdh-sha2-nistp521',
          'diffie-hellman-group14-sha256',
          'diffie-hellman-group16-sha512',
        ],
        cipher: [
          'aes128-gcm',
          'aes128-gcm@openssh.com',
          'aes256-gcm',
          'aes256-gcm@openssh.com',
          'aes128-ctr',
          'aes192-ctr',
          'aes256-ctr',
        ],
        // SHA-1 HMACs dropped — they are downgrade-attack fodder and no longer needed.
        hmac: ['hmac-sha2-256', 'hmac-sha2-512'],
      },
    };

    // Verify the remote host key. Without a hostVerifier, ssh2 accepts ANY host key,
    // leaving the tunnel open to a man-in-the-middle. Fail secure by default.
    connectOptions.hostVerifier = (key: Buffer): boolean => {
      const sha256Hex = createHash('sha256').update(key).digest('hex');
      const sha256B64 = createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
      const openssh = `SHA256:${sha256B64}`;

      const pinned = config.hostFingerprint?.trim();
      if (pinned) {
        const norm = (s: string) =>
          s
            .trim()
            .replace(/^SHA256:/i, '')
            .replace(/[:=]/g, '')
            .toLowerCase();
        const candidates = [openssh, sha256B64, sha256Hex].map(norm);
        if (candidates.includes(norm(pinned))) {
          return true;
        }
        this.logger.error(
          `SSH host key for '${config.host}' does NOT match the pinned ssh_host_fingerprint. ` +
            `Presented key: ${openssh}. Rejecting connection (possible MITM).`
        );
        return false;
      }

      // No fingerprint pinned. Strict checking (the default) refuses to proceed.
      if (config.strictHostKeyChecking === false) {
        this.logger.warning(
          `SSH host key verification is DISABLED for '${config.host}' ` +
            `(ssh_strict_host_key_checking=false). Accepting host key ${openssh} without verification — INSECURE.`
        );
        return true;
      }

      this.logger.error(
        `SSH host key for '${config.host}' is not verified. ` +
          `After confirming it out-of-band, set ssh_host_fingerprint=${openssh}, ` +
          `or set ssh_strict_host_key_checking=false to disable verification (insecure). Rejecting connection.`
      );
      return false;
    };

    // Connection debugging — opt-in only. The ssh2 handshake trace (usernames,
    // host-key fingerprints, algorithm negotiation) is verbose and must not be
    // written to the log at the default level. Enable with SSH_DEBUG=true.
    if (process.env.SSH_DEBUG === 'true') {
      connectOptions.debug = (message: string) => {
        this.logger.debug(`SSH Debug: ${message}`);
      };
    }

    if (config.password) {
      connectOptions.password = config.password;
    } else if (config.privateKey) {
      try {
        if (typeof config.privateKey === 'string') {
          // Check if it's a file path or the key content
          if (config.privateKey.includes('-----BEGIN') || !fs.existsSync(config.privateKey)) {
            // It's the key content
            connectOptions.privateKey = config.privateKey;
          } else {
            // It's a file path
            await checkKeyFilePermissions(config.privateKey as string);
            connectOptions.privateKey = fs.readFileSync(config.privateKey);
          }
        } else {
          connectOptions.privateKey = config.privateKey;
        }

        if (config.passphrase) {
          connectOptions.passphrase = config.passphrase;
        }
      } catch (error) {
        throw new Error(`Failed to read SSH private key: ${(error as Error).message}`, {
          cause: error,
        });
      }
    }

    return connectOptions;
  }

  private setupTunnelMonitoring(dbName: string, tunnel: EnhancedTunnelInfo): void {
    // Set up connection monitoring
    tunnel.connection.on('error', (error) => {
      this.handleTunnelEvent(dbName, {
        event: 'error',
        tunnel,
        error,
        message: `SSH connection error: ${error.message}`,
      });
    });

    tunnel.connection.on('end', () => {
      this.handleTunnelEvent(dbName, {
        event: 'end',
        tunnel,
        message: 'SSH connection ended',
      });
    });

    (tunnel.connection as unknown as NodeJS.EventEmitter).on('close', (_hadError: boolean) => {
      this.handleTunnelEvent(dbName, {
        event: 'close',
        tunnel,
        message: 'SSH connection closed',
      });
    });

    // Monitor server events
    tunnel.server.on('error', (error) => {
      this.logger.error(`Enhanced SSH tunnel server error for '${dbName}'`, error);
      this.updateTunnelStatus(dbName, {
        status: 'error',
        lastError: error.message,
        isHealthy: false,
      });
    });

    tunnel.server.on('close', () => {
      this.logger.info(`Enhanced SSH tunnel server closed for '${dbName}'`);
      this.markTunnelInactive(dbName);
    });
  }

  private handleTunnelEvent(dbName: string, event: SSHEventPayload): void {
    this.logger.info(`Enhanced SSH tunnel event for '${dbName}': ${event.event}`, {
      message: event.message,
      error: event.error?.message,
    });

    switch (event.event) {
      case 'error':
        this.updateTunnelStatus(dbName, {
          status: 'error',
          lastError: event.error?.message || 'Unknown error',
          isHealthy: false,
        });
        break;

      case 'end':
      case 'close':
        this.markTunnelInactive(dbName);
        break;
    }
  }

  private markTunnelInactive(dbName: string): void {
    const tunnel = this.tunnels.get(dbName);
    if (tunnel) {
      tunnel.isActive = false;
      this.updateTunnelStatus(dbName, {
        status: 'disconnected',
        isHealthy: false,
      });
    }
  }

  private updateTunnelStatus(dbName: string, updates: Partial<SSHTunnelStatusInfo>): void {
    const current = this.tunnelStatus.get(dbName) || {
      status: 'disconnected' as SSHTunnelStatus,
      reconnectAttempts: 0,
      isHealthy: false,
    };

    const updated = { ...current, ...updates };
    this.tunnelStatus.set(dbName, updated);
  }
}

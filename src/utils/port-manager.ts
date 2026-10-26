/**
 * Port management utilities for SSH tunnel local port assignment
 */

import * as net from 'net';
import { getLogger } from './logger.js';

export interface PortCheckResult {
  port: number;
  isAvailable: boolean;
  reason?: string;
}

export interface PortAssignmentOptions {
  preferredPort?: number;
  minPort?: number;
  maxPort?: number;
  databaseType?: string;
  excludePorts?: number[];
  maxAttempts?: number;
}

export interface PortAssignmentResult {
  assignedPort: number;
  wasPreferredPort: boolean;
  attemptedPorts: number[];
  reason?: string;
}

// ============================================================================
// Port Management Class
// ============================================================================

/**
 *
 */
export class PortManager {
  private static instance: PortManager;
  private logger = getLogger();
  private reservedPorts = new Set<number>();

  // Common database ports that we should avoid by default
  private readonly DATABASE_PORTS = {
    mysql: 3306,
    postgresql: 5432,
    postgres: 5432,
    mssql: 1433,
    sqlserver: 1433,
    redis: 6379,
    mongodb: 27017,
    cassandra: 9042,
    elasticsearch: 9200,
    kibana: 5601,
    grafana: 3000,
  };

  // Commonly used ports we should avoid
  private readonly COMMON_PORTS = [
    22, // SSH
    25, // SMTP
    53, // DNS
    80, // HTTP
    110, // POP3
    143, // IMAP
    443, // HTTPS
    993, // IMAPS
    995, // POP3S
    1521, // Oracle
    1433, // SQL Server
    3306, // MySQL
    5432, // PostgreSQL
    5672, // RabbitMQ
    6379, // Redis
    8080, // HTTP Alternative
    8443, // HTTPS Alternative
    9200, // Elasticsearch
    27017, // MongoDB
  ];

  private constructor() {
    // Singleton pattern
  }

  /**
   *
   */
  public static getInstance(): PortManager {
    if (!PortManager.instance) {
      PortManager.instance = new PortManager();
    }
    return PortManager.instance;
  }

  /**
   * Check if a specific port is available
   */
  async isPortAvailable(port: number, host = '127.0.0.1'): Promise<PortCheckResult> {
    return new Promise<PortCheckResult>((resolve) => {
      const server = net.createServer();

      server.listen(port, host, () => {
        server.close(() => {
          resolve({ port, isAvailable: true });
        });
      });

      server.on('error', (error: NodeJS.ErrnoException) => {
        let reason = 'Unknown error';

        if (error.code === 'EADDRINUSE') {
          reason = 'Port is already in use';
        } else if (error.code === 'EACCES') {
          reason = 'Permission denied (port may require elevated privileges)';
        } else if (error.code === 'EADDRNOTAVAIL') {
          reason = 'Address not available';
        }

        resolve({
          port,
          isAvailable: false,
          reason: `${reason} (${error.code})`,
        });
      });
    });
  }

  /**
   * Find an available port with intelligent assignment
   */
  async findAvailablePort(options: PortAssignmentOptions = {}): Promise<PortAssignmentResult> {
    const {
      preferredPort,
      minPort = 30000, // Start from a high range to avoid common services
      maxPort = 65535,
      databaseType,
      excludePorts = [],
      maxAttempts = 50,
    } = options;

    const attemptedPorts: number[] = [];
    let assignedPort: number;
    // Note: wasPreferredPort is determined dynamically when we return

    // Step 1: Try the preferred port first if specified
    if (preferredPort && preferredPort > 0) {
      const result = await this.isPortAvailable(preferredPort);
      attemptedPorts.push(preferredPort);

      if (result.isAvailable && !this.reservedPorts.has(preferredPort)) {
        this.reservedPorts.add(preferredPort);
        this.logger.info(`Using preferred port ${preferredPort}`);
        return {
          assignedPort: preferredPort,
          wasPreferredPort: true,
          attemptedPorts,
        };
      } else {
        this.logger.warning(
          `Preferred port ${preferredPort} is not available: ${result.reason || 'Port in use'}`
        );
      }
    }

    // Step 2: Try database-specific alternative ports
    if (databaseType && this.DATABASE_PORTS[databaseType as keyof typeof this.DATABASE_PORTS]) {
      const dbPort = this.DATABASE_PORTS[databaseType as keyof typeof this.DATABASE_PORTS];
      const alternativePorts = this.generateAlternativePorts(dbPort);

      for (const altPort of alternativePorts) {
        if (attemptedPorts.includes(altPort) || excludePorts.includes(altPort)) continue;

        const result = await this.isPortAvailable(altPort);
        attemptedPorts.push(altPort);

        if (result.isAvailable && !this.reservedPorts.has(altPort)) {
          this.reservedPorts.add(altPort);
          this.logger.info(
            `Using database-specific alternative port ${altPort} for ${databaseType}`
          );
          return {
            assignedPort: altPort,
            wasPreferredPort: false,
            attemptedPorts,
            reason: `Database-specific alternative for ${databaseType}`,
          };
        }
      }
    }

    // Step 3: Search in the safe range
    let attempt = 0;
    while (attempt < maxAttempts) {
      const candidatePort = this.generateRandomPort(minPort, maxPort, excludePorts, attemptedPorts);

      if (attemptedPorts.includes(candidatePort)) {
        attempt++;
        continue;
      }

      const result = await this.isPortAvailable(candidatePort);
      attemptedPorts.push(candidatePort);

      if (result.isAvailable && !this.reservedPorts.has(candidatePort)) {
        this.reservedPorts.add(candidatePort);
        assignedPort = candidatePort;
        break;
      }

      attempt++;
    }

    if (!assignedPort!) {
      throw new Error(
        `Failed to find available port after ${maxAttempts} attempts. Tried ports: ${attemptedPorts.join(', ')}`
      );
    }

    this.logger.info(
      `Found available port ${assignedPort} after ${attemptedPorts.length} attempts`
    );

    return {
      assignedPort: assignedPort!,
      wasPreferredPort: false,
      attemptedPorts,
      reason: 'Found in safe port range',
    };
  }

  /**
   * Generate alternative ports for a given database port
   */
  private generateAlternativePorts(basePort: number): number[] {
    const alternatives: number[] = [];

    // Try variations of the base port
    alternatives.push(
      basePort + 1000, // e.g., 3306 -> 4306
      basePort + 100, // e.g., 3306 -> 3406
      basePort + 10, // e.g., 3306 -> 3316
      basePort + 1, // e.g., 3306 -> 3307
      basePort + 2, // e.g., 3306 -> 3308
      basePort + 3 // e.g., 3306 -> 3309
    );

    // Filter out invalid ports and common conflicts
    return alternatives.filter(
      (port) => port > 1024 && port < 65536 && !this.COMMON_PORTS.includes(port)
    );
  }

  /**
   * Generate a random port in the given range
   */
  private generateRandomPort(
    minPort: number,
    maxPort: number,
    excludePorts: number[],
    attemptedPorts: number[]
  ): number {
    let port: number;
    let attempts = 0;
    const maxRandomAttempts = 10;

    do {
      port = Math.floor(Math.random() * (maxPort - minPort + 1)) + minPort;
      attempts++;
    } while (
      attempts < maxRandomAttempts &&
      (this.COMMON_PORTS.includes(port) ||
        excludePorts.includes(port) ||
        attemptedPorts.includes(port) ||
        this.reservedPorts.has(port))
    );

    return port;
  }

  /**
   * Reserve a port to prevent conflicts with other tunnel operations
   */
  reservePort(port: number): void {
    this.reservedPorts.add(port);
    this.logger.debug(`Reserved port ${port}`);
  }

  /**
   * Release a reserved port
   */
  releasePort(port: number): void {
    this.reservedPorts.delete(port);
    this.logger.debug(`Released port ${port}`);
  }

  /**
   * Get list of reserved ports
   */
  getReservedPorts(): number[] {
    return Array.from(this.reservedPorts);
  }

  /**
   * Check multiple ports for availability
   */
  async checkMultiplePorts(ports: number[]): Promise<PortCheckResult[]> {
    const results: PortCheckResult[] = [];

    for (const port of ports) {
      const result = await this.isPortAvailable(port);
      results.push(result);
    }

    return results;
  }

  /**
   * Get port recommendations for a database type
   */
  getPortRecommendations(databaseType: string, excludeUsed = true): number[] {
    const dbPort = this.DATABASE_PORTS[databaseType as keyof typeof this.DATABASE_PORTS];
    if (!dbPort) return [];

    const recommendations = this.generateAlternativePorts(dbPort);

    if (excludeUsed) {
      return recommendations.filter((port) => !this.reservedPorts.has(port));
    }

    return recommendations;
  }

  /**
   * Suggest a good port for SSH tunneling based on database type
   */
  async suggestTunnelPort(
    databaseType: string,
    preferredPort?: number
  ): Promise<PortAssignmentResult> {
    const options: PortAssignmentOptions = {
      databaseType,
      preferredPort,
      minPort: 30000, // Start from high range
      maxPort: 40000, // Keep within reasonable range
      maxAttempts: 20,
    };

    return this.findAvailablePort(options);
  }

  /**
   * Clear all reserved ports (useful for testing)
   */
  clearReservedPorts(): void {
    this.reservedPorts.clear();
    this.logger.debug('Cleared all reserved ports');
  }
}

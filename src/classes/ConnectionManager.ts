/**
 * Database Connection Manager
 */

import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import type {
  DatabaseConfig,
  ConnectionInfo,
  DatabaseConnection,
  SSHTunnelInfo,
  QueryResult,
  BatchResult,
} from '../types/index.js';
import { ConnectionError } from '../types/index.js';
import type { DatabaseAdapter } from '../database/adapters/index.js';
import { AdapterFactory } from '../database/adapters/index.js';
import type { EnhancedSSHTunnelManager } from './EnhancedSSHTunnelManager.js';
import { getLogger } from '../utils/logger.js';
import type { MetricsManager } from './MetricsManager.js';
import type { QueryCache } from './QueryCache.js';
import type { CircuitBreakerState } from '../utils/circuit-breaker.js';
import {
  initialCircuitState,
  shouldReject,
  recordFailure,
  recordSuccess,
} from '../utils/circuit-breaker.js';
import { CircuitOpenError } from '../utils/error-handler.js';
import { writeAuditLog } from '../utils/audit-logger.js';
import {
  isPrivilegeReport,
  privilegeWarning,
  type PrivilegeProbe,
} from '../database/privileges.js';

// ============================================================================
// Connection Manager Class
// ============================================================================

// Transient error patterns that are worth retrying
const RETRYABLE_PATTERNS = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EPIPE',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'Connection lost',
  'Connection terminated unexpectedly',
  'read ECONNRESET',
  'socket hang up',
];

function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return RETRYABLE_PATTERNS.some((pattern) => message.includes(pattern));
}

async function withRetry<T>(
  operation: () => Promise<T>,
  logger: ReturnType<typeof getLogger>,
  context: string,
  maxRetries = 2,
  delayMs = 1000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries && isRetryableError(error)) {
        const backoff = delayMs * (attempt + 1);
        logger.warning(
          `Retryable error in ${context} (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${backoff}ms`,
          {
            error: (error as Error).message,
          }
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
      } else {
        throw error;
      }
    }
  }
  throw lastError; // unreachable, but satisfies TS
}

/**
 *
 */
export class ConnectionManager extends EventEmitter {
  private connections = new Map<string, ConnectionInfo>();
  private adapters = new Map<string, DatabaseAdapter>();
  private databases: Record<string, DatabaseConfig> = {};
  private sshTunnelManager: EnhancedSSHTunnelManager;
  private logger = getLogger();
  private circuits = new Map<string, CircuitBreakerState>();
  private privileges = new Map<string, PrivilegeProbe>();
  private metrics?: MetricsManager;
  private queryCache?: QueryCache;

  constructor(
    sshTunnelManager: EnhancedSSHTunnelManager,
    metrics?: MetricsManager,
    queryCache?: QueryCache
  ) {
    super();
    this.sshTunnelManager = sshTunnelManager;
    this.metrics = metrics;
    this.queryCache = queryCache;
  }

  private getCircuit(dbName: string): CircuitBreakerState {
    let s = this.circuits.get(dbName);
    if (!s) {
      s = initialCircuitState();
      this.circuits.set(dbName, s);
    }
    return s;
  }

  /**
   * Create database adapter (can be overridden for testing)
   */
  private createAdapter(config: DatabaseConfig): DatabaseAdapter {
    return AdapterFactory.createAdapter(config);
  }

  /**
   * Initialize the connection manager
   */
  public initialize(databases: Record<string, DatabaseConfig>): void {
    this.databases = databases;
    this.emit('initialized', databases);
  }

  /**
   * Register a database configuration
   */
  public registerDatabase(name: string, config: DatabaseConfig): void {
    // Validate configuration
    const validation = AdapterFactory.validateConfig(config);
    if (!validation.isValid) {
      throw new Error(
        `Invalid configuration for database '${name}': ${validation.errors.join(', ')}`
      );
    }

    this.databases[name] = config;
    this.logger.info(`Database '${name}' registered`, { type: config.type });
  }

  /**
   * Unregister a database configuration
   */
  public unregisterDatabase(name: string): void {
    delete this.databases[name];
    this.privileges.delete(name);

    // Audit H2: invalidate the query cache for this database so stale results
    // from the old config/host are not served after an update or removal.
    this.queryCache?.invalidate(name);

    // Close connection if it exists
    if (this.connections.has(name)) {
      this.closeConnection(name).catch((error) => {
        this.logger.error(`Error closing connection during unregister for '${name}'`, {
          error: (error as Error).message,
        });
      });
    }

    this.logger.info(`Database '${name}' unregistered`);
  }

  /**
   * Get database configuration
   */
  public getDatabaseConfig(name: string): DatabaseConfig | undefined {
    return this.databases[name];
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  /**
   * Create a new database connection
   */
  async createConnection(dbName: string, config: DatabaseConfig): Promise<ConnectionInfo> {
    try {
      this.logger.info(`Creating connection to database '${dbName}'`, {
        type: config.type,
        host: config.host,
        database: config.database,
        ssl: config.ssl ?? false,
        ssh_enabled: !!config.ssh_host,
      });

      // Validate configuration
      const validation = AdapterFactory.validateConfig(config);
      if (!validation.isValid) {
        throw new ConnectionError(
          `Invalid configuration for database '${dbName}': ${validation.errors.join(', ')}`,
          { database: dbName, errors: validation.errors }
        );
      }

      // Create database adapter
      let adapter: DatabaseAdapter;
      let actualConfig = { ...config };

      try {
        adapter = this.createAdapter(config);
      } catch (error) {
        throw new ConnectionError(`Failed to create adapter for database '${dbName}'`, {
          database: dbName,
          error: (error as Error).message,
        });
      }

      // Set up SSH tunnel if needed
      if (config.ssh_host && config.type !== 'sqlite') {
        try {
          let tunnelInfo: SSHTunnelInfo;

          // Check if tunnel already exists and is healthy
          if (this.sshTunnelManager.isConnected(dbName)) {
            this.logger.info(`Using existing healthy tunnel for '${dbName}'`);
            tunnelInfo = this.sshTunnelManager.getTunnel(dbName)!;
          } else {
            // Check if tunnel exists but unhealthy
            if (this.sshTunnelManager.hasTunnel(dbName)) {
              this.logger.warning(`Existing tunnel for '${dbName}' is unhealthy, recreating...`);
              await this.sshTunnelManager.closeTunnel(dbName);
            }

            // Create new tunnel only if none exists or previous was unhealthy
            this.logger.info(`Creating new SSH tunnel for '${dbName}'`);
            tunnelInfo = await this.sshTunnelManager.createTunnel(dbName, {
              sshConfig: {
                host: config.ssh_host,
                port:
                  typeof config.ssh_port === 'number'
                    ? config.ssh_port
                    : parseInt(String(config.ssh_port || 22), 10),
                username: config.ssh_username!,
                password: config.ssh_password,
                privateKey: config.ssh_private_key,
                passphrase: config.ssh_passphrase,
                hostFingerprint: config.ssh_host_fingerprint,
                strictHostKeyChecking: config.ssh_strict_host_key_checking,
              },
              forwardConfig: {
                sourceHost: '127.0.0.1',
                sourcePort: 0, // Auto-assign
                destinationHost: config.host!,
                destinationPort:
                  typeof config.port === 'number'
                    ? config.port
                    : parseInt(String(config.port!), 10),
              },
              localPort:
                typeof config.local_port === 'number'
                  ? config.local_port
                  : parseInt(String(config.local_port || 0), 10),
              localHost: config.ssh_local_host ?? '127.0.0.1',
            });

            this.logger.info(`New SSH tunnel established for '${dbName}'`, {
              remoteHost: config.host,
              remotePort: config.port,
              localHost: tunnelInfo.localHost,
              localPort: tunnelInfo.localPort,
            });
          }

          // Update config to use tunnel
          actualConfig = {
            ...config,
            host: tunnelInfo.localHost,
            port: tunnelInfo.localPort,
          };

          // Create new adapter with tunnel config
          adapter = this.createAdapter(actualConfig);
        } catch (error) {
          throw new ConnectionError(`Failed to create SSH tunnel for database '${dbName}'`, {
            database: dbName,
            error: (error as Error).message,
          });
        }
      }

      // Establish database connection
      let connection: DatabaseConnection;
      try {
        connection = await adapter.connect();
        this.logger.info(`Database connection established for '${dbName}'`);
      } catch (error) {
        // Clean up SSH tunnel if connection failed
        if (config.ssh_host) {
          await this.sshTunnelManager.closeTunnel(dbName);
        }

        // For tests and specific error types, preserve original message
        const originalMessage = (error as Error).message;
        if (
          originalMessage.includes('Connection failed') ||
          originalMessage.includes('Connection timeout')
        ) {
          throw error;
        }

        throw new ConnectionError(`Failed to connect to database '${dbName}': ${originalMessage}`, {
          database: dbName,
          error: originalMessage,
        });
      }

      // Store connection info
      const connectionInfo: ConnectionInfo = {
        connection,
        type: config.type,
      };

      this.connections.set(dbName, connectionInfo);
      this.adapters.set(dbName, adapter);

      // The database role is the boundary, the filter a second net: check the role once per connection.
      if (config.select_only) {
        const probe = await this.runPrivilegeProbe(dbName, adapter, connection);
        if (config.require_readonly_role && !(isPrivilegeReport(probe) && !probe.canWrite)) {
          await this.closeConnection(dbName);
          const why = isPrivilegeReport(probe)
            ? `its role can write (${probe.reasons.join('; ')})`
            : `its privileges could not be checked (${probe.error})`;
          throw new ConnectionError(
            `Refused to connect to '${dbName}': require_readonly_role is on and ${why}. ` +
              'Connect as a read-only role, or turn require_readonly_role off.',
            { database: dbName }
          );
        }
      }

      // Emit connection event
      this.emit('connected', dbName);

      return connectionInfo;
    } catch (error) {
      if (error instanceof ConnectionError) {
        throw error;
      }

      // For tests and specific error types, preserve original message
      const originalMessage = (error as Error).message;
      if (
        originalMessage.includes('Connection failed') ||
        originalMessage.includes('Connection timeout')
      ) {
        throw error;
      }

      throw new ConnectionError(
        `Unexpected error creating connection to '${dbName}': ${originalMessage}`,
        { database: dbName, error: originalMessage }
      );
    }
  }

  /**
   * Run the adapter's privilege probe, remember the result and say when a
   * select_only connection can write. A probe that fails is remembered as such,
   * never thrown: the result is advice unless require_readonly_role asks for more.
   */
  private async runPrivilegeProbe(
    dbName: string,
    adapter: DatabaseAdapter,
    connection: DatabaseConnection
  ): Promise<PrivilegeProbe> {
    let probe: PrivilegeProbe;
    try {
      probe = await this.withQueryTimeout(
        dbName,
        () => adapter.probePrivileges(connection),
        'Privilege check'
      );
    } catch (error) {
      probe = { error: (error as Error).message, checkedAt: new Date().toISOString() };
      this.logger.info(`Could not check the privileges of '${dbName}'`, { error: probe.error });
    }
    this.privileges.set(dbName, probe);
    const warning = privilegeWarning(probe);
    if (warning) this.logger.warning(`Database '${dbName}': ${warning}`);
    this.emit('privileges', dbName, probe);
    return probe;
  }

  /** The last privilege check of a select_only database, if one ran. */
  public getPrivileges(dbName: string): PrivilegeProbe | undefined {
    return this.privileges.get(dbName);
  }

  /** Check a select_only database's privileges again on its open (or a new) connection. */
  async checkPrivileges(dbName: string): Promise<PrivilegeProbe | undefined> {
    const config = this.getDatabaseConfig(dbName);
    if (!config?.select_only) return undefined;
    const fresh = !this.connections.has(dbName);
    const { connection } = await this.getConnection(dbName);
    // A new connection was just checked by createConnection.
    if (fresh) return this.privileges.get(dbName);
    const adapter = this.adapters.get(dbName);
    if (!adapter) return undefined;
    return this.runPrivilegeProbe(dbName, adapter, connection);
  }

  /**
   * Get an existing connection or create a new one
   */
  async getConnection(dbName: string): Promise<ConnectionInfo> {
    // Check if connection already exists
    const existing = this.connections.get(dbName);
    if (existing) {
      return existing;
    }

    // Check if database is registered
    const config = this.databases[dbName];
    if (!config) {
      throw new Error(`Database ${dbName} is not registered`);
    }

    // Create new connection with retry for transient failures
    return await withRetry(
      () => this.createConnection(dbName, config),
      this.logger,
      `getConnection(${dbName})`
    );
  }

  /**
   * Get database adapter
   */
  getAdapter(dbName: string): DatabaseAdapter | undefined {
    return this.adapters.get(dbName);
  }

  /**
   * Check if a connection exists and is active
   */
  isConnected(dbName: string): boolean {
    const connectionInfo = this.connections.get(dbName);
    const adapter = this.adapters.get(dbName);

    if (!connectionInfo || !adapter) {
      return false;
    }

    try {
      return adapter.isConnected(connectionInfo.connection);
    } catch (error) {
      this.logger.error(`Error checking connection status for '${dbName}'`, {
        error: (error as Error).message,
      });
      return false;
    }
  }

  /**
   * Close a specific connection
   */
  async closeConnection(dbName: string): Promise<void> {
    const connectionInfo = this.connections.get(dbName);
    const adapter = this.adapters.get(dbName);

    if (connectionInfo && adapter) {
      try {
        await adapter.disconnect(connectionInfo.connection);
        this.logger.info(`Database connection closed for '${dbName}'`);
      } catch (error) {
        this.logger.error(`Error closing connection for '${dbName}'`, {
          error: (error as Error).message,
        });
      }

      // Emit disconnection event
      this.emit('disconnected', dbName);
    }

    // Close SSH tunnel if exists
    try {
      await this.sshTunnelManager.closeTunnel(dbName);
    } catch (error) {
      this.logger.error(`Error closing SSH tunnel for '${dbName}'`, {
        error: (error as Error).message,
      });
    }

    // Remove from maps
    this.connections.delete(dbName);
    this.adapters.delete(dbName);
  }

  /**
   * Close all connections
   */
  async closeAllConnections(): Promise<void> {
    const dbNames = Array.from(this.connections.keys());
    // Audit H3: capture the adapters BEFORE closeConnection deletes them from
    // this.adapters. The previous code iterated this.adapters *after* the close
    // loop, by which point the map was empty, so destroyPool() was never called
    // and connection pools (with their TCP connections) were leaked on shutdown.
    const adaptersToDestroy = Array.from(this.adapters.values());

    const PER_CONNECTION_TIMEOUT = 5000;
    const results = await Promise.allSettled(
      dbNames.map((dbName) =>
        Promise.race([
          this.closeConnection(dbName),
          new Promise<void>((_, reject) => {
            const timer = setTimeout(
              () => reject(new Error(`Timeout closing connection '${dbName}'`)),
              PER_CONNECTION_TIMEOUT
            );
            timer.unref();
          }),
        ])
      )
    );

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        this.logger.error(`Error closing connection for '${dbNames[i]}'`, {
          error: (results[i] as PromiseRejectedResult).reason?.message,
        });
      }
    }

    this.logger.info('All database connections closed');

    // Destroy connection pools on shutdown using the captured list.
    for (const adapter of adaptersToDestroy) {
      const poolable = adapter as unknown as { destroyPool?: () => Promise<void> };
      if (typeof poolable.destroyPool === 'function') {
        await poolable.destroyPool();
      }
    }
  }

  // ============================================================================
  // Information and Statistics
  // ============================================================================

  // ============================================================================
  // Query Execution Methods
  // ============================================================================

  /**
   * Internal query execution — preserves original connection-lookup and error handling.
   */
  private async _executeQueryInternal(
    dbName: string,
    query: string,
    params: unknown[] = []
  ): Promise<QueryResult> {
    // Get connection (will create if doesn't exist)
    const connectionInfo = await this.getConnection(dbName);
    const adapter = this.adapters.get(dbName);

    if (!adapter) {
      throw new ConnectionError(`No adapter found for database '${dbName}'`);
    }

    try {
      const result = await adapter.executeQuery(connectionInfo.connection, query, params);
      return result;
    } catch (error) {
      this.emit('error', error, dbName);
      throw error;
    }
  }

  /**
   * Hash of the engine's cheap schema fingerprint rows. Bypasses the query cache and metrics.
   */
  async schemaFingerprint(dbName: string): Promise<string> {
    await this.getConnection(dbName);
    const adapter = this.adapters.get(dbName);
    if (!adapter) {
      throw new ConnectionError(`No adapter found for database '${dbName}'`);
    }
    const result = await this._executeQueryInternal(dbName, adapter.fingerprintQuery());
    return createHash('sha256').update(JSON.stringify(result.rows)).digest('hex');
  }

  /**
   * Classify an error into a category for metrics and circuit breaker decisions.
   */
  private classifyErrorCategory(err: unknown): string {
    if (err instanceof CircuitOpenError) return 'CONNECTION';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorObj = err as any;
    const name = errorObj?.name ?? '';
    if (name.includes('SSH')) return 'SSH';
    if (name === 'ConnectionError') return 'CONNECTION';
    if (name === 'SecurityViolationError') return 'SECURITY';
    if (name === 'TimeoutError') return 'TIMEOUT';

    // Robust inspection of codes and messages for query-time network/connection/SSH failures
    const code = String(errorObj?.code || errorObj?.originalError?.code || '').toUpperCase();
    if (
      code === 'ECONNREFUSED' ||
      code === 'ENOTFOUND' ||
      code === 'EPIPE' ||
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'ESOCKETTIMEDOUT' ||
      code === 'PROTOCOL_CONNECTION_LOST'
    ) {
      return code.includes('SSH') ? 'SSH' : 'CONNECTION';
    }

    const message = errorObj?.message ?? '';
    const lowerMessage = message.toLowerCase();
    if (
      lowerMessage.includes('econnrefused') ||
      lowerMessage.includes('enotfound') ||
      lowerMessage.includes('epipe') ||
      lowerMessage.includes('etimedout') ||
      lowerMessage.includes('econnreset') ||
      lowerMessage.includes('connection closed') ||
      lowerMessage.includes('connection lost') ||
      lowerMessage.includes('socket') ||
      lowerMessage.includes('terminated') ||
      lowerMessage.includes('handshake')
    ) {
      if (lowerMessage.includes('ssh') || lowerMessage.includes('tunnel')) {
        return 'SSH';
      }
      return 'CONNECTION';
    }

    return 'QUERY';
  }

  /**
   * Execute a single query on a database with circuit breaker, caching, metrics,
   * and optional audit logging.
   */
  async executeQuery(dbName: string, query: string, params: unknown[] = []): Promise<QueryResult> {
    // 1. Circuit breaker — fast-reject if OPEN
    const circuit = this.getCircuit(dbName);
    const decision = shouldReject(circuit, Date.now());
    if (decision.reject) {
      const retryIn = Math.ceil((decision as { reject: true; retryInMs: number }).retryInMs / 1000);
      throw new CircuitOpenError(
        `Database '${dbName}' is currently unavailable — retry in ${retryIn}s`
      );
    }
    if (
      !decision.reject &&
      (decision as { reject: false; transitionTo?: 'HALF_OPEN' }).transitionTo === 'HALF_OPEN'
    ) {
      this.circuits.set(dbName, { ...circuit, status: 'HALF_OPEN' });
    }

    // 2. Cache check — for SELECT queries
    if (this.queryCache) {
      const cached = this.queryCache.get(dbName, query, params);
      if (cached !== undefined) {
        this.metrics?.recordCacheHit(dbName);
        return cached;
      }
      if (this.queryCache.shouldCache(query)) {
        this.metrics?.recordCacheMiss(dbName);
      }
    }

    // 3. Execute the query
    const startTime = Date.now();
    try {
      // Note: on timeout, the underlying query continues running on the database;
      // cancellation would require adapter-level support (e.g. KILL QUERY).
      const queryTimeout = this.getDatabaseConfig(dbName)?.query_timeout ?? 30000;
      let timeoutHandle: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`Query timed out after ${queryTimeout}ms`)),
          queryTimeout
        );
        timeoutHandle.unref();
      });
      const result = await Promise.race([
        this._executeQueryInternal(dbName, query, params),
        timeoutPromise,
      ]).finally(() => clearTimeout(timeoutHandle));
      const durationMs = Date.now() - startTime;

      // 4. On success
      const currentCircuit = this.getCircuit(dbName);
      const prevStatus = currentCircuit.status;
      const newCircuit = recordSuccess(currentCircuit);
      this.circuits.set(dbName, newCircuit);
      if (prevStatus !== newCircuit.status) {
        this.metrics?.recordCircuitEvent(
          dbName,
          newCircuit.status === 'CLOSED' ? 'closed' : 'half_open'
        );
        this.emit('circuitStateChange', dbName, newCircuit.status);
      }

      this.metrics?.recordQuery(dbName, durationMs, true);

      // Cache result if cacheable
      if (this.queryCache?.shouldCache(query)) {
        const ttl = this.getDatabaseConfig(dbName)?.cache_ttl_seconds ?? 60;
        this.queryCache.set(dbName, query, params, result, ttl);
      }

      // Invalidate cache for mutation queries
      if (this.queryCache?.isMutation(query)) {
        this.queryCache.invalidate(dbName);
      }

      // Fire-and-forget audit log
      const dbConfig = this.getDatabaseConfig(dbName);
      if (dbConfig?.audit_log) {
        writeAuditLog(dbName, query, durationMs, 'success').catch(
          /* audit is best-effort */ () => undefined
        );
      }

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;

      // 5. On failure
      const category = this.classifyErrorCategory(error);

      // Only advance circuit breaker for CONNECTION/SSH errors
      if (category === 'CONNECTION' || category === 'SSH') {
        // Evict/close broken connection
        await this.closeConnection(dbName).catch((evictError) => {
          this.logger.error(`Failed to evict dead connection for database '${dbName}'`, {
            error: evictError.message,
          });
        });

        const currentCircuit = this.getCircuit(dbName);
        const prevStatus = currentCircuit.status;
        const newCircuit = recordFailure(currentCircuit, Date.now());
        this.circuits.set(dbName, newCircuit);
        if (prevStatus !== newCircuit.status) {
          this.metrics?.recordCircuitEvent(
            dbName,
            newCircuit.status === 'OPEN' ? 'open' : 'half_open'
          );
          this.emit('circuitStateChange', dbName, newCircuit.status);
        }
      }

      this.metrics?.recordQuery(dbName, durationMs, false, category);

      // Fire-and-forget audit log
      const dbConfig = this.getDatabaseConfig(dbName);
      if (dbConfig?.audit_log) {
        writeAuditLog(dbName, query, durationMs, `error:${category}`).catch(
          /* audit is best-effort */ () => undefined
        );
      }

      throw error;
    }
  }

  /**
   * Execute multiple queries in batch
   */
  async executeBatch(
    dbName: string,
    queries: Array<{ query: string; params?: unknown[]; label?: string }>,
    useTransaction = false
  ): Promise<BatchResult> {
    // Get connection (will create if doesn't exist)
    const connectionInfo = await this.getConnection(dbName);
    const adapter = this.adapters.get(dbName);

    if (!adapter) {
      throw new ConnectionError(`No adapter found for database '${dbName}'`);
    }

    const startTime = Date.now();
    const results: Array<{
      index: number;
      label: string;
      success: boolean;
      data?: QueryResult;
      error?: string;
      cause?: unknown;
      query: string;
      execution_time_ms?: number;
    }> = [];

    let transactionStarted = false;

    try {
      // Begin transaction if requested
      if (useTransaction) {
        await adapter.beginTransaction(connectionInfo.connection);
        transactionStarted = true;
      }

      // Execute each query
      for (let i = 0; i < queries.length; i++) {
        const queryObj = queries[i];
        const queryStartTime = Date.now();

        try {
          const result = await this.withQueryTimeout(
            dbName,
            () =>
              adapter.executeQuery(
                connectionInfo.connection,
                queryObj.query,
                queryObj.params || []
              ),
            'Batch query'
          );

          results.push({
            index: i,
            label: queryObj.label || `Query ${i + 1}`,
            success: true,
            data: result,
            query: queryObj.query,
            execution_time_ms: Date.now() - queryStartTime,
          });

          // Invalidate cache for mutation queries
          if (this.queryCache?.isMutation(queryObj.query)) {
            this.queryCache.invalidate(dbName);
          }
        } catch (error) {
          results.push({
            index: i,
            label: queryObj.label || `Query ${i + 1}`,
            success: false,
            error: (error as Error).message,
            cause: error,
            query: queryObj.query,
            execution_time_ms: Date.now() - queryStartTime,
          });

          // If transaction is active and a query fails, rollback. Audit H6:
          // previously this branch did `throw error`, which discarded the partial
          // `results` array and gave the caller no per-query breakdown (inconsistent
          // with non-transaction mode, which continues and returns all results).
          // Now we roll back and STOP the loop, then return the partial results so
          // the caller can see exactly which queries succeeded (and were rolled
          // back) and which one failed.
          if (transactionStarted) {
            await adapter.rollbackTransaction(connectionInfo.connection);
            transactionStarted = false;
            break; // stop the loop, fall through to return partial results
          }
        }
      }

      // Commit transaction if all succeeded
      if (transactionStarted) {
        await adapter.commitTransaction(connectionInfo.connection);
      }

      const totalTime = Date.now() - startTime;
      const successCount = results.filter((r) => r.success).length;

      return {
        totalExecutionTime: totalTime,
        results,
        successCount,
        failureCount: results.length - successCount,
        transactionUsed: useTransaction,
      };
    } catch (error) {
      // Rollback transaction if still active
      if (transactionStarted) {
        try {
          await adapter.rollbackTransaction(connectionInfo.connection);
        } catch (rollbackError) {
          this.logger.error(`Error rolling back transaction for '${dbName}'`, {
            error: (rollbackError as Error).message,
          });
        }
      }

      this.emit('error', error, dbName);
      throw error;
    }
  }

  /**
   * Race an operation against the configured per-database query timeout.
   * Note: this stops the client from waiting; server-side cancellation additionally
   * depends on the adapter (e.g. PostgreSQL statement_timeout).
   */
  private async withQueryTimeout<T>(
    dbName: string,
    op: () => Promise<T>,
    label = 'Operation'
  ): Promise<T> {
    const queryTimeout = this.getDatabaseConfig(dbName)?.query_timeout ?? 30000;
    let timeoutHandle: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`${label} timed out after ${queryTimeout}ms`)),
        queryTimeout
      );
      timeoutHandle.unref();
    });
    return Promise.race([op(), timeoutPromise]).finally(() =>
      clearTimeout(timeoutHandle)
    ) as Promise<T>;
  }

  /**
   * Analyze query performance with database-specific recommendations
   */
  async analyzePerformance(
    dbName: string,
    query: string
  ): Promise<{
    executionTime: number;
    explainTime: number;
    rowCount: number;
    columnCount: number;
    executionPlan: string;
    recommendations: string;
  }> {
    // Get connection (will create if doesn't exist)
    const connectionInfo = await this.getConnection(dbName);
    const adapter = this.adapters.get(dbName);

    if (!adapter) {
      throw new ConnectionError(`No adapter found for database '${dbName}'`);
    }

    try {
      // Execute the actual query to get timing and row info
      const startTime = Date.now();
      const result = await this.withQueryTimeout(
        dbName,
        () => adapter.executeQuery(connectionInfo.connection, query),
        'Performance analysis'
      );
      const executionTime = Date.now() - startTime;

      // Get execution plan
      const explainStartTime = Date.now();
      const explainQuery = adapter.buildExplainQuery(query);
      const explainResult = await this.withQueryTimeout(
        dbName,
        () => adapter.executeQuery(connectionInfo.connection, explainQuery),
        'Performance analysis (explain)'
      );
      const explainTime = Date.now() - explainStartTime;

      // Format execution plan based on database type
      const executionPlan = this.formatExecutionPlan(explainResult, connectionInfo.type);

      // Generate database-specific recommendations
      const recommendations = this.generatePerformanceRecommendations({
        query,
        result,
        explainResult,
        executionTime,
        adapter,
      });

      return {
        executionTime,
        explainTime,
        rowCount: result.rowCount,
        columnCount: result.fields.length,
        executionPlan,
        recommendations,
      };
    } catch (error) {
      this.emit('error', error, dbName);
      throw error;
    }
  }

  /**
   * Format execution plan based on database type
   */
  private formatExecutionPlan(explainResult: QueryResult, dbType: string): string {
    // Every branch joins whatever columns the row actually has. The MySQL case
    // used to index vals[0..3] explicitly, which was wrong in both directions:
    // EXPLAIN FORMAT=JSON returns a single column, so slots 1-3 rendered as the
    // literal "undefined", while a classic EXPLAIN returns 12 columns, so the
    // key, rows, filtered and Extra fields were silently discarded.
    //
    // PostgreSQL's EXPLAIN returns one "QUERY PLAN" column per row — those rows
    // are consecutive lines of a single plan, so they read as a block rather
    // than as delimited fields.
    const separator = dbType === 'postgresql' ? ' ' : ' | ';

    return explainResult.rows.map((row) => Object.values(row).join(separator)).join('\n');
  }

  /**
   * Generate database-specific performance recommendations
   */
  private generatePerformanceRecommendations(options: {
    query: string;
    result: QueryResult;
    explainResult: QueryResult;
    executionTime: number;
    adapter: DatabaseAdapter;
  }): string {
    const { query, result, explainResult, executionTime, adapter } = options;
    const recommendations: string[] = ['Performance Analysis Results:'];

    // Basic execution metrics
    recommendations.push(`- Query executed successfully in ${executionTime}ms`);
    recommendations.push(`- Returned ${result.rowCount} rows with ${result.fields.length} columns`);

    // Performance warnings based on execution time
    if (executionTime > 5000) {
      recommendations.push(
        ' CRITICAL: Query took over 5 seconds - requires immediate optimization'
      );
    } else if (executionTime > 1000) {
      recommendations.push(' WARNING: Slow query detected (>1s) - consider optimization');
    } else if (executionTime > 500) {
      recommendations.push('[INFO]: Moderate execution time - monitor for performance');
    } else {
      recommendations.push(' GOOD: Query performance is acceptable');
    }

    // Large result set warnings
    if (result.rowCount > 10000) {
      recommendations.push(' LARGE DATASET: Consider adding LIMIT clause or pagination');
    } else if (result.rowCount > 1000) {
      recommendations.push('[INFO]: Large result set - verify if all rows are needed');
    }

    // Query analysis recommendations
    const upperQuery = query.toUpperCase();

    // These match keywords, not substrings. `includes('TOP')` fired on any
    // identifier containing the letters - stop_id, laptop, topic - and silently
    // suppressed the advice for perfectly ordinary queries; `includes('SELECT *')`
    // missed the same query written with two spaces or a newline. The join
    // analysis below already had this right.
    if (/\bSELECT\s+\*/.test(upperQuery)) {
      recommendations.push(
        ' TIP: Use specific column names instead of SELECT * for better performance'
      );
    }

    if (!/\bLIMIT\b/.test(upperQuery) && !/\bTOP\b/.test(upperQuery)) {
      recommendations.push(
        ' TIP: Consider adding LIMIT clause to prevent unexpected large results'
      );
    }

    // Database-specific recommendations: only the adapter knows the shape of its own plan.
    recommendations.push(...adapter.getPerformanceRecommendations(explainResult, query));

    // Join analysis
    const joinCount = (upperQuery.match(/\bJOIN\b/g) || []).length;
    if (joinCount > 3) {
      recommendations.push(
        ' COMPLEX: Multiple JOINs detected - ensure proper indexing on join columns'
      );
    } else if (joinCount > 0) {
      recommendations.push('[INFO]: JOINs detected - verify indexes exist on join columns');
    }

    return recommendations.join('\n');
  }
}

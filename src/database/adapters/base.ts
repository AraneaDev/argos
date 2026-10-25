/**
 * Abstract base class for database adapters
 */

import type {
  DatabaseConnection,
  DatabaseConfig,
  QueryResult,
  DatabaseSchema,
  ForeignKey,
  DatabaseTypeString,
  QueryResultWithRedaction,
} from '../../types/index.js';
import { RedactionManager } from '../../classes/RedactionManager.js';

// ============================================================================
// Abstract Database Adapter
// ============================================================================

/**
 *
 */
export abstract class DatabaseAdapter {
  protected config: DatabaseConfig;
  protected connectionTimeout: number;
  protected redactionManager?: RedactionManager;

  constructor(config: DatabaseConfig) {
    this.config = config;
    this.connectionTimeout =
      typeof config.timeout === 'number'
        ? config.timeout
        : typeof config.timeout === 'string'
          ? parseInt(config.timeout, 10) || 30000
          : 30000;

    // Initialize redaction manager if configured
    if (config.redaction?.enabled) {
      this.redactionManager = new RedactionManager(config.redaction);
    }
  }

  // ============================================================================
  // Abstract Methods (must be implemented by subclasses)
  // ============================================================================

  /**
   * Create a connection to the database
   */
  abstract connect(): Promise<DatabaseConnection>;

  /**
   * Execute a query against the database
   */
  abstract executeQuery(
    _connection: DatabaseConnection,
    _query: string,
    _params?: unknown[]
  ): Promise<QueryResult>;

  /**
   * Disconnect from the database
   */
  abstract disconnect(_connection: DatabaseConnection): Promise<void>;

  /**
   * Capture schema information from the database
   */
  abstract captureSchema(_connection: DatabaseConnection): Promise<DatabaseSchema>;

  /**
   * Test if the connection is still alive
   */
  abstract isConnected(_connection: DatabaseConnection): boolean;

  /**
   * Begin a transaction
   */
  abstract beginTransaction(_connection: DatabaseConnection): Promise<void>;

  /**
   * Commit a transaction
   */
  abstract commitTransaction(_connection: DatabaseConnection): Promise<void>;

  /**
   * Rollback a transaction
   */
  abstract rollbackTransaction(_connection: DatabaseConnection): Promise<void>;

  /**
   * Build an EXPLAIN query for performance analysis
   */
  abstract buildExplainQuery(_query: string): string;

  /**
   * Cheap query returning one row with a column named argos_fingerprint (plus an optional n)
   * that changes whenever the schema changes.
   */
  abstract fingerprintQuery(): string;

  // ============================================================================
  // Performance Analysis
  // ============================================================================

  /**
   * Produce dialect-specific advice about the plan that buildExplainQuery() asked for.
   * The adapter owns this because only it knows the shape of its own EXPLAIN output.
   * Adapters with nothing dialect-specific to say inherit this empty default.
   * @param _explainResult - the result of running buildExplainQuery()
   * @param _query - the original query the plan was produced for
   * @returns zero or more recommendation lines
   */
  public getPerformanceRecommendations(_explainResult: QueryResult, _query: string): string[] {
    return [];
  }

  /**
   * Flatten an execution plan into a single lowercase string for keyword matching.
   */
  protected flattenExplainPlan(explainResult: QueryResult): string {
    return explainResult.rows
      .map((row) => Object.values(row).join(' '))
      .join(' ')
      .toLowerCase();
  }

  // ============================================================================
  // Common Implementation Methods
  // ============================================================================

  /**
   * Get the database type
   */
  public getType(): DatabaseTypeString {
    return this.config.type;
  }

  /**
   * Get the connection configuration
   */
  public getConfig(): DatabaseConfig {
    return { ...this.config };
  }

  /**
   * Sanitize connection config for logging (remove sensitive data)
   */
  public getSafeConfig(): Partial<DatabaseConfig> {
    const { password, ssh_password, ssh_private_key, ssh_passphrase, ...safe } = this.config;
    return {
      ...safe,
      password: password ? '[REDACTED]' : undefined,
      ssh_password: ssh_password ? '[REDACTED]' : undefined,
      ssh_private_key: ssh_private_key ? '[REDACTED]' : undefined,
      ssh_passphrase: ssh_passphrase ? '[REDACTED]' : undefined,
    };
  }

  /**
   * Validate that required configuration fields are present
   */
  protected validateConfig(requiredFields: string[]): void {
    const missing: string[] = [];

    for (const field of requiredFields) {
      const value = this.config[field as keyof DatabaseConfig];
      if (value === undefined || value === null || value === '') {
        missing.push(field);
      }
    }

    if (missing.length > 0) {
      throw new Error(`Missing required configuration fields: ${missing.join(', ')}`);
    }
  }

  /**
   * Parse string values to appropriate types
   */
  protected parseConfigValue<T>(
    // undefined and null are accepted explicitly because the first branch below
    // returns the default for them. Without it, T widens to include undefined
    // whenever an optional config field is passed, so a caller who wants a
    // plain number back has to cast around a function that already guarantees
    // one.
    value: string | number | boolean | T | undefined | null,
    type: 'string' | 'number' | 'boolean',
    defaultValue: T
  ): T {
    if (value === undefined || value === null) {
      return defaultValue;
    }

    switch (type) {
      case 'string':
        return String(value) as T;
      case 'number': {
        if (typeof value === 'number') return value as T;
        const parsed = parseInt(String(value), 10);
        return (isNaN(parsed) ? defaultValue : parsed) as T;
      }
      case 'boolean':
        if (typeof value === 'boolean') return value as T;
        return (String(value).toLowerCase() === 'true') as T;
      default:
        return value as T;
    }
  }

  /**
   * Create a standardized error with context
   */
  protected createError(message: string, originalError?: Error): Error {
    const errorMessage = `${this.getType()} adapter error: ${message}`;

    if (originalError) {
      const error = new Error(`${errorMessage} - ${originalError.message}`);
      error.stack = originalError.stack;
      return error;
    }

    return new Error(errorMessage);
  }

  /**
   * Truncate rows if they exceed the limit
   */
  protected truncateResults(
    rows: unknown[],
    maxRows: number
  ): { rows: unknown[]; truncated: boolean } {
    if (rows.length <= maxRows) {
      return { rows, truncated: false };
    }

    return {
      rows: rows.slice(0, maxRows),
      truncated: true,
    };
  }

  /**
   * Extract field names from query results (implementation varies by adapter)
   */
  protected abstract extractFieldNames(_result: unknown): string[];

  /**
   * Whether the server's TLS certificate must be verified.
   *
   * Fails secure. Verification is switched off only when the configuration says
   * so in a form this recognises; an unrecognised value leaves it on. The plain
   * boolean coercion used elsewhere treats every string but 'true' as false,
   * which would turn a typo, or a 'yes' that never went through the config-file
   * parser, into a silently disabled certificate check.
   */
  protected verifyServerCertificate(): boolean {
    // One expression covers every input, because stringifying lands each on the
    // right side of the list: false -> 'false' (off), true -> 'true' (on), and
    // an absent, null or misspelled value stringifies to something the list does
    // not contain, so it stays on.
    return !['false', '0', 'no', 'off'].includes(
      String(this.config.ssl_verify).trim().toLowerCase()
    );
  }

  /**
   * Resolve the effective maximum row count from configuration (default 1000).
   */
  protected getMaxRows(): number {
    const configured = this.config.max_rows;
    return typeof configured === 'number' && configured > 0 ? configured : 1000;
  }

  /**
   * Resolve the per-statement timeout in ms from configuration (default 30000, 0 disables).
   */
  protected getStatementTimeoutMs(): number {
    const raw = this.config.query_timeout ?? this.config.timeout;
    const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
    return Number.isFinite(n) && n >= 0 ? n : 30000;
  }

  /**
   * Build a normalized QueryResult from rows collected via a streaming/cursor path that
   * stops at maxRows+1 (FIND-109), so the full result set is never materialized in the Node
   * heap. The caller supplies the true observed row count and truncation flag because the
   * driver result was consumed incrementally rather than buffered.
   * @param rows - the retained rows (already capped at maxRows)
   * @param observedRowCount - number of rows actually seen (>= rows.length)
   * @param truncated - whether more rows existed beyond the cap
   * @param startTime - Date.now() captured at query start
   * @param query - the executed SQL (for alias-aware redaction)
   * @returns the normalized, optionally-redacted result
   */
  protected buildStreamedResult(
    rows: Record<string, unknown>[],
    observedRowCount: number,
    truncated: boolean,
    startTime: number,
    query?: string
  ): QueryResult {
    // No length check: Object.keys of the ?? {} fallback is already [] for an
    // empty result, so guarding on rows.length only restated it.
    const fields = Object.keys(rows[0] ?? {});
    const baseResult: QueryResult = {
      rows,
      rowCount: observedRowCount,
      fields,
      truncated,
      execution_time_ms: Date.now() - startTime,
    };
    if (this.redactionManager) {
      return this.redactionManager.redactResults(baseResult, query);
    }
    return baseResult;
  }

  /**
   * Normalize query result to standard format with optional redaction
   */
  protected normalizeQueryResult(
    rawResult: unknown,
    startTime: number,
    maxRows?: number,
    query?: string
  ): QueryResult {
    const executionTime = Date.now() - startTime;
    const cap = maxRows ?? this.getMaxRows();

    // Extract rows - implementation varies by adapter
    const rawRows = this.extractRawRows(rawResult);
    const { rows, truncated } = this.truncateResults(rawRows, cap);

    // Extract field names
    const fields = this.extractFieldNames(rawResult);

    // Create base result
    const baseResult: QueryResult = {
      rows: rows as Record<string, unknown>[],
      rowCount: rawRows.length,
      fields,
      truncated,
      execution_time_ms: executionTime,
    };

    // Apply redaction if configured
    if (this.redactionManager) {
      const redactedResult = this.redactionManager.redactResults(baseResult, query);
      return redactedResult;
    }

    return baseResult;
  }

  /**
   * Extract raw rows from database-specific result (implementation varies by adapter)
   */
  protected abstract extractRawRows(_result: unknown): unknown[];

  // ============================================================================
  // Helper Methods for Schema Capture
  // ============================================================================

  /**
   * Create a base schema object
   */
  protected createBaseSchema(databaseName: string): DatabaseSchema {
    return {
      database: databaseName,
      type: this.getType(),
      captured_at: new Date().toISOString(),
      tables: {},
      views: {},
      summary: {
        table_count: 0,
        view_count: 0,
        total_columns: 0,
      },
    };
  }

  /**
   * Update schema summary statistics
   */
  protected updateSchemaSummary(schema: DatabaseSchema): void {
    schema.summary.table_count = Object.keys(schema.tables).length;
    schema.summary.view_count = Object.keys(schema.views).length;
    schema.summary.total_columns = [
      ...Object.values(schema.tables),
      ...Object.values(schema.views),
    ].reduce((total, table) => total + table.columns.length, 0);
  }

  /**
   * Attach primary keys, foreign keys and row estimates to the captured base
   * tables. Missing or negative estimates (engines report -1 for "unknown")
   * become null.
   */
  protected applyTableRelations(
    schema: DatabaseSchema,
    primaryKeys: Map<string, string[]>,
    foreignKeys: Map<string, ForeignKey[]>,
    estimates: Map<string, unknown>
  ): void {
    for (const table of Object.values(schema.tables)) {
      const pk = primaryKeys.get(table.name) ?? [];
      table.primary_key = pk;
      table.foreign_keys = foreignKeys.get(table.name) ?? [];
      const raw = estimates.get(table.name);
      const estimate = raw === null || raw === undefined ? NaN : Number(raw);
      table.row_estimate = Number.isFinite(estimate) && estimate >= 0 ? estimate : null;
      for (const column of table.columns) {
        if (pk.includes(column.name)) {
          column.key = 'PRI';
        }
      }
    }
  }

  // ============================================================================
  // Redaction Management Methods
  // ============================================================================

  /**
   * Update redaction configuration at runtime
   */
  public updateRedactionConfig(redactionConfig: DatabaseConfig['redaction']): void {
    if (redactionConfig?.enabled) {
      this.redactionManager = new RedactionManager(redactionConfig);
    } else {
      this.redactionManager = undefined;
    }

    // Update the config
    this.config.redaction = redactionConfig;
  }

  /**
   * Check if redaction is enabled
   */
  public isRedactionEnabled(): boolean {
    return !!this.redactionManager;
  }

  /**
   * Get redaction configuration summary
   */
  public getRedactionSummary(): ReturnType<RedactionManager['getConfigurationSummary']> | null {
    return this.redactionManager?.getConfigurationSummary() || null;
  }

  /**
   * Test redaction with sample data
   */
  public testRedaction(
    sampleData: Record<string, unknown>
  ): ReturnType<RedactionManager['testRedaction']> | null {
    return this.redactionManager?.testRedaction(sampleData) || null;
  }
}

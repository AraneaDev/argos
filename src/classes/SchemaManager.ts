/**
 * Schema Manager for database schema caching and operations
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import { EventEmitter } from 'events';
import type { DatabaseSchema, DatabaseConfig, ColumnInfo, TableInfo } from '../types/index.js';
import type { ConnectionManager } from './ConnectionManager.js';
import { getLogger } from '../utils/logger.js';

// ============================================================================
// Schema Manager Implementation
// ============================================================================

/**
 *
 */
export class SchemaManager extends EventEmitter {
  private schemas = new Map<string, DatabaseSchema>();
  private captures = new Map<string, Promise<DatabaseSchema>>();
  private connectionManager: ConnectionManager;
  private schemaPath: string;
  private logger = getLogger();

  constructor(connectionManager: ConnectionManager, schemaPath = './schemas') {
    super();
    this.connectionManager = connectionManager;
    this.schemaPath = schemaPath;
  }

  /** Sanitize database name for use in file paths */
  private safeFileName(dbName: string): string {
    return basename(dbName).replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  // ============================================================================
  // Initialization and Setup
  // ============================================================================

  /**
   * Initialize schema manager and load cached schemas
   */
  async initialize(): Promise<void> {
    this.ensureSchemaDirectory();
    this.loadCachedSchemas();

    this.logger.info('Schema manager initialized', {
      schemaPath: this.schemaPath,
      cachedSchemas: this.schemas.size,
    });
  }

  // ============================================================================
  // Schema Operations
  // ============================================================================

  /**
   * Get cached schema for a database
   */
  getSchema(dbName: string): DatabaseSchema | null {
    return this.schemas.get(dbName) || null;
  }

  /**
   * Check if schema is cached for a database
   */
  hasSchema(dbName: string): boolean {
    return this.schemas.has(dbName);
  }

  /**
   * Capture and cache schema for a database
   */
  async captureSchema(dbName: string, _config: DatabaseConfig): Promise<DatabaseSchema> {
    try {
      this.logger.info(`Capturing schema for database '${dbName}'`);

      // Get or create connection
      const connectionInfo = await this.connectionManager.getConnection(dbName);

      // Get the adapter for this database
      const adapter = this.connectionManager.getAdapter(dbName);
      if (!adapter) {
        throw new Error(`No adapter found for database '${dbName}'`);
      }

      // Capture schema using the adapter
      const schema = await adapter.captureSchema(connectionInfo.connection);
      schema.fingerprint = await this.tryFingerprint(dbName);

      // Cache the schema
      this.schemas.set(dbName, schema);

      // Save to file
      await this.saveSchema(dbName, schema);

      this.logger.info(`Schema captured for '${dbName}'`, {
        tables: schema.summary.table_count,
        views: schema.summary.view_count,
        columns: schema.summary.total_columns,
      });

      // Emit event
      this.emit('schema-cached', dbName);

      return schema;
    } catch (error) {
      this.logger.error(`Failed to capture schema for '${dbName}'`, error as Error);
      throw error;
    }
  }

  /**
   * Capture a schema, sharing one in-flight capture per database between concurrent callers.
   * `captureSchema` gets the connection first.
   */
  captureSchemaOnce(dbName: string, config: DatabaseConfig): Promise<DatabaseSchema> {
    const running = this.captures.get(dbName);
    if (running) return running;
    const p = this.captureSchema(dbName, config).finally(() => this.captures.delete(dbName));
    this.captures.set(dbName, p);
    return p;
  }

  /**
   * Store a fingerprint on an already cached schema (e.g. one cached before fingerprints existed)
   */
  async setFingerprint(dbName: string, fingerprint: string): Promise<void> {
    const schema = this.schemas.get(dbName);
    if (!schema) return;
    schema.fingerprint = fingerprint;
    await this.saveSchema(dbName, schema);
  }

  /** Fingerprint for a freshly captured schema; a failure leaves it undefined */
  private async tryFingerprint(dbName: string): Promise<string | undefined> {
    try {
      return await this.connectionManager.schemaFingerprint(dbName);
    } catch (error) {
      this.logger.warning('Failed to fingerprint schema', {
        database: dbName,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * Refresh schema for a database (re-capture and update cache)
   */
  async refreshSchema(dbName: string): Promise<DatabaseSchema> {
    try {
      this.logger.info(`Refreshing schema for database '${dbName}'`);

      // Get connection info to determine config
      const connectionInfo = await this.connectionManager.getConnection(dbName);

      // Get adapter
      const adapter = this.connectionManager.getAdapter(dbName);
      if (!adapter) {
        throw new Error(`No adapter found for database '${dbName}'`);
      }

      // Remove existing cached schema
      this.schemas.delete(dbName);

      // Delete cached schema file
      const schemaFile = join(this.schemaPath, `${this.safeFileName(dbName)}.json`);
      if (existsSync(schemaFile)) {
        unlinkSync(schemaFile);
      }

      // Re-capture schema
      const schema = await adapter.captureSchema(connectionInfo.connection);
      schema.fingerprint = await this.tryFingerprint(dbName);

      // Cache the new schema
      this.schemas.set(dbName, schema);

      // Save to file
      await this.saveSchema(dbName, schema);

      this.logger.info(`Schema refreshed for '${dbName}'`, {
        tables: schema.summary.table_count,
        views: schema.summary.view_count,
        columns: schema.summary.total_columns,
      });

      // Emit event
      this.emit('schema-refreshed', dbName);

      return schema;
    } catch (error) {
      this.logger.error(`Failed to refresh schema for '${dbName}'`, error as Error);
      throw error;
    }
  }

  /**
   * Get schema context for a specific table or entire database
   */
  generateSchemaContext(dbName: string, tableName?: string): string {
    const schema = this.schemas.get(dbName);
    if (!schema) {
      return `No schema information available for database '${dbName}'.`;
    }

    const parts: string[] = [];
    parts.push(
      `${dbName} (${schema.type}) - ${schema.summary.table_count}T ${schema.summary.view_count}V ${schema.summary.total_columns}C`
    );

    // Format a single column compactly: name type[flags]
    const fmtCol = (col: ColumnInfo): string => {
      let s = col.name + ' ' + col.type;
      if (col.max_length) s += `(${col.max_length})`;
      else if (col.precision) s += `(${col.precision},${col.scale || 0})`;
      const flags: string[] = [];
      if (col.key && col.key !== '') flags.push(col.key);
      if (!col.nullable) flags.push('NN');
      if (col.default) flags.push(`d:${col.default}`);
      if (flags.length) s += ' [' + flags.join(',') + ']';
      if (col.comment) s += ' //' + col.comment;
      return s;
    };

    // Format a table/view with full column details
    const fmtTableFull = (name: string, info: TableInfo): string => {
      const cols = info.columns.map(fmtCol).join(', ');
      const comment = info.comment ? ` //${info.comment}` : '';
      return `${name}${comment}: ${cols}`;
    };

    // Format a table/view as summary (name + column count + key columns only)
    const fmtTableSummary = (name: string, info: TableInfo): string => {
      const keyColumns = info.columns
        .filter((c: ColumnInfo) => c.key && c.key !== '')
        .map((c: ColumnInfo) => c.name)
        .join(',');
      const comment = info.comment ? ` //${info.comment}` : '';
      const keys = keyColumns ? ` keys:[${keyColumns}]` : '';
      return `${name}(${info.columns.length}c${keys})${comment}`;
    };

    // If specific table requested, show full column details
    if (tableName) {
      const tableInfo = schema.tables[tableName] || schema.views[tableName];
      if (tableInfo) {
        parts.push(fmtTableFull(tableName, tableInfo));
      } else {
        parts.push(`Table '${tableName}' not found.`);
      }
      return parts.join('\n');
    }

    // For full schema: estimate output size to decide format
    // Use compact summary for large schemas, full details for small ones
    const totalColumns = schema.summary.total_columns;
    const useFullFormat = totalColumns <= 200;

    // Show all tables
    const tableEntries = Object.entries(schema.tables);
    if (tableEntries.length > 0) {
      parts.push('TABLES:');
      for (const [name, table] of tableEntries) {
        parts.push(useFullFormat ? fmtTableFull(name, table) : fmtTableSummary(name, table));
      }
    }

    // Show all views
    const viewEntries = Object.entries(schema.views);
    if (viewEntries.length > 0) {
      parts.push('VIEWS:');
      for (const [name, view] of viewEntries) {
        parts.push(useFullFormat ? fmtTableFull(name, view) : fmtTableSummary(name, view));
      }
    }

    if (!useFullFormat) {
      parts.push(
        `\nUse sql_get_schema with table parameter to see full column details for a specific table.`
      );
    }

    return parts.join('\n');
  }

  // ============================================================================
  // Schema Analysis and Statistics
  // ============================================================================

  // ============================================================================
  // File Operations
  // ============================================================================

  private ensureSchemaDirectory(): void {
    if (!existsSync(this.schemaPath)) {
      mkdirSync(this.schemaPath, { recursive: true, mode: 0o700 });
      this.logger.info(`Created schema directory: ${this.schemaPath}`);
    }
  }

  private loadCachedSchemas(): void {
    try {
      if (!existsSync(this.schemaPath)) {
        return;
      }

      const schemaFiles = readdirSync(this.schemaPath).filter((file) => file.endsWith('.json'));

      for (const file of schemaFiles) {
        // Audit M4: previously the in-memory key was derived from the sanitized
        // filename (`file.replace('.json', '')`), which does NOT match the
        // original database name used by captureSchema/refreshSchema (those key
        // by the real `dbName`). A database named `db/prod` is saved as
        // `db_prod.json`, so after a restart `getSchema('db/prod')` returned null
        // even though the file existed. Now we key by the `schema.database` field
        // stored inside the JSON, which is the original database name.
        try {
          const filePath = join(this.schemaPath, file);
          const schemaContent = readFileSync(filePath, 'utf-8');
          const schema = JSON.parse(schemaContent) as DatabaseSchema;

          // Validate schema structure
          if (this.isValidSchema(schema)) {
            // Use the original database name stored in the schema, falling back
            // to the filename only if the field is missing (legacy files).
            const dbName = schema.database || file.replace('.json', '');
            this.schemas.set(dbName, schema);
            this.logger.debug(`Loaded cached schema for '${dbName}'`, {
              tables: schema.summary.table_count,
              views: schema.summary.view_count,
              capturedAt: schema.captured_at,
            });
          } else {
            this.logger.warning(`Invalid schema file format: ${file}`);
            // Remove invalid schema file
            unlinkSync(filePath);
          }
        } catch (error) {
          this.logger.error(`Error loading schema file ${file}`, error as Error);
          // Try to remove corrupted file
          try {
            unlinkSync(join(this.schemaPath, file));
          } catch (cleanupError) {
            this.logger.error(
              `Error removing corrupted schema file ${file}`,
              cleanupError as Error
            );
          }
        }
      }

      this.logger.info(`Loaded ${this.schemas.size} cached schemas`);
    } catch (error) {
      this.logger.error('Error loading cached schemas', error as Error);
    }
  }

  private async saveSchema(dbName: string, schema: DatabaseSchema): Promise<void> {
    try {
      const filePath = join(this.schemaPath, `${this.safeFileName(dbName)}.json`);
      const schemaJson = JSON.stringify(schema, null, 2);

      writeFileSync(filePath, schemaJson, { encoding: 'utf-8', mode: 0o600 });

      this.logger.debug(`Schema saved for '${dbName}' to ${filePath}`);
    } catch (error) {
      this.logger.error(`Failed to save schema for '${dbName}'`, error as Error);
      throw error;
    }
  }

  private isValidSchema(value: unknown): value is DatabaseSchema {
    if (!value || typeof value !== 'object') return false;
    const s = value as Record<string, unknown>;
    const summary = s.summary as Record<string, unknown> | undefined;
    return (
      typeof s.database === 'string' &&
      typeof s.type === 'string' &&
      typeof s.captured_at === 'string' &&
      typeof s.tables === 'object' &&
      typeof s.views === 'object' &&
      !!summary &&
      typeof summary === 'object' &&
      typeof summary.table_count === 'number' &&
      typeof summary.view_count === 'number' &&
      typeof summary.total_columns === 'number'
    );
  }

  // ============================================================================
  // Maintenance Operations
  // ============================================================================
}

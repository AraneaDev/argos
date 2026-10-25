/**
 * Schema Manager for database schema caching and operations
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  statSync,
} from 'fs';
import { join, basename } from 'path';
import { EventEmitter } from 'events';
import type {
  DatabaseSchema,
  DatabaseListItem,
  DatabaseConfig,
  ColumnInfo,
  TableInfo,
} from '../types/index.js';
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

  /**
   * Clean up schema manager resources
   */
  async cleanup(): Promise<void> {
    // Save any pending schema changes
    await this.saveAllSchemas();
    this.schemas.clear();

    this.logger.info('Schema manager cleaned up');
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

  /**
   * Update database list items with schema information
   */
  enrichDatabaseListItems(items: DatabaseListItem[]): DatabaseListItem[] {
    return items.map((item) => {
      const schema = this.schemas.get(item.name);

      if (schema) {
        return {
          ...item,
          schema_cached: true,
          schema_info: schema.summary,
        };
      }

      return item;
    });
  }

  // ============================================================================
  // Schema Analysis and Statistics
  // ============================================================================

  /**
   * Get schema statistics across all cached schemas
   */
  getSchemaStatistics(): {
    totalDatabases: number;
    totalTables: number;
    totalViews: number;
    totalColumns: number;
    avgTablesPerDb: number;
    avgColumnsPerTable: number;
    schemasByType: Record<string, number>;
  } {
    const schemas = Array.from(this.schemas.values());

    const stats = {
      totalDatabases: schemas.length,
      totalTables: schemas.reduce((sum, s) => sum + s.summary.table_count, 0),
      totalViews: schemas.reduce((sum, s) => sum + s.summary.view_count, 0),
      totalColumns: schemas.reduce((sum, s) => sum + s.summary.total_columns, 0),
      avgTablesPerDb: 0,
      avgColumnsPerTable: 0,
      schemasByType: {} as Record<string, number>,
    };

    if (schemas.length > 0) {
      stats.avgTablesPerDb = Math.round((stats.totalTables / schemas.length) * 100) / 100;
    }

    if (stats.totalTables > 0) {
      stats.avgColumnsPerTable = Math.round((stats.totalColumns / stats.totalTables) * 100) / 100;
    }

    // Count schemas by database type
    for (const schema of schemas) {
      stats.schemasByType[schema.type] = (stats.schemasByType[schema.type] || 0) + 1;
    }

    return stats;
  }

  /**
   * Find tables across all schemas that match a pattern
   */
  findTables(pattern: string | RegExp): Array<{
    database: string;
    table: string;
    type: 'table' | 'view';
    columns: number;
  }> {
    const results: Array<{
      database: string;
      table: string;
      type: 'table' | 'view';
      columns: number;
    }> = [];

    const regex =
      typeof pattern === 'string' ? new RegExp(pattern.replace(/\*/g, '.*'), 'i') : pattern;

    for (const [dbName, schema] of this.schemas.entries()) {
      // Search tables
      for (const [tableName, table] of Object.entries(schema.tables)) {
        if (regex.test(tableName)) {
          results.push({
            database: dbName,
            table: tableName,
            type: 'table',
            columns: table.columns.length,
          });
        }
      }

      // Search views
      for (const [viewName, view] of Object.entries(schema.views)) {
        if (regex.test(viewName)) {
          results.push({
            database: dbName,
            table: viewName,
            type: 'view',
            columns: view.columns.length,
          });
        }
      }
    }

    return results.sort((a, b) => {
      if (a.database === b.database) {
        return a.table.localeCompare(b.table);
      }
      return a.database.localeCompare(b.database);
    });
  }

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

  private async saveAllSchemas(): Promise<void> {
    const promises = Array.from(this.schemas.entries()).map(([dbName, schema]) =>
      this.saveSchema(dbName, schema).catch((error) => {
        this.logger.error(`Failed to save schema for '${dbName}'`, error as Error);
      })
    );

    await Promise.all(promises);
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

  /**
   * Remove old or invalid schema cache files
   */
  async cleanupOldSchemas(maxAgeHours = 24 * 7): Promise<{ removed: number; errors: string[] }> {
    const removed: string[] = [];
    const errors: string[] = [];
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

    try {
      if (!existsSync(this.schemaPath)) {
        return { removed: 0, errors: [] };
      }

      const files = readdirSync(this.schemaPath);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const filePath = join(this.schemaPath, file);
          const stats = statSync(filePath);
          const age = Date.now() - stats.mtime.getTime();

          if (age > maxAgeMs) {
            // Read the file BEFORE deleting it to extract the correct in-memory
            // cache key (schema.database). After M4, the cache is keyed by the
            // original DB name, not the sanitized filename.
            let dbName = file.replace('.json', '');
            try {
              const content = readFileSync(filePath, 'utf-8');
              const schema = JSON.parse(content) as DatabaseSchema;
              if (schema.database) dbName = schema.database;
            } catch {
              // Fall back to filename-based key for legacy/corrupt files
            }

            unlinkSync(filePath);
            removed.push(file);
            this.schemas.delete(dbName);
          }
        } catch (error) {
          errors.push(`Error processing ${file}: ${(error as Error).message}`);
        }
      }

      if (removed.length > 0) {
        this.logger.info(`Cleaned up ${removed.length} old schema files`, { removed });
      }
    } catch (error) {
      errors.push(`Error during cleanup: ${(error as Error).message}`);
      this.logger.error('Error during schema cleanup', error as Error);
    }

    return { removed: removed.length, errors };
  }

  /**
   * Get schema cache information
   */
  getCacheInfo(): {
    schemasInMemory: number;
    schemaPath: string;
    filesOnDisk: number;
    totalSizeBytes: number;
  } {
    let filesOnDisk = 0;
    let totalSizeBytes = 0;

    try {
      if (existsSync(this.schemaPath)) {
        const files = readdirSync(this.schemaPath).filter((file) => file.endsWith('.json'));

        filesOnDisk = files.length;

        for (const file of files) {
          try {
            const filePath = join(this.schemaPath, file);
            const stats = statSync(filePath);
            totalSizeBytes += stats.size;
          } catch {
            // Ignore individual file errors
          }
        }
      }
    } catch (error) {
      this.logger.error('Error getting cache info', error as Error);
    }

    return {
      schemasInMemory: this.schemas.size,
      schemaPath: this.schemaPath,
      filesOnDisk,
      totalSizeBytes,
    };
  }
}

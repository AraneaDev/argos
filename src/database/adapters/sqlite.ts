/**
 * SQLite Database Adapter
 */

import * as sqlite3Ns from 'sqlite3';
import type { Database as SQLiteDatabase } from 'sqlite3';
// sqlite3 is a CommonJS native module. Under real Node ESM its exports are reachable only
// via `.default` (Node's cjs-module-lexer does not detect its dynamically-assigned named
// exports), so `import * as sqlite3; sqlite3.Database` is `undefined` at runtime and connect
// crashes with "Database is not a constructor". Resolve the concrete module object — this
// works for the real package (uses `.default`) and for the jest mock (no `.default`).
const sqlite3 = ((sqlite3Ns as unknown as { default?: typeof import('sqlite3') }).default ??
  sqlite3Ns) as typeof import('sqlite3');
const { Database } = sqlite3;
import { DatabaseAdapter } from './base.js';
import type {
  DatabaseConnection,
  QueryResult,
  DatabaseSchema,
  ColumnInfo,
  ForeignKey,
  TableInfo,
} from '../../types/index.js';

/**
 * A promise for a sqlite3 callback, settled on the next turn of the event loop.
 *
 * sqlite3 6.x runs its completion callbacks without draining the microtask queue, so a
 * promise settled directly inside one resumes its `await` only at the next macrotask. In
 * an idle MCP server reading stdin that was 8-30 s later, for every query, schema capture
 * and EXPLAIN. setImmediate settles it in the check phase that follows the callback, after
 * which the microtasks run.
 */
function onNextTurn<T>(
  executor: (resolve: (value: T) => void, reject: (error: unknown) => void) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) =>
    executor(
      (value) => setImmediate(resolve, value),
      (error) => setImmediate(reject, error)
    )
  );
}

// ============================================================================
// SQLite Adapter Implementation
// ============================================================================

/**
 *
 */
export class SQLiteAdapter extends DatabaseAdapter {
  // ============================================================================
  // Connection Management
  // ============================================================================

  /**
   *
   */
  async connect(): Promise<DatabaseConnection> {
    this.validateConfig(['file']);

    const file = this.config.file as string;

    // Fail secure: for SELECT-only databases, open READONLY. This prevents the default
    // OPEN_READWRITE|OPEN_CREATE behaviour from (a) creating a new database file at an
    // attacker-supplied path and (b) writing to an existing file (see FIND-110). Non
    // SELECT-only databases keep the default read/write/create mode.
    const mode = this.config.select_only
      ? sqlite3.OPEN_READONLY
      : sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE;

    return onNextTurn<DatabaseConnection>((resolve, reject) => {
      const db = new Database(file, mode, (err) => {
        if (err) {
          reject(this.createError('Failed to connect to SQLite database', err));
        } else {
          resolve(db as DatabaseConnection);
        }
      });
    });
  }

  /**
   *
   */
  async disconnect(connection: DatabaseConnection): Promise<void> {
    return onNextTurn<void>((resolve, reject) => {
      const sqliteDb = connection as SQLiteDatabase;
      sqliteDb.close((err) => {
        if (err) {
          reject(this.createError('Failed to disconnect from SQLite database', err));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   *
   */
  isConnected(connection: DatabaseConnection): boolean {
    try {
      // Connected means the handle says open === true. The null and
      // missing-property checks that used to precede this only restated it:
      // optional chaining covers a missing handle, the strict comparison covers
      // a missing or non-true property, and the catch covers a throwing getter.
      return (connection as unknown as Record<string, unknown> | null | undefined)?.open === true;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // Query Execution
  // ============================================================================

  /**
   *
   */
  async executeQuery(
    connection: DatabaseConnection,
    query: string,
    params: unknown[] = []
  ): Promise<QueryResult> {
    const startTime = Date.now();
    const cap = this.getMaxRows();
    const timeoutMs = this.getStatementTimeoutMs();

    return onNextTurn<QueryResult>((resolve, reject) => {
      const sqliteDb = connection as SQLiteDatabase;
      const kept: Record<string, unknown>[] = [];
      let observed = 0;
      let truncated = false;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = (err?: Error | null): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (err) {
          reject(this.createError('Failed to execute SQLite query', err));
          return;
        }
        resolve(this.buildStreamedResult(kept, observed, truncated, startTime, query));
      };

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          // Abort the in-flight statement server-side (FIND-108) instead of only giving up
          // client-side. interrupt() cancels the running query on this connection; queries
          // are serialized per connection so no other statement is affected.
          try {
            sqliteDb.interrupt();
          } catch {
            /* ignore — connection may already be closing */
          }
          finish(new Error(`Query timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        if (timer.unref) timer.unref();
      }

      // Stream rows one at a time, retaining only up to maxRows so a huge result set never
      // fully materializes in the Node heap (FIND-109). The observed count and truncation
      // flag are tracked independently of what is retained.
      sqliteDb.each(
        query,
        params,
        (err: Error | null, row: Record<string, unknown>) => {
          if (err) {
            finish(err);
            return;
          }
          observed++;
          if (kept.length < cap) kept.push(row);
          else truncated = true;
        },
        (err: Error | null) => finish(err)
      );
    });
  }

  // Required by the base contract but not on any live path: executeQuery streams
  // through buildStreamedResult, so this adapter never calls
  // normalizeQueryResult, the only caller of the two extractors below. They are
  // kept so the class satisfies DatabaseAdapter and so a future buffered path
  // has them, which is also why they carry no tests.
  protected extractRawRows(result: unknown): unknown[] {
    const sqliteResult = result as { rows: unknown[] };
    return Array.isArray(sqliteResult.rows) ? sqliteResult.rows : [];
  }

  protected extractFieldNames(result: unknown): string[] {
    const sqliteResult = result as { rows: Record<string, unknown>[] };
    if (!Array.isArray(sqliteResult.rows) || sqliteResult.rows.length === 0) {
      return [];
    }
    return Object.keys(sqliteResult.rows[0] || {});
  }

  // ============================================================================
  // Transaction Management
  // ============================================================================

  /**
   *
   */
  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    return onNextTurn<void>((resolve, reject) => {
      const sqliteDb = connection as SQLiteDatabase;
      sqliteDb.run('BEGIN TRANSACTION', (err) => {
        if (err) {
          reject(this.createError('Failed to begin SQLite transaction', err));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   *
   */
  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    return onNextTurn<void>((resolve, reject) => {
      const sqliteDb = connection as SQLiteDatabase;
      sqliteDb.run('COMMIT', (err) => {
        if (err) {
          reject(this.createError('Failed to commit SQLite transaction', err));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   *
   */
  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    return onNextTurn<void>((resolve, reject) => {
      const sqliteDb = connection as SQLiteDatabase;
      sqliteDb.run('ROLLBACK', (err) => {
        if (err) {
          reject(this.createError('Failed to rollback SQLite transaction', err));
        } else {
          resolve();
        }
      });
    });
  }

  // ============================================================================
  // Performance Analysis
  // ============================================================================

  /**
   *
   */
  buildExplainQuery(query: string): string {
    return `EXPLAIN QUERY PLAN ${query}`;
  }

  /**
   * Cheap query whose single row changes when the schema changes.
   */
  fingerprintQuery(): string {
    return `SELECT schema_version AS argos_fingerprint FROM pragma_schema_version`;
  }

  /**
   *
   */
  override getPerformanceRecommendations(explainResult: QueryResult, _query: string): string[] {
    const recommendations: string[] = [];
    const planText = this.flattenExplainPlan(explainResult);

    if (planText.includes('scan table')) {
      recommendations.push(' SQLITE: Table scan detected - consider adding indexes');
    }

    if (planText.includes('temp b-tree')) {
      recommendations.push(' SQLITE: Temporary B-tree created - optimize sorting operations');
    }

    recommendations.push(
      '[INFO] SQLITE: Run ANALYZE command periodically to update query planner statistics'
    );

    return recommendations;
  }

  // ============================================================================
  // Schema Capture
  // ============================================================================

  /**
   *
   */
  async captureSchema(connection: DatabaseConnection): Promise<DatabaseSchema> {
    try {
      const schema = this.createBaseSchema(this.config.file ?? '');

      // Get all tables and views
      const tables = await this.getTables(connection);

      // Process each table/view
      for (const table of tables) {
        const columns = await this.captureTableColumns(connection, table.name);

        const tableInfo: TableInfo = {
          name: table.name,
          type: table.type,
          comment: '', // SQLite doesn't support table comments
          columns,
        };

        if (table.type === 'table') {
          schema.tables[table.name] = tableInfo;
        } else {
          schema.views[table.name] = tableInfo;
        }
      }

      const primaryKeys = new Map<string, string[]>();
      const foreignKeys = new Map<string, ForeignKey[]>();
      for (const table of Object.values(schema.tables)) {
        primaryKeys.set(
          table.name,
          table.columns.filter((col) => col.key === 'PRI').map((col) => col.name)
        );
        foreignKeys.set(table.name, await this.captureForeignKeys(connection, table.name));
      }
      // SQLite keeps no row statistics short of scanning the table
      this.applyTableRelations(schema, primaryKeys, foreignKeys, new Map());

      this.updateSchemaSummary(schema);
      return schema;
    } catch (error) {
      throw this.createError('Failed to capture SQLite schema', error as Error);
    }
  }

  private async getTables(
    connection: DatabaseConnection
  ): Promise<Array<{ name: string; type: string }>> {
    return onNextTurn((resolve, reject) => {
      const sqliteDb = connection as SQLiteDatabase;

      const query = `
 SELECT name, type 
 FROM sqlite_master 
 WHERE type IN ('table', 'view') 
 AND name NOT LIKE 'sqlite_%'
 ORDER BY name
 `;

      sqliteDb.all(query, (err, rows) => {
        if (err) {
          reject(this.createError('Failed to get SQLite tables', err));
        } else {
          resolve(rows as Array<{ name: string; type: string }>);
        }
      });
    });
  }

  private async captureForeignKeys(
    connection: DatabaseConnection,
    tableName: string
  ): Promise<ForeignKey[]> {
    return onNextTurn((resolve, reject) => {
      (connection as SQLiteDatabase).all(`PRAGMA foreign_key_list(${tableName})`, (err, rows) => {
        if (err) {
          reject(this.createError(`Failed to get foreign keys for table ${tableName}`, err));
          return;
        }
        resolve(
          (rows as Array<{ id: number; seq: number; table: string; from: string; to: string }>)
            .slice()
            .sort((a, b) => a.id - b.id || a.seq - b.seq)
            .map((fk) => ({ column: fk.from, references: { table: fk.table, column: fk.to } }))
        );
      });
    });
  }

  private async captureTableColumns(
    connection: DatabaseConnection,
    tableName: string
  ): Promise<ColumnInfo[]> {
    return onNextTurn((resolve, reject) => {
      const sqliteDb = connection as SQLiteDatabase;

      // Use PRAGMA table_info to get column information
      sqliteDb.all(`PRAGMA table_info(${tableName})`, (err, rows) => {
        if (err) {
          reject(this.createError(`Failed to get columns for table ${tableName}`, err));
        } else {
          const found = rows as Array<{
            cid: number;
            name: string;
            type: string;
            notnull: number;
            dflt_value: unknown;
            pk: number;
          }>;
          const keyed = found.filter((col) => col.pk > 0).length;
          const columns = found.map(
            (col): ColumnInfo => ({
              name: col.name,
              type: col.type,
              // A lone INTEGER PRIMARY KEY is the rowid: never NULL, though table_info says notnull=0
              nullable:
                col.notnull === 0 &&
                !(keyed === 1 && col.pk > 0 && col.type.trim().toUpperCase() === 'INTEGER'),
              default: col.dflt_value,
              max_length: null,
              precision: null,
              scale: null,
              comment: '', // SQLite doesn't support column comments
              key: col.pk > 0 ? 'PRI' : '',
              extra: '',
            })
          );

          resolve(columns);
        }
      });
    });
  }

  // ============================================================================
  // SQLite-specific Methods
  // ============================================================================

  /**
   * Get SQLite version information
   */
  async getVersion(connection: DatabaseConnection): Promise<string> {
    return onNextTurn<string>((resolve, reject) => {
      const sqliteDb = connection as SQLiteDatabase;
      sqliteDb.get('SELECT sqlite_version() as version', (err, row) => {
        if (err) {
          reject(this.createError('Failed to get SQLite version', err));
        } else {
          resolve((row as { version: string })?.version || 'Unknown');
        }
      });
    });
  }

  /**
   * Get database file size and page information
   */
  async getDatabaseInfo(connection: DatabaseConnection): Promise<Record<string, unknown>> {
    return onNextTurn<Record<string, unknown>>((resolve, reject) => {
      const sqliteDb = connection as SQLiteDatabase;

      const queries = ['PRAGMA page_count', 'PRAGMA page_size', 'PRAGMA database_list'];

      const results: Record<string, unknown> = {};
      let completed = 0;

      queries.forEach((query, index) => {
        sqliteDb.get(query, (err, row) => {
          if (err) {
            reject(this.createError(`Failed to execute ${query}`, err));
            return;
          }

          switch (index) {
            case 0:
              results.page_count = (row as { page_count: number })?.page_count;
              break;
            case 1:
              results.page_size = (row as { page_size: number })?.page_size;
              break;
            case 2:
              results.database_list = row;
              break;
          }

          completed++;
          if (completed === queries.length) {
            // Calculate approximate file size
            if (typeof results.page_count === 'number' && typeof results.page_size === 'number') {
              results.approximate_size = results.page_count * results.page_size;
            }
            resolve(results);
          }
        });
      });
    });
  }

  /**
   * Analyze table for statistics (SQLite ANALYZE command)
   */
  async analyzeTable(connection: DatabaseConnection, tableName?: string): Promise<void> {
    return onNextTurn<void>((resolve, reject) => {
      const sqliteDb = connection as SQLiteDatabase;
      const query = tableName ? `ANALYZE ${tableName}` : 'ANALYZE';

      sqliteDb.run(query, (err) => {
        if (err) {
          reject(this.createError('Failed to analyze SQLite table', err));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Vacuum database to optimize storage
   */
  async vacuum(connection: DatabaseConnection): Promise<void> {
    return onNextTurn<void>((resolve, reject) => {
      const sqliteDb = connection as SQLiteDatabase;

      sqliteDb.run('VACUUM', (err) => {
        if (err) {
          reject(this.createError('Failed to vacuum SQLite database', err));
        } else {
          resolve();
        }
      });
    });
  }
}

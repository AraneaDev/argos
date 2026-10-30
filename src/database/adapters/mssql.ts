/**
 * SQL Server (MSSQL) Database Adapter
 */

import * as sqlNs from 'mssql';
import type { ConnectionPool as MSSQLConnectionPool, IResult, config as MSSQLConfig } from 'mssql';
// mssql is a CommonJS module whose value exports (ConnectionPool, Request, TYPES, …) are
// reachable only via `.default` under real Node ESM — `import * as sql; sql.ConnectionPool`
// is `undefined` at runtime and connect crashes. Resolve the concrete module object (works
// for the real package via `.default` and for the jest mock, which has no `.default`).
const sql = ((sqlNs as unknown as { default?: typeof sqlNs }).default ?? sqlNs) as typeof sqlNs;
import { DatabaseAdapter } from './base.js';
import { azureCliCredential } from '../azure-credential.js';
import { MSSQL_PRIVILEGE_QUERY, mssqlPrivileges, type PrivilegeReport } from '../privileges.js';
import type {
  DatabaseConnection,
  QueryResult,
  DatabaseSchema,
  ColumnInfo,
  ForeignKey,
  TableInfo,
} from '../../types/index.js';

// ============================================================================
// SQL Server Adapter Implementation
// ============================================================================

/**
 *
 */
/**
 * Whether a connect failure came from acquiring the token rather than from the
 * connection itself. `@azure/identity` raises these two; everything else --- a
 * firewall, a private-endpoint-only server, a wrong database name --- arrives
 * as a driver ConnectionError, and pointing the user at `az login` for one of
 * those sends them somewhere the problem is not.
 */
function isCredentialFailure(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === 'CredentialUnavailableError' || name === 'AuthenticationError';
}

/**
 *
 */
export class MSSQLAdapter extends DatabaseAdapter {
  // ============================================================================
  // Connection Management
  // ============================================================================

  /**
   *
   */
  async connect(): Promise<DatabaseConnection> {
    const azureCli = this.config.authentication === 'azure-cli';

    this.validateConfig(
      azureCli ? ['host', 'database'] : ['host', 'database', 'username', 'password']
    );

    const connectionConfig: MSSQLConfig = {
      server: this.config.host as string,
      port: this.parseConfigValue(this.config.port, 'number', 1433),
      database: this.config.database as string,
      connectionTimeout: this.connectionTimeout,
      requestTimeout: this.connectionTimeout,
      options: {
        // A bearer token on an unencrypted wire is worse than a password: it is
        // replayable against every database the signed-in identity can reach.
        // Azure SQL requires TLS anyway, so encrypt=false is refused, not honoured.
        encrypt: azureCli ? true : this.parseConfigValue(this.config.encrypt, 'boolean', true),
        // encrypt=true alone is not protection. An attacker who presents a
        // forged certificate still terminates the TLS and captures the bearer
        // token, so ssl_verify=false cannot reach the token-auth path either.
        trustServerCertificate: azureCli ? false : !this.verifyServerCertificate(),
        enableArithAbort: true,
      },
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
      },
    };

    if (azureCli) {
      connectionConfig.authentication = {
        type: 'token-credential',
        options: {
          credential: await azureCliCredential(this.config),
        },
      };
    } else {
      connectionConfig.user = this.config.username as string;
      connectionConfig.password = this.config.password as string;
    }

    try {
      const pool = new sql.ConnectionPool(connectionConfig);
      await pool.connect();
      return pool as DatabaseConnection;
    } catch (error) {
      throw this.createError(
        azureCli && isCredentialFailure(error)
          ? 'Failed to connect to SQL Server database using Azure CLI authentication. ' +
              'Check that the Azure CLI is installed and that `az login` has been run'
          : 'Failed to connect to SQL Server database',
        error as Error
      );
    }
  }

  /**
   *
   */
  async disconnect(connection: DatabaseConnection): Promise<void> {
    try {
      const mssqlPool = connection as MSSQLConnectionPool;
      await mssqlPool.close();
    } catch (error) {
      throw this.createError('Failed to disconnect from SQL Server database', error as Error);
    }
  }

  /**
   *
   */
  isConnected(connection: DatabaseConnection): boolean {
    try {
      const mssqlPool = connection as MSSQLConnectionPool;
      return !!(mssqlPool && mssqlPool.connected);
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

    try {
      const mssqlPool = connection as MSSQLConnectionPool;
      const request = mssqlPool.request();

      // Add parameters if provided
      params.forEach((param, index) => {
        request.input(`param${index}`, param);
      });

      // Replace ? placeholders with named parameters for SQL Server, skipping any
      // '?' that appears inside a string literal so parameter order stays aligned.
      const processedQuery = this.replacePlaceholders(query);

      const result = await request.query(processedQuery);
      return this.normalizeQueryResult(result, startTime, undefined, query);
    } catch (error) {
      throw this.createError('Failed to execute SQL Server query', error as Error);
    }
  }

  /**
   * Convert positional '?' placeholders to `@paramN`, ignoring '?' inside string
   * literals and comments so a literal question mark does not shift parameter
   * order. Parameters are bound positionally as `@param0`..`@paramN-1`, so a slot
   * consumed by a question mark that was never a placeholder leaves the real
   * one referring to a variable that was never declared.
   */
  private replacePlaceholders(query: string): string {
    let out = '';
    let paramIndex = 0;
    let inSingle = false;
    let inDouble = false;
    let inBracket = false;
    let inLineComment = false;
    // T-SQL block comments nest, so this is a depth rather than a flag.
    let blockCommentDepth = 0;

    for (let i = 0; i < query.length; i++) {
      const ch = query[i];
      const next = query[i + 1];

      // Inside a -- line comment: it ends at the newline, which is kept.
      if (inLineComment) {
        out += ch;
        if (ch === '\n') {
          inLineComment = false;
        }
        continue;
      }
      // Inside a /* block comment */, which may contain further nested ones.
      if (blockCommentDepth > 0) {
        if (ch === '/' && next === '*') {
          out += ch + next;
          i++;
          blockCommentDepth++;
        } else if (ch === '*' && next === '/') {
          out += ch + next;
          i++;
          blockCommentDepth--;
        } else {
          out += ch;
        }
        continue;
      }
      // Inside a single-quoted string literal: '' is an escaped quote (stays in string).
      if (inSingle) {
        out += ch;
        if (ch === "'") {
          if (next === "'") {
            out += next;
            i++;
          } else {
            inSingle = false;
          }
        }
        continue;
      }
      // Inside a double-quoted identifier: "" is an escaped quote.
      if (inDouble) {
        out += ch;
        if (ch === '"') {
          if (next === '"') {
            out += next;
            i++;
          } else {
            inDouble = false;
          }
        }
        continue;
      }
      // Inside a [bracketed identifier]: ]] is an escaped bracket.
      if (inBracket) {
        out += ch;
        if (ch === ']') {
          if (next === ']') {
            out += next;
            i++;
          } else {
            inBracket = false;
          }
        }
        continue;
      }

      // Not inside any quoted/bracketed/comment context. Comment openers are
      // tested before the quote openers so a '?' after them is never bound, and
      // after them so a '--' inside a string is still just text.
      if (ch === '-' && next === '-') {
        inLineComment = true;
        out += ch + next;
        i++;
      } else if (ch === '/' && next === '*') {
        blockCommentDepth = 1;
        out += ch + next;
        i++;
      } else if (ch === "'") {
        inSingle = true;
        out += ch;
      } else if (ch === '"') {
        inDouble = true;
        out += ch;
      } else if (ch === '[') {
        inBracket = true;
        out += ch;
      } else if (ch === '?') {
        out += `@param${paramIndex++}`;
      } else {
        out += ch;
      }
    }

    return out;
  }

  protected extractRawRows(result: unknown): unknown[] {
    const mssqlResult = result as IResult<unknown>;
    return Array.isArray(mssqlResult.recordset) ? mssqlResult.recordset : [];
  }

  protected extractFieldNames(result: unknown): string[] {
    const mssqlResult = result as IResult<Record<string, unknown>>;
    if (!Array.isArray(mssqlResult.recordset) || mssqlResult.recordset.length === 0) {
      return [];
    }
    return Object.keys(mssqlResult.recordset[0] || {});
  }

  // ============================================================================
  // Transaction Management
  // ============================================================================

  /**
   *
   */
  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    try {
      const mssqlPool = connection as MSSQLConnectionPool;
      const request = mssqlPool.request();
      await request.query('BEGIN TRANSACTION');
    } catch (error) {
      throw this.createError('Failed to begin SQL Server transaction', error as Error);
    }
  }

  /**
   *
   */
  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    try {
      const mssqlPool = connection as MSSQLConnectionPool;
      const request = mssqlPool.request();
      await request.query('COMMIT TRANSACTION');
    } catch (error) {
      throw this.createError('Failed to commit SQL Server transaction', error as Error);
    }
  }

  /**
   *
   */
  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    try {
      const mssqlPool = connection as MSSQLConnectionPool;
      const request = mssqlPool.request();
      await request.query('ROLLBACK TRANSACTION');
    } catch (error) {
      throw this.createError('Failed to rollback SQL Server transaction', error as Error);
    }
  }

  // ============================================================================
  // Performance Analysis
  // ============================================================================

  /**
   *
   */
  buildExplainQuery(query: string): string {
    return `SET SHOWPLAN_ALL ON; ${query}; SET SHOWPLAN_ALL OFF`;
  }

  /** What this connection's role may do, from one read-only query. */
  override async probePrivileges(connection: DatabaseConnection): Promise<PrivilegeReport> {
    return mssqlPrivileges(await this.executeQuery(connection, MSSQL_PRIVILEGE_QUERY));
  }

  /**
   * Cheap query whose single row changes when the schema changes.
   */
  fingerprintQuery(): string {
    return `SELECT COUNT(*) AS n, CONVERT(varchar(30), MAX(modify_date), 126) AS argos_fingerprint FROM sys.objects WHERE is_ms_shipped = 0`;
  }

  // ============================================================================
  // Schema Capture
  // ============================================================================

  /**
   *
   */
  async captureSchema(connection: DatabaseConnection): Promise<DatabaseSchema> {
    try {
      const schema = this.createBaseSchema(this.config.database ?? '');

      // Get all tables and views
      const tablesQuery = `
 SELECT 
 TABLE_NAME,
 TABLE_TYPE,
 '' as TABLE_COMMENT
 FROM INFORMATION_SCHEMA.TABLES 
 WHERE TABLE_SCHEMA = 'dbo'
 ORDER BY TABLE_NAME
 `;

      const mssqlPool = connection as MSSQLConnectionPool;
      const tablesResult = await mssqlPool.request().query(tablesQuery);

      // Process each table/view
      for (const table of tablesResult.recordset) {
        const columns = await this.captureTableColumns(connection, table.TABLE_NAME);

        const tableInfo: TableInfo = {
          name: table.TABLE_NAME,
          type: table.TABLE_TYPE,
          comment: table.TABLE_COMMENT || '',
          columns,
        };

        if (table.TABLE_TYPE === 'BASE TABLE') {
          schema.tables[table.TABLE_NAME] = tableInfo;
        } else {
          schema.views[table.TABLE_NAME] = tableInfo;
        }
      }

      await this.captureRelations(connection, schema);

      this.updateSchemaSummary(schema);
      return schema;
    } catch (error) {
      throw this.createError('Failed to capture SQL Server schema', error as Error);
    }
  }

  private async captureRelations(
    connection: DatabaseConnection,
    schema: DatabaseSchema
  ): Promise<void> {
    const pool = connection as MSSQLConnectionPool;

    const pkResult = await pool.request().query(`
 SELECT t.name AS table_name, c.name AS column_name
 FROM sys.indexes i
 JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
 JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
 JOIN sys.tables t ON t.object_id = i.object_id
 WHERE i.is_primary_key = 1 AND SCHEMA_NAME(t.schema_id) = 'dbo'
 ORDER BY t.name, ic.key_ordinal
 `);
    const fkResult = await pool.request().query(`
 SELECT tp.name AS table_name, cp.name AS column_name,
 tr.name AS referenced_table, cr.name AS referenced_column
 FROM sys.foreign_key_columns fkc
 JOIN sys.tables tp ON tp.object_id = fkc.parent_object_id
 JOIN sys.columns cp ON cp.object_id = fkc.parent_object_id AND cp.column_id = fkc.parent_column_id
 JOIN sys.tables tr ON tr.object_id = fkc.referenced_object_id
 JOIN sys.columns cr ON cr.object_id = fkc.referenced_object_id AND cr.column_id = fkc.referenced_column_id
 WHERE SCHEMA_NAME(tp.schema_id) = 'dbo'
 ORDER BY tp.name, fkc.constraint_column_id
 `);
    const rowsResult = await pool.request().query(`
 SELECT t.name AS table_name, SUM(p.rows) AS row_estimate
 FROM sys.tables t
 JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
 WHERE SCHEMA_NAME(t.schema_id) = 'dbo'
 GROUP BY t.name
 `);

    const primaryKeys = new Map<string, string[]>();
    for (const row of pkResult.recordset) {
      primaryKeys.set(row.table_name, [
        ...(primaryKeys.get(row.table_name) ?? []),
        row.column_name,
      ]);
    }
    const foreignKeys = new Map<string, ForeignKey[]>();
    for (const row of fkResult.recordset) {
      foreignKeys.set(row.table_name, [
        ...(foreignKeys.get(row.table_name) ?? []),
        {
          column: row.column_name,
          references: { table: row.referenced_table, column: row.referenced_column },
        },
      ]);
    }
    const estimates = new Map<string, unknown>(
      rowsResult.recordset.map((row: { table_name: string; row_estimate: unknown }) => [
        row.table_name,
        row.row_estimate,
      ])
    );

    this.applyTableRelations(schema, primaryKeys, foreignKeys, estimates);
  }

  private async captureTableColumns(
    connection: DatabaseConnection,
    tableName: string
  ): Promise<ColumnInfo[]> {
    const columnsQuery = `
 SELECT 
 c.COLUMN_NAME,
 c.DATA_TYPE,
 c.IS_NULLABLE,
 c.COLUMN_DEFAULT,
 c.CHARACTER_MAXIMUM_LENGTH,
 c.NUMERIC_PRECISION,
 c.NUMERIC_SCALE,
 ISNULL(ep.value, '') as COLUMN_COMMENT,
 CASE 
 WHEN pk.COLUMN_NAME IS NOT NULL THEN 'PRI'
 ELSE ''
 END as COLUMN_KEY
 FROM INFORMATION_SCHEMA.COLUMNS c
 LEFT JOIN sys.extended_properties ep ON ep.major_id = OBJECT_ID('dbo.' + c.TABLE_NAME)
 AND ep.minor_id = c.ORDINAL_POSITION
 AND ep.name = 'MS_Description'
 LEFT JOIN (
 SELECT ku.COLUMN_NAME, ku.TABLE_NAME
 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
 JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
 WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
 ) pk ON pk.TABLE_NAME = c.TABLE_NAME AND pk.COLUMN_NAME = c.COLUMN_NAME
 WHERE c.TABLE_NAME = @tableName
 ORDER BY c.ORDINAL_POSITION
 `;

    const mssqlPool = connection as MSSQLConnectionPool;
    const request = mssqlPool.request();
    request.input('tableName', tableName);
    const columnsResult = await request.query(columnsQuery);

    return columnsResult.recordset.map((col): ColumnInfo => ({
      name: col.COLUMN_NAME,
      type: col.DATA_TYPE,
      nullable: col.IS_NULLABLE === 'YES',
      default: col.COLUMN_DEFAULT,
      max_length: col.CHARACTER_MAXIMUM_LENGTH,
      precision: col.NUMERIC_PRECISION,
      scale: col.NUMERIC_SCALE,
      comment: col.COLUMN_COMMENT || '',
      key: col.COLUMN_KEY || '',
      extra: '',
    }));
  }

  // ============================================================================
  // SQL Server-specific Methods
  // ============================================================================
}

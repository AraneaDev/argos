/**
 * PostgreSQL Database Adapter
 */

import * as tls from 'node:tls';
import * as pg from 'pg';
import type { Client as PgClient, PoolClient } from 'pg';
import { DatabaseAdapter } from './base.js';
import { usesAzureCliAuth } from '../../utils/config.js';
import { azureCliCredential, type EntraCredential } from '../azure-credential.js';
import {
  POSTGRES_PRIVILEGE_QUERY,
  postgresPrivileges,
  type PrivilegeReport,
} from '../privileges.js';
import type {
  DatabaseConnection,
  QueryResult,
  DatabaseSchema,
  ColumnInfo,
  ForeignKey,
  TableInfo,
} from '../../types/index.js';

// ============================================================================
// PostgreSQL Adapter Implementation
// ============================================================================

/** The resource Azure Database for PostgreSQL accepts Entra access tokens for. */
export const AZURE_POSTGRES_SCOPE = 'https://ossrdbms-aad.database.windows.net/.default';

/**
 * Whether a connect failure came from acquiring the token rather than from the
 * connection itself; see the same check in the SQL Server adapter.
 */
function isCredentialFailure(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === 'CredentialUnavailableError' || name === 'AuthenticationError';
}

/**
 *
 */
export class PostgreSQLAdapter extends DatabaseAdapter {
  private _pool?: pg.Pool;
  private credential?: Promise<EntraCredential>;

  /** The Azure CLI credential, built once per adapter. */
  private entraCredential(): Promise<EntraCredential> {
    this.credential ??= azureCliCredential(this.config);
    return this.credential;
  }

  /**
   * A fresh Entra access token, the password for one new connection. Tokens live
   * 5 to 60 minutes, so the pool asks again for every connection it opens rather
   * than holding one string that would expire under it.
   */
  private async entraToken(): Promise<string> {
    const credential = await this.entraCredential();
    const token = await credential.getToken(AZURE_POSTGRES_SCOPE);
    if (!token?.token) {
      const error = new Error('The Azure CLI returned no access token');
      error.name = 'CredentialUnavailableError';
      throw error;
    }
    return token.token;
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  private getPool(): pg.Pool {
    if (!this._pool) {
      const host = this.config.host as string;
      const database = this.config.database as string;
      const username = this.config.username as string;
      const password = this.config.password as string;
      const azureCli = usesAzureCliAuth(this.config);

      // Same resolution as every other adapter: query_timeout, else the
      // connection timeout, else 30s. This used to read query_timeout directly
      // and ignore both a numeric string and the timeout fallback, so the same
      // configuration could mean one thing here and another on MySQL.
      const statementTimeout = this.getStatementTimeoutMs();

      const poolConfig: pg.PoolConfig = {
        host,
        port: this.parseConfigValue(this.config.port, 'number', 5432),
        database,
        user: username,
        // An async password is called by pg for every new connection.
        password: azureCli ? () => this.entraToken() : password,
        max: 10,
        connectionTimeoutMillis: this.connectionTimeout,
        // Server-side cancellation: PostgreSQL aborts a query that runs longer than
        // this, so a runaway query cannot tie up the connection indefinitely.
        statement_timeout: statementTimeout,
        query_timeout: statementTimeout,
      };

      if (azureCli) {
        // A bearer token on an unverified connection goes to whoever answers, and is
        // replayable against every database the identity can reach: TLS with
        // certificate verification, whatever ssl and ssl_verify say.
        poolConfig.ssl = this.verifiedTls();
      } else if (this.config.ssl !== undefined) {
        // Mirror the same SSL branches as the old connect() to avoid behavior change
        const sslEnabled = this.parseConfigValue(this.config.ssl, 'boolean', false);
        if (sslEnabled) {
          const sslVerify = this.verifyServerCertificate();
          poolConfig.ssl = sslVerify ? this.verifiedTls() : { rejectUnauthorized: false };
        } else {
          poolConfig.ssl = false; // explicitly disable
        }
      }

      this._pool = new pg.Pool(poolConfig);
    }
    return this._pool;
  }

  /**
   * TLS with certificate verification. Through an SSH tunnel the connection goes to
   * 127.0.0.1, so the certificate is checked against the database's own hostname
   * (tls_servername), which is also sent as SNI.
   */
  private verifiedTls(): pg.PoolConfig['ssl'] {
    const name = this.config.tls_servername;
    if (!name) return { rejectUnauthorized: true };
    return {
      rejectUnauthorized: true,
      servername: name,
      checkServerIdentity: (_host, cert) => tls.checkServerIdentity(name, cert),
    };
  }

  /**
   *
   */
  async connect(): Promise<DatabaseConnection> {
    const azureCli = usesAzureCliAuth(this.config);
    this.validateConfig(
      azureCli ? ['host', 'database', 'username'] : ['host', 'database', 'username', 'password']
    );
    try {
      const client: PoolClient = await this.getPool().connect();
      if (this.config.read_only_session) {
        try {
          // Database-enforced: any write in this session fails with
          // "cannot execute ... in a read-only transaction".
          await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
        } catch (error) {
          client.release();
          throw error;
        }
      }
      return client as DatabaseConnection;
    } catch (error) {
      throw this.createError(
        azureCli && isCredentialFailure(error)
          ? 'Failed to connect to PostgreSQL using Azure CLI authentication. ' +
              'Check that the Azure CLI is installed and that `az login` has been run'
          : 'Failed to acquire PostgreSQL connection from pool',
        error as Error
      );
    }
  }

  /**
   *
   */
  async disconnect(connection: DatabaseConnection): Promise<void> {
    try {
      const poolClient = connection as PoolClient;
      poolClient.release();
    } catch (error) {
      throw this.createError('Failed to release PostgreSQL connection to pool', error as Error);
    }
  }

  /**
   *
   */
  async destroyPool(): Promise<void> {
    if (this._pool) {
      await this._pool.end();
      this._pool = undefined;
    }
  }

  /**
   *
   */
  isConnected(connection: DatabaseConnection): boolean {
    try {
      const pgClient = connection as PgClient & {
        connection?: { stream?: { destroyed?: boolean } };
      };
      if (!pgClient?.connection?.stream) return false;
      return pgClient.connection.stream.destroyed !== true;
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
      const pgClient = connection as PgClient;
      const result = await pgClient.query(query, params);

      return this.normalizeQueryResult(result, startTime, undefined, query);
    } catch (error) {
      throw this.createError('Failed to execute PostgreSQL query', error as Error);
    }
  }

  protected extractRawRows(result: unknown): unknown[] {
    const pgResult = result as pg.QueryResult;
    return Array.isArray(pgResult.rows) ? pgResult.rows : [];
  }

  protected extractFieldNames(result: unknown): string[] {
    const pgResult = result as pg.QueryResult;
    return pgResult.fields?.map((field: pg.FieldDef) => field.name) || [];
  }

  // ============================================================================
  // Transaction Management
  // ============================================================================

  /**
   *
   */
  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    try {
      const pgClient = connection as PgClient;
      await pgClient.query('BEGIN');
    } catch (error) {
      throw this.createError('Failed to begin PostgreSQL transaction', error as Error);
    }
  }

  /**
   *
   */
  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    try {
      const pgClient = connection as PgClient;
      await pgClient.query('COMMIT');
    } catch (error) {
      throw this.createError('Failed to commit PostgreSQL transaction', error as Error);
    }
  }

  /**
   *
   */
  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    try {
      const pgClient = connection as PgClient;
      await pgClient.query('ROLLBACK');
    } catch (error) {
      throw this.createError('Failed to rollback PostgreSQL transaction', error as Error);
    }
  }

  // ============================================================================
  // Performance Analysis
  // ============================================================================

  /**
   *
   */
  buildExplainQuery(query: string): string {
    // Use JSON format for better parsing and analysis
    return `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`;
  }

  /** What this connection's role may do, from one read-only query. */
  override async probePrivileges(connection: DatabaseConnection): Promise<PrivilegeReport> {
    return postgresPrivileges(await this.executeQuery(connection, POSTGRES_PRIVILEGE_QUERY));
  }

  /**
   * Cheap query whose single row changes when the schema changes.
   */
  fingerprintQuery(): string {
    return `SELECT md5(string_agg(table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||is_nullable, ',' ORDER BY table_schema, table_name, ordinal_position)) AS argos_fingerprint FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema')`;
  }

  /**
   *
   */
  override getPerformanceRecommendations(explainResult: QueryResult, query: string): string[] {
    const recommendations: string[] = [];
    const planText = this.flattenExplainPlan(explainResult);

    if (planText.includes('seq scan')) {
      recommendations.push(' POSTGRESQL: Sequential scan detected - consider adding indexes');
    }

    if (planText.includes('nested loop') && planText.includes('buffers')) {
      recommendations.push(' POSTGRESQL: Nested loops with buffer usage - check join conditions');
    }

    if (query.toUpperCase().includes('LIKE') && query.includes('%')) {
      recommendations.push(
        ' POSTGRESQL: LIKE with wildcards - consider full-text search (GIN indexes)'
      );
    }

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
      const schema = this.createBaseSchema(this.config.database ?? '');

      // Get all tables and views from public schema
      const tablesQuery = `
 SELECT 
 table_name,
 table_type,
 COALESCE(obj_description(c.oid), '') as table_comment
 FROM information_schema.tables t
 LEFT JOIN pg_class c ON c.relname = t.table_name
 WHERE table_schema = 'public'
 ORDER BY table_name
 `;

      const tablesResult = await (connection as PgClient).query(tablesQuery);

      // Process each table/view
      for (const table of tablesResult.rows) {
        const columns = await this.captureTableColumns(connection, table.table_name);

        const tableInfo: TableInfo = {
          name: table.table_name,
          type: table.table_type,
          comment: table.table_comment || '',
          columns,
        };

        if (table.table_type === 'BASE TABLE') {
          schema.tables[table.table_name] = tableInfo;
        } else {
          schema.views[table.table_name] = tableInfo;
        }
      }

      await this.captureRelations(connection, schema);

      this.updateSchemaSummary(schema);
      return schema;
    } catch (error) {
      throw this.createError('Failed to capture PostgreSQL schema', error as Error);
    }
  }

  private async captureRelations(
    connection: DatabaseConnection,
    schema: DatabaseSchema
  ): Promise<void> {
    const pgClient = connection as PgClient;

    // pg_constraint pairs conkey/confkey by position, so composite foreign keys
    // yield exactly their own column pairs and same-named constraints on
    // different tables never mix (information_schema cannot guarantee either).
    const keysResult = await pgClient.query(`
 SELECT
 CASE con.contype WHEN 'p' THEN 'PRIMARY KEY' ELSE 'FOREIGN KEY' END AS constraint_type,
 cl.relname AS table_name,
 att.attname AS column_name,
 fcl.relname AS foreign_table_name,
 fatt.attname AS foreign_column_name
 FROM pg_constraint con
 JOIN pg_class cl ON cl.oid = con.conrelid
 JOIN pg_namespace n ON n.oid = cl.relnamespace
 CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(attnum, fattnum, ord)
 JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
 LEFT JOIN pg_class fcl ON fcl.oid = con.confrelid
 LEFT JOIN pg_attribute fatt ON fatt.attrelid = con.confrelid AND fatt.attnum = k.fattnum
 WHERE n.nspname = 'public' AND con.contype IN ('p', 'f')
 ORDER BY cl.relname, con.oid, k.ord
 `);

    const estimatesResult = await pgClient.query(`
 SELECT c.relname AS table_name, c.reltuples AS row_estimate
 FROM pg_class c
 JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
 `);

    const primaryKeys = new Map<string, string[]>();
    const foreignKeys = new Map<string, ForeignKey[]>();
    for (const row of keysResult.rows) {
      if (row.constraint_type === 'PRIMARY KEY') {
        primaryKeys.set(row.table_name, [
          ...(primaryKeys.get(row.table_name) ?? []),
          row.column_name,
        ]);
      } else {
        foreignKeys.set(row.table_name, [
          ...(foreignKeys.get(row.table_name) ?? []),
          {
            column: row.column_name,
            references: { table: row.foreign_table_name, column: row.foreign_column_name },
          },
        ]);
      }
    }
    const estimates = new Map<string, unknown>(
      estimatesResult.rows.map((row: { table_name: string; row_estimate: unknown }) => [
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
 column_name,
 data_type,
 is_nullable,
 column_default,
 character_maximum_length,
 numeric_precision,
 numeric_scale,
 COALESCE(col_description(pgc.oid, cols.ordinal_position), '') as column_comment
 FROM information_schema.columns cols
 LEFT JOIN pg_class pgc ON pgc.relname = cols.table_name
 WHERE cols.table_schema = 'public' AND cols.table_name = $1
 ORDER BY cols.ordinal_position
 `;

    const columnsResult = await (connection as PgClient).query(columnsQuery, [tableName]);

    return columnsResult.rows.map((col): ColumnInfo => ({
      name: col.column_name,
      type: col.data_type,
      nullable: col.is_nullable === 'YES',
      default: col.column_default,
      max_length: col.character_maximum_length,
      precision: col.numeric_precision,
      scale: col.numeric_scale,
      comment: col.column_comment || '',
      key: '', // PostgreSQL doesn't have a direct equivalent to MySQL's COLUMN_KEY
      extra: '', // PostgreSQL doesn't have a direct equivalent to MySQL's EXTRA
    }));
  }

  // ============================================================================
  // PostgreSQL-specific Methods
  // ============================================================================
}

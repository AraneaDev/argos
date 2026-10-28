/**
 * Schema Tool Handlers
 * Handles sql_get_schema, sql_refresh_schema, sql_list_databases, sql_test_connection
 */

import type {
  SQLGetSchemaArgs,
  SQLTestConnectionArgs,
  SQLRefreshSchemaArgs,
  MCPToolResponse,
  DatabaseListItem,
} from '../../types/index.js';
import { formatDatabaseSummary, createToolResponse } from '../../utils/response-formatter.js';
import { getErrorMessage, sanitizeError, ConnectionError } from '../../utils/error-handler.js';
import type { ToolHandlerContext } from './types.js';
import { requireDbConfig } from './types.js';
import { ensureSchema } from './name-check.js';

/** sql_get_schema: the schema of a database, or of one table in it; captured first if not cached. */
export async function handleGetSchema(
  ctx: ToolHandlerContext,
  args: SQLGetSchemaArgs
): Promise<MCPToolResponse> {
  const { database, table } = args;

  try {
    let schema = ctx.schemaManager.getSchema(database);
    if (!schema) {
      schema = await ensureSchema(ctx, database, requireDbConfig(ctx.config, database));
    }
    if (!schema) {
      return createToolResponse(` Could not capture the schema for '${database}'.`);
    }

    const schemaText = ctx.schemaManager.generateSchemaContext(database, table);

    return createToolResponse(schemaText);
  } catch (error) {
    const errorMessage = sanitizeError(error);
    return createToolResponse(` Failed to get schema for ${database}: ${errorMessage}`, true);
  }
}

/** sql_refresh_schema: capture a database's schema again and update the cache. */
export async function handleRefreshSchema(
  ctx: ToolHandlerContext,
  args: SQLRefreshSchemaArgs
): Promise<MCPToolResponse> {
  const { database } = args;

  try {
    const dbConfig = requireDbConfig(ctx.config, database);

    // Ensure connection exists
    let connection = await ctx.connectionManager.getConnection(database);
    if (!connection) {
      if (dbConfig.ssh_host) {
        ctx.logger.info(`SSH tunnel will be managed by ConnectionManager for '${database}'`);
      }
      await ctx.connectionManager.executeQuery(database, 'SELECT 1', []);
      connection = await ctx.connectionManager.getConnection(database);
      if (!connection) {
        throw new ConnectionError(`Could not establish connection to ${database}`);
      }
    }

    const schema = await ctx.schemaManager.refreshSchema(database);

    return createToolResponse(
      ` Schema refreshed for ${database}\n Captured: ${schema.summary.table_count} tables, ${schema.summary.total_columns} columns`
    );
  } catch (error) {
    const errorMessage = sanitizeError(error);
    return createToolResponse(` Failed to refresh schema for ${database}: ${errorMessage}`, true);
  }
}

/** sql_list_databases: the configured databases (without credentials) and the global security limits. */
export async function handleListDatabases(ctx: ToolHandlerContext): Promise<MCPToolResponse> {
  try {
    const databases: DatabaseListItem[] = [];

    for (const [name, config] of Object.entries(ctx.config.databases)) {
      const hasSchema = ctx.schemaManager.hasSchema(name);
      const schemaInfo = hasSchema ? ctx.schemaManager.getSchema(name)?.summary : undefined;

      databases.push({
        name,
        type: config.type,
        host: config.host || config.file || 'N/A',
        database: config.database,
        ssh_enabled: !!config.ssh_host,
        ssl_enabled: !!config.ssl,
        select_only_mode: !!config.select_only,
        mcp_configurable: !!config.mcp_configurable,
        schema_cached: hasSchema,
        schema_info: schemaInfo
          ? {
              table_count: schemaInfo.table_count,
              view_count: schemaInfo.view_count,
              total_columns: schemaInfo.total_columns,
            }
          : undefined,
      });
    }

    let responseText = ' Configured Databases:\n\n';
    for (const db of databases) {
      responseText += formatDatabaseSummary(db);
    }

    if (ctx.config.security) {
      responseText += '\n **Global Security Limits:**\n';
      responseText += ` - Max JOINs: ${ctx.config.security.max_joins}\n`;
      responseText += ` - Max Subqueries: ${ctx.config.security.max_subqueries}\n`;
      responseText += ` - Max UNIONs: ${ctx.config.security.max_unions}\n`;
      responseText += ` - Max GROUP BYs: ${ctx.config.security.max_group_bys}\n`;
      responseText += ` - Max Complexity Score: ${ctx.config.security.max_complexity_score}\n`;
      responseText += ` - Max Query Length: ${ctx.config.security.max_query_length}\n`;
    }

    return createToolResponse(responseText);
  } catch (error) {
    const errorMessage = sanitizeError(error);
    return createToolResponse(` Failed to list databases: ${errorMessage}`, true);
  }
}

/** sql_test_connection: connect and run SELECT 1, capturing the schema if none is cached yet. */
export async function handleTestConnection(
  ctx: ToolHandlerContext,
  args: SQLTestConnectionArgs
): Promise<MCPToolResponse> {
  const { database } = args;

  try {
    const dbConfig = requireDbConfig(ctx.config, database);

    if (dbConfig.ssh_host) {
      ctx.logger.info(`SSH tunnel will be managed by ConnectionManager for '${database}'`);
    }

    // Test the connection — errors must propagate so we report actual status
    await ctx.connectionManager.getConnection(database);

    // Verify the connection works with a simple query
    await ctx.connectionManager.executeQuery(database, 'SELECT 1');

    // Capture schema if not cached (schema failure is non-fatal)
    if (!ctx.schemaManager.hasSchema(database)) {
      try {
        await ctx.schemaManager.captureSchema(database, dbConfig);
      } catch (error) {
        ctx.logger.warning('Failed to capture schema', { database, error: getErrorMessage(error) });
      }
    }

    const schema = ctx.schemaManager.getSchema(database);

    let responseText = ` Connection successful to ${database}\n`;
    if (ctx.sshTunnelManager.hasTunnel(database)) responseText += ` SSH tunnel established\n`;
    if (dbConfig.select_only) responseText += ` SELECT-only mode active\n`;
    if (schema) {
      responseText += ` Schema captured: ${schema.summary.table_count} tables, ${schema.summary.total_columns} columns\n`;
    }

    return createToolResponse(responseText);
  } catch (error) {
    const errorMessage = sanitizeError(error);
    return createToolResponse(` Connection test failed for ${database}: ${errorMessage}`, true);
  }
}

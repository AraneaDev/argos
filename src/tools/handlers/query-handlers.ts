/**
 * Query Tool Handlers
 * Handles sql_query, sql_batch_query, and sql_analyze_performance
 */

import type {
  SQLQueryArgs,
  SQLBatchQueryArgs,
  SQLAnalyzePerformanceArgs,
  MCPToolResponse,
} from '../../types/index.js';
import { NameCheckError, SecurityViolationError } from '../../types/index.js';
import {
  formatTableResults,
  formatCondensedTableResults,
  createToolResponse,
} from '../../utils/response-formatter.js';
import { sanitizeError, sanitizeMessage, ValidationError } from '../../utils/error-handler.js';
import { formatSchemaChanges, type SchemaChange } from '../../schema/diff.js';
import {
  attachJournal,
  journalFailure,
  journalOk,
  paramsFlag,
  type JournalRef,
} from './journal.js';
import { correctionForError, preflightNames } from './name-check.js';
import type { ToolHandlerContext } from './types.js';
import { requireDbConfig } from './types.js';

/** Append the schema-change line and structured `_meta.argos` when something changed. */
function withSchemaChanges(
  response: MCPToolResponse,
  changes: SchemaChange[],
  ref: JournalRef = { journalId: null, spool: null }
): MCPToolResponse {
  if (changes.length > 0) {
    response.content[0].text += `\n${formatSchemaChanges(changes)}`;
  }
  if (changes.length === 0 && ref.journalId === null) return response;
  return attachJournal(response, ref, changes);
}

/**
 * Failure response: the schema-change line (if any) is kept, because `check` has already
 * refreshed the cache and will not report the same change again.
 */
function failureResponse(text: string, changes: SchemaChange[], ref: JournalRef): MCPToolResponse {
  const response = createToolResponse(text, true);
  if (changes.length > 0) response.content[0].text += `\n${formatSchemaChanges(changes)}`;
  return attachJournal(response, ref, changes);
}

/** Failure text: a name-check block, or the sanitized error followed by the raw correction. */
function failureText(
  ctx: ToolHandlerContext,
  database: string,
  sql: string,
  error: unknown,
  failed: string
): string {
  if (error instanceof NameCheckError) {
    return ` Query not run on ${database}: ${error.message}\n${error.correction}`;
  }
  const correction = correctionForError(ctx, database, sql, error);
  return `${failed}: ${sanitizeError(error)}${correction ? `\n${correction}` : ''}`;
}

/**
 *
 */
export async function handleSqlQuery(
  ctx: ToolHandlerContext,
  args: SQLQueryArgs
): Promise<MCPToolResponse> {
  const { database, query, params = [] } = args;
  let schemaChanges: SchemaChange[] = [];

  try {
    const dbConfig = requireDbConfig(ctx.config, database);

    // Security validation for SELECT-only mode
    if (dbConfig.select_only) {
      const validation = ctx.securityManager.validateSelectOnlyQuery(query, dbConfig.type);
      if (!validation.allowed) {
        throw new SecurityViolationError(
          `Query blocked: Database '${database}' is configured for SELECT-only access. ${validation.reason}`,
          { database, query: query.substring(0, 100), reason: validation.reason }
        );
      }
    } else {
      // Even in write mode, block always-dangerous commands (EXEC, LOAD, etc.)
      const validation = ctx.securityManager.validateAnyQuery(query, dbConfig.type);
      if (!validation.allowed) {
        throw new SecurityViolationError(`Query blocked: ${validation.reason}`, {
          database,
          query: query.substring(0, 100),
          reason: validation.reason,
        });
      }
    }

    if (dbConfig.ssh_host) {
      ctx.logger.info(`SSH tunnel will be managed by ConnectionManager for '${database}'`);
    }

    schemaChanges = await ctx.schemaWatch.check(database, dbConfig);
    const bad = await preflightNames(ctx, database, dbConfig, query);
    if (bad) {
      schemaChanges = [...schemaChanges, ...bad.schemaChanges];
      throw new NameCheckError(`it names a column that doesn't exist`, bad.correction);
    }

    const result = await ctx.connectionManager.executeQuery(database, query, params);

    let responseText = ` Query executed successfully on ${database}\n`;
    if (ctx.sshTunnelManager.hasTunnel(database)) responseText += ` Connected via SSH tunnel\n`;
    if (dbConfig.select_only) responseText += ` SELECT-only mode active\n`;
    responseText += ` Results: ${result.rowCount} rows`;
    if (result.truncated) responseText += ` (limited to ${result.rows.length})`;
    responseText += '\n\n';

    if (result.rows.length > 0) {
      responseText += formatTableResults(result);
    } else {
      responseText += 'No results returned.\n';
    }

    const ref = await journalOk(
      ctx,
      { database, tool: 'sql_query', sql: query, ...paramsFlag(params) },
      { rowCount: result.rowCount, durationMs: result.execution_time_ms },
      result,
      schemaChanges
    );
    return withSchemaChanges(createToolResponse(responseText), schemaChanges, ref);
  } catch (error) {
    const ref = await journalFailure(
      ctx,
      { database, tool: 'sql_query', sql: query, ...paramsFlag(params) },
      error,
      schemaChanges
    );
    // Sanitize before returning to the client — raw driver errors can leak data,
    // schema, or connection details. SecurityViolationError messages are preserved.
    let responseText = failureText(ctx, database, query, error, ` Query failed on ${database}`);

    if (error instanceof SecurityViolationError) {
      responseText += '\n\n **Security Information:**\n';
      responseText += 'This database is configured with SELECT-only mode for safety.\n';
      responseText += 'Only SELECT, WITH, SHOW, EXPLAIN, and DESCRIBE statements are allowed.\n';
      responseText += 'To modify data, use a database configured with full access permissions.';
    }

    return failureResponse(responseText, schemaChanges, ref);
  }
}

/**
 *
 */
export async function handleBatchQuery(
  ctx: ToolHandlerContext,
  args: SQLBatchQueryArgs
): Promise<MCPToolResponse> {
  const { database, queries, transaction = false } = args;

  if (!queries || queries.length === 0) {
    throw new ValidationError('No queries provided for batch execution');
  }

  const maxBatchSize = ctx.config.extension?.max_batch_size || 10;
  if (queries.length > maxBatchSize) {
    throw new ValidationError(`Batch size exceeds maximum of ${maxBatchSize} queries`);
  }

  const batchId = ctx.paneStore ? ctx.paneStore.newId() : undefined;
  let offending: SQLBatchQueryArgs['queries'][number] | null = null;
  let schemaChanges: SchemaChange[] = [];

  try {
    const dbConfig = requireDbConfig(ctx.config, database);

    if (dbConfig.select_only) {
      for (const query of queries) {
        offending = query;
        const validation = ctx.securityManager.validateSelectOnlyQuery(query.query, dbConfig.type);
        if (!validation.allowed) {
          throw new SecurityViolationError(`Batch contains blocked query: ${validation.reason}`, {
            database,
            query: query.query.substring(0, 100),
            reason: validation.reason,
          });
        }
      }
    } else {
      // Even in write mode, validate each query for always-blocked commands
      for (const query of queries) {
        offending = query;
        const validation = ctx.securityManager.validateAnyQuery(query.query, dbConfig.type);
        if (!validation.allowed) {
          throw new SecurityViolationError(`Batch contains blocked query: ${validation.reason}`, {
            database,
            query: query.query.substring(0, 100),
            reason: validation.reason,
          });
        }
      }
    }

    offending = null;

    if (dbConfig.ssh_host) {
      ctx.logger.info(`SSH tunnel will be managed by ConnectionManager for '${database}'`);
    }

    schemaChanges = await ctx.schemaWatch.check(database, dbConfig);

    const result = await ctx.connectionManager.executeBatch(
      database,
      queries,
      transaction && !dbConfig.select_only
    );

    let responseText = ` **Batch Query Results** (${database})\n\n`;
    responseText += `**Execution Summary:**\n`;
    responseText += ` - Total Time: ${result.totalExecutionTime}ms\n`;
    responseText += ` - Queries Executed: ${result.results.length}\n`;
    responseText += ` - Successful: ${result.successCount} [OK]\n`;
    responseText += ` - Failed: ${result.failureCount} ${result.failureCount > 0 ? '[ERROR]' : '[OK]'}\n`;

    if (transaction && !dbConfig.select_only) {
      responseText += ` - Transaction: ${result.transactionUsed ? 'Committed' : 'Used'} [OK]\n`;
    }
    if (dbConfig.select_only) {
      responseText += ` - Security: SELECT-only mode active [LOCK]\n`;
    }
    if (ctx.sshTunnelManager.hasTunnel(database)) {
      responseText += ` - Connection: SSH tunnel [OK]\n`;
    }

    responseText += `\n **Individual Results:**\n\n`;

    for (const queryResult of result.results) {
      responseText += `**${queryResult.label || `Query ${queryResult.index}`}**:\n`;

      if (queryResult.success && queryResult.data) {
        responseText += `[OK] Success`;
        if (queryResult.data.execution_time_ms) {
          responseText += ` (${queryResult.data.execution_time_ms}ms)`;
        }
        responseText += `\n`;

        if (queryResult.data.rows && queryResult.data.rows.length > 0) {
          responseText += ` Results: ${queryResult.data.rowCount} rows`;
          if (queryResult.data.truncated) {
            responseText += ` (showing ${queryResult.data.rows.length})`;
          }
          responseText += '\n';
          responseText += formatCondensedTableResults(queryResult.data);
        } else {
          responseText += ' No results returned\n';
        }
      } else {
        responseText += `[ERROR] Failed: ${sanitizeMessage(queryResult.error || '')}\n`;
      }

      responseText += ` Query: \`${queryResult.query?.substring(0, 100)}${queryResult.query && queryResult.query.length > 100 ? '...' : ''}\`\n\n`;
    }

    let first: JournalRef = { journalId: null, spool: null };
    for (const [i, queryResult] of result.results.entries()) {
      const base = {
        database,
        tool: 'sql_batch_query' as const,
        sql: queryResult.query ?? queries[i]?.query ?? '',
        batchId,
        ...paramsFlag(queries[i]?.params),
      };
      const ref =
        queryResult.success && queryResult.data
          ? await journalOk(
              ctx,
              base,
              {
                rowCount: queryResult.data.rowCount,
                durationMs: queryResult.data.execution_time_ms,
              },
              queryResult.data,
              i === 0 ? schemaChanges : []
            )
          : await journalFailure(
              ctx,
              base,
              new Error(queryResult.error || 'Query failed'),
              i === 0 ? schemaChanges : []
            );
      if (i === 0) first = ref;
    }
    return withSchemaChanges(createToolResponse(responseText), schemaChanges, first);
  } catch (error) {
    let ref: JournalRef = { journalId: null, spool: null };
    if (offending !== null || !(error instanceof SecurityViolationError)) {
      // A blocked batch records the offending statement; any other failure records each one.
      const stmts = offending !== null ? [offending] : queries;
      for (const [i, q] of stmts.entries()) {
        const r = await journalFailure(
          ctx,
          { database, tool: 'sql_batch_query', sql: q.query, batchId, ...paramsFlag(q.params) },
          error,
          i === 0 ? schemaChanges : []
        );
        if (i === 0) ref = r;
      }
    }
    const errorMessage = sanitizeError(error);
    let responseText = ` **Batch Query Failed** (${database})\n\n`;
    responseText += ` **Error:** ${errorMessage}\n\n`;

    if (error instanceof SecurityViolationError) {
      responseText += '\n **Security Information:**\n';
      responseText += 'This database is configured with SELECT-only mode for safety.\n';
      responseText += 'All queries in the batch must comply with security restrictions.';
    }

    return failureResponse(responseText, schemaChanges, ref);
  }
}

/**
 *
 */
export async function handleAnalyzePerformance(
  ctx: ToolHandlerContext,
  args: SQLAnalyzePerformanceArgs
): Promise<MCPToolResponse> {
  const { database, query } = args;
  let schemaChanges: SchemaChange[] = [];

  try {
    const dbConfig = requireDbConfig(ctx.config, database);

    // Performance analysis EXECUTES the query (and, on some engines, again via EXPLAIN
    // ANALYZE). It must pass the same security validation as sql_query — otherwise it is
    // a full bypass of SELECT-only mode.
    const validation = dbConfig.select_only
      ? ctx.securityManager.validateSelectOnlyQuery(query, dbConfig.type)
      : ctx.securityManager.validateAnyQuery(query, dbConfig.type);
    if (!validation.allowed) {
      throw new SecurityViolationError(
        dbConfig.select_only
          ? `Analyze blocked: Database '${database}' is configured for SELECT-only access. ${validation.reason}`
          : `Analyze blocked: ${validation.reason}`,
        { database, query: query.substring(0, 100), reason: validation.reason }
      );
    }

    if (dbConfig.ssh_host) {
      ctx.logger.info(`SSH tunnel will be managed by ConnectionManager for '${database}'`);
    }

    schemaChanges = await ctx.schemaWatch.check(database, dbConfig);

    const bad = await preflightNames(ctx, database, dbConfig, query);
    if (bad) {
      schemaChanges = [...schemaChanges, ...bad.schemaChanges];
      throw new NameCheckError(`it names a column that doesn't exist`, bad.correction);
    }

    const analysis = await ctx.connectionManager.analyzePerformance(database, query);

    let responseText = ` **Query Performance Analysis** (${database})\n\n`;
    responseText += `**Execution Times:**\n`;
    responseText += ` - Query Execution: ${analysis.executionTime}ms\n`;
    responseText += ` - Explain Analysis: ${analysis.explainTime}ms\n\n`;

    responseText += `**Query Results:**\n`;
    responseText += ` - Rows Returned: ${analysis.rowCount}\n`;
    responseText += ` - Columns: ${analysis.columnCount}\n\n`;

    responseText += ` **Execution Plan:**\n`;
    responseText += '```\n';
    responseText += analysis.executionPlan;
    responseText += '```\n\n';

    responseText += ` **Performance Recommendations:**\n`;
    responseText += analysis.recommendations;

    const ref = await journalOk(
      ctx,
      { database, tool: 'sql_analyze_performance', sql: query },
      { rowCount: analysis.rowCount, durationMs: analysis.executionTime },
      null,
      schemaChanges
    );
    return withSchemaChanges(createToolResponse(responseText), schemaChanges, ref);
  } catch (error) {
    const ref = await journalFailure(
      ctx,
      { database, tool: 'sql_analyze_performance', sql: query },
      error,
      schemaChanges
    );
    return failureResponse(
      failureText(ctx, database, query, error, ` Performance analysis failed for ${database}`),
      schemaChanges,
      ref
    );
  }
}

/**
 * Name checking around a query: a pre-flight check against the cached schema (layer 1) and a
 * correction for the database's own unknown-name errors (layer 2). Corrections are plain
 * names and types and must never be passed through sanitizeMessage.
 */

import type { DatabaseConfig, DatabaseSchema } from '../../types/index.js';
import type { SchemaChange } from '../../schema/diff.js';
import {
  checkNames,
  defaultSchemaFor,
  knownTables,
  type NameProblem,
} from '../../schema/name-check.js';
import { classifyNameError, formatCorrection } from '../../schema/name-hints.js';
import type { ToolHandlerContext } from './types.js';

/** How long a query waits for a schema capture before it runs unchecked. */
export const SCHEMA_CAPTURE_LIMIT_MS = 5000;

/**
 * The cached schema, capturing one if needed. Resolves null when the capture fails or takes
 * longer than the limit; a slow capture keeps going in the background.
 */
export async function ensureSchema(
  ctx: ToolHandlerContext,
  database: string,
  dbConfig: DatabaseConfig
): Promise<DatabaseSchema | null> {
  const cached = ctx.schemaManager.getSchema(database);
  if (cached) return cached;

  const warn = (error: unknown) =>
    ctx.logger.warning('Schema capture for name check failed', {
      database,
      error: error instanceof Error ? error.message : String(error),
    });

  // The catch also covers a capture that rejects after the timer has won the race.
  const capture = ctx.schemaManager.captureSchemaOnce(database, dbConfig).catch((error) => {
    warn(error);
    return null;
  });

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), SCHEMA_CAPTURE_LIMIT_MS);
  });
  try {
    return await Promise.race([capture, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function warnSkipped(ctx: ToolHandlerContext, database: string, error: unknown): void {
  ctx.logger.warning('Name check skipped', {
    database,
    error: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Null when the query may run; otherwise the problems that are still there after a forced
 * fingerprint check and re-read (the schema may have changed since it was cached), plus any
 * schema changes that check found. `statement` is the 0-based batch index. Fails open: any
 * error inside is logged and the query runs unchecked.
 */
export async function preflightNames(
  ctx: ToolHandlerContext,
  database: string,
  dbConfig: DatabaseConfig,
  sql: string,
  statement?: number
): Promise<{ problems: NameProblem[]; correction: string; schemaChanges: SchemaChange[] } | null> {
  if (dbConfig.name_check === false) return null;
  try {
    const schema = await ensureSchema(ctx, database, dbConfig);
    if (!schema) return null;
    const defaultSchema = defaultSchemaFor(dbConfig.type, dbConfig.database);
    if (checkNames(sql, schema, defaultSchema).length === 0) return null;

    const schemaChanges = await ctx.schemaWatch.check(database, dbConfig, { force: true });
    const fresh = ctx.schemaManager.getSchema(database) ?? schema;
    const problems = checkNames(sql, fresh, defaultSchema);
    if (problems.length === 0) return null;
    if (statement !== undefined) for (const problem of problems) problem.statement = statement;
    return { problems, correction: formatCorrection(fresh, problems), schemaChanges };
  } catch (error) {
    warnSkipped(ctx, database, error);
    return null;
  }
}

/** '' when the error isn't an unknown-name error, no schema is cached, or building it fails. */
export function correctionForError(
  ctx: ToolHandlerContext,
  database: string,
  sql: string,
  error: unknown
): string {
  try {
    const info = classifyNameError(error);
    const schema = ctx.schemaManager.getSchema(database);
    if (!info || !schema) return '';
    if (info.kind === 'table') {
      return formatCorrection(schema, [{ kind: 'table', name: info.name }]);
    }
    const dbConfig = ctx.config.databases[database];
    const defaultSchema = dbConfig ? defaultSchemaFor(dbConfig.type, dbConfig.database) : null;
    const inScope = knownTables(sql, schema, defaultSchema);
    return formatCorrection(schema, [{ kind: 'column', name: info.name, inScope }]);
  } catch (caught) {
    warnSkipped(ctx, database, caught);
    return '';
  }
}

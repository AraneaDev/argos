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

/** How long a failed capture is remembered before a query tries again. */
export const CAPTURE_RETRY_MS = 60_000;

/** When each database's last capture failed, per schema manager (so per server). */
const failedCaptures = new WeakMap<object, Map<string, number>>();

/**
 * The cached schema, capturing one if needed. Resolves null when the capture fails or takes
 * longer than the limit; a slow capture keeps going in the background. Only the call that
 * starts a capture waits for it: while one is running, and for a minute after one failed,
 * this resolves null at once. `wait` (sql_get_schema, which asks for the schema itself)
 * joins a running capture and retries a failed one.
 */
export async function ensureSchema(
  ctx: ToolHandlerContext,
  database: string,
  dbConfig: DatabaseConfig,
  opts: { wait?: boolean } = {}
): Promise<DatabaseSchema | null> {
  const cached = ctx.schemaManager.getSchema(database);
  if (cached) return cached;

  let failed = failedCaptures.get(ctx.schemaManager);
  if (!failed) {
    failed = new Map();
    failedCaptures.set(ctx.schemaManager, failed);
  }
  if (!opts.wait) {
    if (ctx.schemaManager.isCapturing(database)) return null;
    const failedAt = failed.get(database);
    if (failedAt !== undefined && Date.now() - failedAt < CAPTURE_RETRY_MS) return null;
  }

  const failures = failed;
  // The catch also covers a capture that rejects after the timer has won the race.
  const capture = ctx.schemaManager.captureSchemaOnce(database, dbConfig).then(
    (schema) => {
      failures.delete(database);
      return schema;
    },
    (error) => {
      failures.set(database, Date.now());
      ctx.logger.warning('Schema capture for name check failed', {
        database,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  );

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

/**
 * ensureSchema for a query handler, called once per call (once per batch). Fails open: an
 * error is logged and resolves null, so the query runs unchecked.
 */
export async function schemaForCheck(
  ctx: ToolHandlerContext,
  database: string,
  dbConfig: DatabaseConfig
): Promise<DatabaseSchema | null> {
  try {
    return await ensureSchema(ctx, database, dbConfig);
  } catch (error) {
    warnSkipped(ctx, database, error);
    return null;
  }
}

function warnSkipped(ctx: ToolHandlerContext, database: string, error: unknown): void {
  ctx.logger.warning('Name check skipped', {
    database,
    error: error instanceof Error ? error.message : String(error),
  });
}

export interface Preflight {
  problems: NameProblem[];
  correction: string;
  schemaChanges: SchemaChange[];
}

/**
 * Checks `sql` against `captured` (from schemaForCheck, which the handler calls first, even
 * with name_check off, because layer 2 needs a cached schema), or against the cache when an
 * earlier statement's forced check refreshed it. Problems are those still there after a
 * forced fingerprint check and re-read (the schema may have changed since it was cached);
 * `schemaChanges` are whatever that check found, to be reported even when the query then
 * runs. `statement` is the 0-based batch index. Fails open: any error inside is logged and
 * nothing is reported.
 */
export async function preflightNames(
  ctx: ToolHandlerContext,
  database: string,
  dbConfig: DatabaseConfig,
  captured: DatabaseSchema | null,
  sql: string,
  statement?: number
): Promise<Preflight> {
  const none: Preflight = { problems: [], correction: '', schemaChanges: [] };
  try {
    if (!captured || dbConfig.name_check === false) return none;
    const schema = ctx.schemaManager.getSchema(database) ?? captured;
    const defaultSchema = defaultSchemaFor(dbConfig.type, dbConfig.database);
    if (checkNames(sql, schema, defaultSchema).length === 0) return none;

    const schemaChanges = await ctx.schemaWatch.check(database, dbConfig, { force: true });
    const fresh = ctx.schemaManager.getSchema(database) ?? schema;
    const problems = checkNames(sql, fresh, defaultSchema);
    if (problems.length === 0) return { ...none, schemaChanges };
    if (statement !== undefined) for (const problem of problems) problem.statement = statement;
    return { problems, correction: formatCorrection(fresh, problems), schemaChanges };
  } catch (error) {
    warnSkipped(ctx, database, error);
    return none;
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

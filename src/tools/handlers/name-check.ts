/**
 * Name checking before a query runs: makes sure a schema is at hand to check against.
 */

import type { DatabaseConfig, DatabaseSchema } from '../../types/index.js';
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

/**
 * Journal helpers for query handlers: record Claude's calls in the pane store.
 * Every store call is guarded; a failure is logged and never reaches the tool response.
 */

import type { JournalEntry } from '../../pane/contract.js';
import type { SchemaChange } from '../../schema/diff.js';
import type { MCPToolResponse, QueryResult } from '../../types/index.js';
import { SecurityViolationError } from '../../types/index.js';
import { getErrorMessage, sanitizeError } from '../../utils/error-handler.js';
import type { ToolHandlerContext } from './types.js';

export interface JournalRef {
  journalId: string | null;
  spool: string | null;
}

/** `{ hasParams: true }` when a statement carried bound parameters, else nothing. */
export function paramsFlag(params: unknown[] | undefined): { hasParams?: true } {
  return params && params.length > 0 ? { hasParams: true } : {};
}

interface Base {
  database: string;
  tool: JournalEntry['tool'];
  sql: string;
  batchId?: string;
  hasParams?: boolean;
}

async function guarded(
  ctx: ToolHandlerContext,
  what: string,
  fn: () => Promise<JournalRef>
): Promise<JournalRef> {
  try {
    return await fn();
  } catch (error) {
    try {
      ctx.logger.warning(`Pane journal: ${what} failed`, { error: getErrorMessage(error) });
    } catch {
      /* logging must not throw either */
    }
    return { journalId: null, spool: null };
  }
}

/** Record a successful statement; `result` is spooled in full unless omitted (analyze). */
export function journalOk(
  ctx: ToolHandlerContext,
  base: Base,
  stats: { rowCount: number; durationMs: number },
  result: QueryResult | null,
  schemaChange: SchemaChange[] = []
): Promise<JournalRef> {
  return guarded(ctx, 'record', async () => {
    const store = ctx.paneStore;
    if (!store) return { journalId: null, spool: null };
    const id = store.newId();
    let spool: string | null = null;
    if (result) {
      try {
        spool = await store.writeSpool(id, result);
      } catch (error) {
        ctx.logger.warning('Pane journal: spool failed', { error: getErrorMessage(error) });
      }
    }
    const entry: JournalEntry = {
      id,
      at: new Date().toISOString(),
      source: 'claude',
      ...base,
      durationMs: stats.durationMs,
      rowCount: stats.rowCount,
      outcome: 'ok',
      ...(schemaChange.length > 0 ? { schemaChange } : {}),
      spool,
    };
    await store.append(entry);
    return { journalId: id, spool };
  });
}

/** Record a blocked or failed statement (no spool), with any schema change noticed first. */
export function journalFailure(
  ctx: ToolHandlerContext,
  base: Base,
  error: unknown,
  schemaChange: SchemaChange[] = []
): Promise<JournalRef> {
  return guarded(ctx, 'record', async () => {
    const store = ctx.paneStore;
    if (!store) return { journalId: null, spool: null };
    const id = store.newId();
    await store.append({
      id,
      at: new Date().toISOString(),
      source: 'claude',
      ...base,
      durationMs: null,
      rowCount: null,
      outcome: error instanceof SecurityViolationError ? 'blocked' : 'error',
      reason: sanitizeError(error),
      ...(schemaChange.length > 0 ? { schemaChange } : {}),
      spool: null,
    });
    return { journalId: id, spool: null };
  });
}

/** Attach `_meta.argos` (ids and schema changes only, never result data). */
export function attachJournal(
  response: MCPToolResponse,
  ref: JournalRef,
  changes: SchemaChange[] = []
): MCPToolResponse {
  response._meta.argos = {
    journalId: ref.journalId,
    spool: ref.spool,
    ...(changes.length > 0 ? { schemaChange: changes } : {}),
  };
  return response;
}

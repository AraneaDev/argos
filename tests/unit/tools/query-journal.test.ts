/**
 * Journaling of Claude's query calls into the pane store.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  handleSqlQuery,
  handleBatchQuery,
  handleAnalyzePerformance,
} from '../../../src/tools/handlers/query-handlers.js';
import type { ToolHandlerContext } from '../../../src/tools/handlers/types.js';
import type { ParsedServerConfig, DatabaseConfig } from '../../../src/types/index.js';
import { PaneStore } from '../../../src/pane/store.js';

const dbs = { db: { type: 'postgresql', select_only: true } as DatabaseConfig };
const okResult = (n: number) => ({
  rows: [{ a: n }],
  rowCount: 1,
  fields: ['a'],
  truncated: false,
  execution_time_ms: 7,
});

function makeCtx(paneStore: PaneStore | null): ToolHandlerContext {
  return {
    connectionManager: {
      executeQuery: jest.fn().mockResolvedValue(okResult(1)),
      executeBatch: jest.fn(),
      analyzePerformance: jest.fn(),
    } as any,
    securityManager: {
      validateSelectOnlyQuery: jest.fn().mockReturnValue({ allowed: true }),
      validateAnyQuery: jest.fn().mockReturnValue({ allowed: true }),
    } as any,
    schemaManager: { hasSchema: jest.fn().mockReturnValue(true) } as any,
    schemaWatch: { check: jest.fn().mockResolvedValue([]) } as any,
    paneStore,
    sshTunnelManager: { hasTunnel: jest.fn().mockReturnValue(false) } as any,
    metricsManager: {} as any,
    config: { databases: dbs } as ParsedServerConfig,
    configPath: '/tmp/x.ini',
    logger: { info: jest.fn(), debug: jest.fn(), warning: jest.fn(), error: jest.fn() } as any,
  };
}

describe('query journaling', () => {
  let dir: string;
  let store: PaneStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'argos-journal-'));
    store = new PaneStore(dir);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('journals an ok sql_query with a spool and returns its id in _meta.argos', async () => {
    const ctx = makeCtx(store);
    const r = await handleSqlQuery(ctx, { database: 'db', query: 'SELECT 1' });
    const [e] = await store.history();
    expect(e).toMatchObject({
      source: 'claude',
      tool: 'sql_query',
      database: 'db',
      sql: 'SELECT 1',
      outcome: 'ok',
      rowCount: 1,
      durationMs: 7,
    });
    expect(e.spool).toEqual(expect.any(String));
    expect(r._meta.argos).toEqual({ journalId: e.id, spool: e.spool });
    expect((await store.readSpool(e.id))?.rows).toEqual([[1]]);
  });

  it('journals a blocked query with the reason and no spool', async () => {
    const ctx = makeCtx(store);
    (ctx.securityManager.validateSelectOnlyQuery as jest.Mock).mockReturnValue({
      allowed: false,
      reason: 'Only SELECT allowed',
    });
    const r = await handleSqlQuery(ctx, { database: 'db', query: 'DELETE FROM t' });
    const [e] = await store.history();
    expect(e.outcome).toBe('blocked');
    expect(e.reason).toContain('Only SELECT allowed');
    expect(e.spool).toBeNull();
    expect(r.isError).toBe(true);
    expect(r._meta.argos).toEqual({ journalId: e.id, spool: null });
  });

  it('journals a failing query as error', async () => {
    const ctx = makeCtx(store);
    (ctx.connectionManager.executeQuery as jest.Mock).mockRejectedValue(new Error('boom'));
    await handleSqlQuery(ctx, { database: 'db', query: 'SELECT 1' });
    const [e] = await store.history();
    expect(e.outcome).toBe('error');
    expect(e.reason).toBeTruthy();
  });

  it('records schema changes on the entry', async () => {
    const ctx = makeCtx(store);
    const changes = [{ kind: 'column-added', table: 't', column: 'c', type: 'int' }];
    (ctx.schemaWatch.check as jest.Mock).mockResolvedValue(changes);
    const r = await handleSqlQuery(ctx, { database: 'db', query: 'SELECT 1' });
    const [e] = await store.history();
    expect(e.schemaChange).toEqual(changes);
    expect(r._meta.argos?.schemaChange).toEqual(changes);
  });

  it('journals a batch of 3 as 3 entries sharing a batchId, each spooled', async () => {
    const ctx = makeCtx(store);
    (ctx.connectionManager.executeBatch as jest.Mock).mockResolvedValue({
      results: [1, 2, 3].map((n) => ({
        index: n,
        label: `q${n}`,
        success: true,
        data: okResult(n),
        query: `SELECT ${n}`,
      })),
      successCount: 3,
      failureCount: 0,
      totalExecutionTime: 3,
      transactionUsed: false,
    });
    const r = await handleBatchQuery(ctx, {
      database: 'db',
      queries: [{ query: 'SELECT 1' }, { query: 'SELECT 2' }, { query: 'SELECT 3' }],
    });
    const entries = (await store.history()).reverse();
    expect(entries).toHaveLength(3);
    expect(new Set(entries.map((e) => e.batchId)).size).toBe(1);
    expect(entries[0].batchId).toBeTruthy();
    expect(entries.every((e) => e.spool && e.tool === 'sql_batch_query')).toBe(true);
    expect(entries.map((e) => e.sql)).toEqual(['SELECT 1', 'SELECT 2', 'SELECT 3']);
    expect(r._meta.argos).toEqual({ journalId: entries[0].id, spool: entries[0].spool });
  });

  it('journals a blocked batch as one blocked entry for the offending statement', async () => {
    const ctx = makeCtx(store);
    (ctx.securityManager.validateSelectOnlyQuery as jest.Mock).mockImplementation((q: string) =>
      q.startsWith('DROP') ? { allowed: false, reason: 'no drops' } : { allowed: true }
    );
    const r = await handleBatchQuery(ctx, {
      database: 'db',
      queries: [{ query: 'SELECT 1' }, { query: 'DROP TABLE t' }],
    });
    const entries = await store.history();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ outcome: 'blocked', sql: 'DROP TABLE t', spool: null });
    expect(r._meta.argos?.journalId).toBe(entries[0].id);
  });

  it('journals analyze with spool null', async () => {
    const ctx = makeCtx(store);
    (ctx.connectionManager.analyzePerformance as jest.Mock).mockResolvedValue({
      executionTime: 5,
      explainTime: 1,
      rowCount: 9,
      columnCount: 1,
      executionPlan: 'p',
      recommendations: 'r',
    });
    const r = await handleAnalyzePerformance(ctx, { database: 'db', query: 'SELECT 1' });
    const [e] = await store.history();
    expect(e).toMatchObject({
      tool: 'sql_analyze_performance',
      outcome: 'ok',
      rowCount: 9,
      durationMs: 5,
      spool: null,
    });
    expect(r._meta.argos).toEqual({ journalId: e.id, spool: null });
  });

  it('still returns the normal response when append throws', async () => {
    jest.spyOn(store, 'append').mockRejectedValue(new Error('disk full'));
    const ctx = makeCtx(store);
    const r = await handleSqlQuery(ctx, { database: 'db', query: 'SELECT 1' });
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain('Query executed successfully');
    expect(r._meta.argos).toBeUndefined();
    expect(ctx.logger.warning).toHaveBeenCalled();
  });

  it('survives rows that cannot be serialised (BigInt)', async () => {
    const ctx = makeCtx(store);
    (ctx.connectionManager.executeQuery as jest.Mock).mockResolvedValue({
      ...okResult(1),
      rows: [{ a: BigInt(1) }],
    });
    const r = await handleSqlQuery(ctx, { database: 'db', query: 'SELECT 1' });
    expect(r.isError).toBeUndefined();
    const [e] = await store.history();
    expect(e.outcome).toBe('ok');
    expect(e.spool).toBeNull();
  });

  it('works with paneStore null', async () => {
    const ctx = makeCtx(null);
    const r = await handleSqlQuery(ctx, { database: 'db', query: 'SELECT 1' });
    expect(r.isError).toBeUndefined();
    expect(r._meta.argos).toBeUndefined();
  });

  it('spools a 100k-row result without changing the response', async () => {
    const ctx = makeCtx(store);
    const rows = Array.from({ length: 100_000 }, (_, i) => ({ a: i, b: 'x'.repeat(50) }));
    (ctx.connectionManager.executeQuery as jest.Mock).mockResolvedValue({
      rows,
      rowCount: rows.length,
      fields: ['a', 'b'],
      truncated: false,
      execution_time_ms: 1,
    });
    await handleSqlQuery(ctx, { database: 'db', query: 'SELECT 1' });
    const [e] = await store.history();
    const page = await store.readSpool(e.id, 99_990, 5);
    expect(page?.total).toBe(100_000);
    expect(page?.rows[0][0]).toBe(99_990);
  });
});

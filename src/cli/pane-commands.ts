/**
 * The pane's read-only commands. Each returns the JSON value printed on stdout;
 * `runPaneCommand` wraps that in the exit-code contract.
 */

import type { ConnectionView, JournalEntry, Pin, SchemaView, SpoolPage } from '../pane/contract.js';
import type { SchemaChange } from '../schema/diff.js';
import { sanitizeError } from '../utils/error-handler.js';
import type { PaneCommandKind } from './commands.js';
import { openCore, type Core } from './core.js';

const LAST_CHANGE_SCAN = 500;

/** List configured connections without opening any of them. */
export async function connections(core: Core): Promise<ConnectionView[]> {
  return Object.entries(core.config.databases).map(([name, c]) => ({
    name,
    type: c.type,
    host: c.host ?? null,
    ssh: !!c.ssh_host,
    ssl: !!c.ssl,
    selectOnly: c.select_only !== false,
    mcpConfigurable: !!c.mcp_configurable,
    schemaCapturedAt: core.schemaManager.getSchema(name)?.captured_at ?? null,
  }));
}

/** Cached schema (captured once if absent), or a fresh capture with `refresh`. */
export async function schema(core: Core, db: string, refresh: boolean): Promise<SchemaView> {
  const config = core.config.databases[db];
  if (!config) throw new Error(`Unknown database '${db}'`);
  let s = core.schemaManager.getSchema(db);
  if (refresh && s) s = await core.schemaManager.refreshSchema(db);
  else if (!s) s = await core.schemaManager.captureSchema(db, config);

  let lastChange: SchemaChange[] | null = null;
  for (const e of await core.store.history({ limit: LAST_CHANGE_SCAN })) {
    if (e.database === db && e.schemaChange && e.schemaChange.length > 0) {
      lastChange = e.schemaChange;
      break;
    }
  }
  return {
    database: db,
    type: s.type,
    capturedAt: s.captured_at ?? null,
    tables: Object.values(s.tables ?? {}),
    views: Object.values(s.views ?? {}),
    lastChange,
  };
}

const VALUE_FLAGS = new Set([
  '--config',
  '--sql',
  '--before',
  '--limit',
  '--offset',
  '--name',
  '--db',
]);

function positional(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (VALUE_FLAGS.has(a)) i++;
    else if (!a.startsWith('--')) return a;
  }
  return undefined;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

function intFlag(args: string[], name: string): number | undefined {
  const v = flag(args, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** SQL from `--sql <text>`, or from stdin when the value is `-`. */
async function sqlFlag(args: string[]): Promise<string | undefined> {
  const v = flag(args, '--sql');
  return v === '-' ? readStdin() : v;
}

/**
 * Run SQL the person typed. Always read-only: the security manager's SELECT-only check runs
 * whatever the connection's select_only says, before anything reaches the database.
 * Failures and refusals are journaled and returned as the entry, not thrown.
 */
export async function query(core: Core, db: string, sql: string): Promise<JournalEntry> {
  const dbConfig = core.config.databases[db];
  if (!dbConfig) throw new Error(`Unknown database '${db}'`);

  const id = core.store.newId();
  const base = {
    id,
    at: new Date().toISOString(),
    source: 'pane' as const,
    database: db,
    tool: 'pane_query' as const,
    sql,
  };
  const failed = async (outcome: 'blocked' | 'error', reason: string): Promise<JournalEntry> => {
    const entry: JournalEntry = {
      ...base,
      durationMs: null,
      rowCount: null,
      outcome,
      reason,
      spool: null,
    };
    await core.store.append(entry);
    return entry;
  };

  const verdict = core.securityManager.validateSelectOnlyQuery(sql, dbConfig.type);
  if (!verdict.allowed) return failed('blocked', verdict.reason ?? 'Query refused');

  let entry: JournalEntry;
  try {
    const started = Date.now();
    const result = await core.connectionManager.executeQuery(db, sql);
    const durationMs = Date.now() - started;
    // the connection is open now, so the fingerprint check can piggyback on it
    const schemaChange = await core.schemaWatch.check(db, dbConfig);
    const spool = await core.store.writeSpool(id, result);
    entry = {
      ...base,
      durationMs,
      rowCount: result.rowCount,
      outcome: 'ok',
      ...(schemaChange.length > 0 ? { schemaChange } : {}),
      spool,
    };
    await core.store.append(entry);
  } catch (error) {
    return failed('error', sanitizeError(error));
  }
  await core.store.touchPins(db, sql, id);
  return entry;
}

/** Journal entries, newest first. */
export function history(core: Core, before?: string, limit?: number): Promise<JournalEntry[]> {
  return core.store.history({ before, limit });
}

/** One page of a spooled result. */
export async function result(
  core: Core,
  id: string,
  offset?: number,
  limit?: number
): Promise<SpoolPage> {
  const page = await core.store.readSpool(id, offset, limit);
  if (!page) throw new Error(`No spooled result for '${id}'`);
  return page;
}

/** Pin a journal entry's query, or an explicit database and SQL. */
export async function pin(
  core: Core,
  ref: { journalId?: string; db?: string; sql?: string; name?: string }
): Promise<Pin> {
  let database = ref.db;
  let sql = ref.sql;
  let lastJournalId: string | null = null;
  if (ref.journalId) {
    const entry = await core.store.entry(ref.journalId);
    if (!entry) throw new Error(`No journal entry '${ref.journalId}'`);
    database = entry.database;
    sql = entry.sql;
    lastJournalId = entry.id;
  }
  if (!database || !sql) {
    throw new Error('Usage: argos pin <journalId> | argos pin --db <db> --sql <sql> [--name <n>]');
  }
  if (!core.config.databases[database]) throw new Error(`Unknown database '${database}'`);
  return core.store.pin({ name: ref.name ?? null, database, sql, lastJournalId });
}

/** Remove a pin. */
export async function unpin(core: Core, id: string): Promise<{ removed: boolean }> {
  return { removed: await core.store.unpin(id) };
}

/** All pins. */
export function pins(core: Core): Promise<Pin[]> {
  return core.store.pins();
}

export interface PaneOutcome {
  json: unknown;
  code: number;
}

/**
 * Run one pane subcommand: the value for stdout and the exit code.
 * Never throws; failures become `{ error }` with code 1.
 * @param kind - subcommand
 * @param args - arguments after it
 * @param schemaPath - schema cache directory override (tests)
 */
export async function runPaneCommand(
  kind: PaneCommandKind,
  args: string[],
  schemaPath?: string
): Promise<PaneOutcome> {
  let core: Core | undefined;
  try {
    switch (kind) {
      case 'connections':
        core = await openCore(args, schemaPath);
        return { json: await connections(core), code: 0 };
      case 'schema': {
        const db = positional(args);
        if (!db) throw new Error('Usage: argos schema <db> [--refresh]');
        core = await openCore(args, schemaPath);
        return { json: await schema(core, db, args.includes('--refresh')), code: 0 };
      }
      case 'query': {
        const db = positional(args);
        const sql = await sqlFlag(args);
        if (!db || !sql) throw new Error('Usage: argos query <db> --sql <sql|->');
        core = await openCore(args, schemaPath);
        return { json: await query(core, db, sql), code: 0 };
      }
      case 'history':
        core = await openCore(args, schemaPath);
        return {
          json: await history(core, flag(args, '--before'), intFlag(args, '--limit')),
          code: 0,
        };
      case 'result': {
        const id = positional(args);
        if (!id) throw new Error('Usage: argos result <id> [--offset n] [--limit n]');
        core = await openCore(args, schemaPath);
        return {
          json: await result(core, id, intFlag(args, '--offset'), intFlag(args, '--limit')),
          code: 0,
        };
      }
      case 'pin': {
        const ref = {
          journalId: positional(args),
          db: flag(args, '--db'),
          sql: await sqlFlag(args),
          name: flag(args, '--name'),
        };
        core = await openCore(args, schemaPath);
        return { json: await pin(core, ref), code: 0 };
      }
      case 'unpin': {
        const id = positional(args);
        if (!id) throw new Error('Usage: argos unpin <id>');
        core = await openCore(args, schemaPath);
        return { json: await unpin(core, id), code: 0 };
      }
      case 'pins':
        core = await openCore(args, schemaPath);
        return { json: await pins(core), code: 0 };
      default:
        return { json: { error: 'not implemented yet' }, code: 1 };
    }
  } catch (error) {
    return { json: { error: sanitizeError(error) }, code: 1 };
  } finally {
    await core?.close();
  }
}

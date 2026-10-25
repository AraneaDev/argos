jest.unmock('sqlite3');
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sqlite3 from 'sqlite3';
import { runPaneCommand } from '../../../src/cli/pane-commands.js';
import { PaneStore, dataDirFor } from '../../../src/pane/store.js';

const FIXTURES = join(__dirname, '..', '..', 'fixtures', 'pane-contract');
const STAMP = '2000-01-01T00:00:00.000Z';

function exec(db: sqlite3.Database, sql: string): Promise<void> {
  return new Promise((res, rej) => db.exec(sql, (e) => (e ? rej(e) : res())));
}

/** Replace volatile values so the committed fixtures are stable across runs. */
function normalize(value: unknown, tmp: string): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, v) =>
      /^(capturedAt|schemaCapturedAt|captured_at)$/.test(key) && typeof v === 'string' ? STAMP : v
    )
      .split(tmp)
      .join('<tmp>')
  );
}

describe('pane commands', () => {
  let tmp: string;
  let configPath: string;
  let schemas: string;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'argos-cli-'));
    schemas = join(tmp, 'schemas');
    await mkdir(schemas);
    const file = join(tmp, 'demo.db');
    const db = new sqlite3.Database(file);
    await exec(
      db,
      `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
       CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), title TEXT);
       CREATE VIEW user_names AS SELECT name FROM users;`
    );
    await new Promise<void>((r) => db.close(() => r()));
    configPath = join(tmp, 'config.ini');
    await writeFile(
      configPath,
      `[database.demo]\ntype=sqlite\nfile=${file}\nselect_only=true\n\n` +
        `[database.writable]\ntype=sqlite\nfile=${file}\nselect_only=false\n`,
      { mode: 0o600 }
    );
  });

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('lists connections with selectOnly as configured', async () => {
    const out = await runPaneCommand('connections', ['--config', configPath], schemas);
    expect(out.code).toBe(0);
    const list = out.json as any[];
    expect(list.find((c) => c.name === 'demo')).toMatchObject({
      type: 'sqlite',
      host: null,
      ssh: false,
      ssl: false,
      selectOnly: true,
      mcpConfigurable: false,
    });
    expect(list.find((c) => c.name === 'writable').selectOnly).toBe(false);
    await mkdir(FIXTURES, { recursive: true });
    await writeFile(
      join(FIXTURES, 'connections.json'),
      JSON.stringify(normalize(out.json, tmp), null, 2) + '\n'
    );
  });

  it('returns a schema with primary keys, views and no lastChange', async () => {
    const out = await runPaneCommand('schema', ['demo', '--config', configPath], schemas);
    expect(out.code).toBe(0);
    const s = out.json as any;
    expect(s.database).toBe('demo');
    expect(s.tables.map((t: any) => t.name).sort()).toEqual(['posts', 'users']);
    expect(s.tables.find((t: any) => t.name === 'users').primary_key).toEqual(['id']);
    expect(s.views.map((t: any) => t.name)).toEqual(['user_names']);
    expect(s.lastChange).toBeNull();
    await writeFile(
      join(FIXTURES, 'schema.json'),
      JSON.stringify(normalize(out.json, tmp), null, 2) + '\n'
    );
  });

  it('reports the newest schemaChange from the journal and supports --refresh', async () => {
    const store = new PaneStore(dataDirFor(configPath));
    const base = {
      at: STAMP,
      source: 'claude' as const,
      database: 'demo',
      tool: 'sql_query' as const,
      sql: 'x',
      durationMs: 1,
      rowCount: 0,
      outcome: 'ok' as const,
      spool: null,
    };
    await store.append({
      ...base,
      id: 'a1',
      schemaChange: [{ kind: 'table-added', table: 'old' }],
    });
    await store.append({
      ...base,
      id: 'a2',
      schemaChange: [{ kind: 'table-added', table: 'new' }],
    });
    await store.append({ ...base, id: 'a3' });
    const out = await runPaneCommand(
      'schema',
      ['demo', '--refresh', '--config', configPath],
      schemas
    );
    expect(out.code).toBe(0);
    expect((out.json as any).lastChange).toEqual([{ kind: 'table-added', table: 'new' }]);
  });

  it('answers an unknown database with { error } and exit 1', async () => {
    const out = await runPaneCommand('schema', ['nope', '--config', configPath], schemas);
    expect(out.code).toBe(1);
    expect(out.json).toEqual({ error: expect.stringContaining('nope') });
  });

  it('answers a missing config with { error } and exit 1', async () => {
    const out = await runPaneCommand('connections', ['--config', join(tmp, 'absent.ini')], schemas);
    expect(out.code).toBe(1);
    expect(out.json).toHaveProperty('error');
  });

  it('answers not-yet-implemented commands with { error } and exit 1', async () => {
    const out = await runPaneCommand('query', [], schemas);
    expect(out).toEqual({ json: { error: 'not implemented yet' }, code: 1 });
  });

  it('writes nothing to stdout itself', async () => {
    const spy = jest.spyOn(process.stdout, 'write');
    await runPaneCommand('schema', ['demo', '--config', configPath], schemas);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

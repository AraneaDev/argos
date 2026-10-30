jest.unmock('sqlite3');
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sqlite3 from 'sqlite3';
import { connections, runPaneCommand } from '../../../src/cli/pane-commands.js';
import { openCore } from '../../../src/cli/core.js';
import { PaneStore, dataDirFor } from '../../../src/pane/store.js';
import { sqlitePrivileges } from '../../../src/database/privileges.js';

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
    // The MCP server's role checks, as it records them; a full-access connection's is not shown.
    const store = new PaneStore(dataDirFor(configPath));
    await store.recordRole('demo', { ...sqlitePrivileges(true), checkedAt: STAMP });
    await store.recordRole('writable', { ...sqlitePrivileges(false), checkedAt: STAMP });
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
      role: { checkedAt: STAMP, canWrite: false, principal: null, reasons: [] },
    });
    expect(list.find((c) => c.name === 'writable')).toMatchObject({
      selectOnly: false,
      role: null,
    });
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

  it('answers a query with no database as a usage { error } and exit 1', async () => {
    const out = await runPaneCommand('query', [], schemas);
    expect(out.code).toBe(1);
    expect(out.json).toEqual({ error: expect.stringContaining('Usage') });
  });

  it('writes nothing to stdout itself', async () => {
    const spy = jest.spyOn(process.stdout, 'write');
    await runPaneCommand('schema', ['demo', '--config', configPath], schemas);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  describe('query, history, result and pins', () => {
    let qtmp: string;
    let qconfig: string;
    let qschemas: string;
    let qfile: string;
    const cfg = () => ['--config', qconfig];
    const run = (kind: Parameters<typeof runPaneCommand>[0], ...args: string[]) =>
      runPaneCommand(kind, [...args, ...cfg()], qschemas);

    function count(): Promise<number> {
      return new Promise((res, rej) => {
        const d = new sqlite3.Database(qfile);
        d.get('SELECT COUNT(*) AS n FROM t', (e, row: any) => {
          d.close(() => (e ? rej(e) : res(row.n)));
        });
      });
    }

    beforeAll(async () => {
      qtmp = await mkdtemp(join(tmpdir(), 'argos-q-'));
      qschemas = join(qtmp, 'schemas');
      await mkdir(qschemas);
      qfile = join(qtmp, 'q.db');
      const db = new sqlite3.Database(qfile);
      await exec(
        db,
        `CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);
         INSERT INTO t (v) VALUES ('a'), ('b'), ('c');`
      );
      await new Promise<void>((r) => db.close(() => r()));
      qconfig = join(qtmp, 'config.ini');
      await writeFile(qconfig, `[database.full]\ntype=sqlite\nfile=${qfile}\nselect_only=false\n`, {
        mode: 0o600,
      });
    });

    afterAll(async () => {
      await rm(qtmp, { recursive: true, force: true });
    });

    const fixture = async (name: string, value: unknown) => {
      const text = JSON.stringify(
        value,
        (k, v) => {
          if (k === 'at' || k === 'createdAt') return STAMP;
          if (k === 'durationMs' && typeof v === 'number') return 0;
          if (['id', 'lastJournalId', 'batchId'].includes(k) && typeof v === 'string')
            return '<id>';
          if (k === 'spool' && typeof v === 'string') return '<id>.json';
          return v;
        },
        2
      );
      await writeFile(join(FIXTURES, name), text + '\n');
    };

    it('journals a SELECT as ok with a spool, and result pages it', async () => {
      const out = await run('query', 'full', '--sql', 'SELECT id, v FROM t ORDER BY id');
      expect(out.code).toBe(0);
      const e = out.json as any;
      expect(e).toMatchObject({
        source: 'pane',
        database: 'full',
        tool: 'pane_query',
        outcome: 'ok',
        rowCount: 3,
      });
      expect(e.spool).toBe(`${e.id}.json`);
      await fixture('query.json', out.json);

      const page = await run('result', e.id, '--offset', '1', '--limit', '1');
      expect(page.code).toBe(0);
      expect(page.json).toMatchObject({
        id: e.id,
        fields: ['id', 'v'],
        rows: [[2, 'b']],
        total: 3,
        offset: 1,
      });
      await fixture('result.json', page.json);

      const missing = await run('result', 'nope');
      expect(missing.code).toBe(1);
    });

    it.each([
      ['DELETE', 'DELETE FROM t'],
      ['data-modifying CTE', 'WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x'],
      ['multi-statement', 'SELECT 1; DROP TABLE t'],
    ])(
      'refuses %s on a full-access connection, journals blocked, table unchanged',
      async (_n, sql) => {
        const before = await count();
        const out = await run('query', 'full', '--sql', sql);
        expect(out.code).toBe(0);
        const e = out.json as any;
        expect(e).toMatchObject({
          outcome: 'blocked',
          source: 'pane',
          tool: 'pane_query',
          sql,
          spool: null,
          rowCount: null,
        });
        expect(typeof e.reason).toBe('string');
        expect(e.reason.length).toBeGreaterThan(0);
        expect(await count()).toBe(before);
        expect((await new PaneStore(dataDirFor(qconfig)).entry(e.id))?.outcome).toBe('blocked');
      }
    );

    it('opens a full-access connection read-only at the database, yet reports it as configured', async () => {
      const core = await openCore(cfg(), qschemas);
      try {
        // bypass the lexical gate: the database itself must refuse the write
        await expect(
          core.connectionManager.executeQuery('full', "INSERT INTO t (v) VALUES ('x')")
        ).rejects.toThrow(/readonly|read-only/i);
        expect((await connections(core)).find((c) => c.name === 'full')?.selectOnly).toBe(false);
        expect(core.config.databases.full!.select_only).toBe(false);
      } finally {
        await core.close();
      }
      expect(await count()).toBe(3);
    });

    it('journals a failing SELECT as error', async () => {
      const out = await run('query', 'full', '--sql', 'SELECT * FROM missing_table');
      expect(out.code).toBe(0);
      expect(out.json).toMatchObject({ outcome: 'error', spool: null });
    });

    it('answers an unknown database with { error } and exit 1', async () => {
      const out = await run('query', 'nope', '--sql', 'SELECT 1');
      expect(out.code).toBe(1);
    });

    it('pages history with --before and --limit, newest first', async () => {
      const all = (await run('history', '--limit', '100')).json as any[];
      expect(all.length).toBeGreaterThanOrEqual(5);
      const first = (await run('history', '--limit', '2')).json as any[];
      expect(first.map((e) => e.id)).toEqual(all.slice(0, 2).map((e) => e.id));
      const next = (await run('history', '--before', first[1].id, '--limit', '2')).json as any[];
      expect(next.map((e) => e.id)).toEqual(all.slice(2, 4).map((e) => e.id));
      await fixture('history.json', (await run('history', '--limit', '2')).json);
    });

    it('round-trips pins and updates lastJournalId when a query matches exactly', async () => {
      expect((await run('pins')).json).toEqual([]);
      const sql = 'SELECT v FROM t';
      const byQuery = (await run('pin', '--db', 'full', '--sql', sql, '--name', 'vals'))
        .json as any;
      expect(byQuery).toMatchObject({ name: 'vals', database: 'full', sql, lastJournalId: null });

      const ran = (await run('query', 'full', '--sql', sql)).json as any;
      let list = (await run('pins')).json as any[];
      expect(list).toHaveLength(1);
      expect(list[0].lastJournalId).toBe(ran.id);
      await fixture('pins.json', list);

      const byJournal = (await run('pin', ran.id)).json as any;
      expect(byJournal).toMatchObject({ database: 'full', sql, name: null, lastJournalId: ran.id });

      expect((await run('unpin', byQuery.id)).json).toEqual({ removed: true });
      expect((await run('unpin', byQuery.id)).json).toEqual({ removed: false });
      list = (await run('pins')).json as any[];
      expect(list.map((p) => p.id)).toEqual([byJournal.id]);
    });

    it('rejects pin with neither a journal id nor --db and --sql', async () => {
      expect((await run('pin')).code).toBe(1);
    });
  });
});

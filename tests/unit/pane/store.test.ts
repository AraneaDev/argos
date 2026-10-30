import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat, readFile, writeFile, appendFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transformSync } from '@swc/core';
import { PaneStore, dataDirFor } from '../../../src/pane/store.js';
import type { JournalEntry } from '../../../src/pane/contract.js';
import type { QueryResult } from '../../../src/types/database.js';

const entry = (id: string, over: Partial<JournalEntry> = {}): JournalEntry => ({
  id,
  at: '2026-01-01T00:00:00Z',
  source: 'claude',
  database: 'db',
  tool: 'sql_query',
  sql: 'select 1',
  durationMs: 1,
  rowCount: 1,
  outcome: 'ok',
  spool: null,
  ...over,
});

const result = (n: number, truncated = false): QueryResult => ({
  rows: Array.from({ length: n }, (_, i) => ({ b: `row${i}`, a: i })),
  rowCount: n,
  fields: ['a', 'b'],
  truncated,
  execution_time_ms: 1,
});

describe('PaneStore', () => {
  let dir: string;
  let store: PaneStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'argos-store-'));
    store = new PaneStore(join(dir, '.argos'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('dataDirFor puts .argos beside the config', () => {
    expect(dataDirFor('/x/y/config.ini')).toBe('/x/y/.argos');
  });

  it('newId uses the injected clock and sorts by time', () => {
    let t = 1_000_000;
    const s = new PaneStore(dir, { now: () => t });
    const a = s.newId();
    t += 5000;
    const b = s.newId();
    expect(a).toMatch(/^[0-9a-z]+-[0-9a-f]{8}$/);
    expect(a.startsWith((1_000_000).toString(36))).toBe(true);
    expect(a < b).toBe(true);
  });

  it('returns history newest first and pages with before', async () => {
    for (const id of ['a1', 'a2', 'a3', 'a4']) await store.append(entry(id));
    expect((await store.history({})).map((e) => e.id)).toEqual(['a4', 'a3', 'a2', 'a1']);
    expect((await store.history({ limit: 2 })).map((e) => e.id)).toEqual(['a4', 'a3']);
    expect((await store.history({ before: 'a3', limit: 5 })).map((e) => e.id)).toEqual([
      'a2',
      'a1',
    ]);
    expect((await store.entry('a2'))?.id).toBe('a2');
    expect(await store.entry('zz')).toBeNull();
  });

  it('history is empty with no journal', async () => {
    expect(await store.history({})).toEqual([]);
  });

  it('skips a torn last line and garbage lines', async () => {
    await store.append(entry('a1'));
    await appendFile(join(dir, '.argos', 'journal.jsonl'), 'not json\n{"id":"a2","sql":"sel');
    expect((await store.history({})).map((e) => e.id)).toEqual(['a1']);
  });

  it('reads lines across chunk boundaries, multibyte included', async () => {
    const big = 'é'.repeat(5000);
    for (let i = 0; i < 30; i++)
      await store.append(entry(`m${String(i).padStart(2, '0')}`, { sql: big }));
    const h = await store.history({ limit: 100 });
    expect(h).toHaveLength(30);
    expect(h[0].id).toBe('m29');
    expect(h[29].sql).toBe(big);
  });

  it('round-trips spool rows as arrays in field order and pages with total', async () => {
    const name = await store.writeSpool('s1', result(10, true));
    expect(name).toBe('s1.json');
    const page = await store.readSpool('s1', 2, 3);
    expect(page).toEqual({
      id: 's1',
      fields: ['a', 'b'],
      rows: [
        [2, 'row2'],
        [3, 'row3'],
        [4, 'row4'],
      ],
      total: 10,
      offset: 2,
      truncated: true,
    });
    expect((await store.readSpool('s1'))?.rows).toHaveLength(10);
    expect(await store.readSpool('nope')).toBeNull();
    expect(await store.readSpool('../evil')).toBeNull();
  });

  it('spools 100k rows and pages the tail', async () => {
    await store.writeSpool('big', result(100_000));
    const page = await store.readSpool('big', 99_900, 200);
    expect(page?.rows).toHaveLength(100);
    expect(page?.total).toBe(100_000);
    expect(page?.rows[99]).toEqual([99_999, 'row99999']);
  });

  it('evicts oldest past the byte cap but keeps a pinned spool', async () => {
    const t0 = Date.now();
    const s = new PaneStore(join(dir, '.argos'), { spoolBytes: 3000, now: () => t0 });
    await s.writeSpool('old1', result(100));
    await s.writeSpool('old2', result(100));
    await s.pin({ name: null, database: 'db', sql: 'x', lastJournalId: 'old1' });
    const spool = (n: string) => join(dir, '.argos', 'spool', `${n}.json`);
    await utimes(spool('old1'), new Date(t0 - 3000), new Date(t0 - 3000));
    await utimes(spool('old2'), new Date(t0 - 2000), new Date(t0 - 2000));
    await s.writeSpool('new1', result(100));
    await expect(stat(spool('old1'))).resolves.toBeDefined();
    await expect(stat(spool('old2'))).rejects.toThrow();
    await expect(stat(spool('new1'))).resolves.toBeDefined();
  });

  it('evicts spools older than spoolDays', async () => {
    const t0 = Date.now();
    const s = new PaneStore(join(dir, '.argos'), { spoolDays: 1, now: () => t0 });
    await s.writeSpool('aged', result(1));
    const p = join(dir, '.argos', 'spool', 'aged.json');
    await utimes(p, new Date(t0 - 2 * 86_400_000), new Date(t0 - 2 * 86_400_000));
    expect(await s.evict()).toBe(1);
    await expect(stat(p)).rejects.toThrow();
  });

  it('pins, lists and unpins', async () => {
    expect(await store.pins()).toEqual([]);
    const p = await store.pin({ name: 'n', database: 'db', sql: 'select 1', lastJournalId: null });
    expect(p.id).toBeTruthy();
    expect(p.createdAt).toMatch(/^\d{4}-/);
    expect(await store.pins()).toEqual([p]);
    expect(await store.unpin('missing')).toBe(false);
    expect(await store.unpin(p.id)).toBe(true);
    expect(await store.pins()).toEqual([]);
  });

  it('writes files 0600 and the directory 0700', async () => {
    await store.append(entry('a1'));
    await store.writeSpool('s1', result(1));
    await store.pin({ name: null, database: 'db', sql: 'x', lastJournalId: null });
    const base = join(dir, '.argos');
    for (const f of ['journal.jsonl', 'pins.json', 'spool/s1.json']) {
      expect((await stat(join(base, f))).mode & 0o777).toBe(0o600);
    }
    expect((await stat(base)).mode & 0o777).toBe(0o700);
  });

  it('creates .argos/.gitignore ignoring everything, and keeps an existing one', async () => {
    await store.ensure();
    const ignore = join(dir, '.argos', '.gitignore');
    expect(await readFile(ignore, 'utf8')).toBe('*\n');
    expect((await stat(join(dir, '.argos', 'spool'))).isDirectory()).toBe(true);

    await writeFile(ignore, '# mine\n');
    await new PaneStore(join(dir, '.argos')).append(entry('a1'));
    expect(await readFile(ignore, 'utf8')).toBe('# mine\n');
  });

  it('creates .gitignore on first write without an explicit ensure', async () => {
    await store.append(entry('a1'));
    expect(await readFile(join(dir, '.argos', '.gitignore'), 'utf8')).toBe('*\n');
  });

  it('persists fingerprint check times per connection, private to the user', async () => {
    expect(await store.fingerprintCheckedAt('db')).toBeUndefined();
    await store.recordFingerprintCheck('db', 1234);
    await store.recordFingerprintCheck('other', 99);
    const again = new PaneStore(join(dir, '.argos'));
    expect(await again.fingerprintCheckedAt('db')).toBe(1234);
    expect(await again.fingerprintCheckedAt('other')).toBe(99);
    expect((await stat(join(dir, '.argos', 'schema-checks.json'))).mode & 0o777).toBe(0o600);
  });

  it('records role checks per connection, a failed check with canWrite null', async () => {
    expect(await store.roles()).toEqual({});
    await store.recordRole('az', {
      canWrite: true,
      principal: 'dbo',
      reasons: ['db_owner'],
      notes: ['ignored by the pane'],
      checkedAt: 't1',
    });
    await store.recordRole('pg', { error: 'permission denied', checkedAt: 't2' });
    const again = new PaneStore(join(dir, '.argos'));
    expect(await again.roles()).toEqual({
      az: { checkedAt: 't1', canWrite: true, principal: 'dbo', reasons: ['db_owner'] },
      pg: { checkedAt: 't2', canWrite: null, principal: null, reasons: [] },
    });
    expect((await stat(join(dir, '.argos', 'roles.json'))).mode & 0o777).toBe(0o600);
  });

  it('keeps every role when checks finish together, and forgets one on request', async () => {
    const reader = { canWrite: false, principal: null, reasons: [], notes: [], checkedAt: 't' };
    await Promise.all(['a', 'b', 'c', 'd', 'e'].map((db) => store.recordRole(db, reader)));
    expect(Object.keys(await store.roles()).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    await store.forgetRole('c');
    await store.forgetRole('absent');
    expect(Object.keys(await store.roles()).sort()).toEqual(['a', 'b', 'd', 'e']);
  });

  it('reports a failed role write to its caller and goes on with the next', async () => {
    const reader = { canWrite: false, principal: null, reasons: [], notes: [], checkedAt: 't' };
    const broken = store as unknown as { writeAtomic: (p: string, t: string) => Promise<void> };
    const write = broken.writeAtomic.bind(store);
    broken.writeAtomic = async () => {
      throw new Error('disk full');
    };
    await expect(store.recordRole('a', reader)).rejects.toThrow('disk full');
    broken.writeAtomic = write;
    await store.recordRole('b', reader);
    expect(Object.keys(await store.roles())).toEqual(['b']);
  });

  it('leaves out a malformed role entry', async () => {
    await store.recordRole('ok', {
      canWrite: false,
      principal: null,
      reasons: [],
      notes: [],
      checkedAt: 't',
    });
    const path = join(dir, '.argos', 'roles.json');
    const roles = JSON.parse(await readFile(path, 'utf8'));
    roles.bad = { checkedAt: 't', canWrite: 'yes', principal: null, reasons: [] };
    await writeFile(path, JSON.stringify(roles));
    expect(Object.keys(await store.roles())).toEqual(['ok']);
  });

  it('two processes appending 500 entries each yield 1000 parseable lines', async () => {
    const src = await readFile(join(__dirname, '../../../src/pane/store.ts'), 'utf8');
    const js = transformSync(src, {
      filename: 'store.ts',
      jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
      module: { type: 'es6' },
    }).code;
    await writeFile(join(dir, 'store.mjs'), js);
    await writeFile(
      join(dir, 'worker.mjs'),
      `import { PaneStore } from './store.mjs';
const [, , d, tag] = process.argv;
const s = new PaneStore(d);
const pad = 'x'.repeat(2000);
await Promise.all(Array.from({ length: 500 }, (_, i) => s.append({ id: tag + '-' + i, at: '', source: 'pane', database: 'db', tool: 'pane_query', sql: pad, durationMs: 1, rowCount: 1, outcome: 'ok', spool: null })));
`
    );
    const run = (tag: string) =>
      new Promise<void>((res, rej) => {
        const c = spawn(process.execPath, [join(dir, 'worker.mjs'), join(dir, '.argos'), tag], {
          stdio: 'inherit',
        });
        c.on('exit', (code) =>
          code === 0 ? res() : rej(new Error(`worker ${tag} exited ${code}`))
        );
      });
    await Promise.all([run('p'), run('q')]);
    const lines = (await readFile(join(dir, '.argos', 'journal.jsonl'), 'utf8'))
      .split('\n')
      .filter(Boolean);
    expect(lines).toHaveLength(1000);
    expect(lines.every((l) => JSON.parse(l).id)).toBe(true);
    expect(await store.history({ limit: 2000 })).toHaveLength(1000);
  });
});

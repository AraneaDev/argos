/**
 * Regression: sqlite3 6.x runs its completion callbacks without draining the
 * microtask queue. A promise resolved inside one only resumes its `await` at the
 * next macrotask, which in an idle MCP server was 8-30 s away (every query, schema
 * capture and EXPLAIN stalled). The adapter must settle its promises on the next
 * turn of the event loop instead.
 *
 * Jest keeps its own event loop busy, which hides the stall, so the real adapter
 * runs in a plain child process with nothing else to wake it.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(__dirname, '../../..');
const IDLE_BUDGET_MS = 1000;

const CHILD = `
import { createRequire } from 'node:module';
const sqlite3 = createRequire(${JSON.stringify(join(ROOT, 'package.json'))})('sqlite3');
import { SQLiteAdapter } from ${JSON.stringify(pathToFileURL(join(ROOT, 'src/database/adapters/sqlite.ts')).href)};

const file = process.argv[2];
await new Promise((res, rej) => {
  const db = new sqlite3.Database(file, (err) => {
    if (err) return rej(err);
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t (v) VALUES ('a'), ('b');",
      (e) => (e ? rej(e) : db.close((c) => (c ? rej(c) : res()))));
  });
});
// Read stdin the way the MCP server's stdio transport does; the stall needs it.
process.stdin.resume();
// Let start-up activity settle, so the process is idle when the adapter runs.
await new Promise((r) => setTimeout(r, 300));

const adapter = new SQLiteAdapter({ type: 'sqlite', file, select_only: true });
const timings = {};
const time = async (label, op) => { const t = Date.now(); await op(); timings[label] = Date.now() - t; };
let connection;
await time('connect', async () => { connection = await adapter.connect(); });
for (let i = 1; i <= 3; i++) await time('query ' + i, () => adapter.executeQuery(connection, 'SELECT COUNT(*) AS n FROM t'));
await time('captureSchema', () => adapter.captureSchema(connection));
await time('disconnect', () => adapter.disconnect(connection));
process.stdout.write(JSON.stringify(timings));
process.exit(0);
`;

describe('SQLiteAdapter in an idle process', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'argos-sqlite-idle-'));
    writeFileSync(join(dir, 'child.mjs'), CHILD);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('resumes every await promptly, with nothing else waking the event loop', async () => {
    const stdout = await new Promise<string>((done, fail) => {
      const child = spawn(
        process.execPath,
        [
          '--import',
          pathToFileURL(join(ROOT, 'tests/fixtures/ts-loader.mjs')).href,
          join(dir, 'child.mjs'),
          join(dir, 'idle.db'),
        ],
        // An open stdin pipe keeps the child alive the way an MCP server's is.
        { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('error', fail);
      child.on('exit', (code) =>
        code === 0 ? done(out) : fail(new Error(`child exited ${code}: ${err}`))
      );
    });

    const timings = JSON.parse(stdout) as Record<string, number>;
    expect(Object.keys(timings)).toEqual([
      'connect',
      'query 1',
      'query 2',
      'query 3',
      'captureSchema',
      'disconnect',
    ]);
    for (const [label, ms] of Object.entries(timings)) {
      expect({ label, ms, fast: ms < IDLE_BUDGET_MS }).toEqual({ label, ms, fast: true });
    }
  }, 120_000);
});

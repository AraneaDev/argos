/**
 * Schema capture against the real sqlite3 driver (in-memory database): generated columns,
 * virtual tables and table names that need quoting. Only `all`/`run` are used here, which
 * work under Jest (unlike the streaming methods, see tests/integration/live-adapters.test.ts).
 */

// tests/setup.ts mocks sqlite3 for every suite; this one needs the real driver.
jest.unmock('sqlite3');

import { SQLiteAdapter } from '../../../src/database/adapters/sqlite.js';
import type { DatabaseConnection } from '../../../src/types/index.js';

type Db = {
  all(sql: string, cb: (err: Error | null, rows: unknown[]) => void): void;
  exec(sql: string, cb: (err: Error | null) => void): void;
  close(cb: (err: Error | null) => void): void;
};

const exec = (db: Db, sql: string) =>
  new Promise<void>((resolve, reject) => db.exec(sql, (err) => (err ? reject(err) : resolve())));

describe('SQLite schema capture with the real driver', () => {
  const adapter = new SQLiteAdapter({ type: 'sqlite', file: ':memory:' });
  let connection: DatabaseConnection;

  beforeEach(async () => {
    connection = await adapter.connect();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => (connection as unknown as Db).close(() => resolve()));
  });

  it('captures generated columns as ordinary columns', async () => {
    await exec(
      connection as unknown as Db,
      `CREATE TABLE people (
         first TEXT, last TEXT,
         full_name TEXT GENERATED ALWAYS AS (first || ' ' || last) VIRTUAL,
         initials TEXT GENERATED ALWAYS AS (substr(first, 1, 1)) STORED
       )`
    );
    const schema = await adapter.captureSchema(connection);
    expect(schema.tables.people.columns.map((c) => c.name)).toEqual([
      'first',
      'last',
      'full_name',
      'initials',
    ]);
  });

  it('types an FTS5 table as VIRTUAL TABLE', async () => {
    await exec(connection as unknown as Db, `create virtual table docs using fts5(title, body)`);
    const schema = await adapter.captureSchema(connection);
    expect(schema.tables.docs.type).toBe('VIRTUAL TABLE');
    // The shadow tables FTS5 creates stay ordinary tables
    expect(schema.tables.docs_content.type).toBe('table');
  });

  it('captures tables whose names need quoting', async () => {
    await exec(
      connection as unknown as Db,
      `CREATE TABLE "order" (id INTEGER PRIMARY KEY, total REAL);
       CREATE TABLE "my table" (a TEXT);
       CREATE TABLE "we""ird" (b TEXT REFERENCES "order"(id))`
    );
    const schema = await adapter.captureSchema(connection);
    expect(schema.tables.order.columns.map((c) => c.name)).toEqual(['id', 'total']);
    expect(schema.tables['my table'].columns.map((c) => c.name)).toEqual(['a']);
    expect(schema.tables['we"ird'].foreign_keys).toEqual([
      { column: 'b', references: { table: 'order', column: 'id' } },
    ]);
  });

  it('versions the fingerprint so schemas cached by the older capture get refreshed', async () => {
    // Caches written before generated columns and virtual tables were captured have a
    // fingerprint without the version: the forced check before a block sees a mismatch.
    const rows = await new Promise<unknown[]>((resolve, reject) =>
      (connection as unknown as Db).all(adapter.fingerprintQuery(), (err, found) =>
        err ? reject(err) : resolve(found)
      )
    );
    expect(rows).toEqual([{ argos_fingerprint: 0, capture_version: 2 }]);
  });
});

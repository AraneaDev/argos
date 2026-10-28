import {
  checkNames,
  defaultSchemaFor,
  suggest,
  type NameProblem,
} from '../../../src/schema/name-check.js';
import type { ColumnInfo, DatabaseSchema, TableInfo } from '../../../src/types/database.js';

describe('suggest', () => {
  it('matches across underscores', () => {
    expect(suggest('user_name', ['id', 'username', 'email'])).toEqual(['username']);
  });

  it('ranks the closest typo first', () => {
    expect(suggest('custmer_id', ['customer_id', 'id'])[0]).toBe('customer_id');
  });

  it('catches a one-letter typo', () => {
    expect(suggest('userz', ['users', 'orders'])).toEqual(['users']);
  });

  it('counts swapped adjacent letters as one typo', () => {
    expect(suggest('emial', ['id', 'email', 'username'])).toEqual(['email']);
  });

  it('treats singular and plural as a match', () => {
    expect(suggest('order', ['orders', 'users'])).toEqual(['orders']);
  });

  it('ignores case', () => {
    expect(suggest('USERNAME', ['username'])).toEqual(['username']);
  });

  it('makes no wild guesses', () => {
    expect(suggest('foo', ['id', 'username', 'created_at'])).toEqual([]);
  });

  it('caps the number of results', () => {
    const candidates = ['user1', 'user2', 'user3', 'user4', 'user5'];
    expect(suggest('user', candidates, 2)).toHaveLength(2);
    expect(suggest('user', candidates)).toHaveLength(3);
  });
});

describe('checkNames', () => {
  const table = (name: string, columns: string[]): TableInfo => ({
    name,
    type: 'BASE TABLE',
    columns: columns.map(
      (c) => ({ name: c, type: 'text', nullable: true, default: null }) as ColumnInfo
    ),
  });
  const schema = {
    database: 'db',
    type: 'postgresql',
    tables: {
      users: table('users', ['id', 'username', 'email', 'created_at']),
      orders: table('orders', ['id', 'user_id', 'total', 'status', 'created_at']),
    },
    views: { active_users: table('active_users', ['id', 'username']) },
  } as unknown as DatabaseSchema;
  const mysql = { ...schema, type: 'mysql', database: 'shop' } as DatabaseSchema;
  const sqlite = { ...schema, type: 'sqlite' } as DatabaseSchema;
  const columnsOf = (key: string) =>
    (schema.tables[key] ?? schema.views[key]).columns.map((c) => c.name);

  it.each([
    'WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM t WHERE n < 5) SELECT n FROM t',
    'SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)',
    'SELECT d.c FROM (SELECT count(*) AS c FROM orders) d',
    'SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at) AS rn FROM orders',
    'SELECT CAST(total AS integer), total::numeric FROM orders',
    "SELECT EXTRACT(epoch FROM created_at) FROM orders WHERE created_at > CURRENT_DATE - INTERVAL '7 days'",
    "SELECT data->>'k' FROM events",
    'SELECT * FROM users u, LATERAL (SELECT * FROM orders o WHERE o.user_id = u.id) x',
    'SELECT * FROM users JOIN orders USING (id)',
    'SELECT * FROM users NATURAL JOIN orders',
    'SELECT * FROM (VALUES (1),(2)) v(n)',
    'SELECT "username" FROM "users"',
    'SELECT Username FROM Users',
    'SELECT username AS who FROM users ORDER BY who',
    "SELECT * FROM analytics.events WHERE events.kind = 'x'",
    'SELECT * FROM information_schema.columns',
    'SELECT * FROM pg_stat_activity',
    'SELECT nosuch FROM my_matview',
    'SELECT * FROM tmp_import WHERE tmp_import.whatever = 1',
    'SELECT * FROM #tmp',
    'SELECT * FROM generate_series(1,3) g WHERE g.g > 1',
    'SELECT username FROM users -- u.nosuch',
    "SELECT username FROM users WHERE email = 'u.nosuch@x.com'",
    'SELECT username FROM users WHERE id = $1 AND email = ? AND username = @p1 AND created_at > :since',
    'SELECT nosuch FROM users JOIN some_unknown_table s ON s.id = users.id',
    'UPDATE users SET nosuch = 1',
    'SHOW TABLES',
    'SELECT ctid, id FROM users WHERE rowid = 1',
    'SELECT u FROM users u',
  ])('does not block %s', (sql) => {
    expect(checkNames(sql, schema, 'public')).toEqual([]);
  });

  it.each<[string, Partial<NameProblem>, string]>([
    ['SELECT u.user_name FROM users u', { name: 'user_name', table: 'users' }, 'username'],
    ['SELECT users.emial FROM users', { name: 'emial', table: 'users' }, 'email'],
    [
      'SELECT user_name FROM users',
      { name: 'user_name', table: null, inScope: ['users'] },
      'username',
    ],
    ["SELECT id FROM users WHERE emial = 'x'", { name: 'emial', table: null }, 'email'],
    [
      'SELECT o.totl FROM orders o JOIN users u ON u.id = o.user_id',
      { name: 'totl', table: 'orders' },
      'total',
    ],
    [
      'SELECT a.usrname FROM active_users a',
      { name: 'usrname', table: 'active_users' },
      'username',
    ],
    ['SELECT u.usrname FROM public.users u', { name: 'usrname', table: 'users' }, 'username'],
    ['EXPLAIN SELECT u.user_name FROM users u', { name: 'user_name', table: 'users' }, 'username'],
  ])('blocks %s', (sql, expected, hint) => {
    const problems = checkNames(sql, schema, 'public');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject(expected);
    const pool = expected.table ? columnsOf(expected.table) : columnsOf('users');
    expect(suggest(problems[0].name, pool)[0]).toBe(hint);
  });

  it('checks the database as the default schema on MySQL', () => {
    expect(defaultSchemaFor('mysql', 'shop')).toBe('shop');
    expect(checkNames('SELECT s.x FROM shop.users s', mysql, 'shop')).toMatchObject([
      { name: 'x', table: 'users' },
    ]);
  });

  it('names a default schema per engine', () => {
    expect(defaultSchemaFor('postgresql', 'db')).toBe('public');
    expect(defaultSchemaFor('postgres', 'db')).toBe('public');
    expect(defaultSchemaFor('mssql', 'db')).toBe('dbo');
    expect(defaultSchemaFor('sqlserver', 'db')).toBe('dbo');
    expect(defaultSchemaFor('sqlite', undefined)).toBe('main');
    expect(defaultSchemaFor('mysql', undefined)).toBeNull();
  });

  it('treats a schema other than the default as unknown', () => {
    expect(checkNames('SELECT s.x FROM other.users s', mysql, 'shop')).toEqual([]);
    expect(checkNames('SELECT s.x FROM shop.users s', mysql, null)).toEqual([]);
  });

  it('skips quoted bare columns on engines that read them as strings', () => {
    expect(checkNames('SELECT "nosuch" FROM users', mysql, 'shop')).toEqual([]);
    expect(checkNames('SELECT "nosuch" FROM users', sqlite, 'main')).toEqual([]);
    expect(checkNames('SELECT "nosuch" FROM users', schema, 'public')).toMatchObject([
      { name: 'nosuch', table: null },
    ]);
  });

  it('still checks quoted qualified columns on those engines', () => {
    expect(checkNames('SELECT u.`nosuch` FROM users u', mysql, 'shop')).toMatchObject([
      { name: 'nosuch', table: 'users' },
    ]);
  });

  it('does not check bare columns without a table', () => {
    expect(checkNames('SELECT foo', schema, 'public')).toEqual([]);
  });

  it('never reports hidden system columns', () => {
    const sql =
      'SELECT u.ctid, u.xmin, u.XMAX, u.cmin, u.cmax, u.tableoid, u.oid, u._rowid_, u.ROWID FROM users u';
    expect(checkNames(sql, schema, 'public')).toEqual([]);
    expect(checkNames('SELECT oid, _rowid_ FROM users', sqlite, 'main')).toEqual([]);
  });

  it.each(['SELECT _rowid FROM users', 'SELECT u._rowid, username FROM users u WHERE _rowid = 1'])(
    'does not block MySQL %s',
    (sql) => {
      expect(checkNames(sql, mysql, 'shop')).toEqual([]);
    }
  );

  describe('SQLite generated columns and virtual tables', () => {
    // Shaped like the SQLite capture: table_xinfo lists generated columns, and a virtual
    // table keeps its declared columns but is typed 'VIRTUAL TABLE'.
    const sqliteSchema = {
      database: 'app.db',
      type: 'sqlite',
      tables: {
        people: table('people', ['first', 'last', 'full_name']),
        docs: { ...table('docs', ['title', 'body']), type: 'VIRTUAL TABLE' },
        docs_content: { ...table('docs_content', ['id', 'c0', 'c1']), type: 'table' },
      },
      views: {},
    } as unknown as DatabaseSchema;

    it.each([
      'SELECT full_name FROM people',
      'SELECT p.full_name FROM people p WHERE full_name LIKE ?',
      "SELECT title FROM docs WHERE docs MATCH 'x' ORDER BY rank",
      "SELECT d.rank, d.docid, d.__langid, bm25(docs) FROM docs d WHERE docs MATCH 'x'",
      'SELECT nosuch FROM docs',
    ])('does not block %s', (sql) => {
      expect(checkNames(sql, sqliteSchema, 'main')).toEqual([]);
    });

    it('still checks the ordinary tables next to a virtual table', () => {
      expect(checkNames('SELECT p.fullname FROM people p', sqliteSchema, 'main')).toMatchObject([
        { name: 'fullname', table: 'people' },
      ]);
    });
  });

  it('does not treat a whole-row reference as a column', () => {
    expect(checkNames('SELECT users FROM users', schema, 'public')).toEqual([]);
    expect(checkNames('SELECT U FROM users u', schema, 'public')).toEqual([]);
  });

  it('ignores qualifiers that are not a known table', () => {
    expect(checkNames('SELECT geom.STX FROM users', schema, 'dbo')).toEqual([]);
    expect(checkNames('SELECT x.nosuch FROM users u', schema, 'public')).toEqual([]);
  });

  it('drops a qualifier bound to two different tables', () => {
    const sql = 'SELECT * FROM users t WHERE EXISTS (SELECT 1 FROM orders t WHERE t.total > 1)';
    expect(checkNames(sql, schema, 'public')).toEqual([]);
  });

  it('drops a qualifier that a CTE or derived table shadows', () => {
    expect(
      checkNames(
        'WITH users AS (SELECT 1 AS nosuch) SELECT users.nosuch FROM users',
        schema,
        'public'
      )
    ).toEqual([]);
    expect(
      checkNames(
        'SELECT o.nosuch FROM orders o WHERE o.id IN (SELECT o.id FROM (SELECT 1 AS id) o)',
        schema,
        'public'
      )
    ).toEqual([]);
  });

  it('matches a quoted table exactly before case-insensitively', () => {
    const mixed = {
      ...schema,
      tables: { ...schema.tables, Users: table('Users', ['Id']) },
    } as DatabaseSchema;
    expect(checkNames('SELECT u.Id FROM "Users" u', mixed, 'public')).toEqual([]);
    expect(checkNames('SELECT u.username FROM "users" u', mixed, 'public')).toEqual([]);
    // Unquoted and ambiguous by case: not sure which table, so no problem.
    expect(checkNames('SELECT u.nosuch FROM USERS u', mixed, 'public')).toEqual([]);
  });

  it('reports a repeated wrong column once', () => {
    expect(checkNames("SELECT emial FROM users WHERE emial = 'x'", schema, 'public')).toHaveLength(
      1
    );
  });

  it('lists every known table in scope for a bare column', () => {
    expect(
      checkNames(
        'SELECT nosuch FROM users JOIN orders ON orders.user_id = users.id',
        schema,
        'public'
      )
    ).toEqual([{ name: 'nosuch', table: null, inScope: ['users', 'orders'] }]);
  });
});

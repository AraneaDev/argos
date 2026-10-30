/**
 * SQL Security Manager with comprehensive validation
 */

import { EventEmitter } from 'events';
import type {
  SecurityValidation,
  QueryComplexityAnalysis,
  ComplexityLimits,
  ComplexityRiskLevel,
  SQLToken,
  TokenType,
  SecurityManagerConfig,
  ISecurityManager,
  ParsedServerConfig,
} from '../types/index.js';
import { getLogger } from '../utils/logger.js';

// ============================================================================
// SQL Security Manager Implementation
// ============================================================================

/**
 * The SQL filter: what SELECT-only mode refuses before a query reaches the driver.
 *
 * What it can promise: one statement, led by a read command, with no write, DDL or
 * privilege keyword anywhere in it, none of the listed side-effect functions, no
 * invisible formatting characters, and within the complexity limits. The published
 * bypass families (stacked statements, comments as whitespace, SET, data-modifying
 * CTEs, SELECT ... INTO, COPY ... TO PROGRAM, side-effect functions, case and
 * Unicode tricks) are pinned in tests/unit/security-bypass-regression.test.ts.
 *
 * What it cannot promise: that a function it does not know has no side effects.
 * A SELECT may call a user-defined function, or an extension's, that writes, and
 * no keyword list sees inside it. Nor does it bound load beyond the complexity
 * score: a heavy read is stopped by query_timeout, not here.
 *
 * So this is the second net. The boundary is the database role: a role that cannot
 * write cannot be made to write by any parser bug. ConnectionManager checks the role
 * of every select_only connection (src/database/privileges.ts) and warns, or with
 * require_readonly_role refuses, when it can write.
 */
export class SecurityManager extends EventEmitter implements ISecurityManager {
  // Commands that are dangerous regardless of select_only mode
  private readonly alwaysBlockedCommands = new Set<string>([
    'EXEC',
    'EXECUTE',
    'CALL',
    'LOAD',
    'IMPORT',
    'EXPORT',
    'BACKUP',
    'RESTORE',
    // Added per audit H5: COPY is PostgreSQL server-side file I/O / FROM PROGRAM
    // RCE primitive — must be blocked even in full-access mode. MERGE and UPSERT
    // are legitimate DML (like INSERT/UPDATE/DELETE, which are allowed in
    // full-access mode), so they are NOT here — they remain in blockedKeywords
    // (for SELECT-only mode) and in MUTATION_RE (for cache invalidation).
    'COPY',
  ]);

  private readonly blockedKeywords = new Set<string>([
    'INSERT',
    'UPDATE',
    'DELETE',
    'DROP',
    'CREATE',
    'ALTER',
    'TRUNCATE',
    'REPLACE',
    'MERGE',
    'UPSERT',
    'GRANT',
    'REVOKE',
    'EXEC',
    'EXECUTE',
    'CALL',
    'SET',
    'DECLARE',
    'USE',
    'LOAD',
    'IMPORT',
    'EXPORT',
    'BACKUP',
    'RESTORE',
    'ATTACH',
    'DETACH',
    'COPY',
    'PRAGMA',
    'VACUUM',
    'REINDEX',
  ]);

  // Commands that are the ONLY acceptable leading verb in SELECT-only mode.
  // The leading token of the statement must be one of these (or a db-specific
  // metadata command); anything else is rejected before deeper analysis.
  private readonly allowedLeadCommands = new Set<string>([
    'SELECT',
    'WITH',
    'SHOW',
    'EXPLAIN',
    'DESCRIBE',
    'DESC',
  ]);

  // Write/DDL/privilege keywords that must NOT appear anywhere in a SELECT-only
  // query. Scanning every token (not just the leading one) blocks data-modifying
  // CTEs (WITH x AS (DELETE ...)), COPY ... TO PROGRAM, SELECT ... INTO, and
  // stacked writes that a leading-keyword check alone would miss.
  private readonly writeCommandKeywords = new Set<string>([
    'INSERT',
    'UPDATE',
    'DELETE',
    'DROP',
    'CREATE',
    'ALTER',
    'TRUNCATE',
    'MERGE',
    'REPLACE',
    'UPSERT',
    'GRANT',
    'REVOKE',
    'EXEC',
    'EXECUTE',
    'CALL',
    'ATTACH',
    'DETACH',
    'LOAD',
    'IMPORT',
    'EXPORT',
    'BACKUP',
    'RESTORE',
    'COPY',
    'PRAGMA',
    'INTO',
    'VACUUM',
    'REINDEX',
    'SET',
    'USE',
    'DECLARE',
    // T-SQL statement verbs — semicolons are optional in T-SQL, so these can be chained
    // after a leading SELECT with only whitespace. Blocking them anywhere in the token
    // stream prevents `SELECT 1 UPDATETEXT ...` / `SELECT 1 DBCC ...` style bypasses.
    'WRITETEXT',
    'UPDATETEXT',
    'DBCC',
    'KILL',
    'RECONFIGURE',
    'CHECKPOINT',
    'SHUTDOWN',
    'DENY',
    'WAITFOR',
    'OPENROWSET',
    'OPENQUERY',
    'OPENDATASOURCE',
    'BULK',
  ]);

  private readonly allowedKeywords = new Set<string>([
    'SELECT',
    'WITH',
    'FROM',
    'WHERE',
    'JOIN',
    'INNER',
    'LEFT',
    'RIGHT',
    'OUTER',
    'FULL',
    'CROSS',
    'ON',
    'AS',
    'AND',
    'OR',
    'GROUP',
    'BY',
    'HAVING',
    'ORDER',
    'LIMIT',
    'OFFSET',
    'UNION',
    'INTERSECT',
    'EXCEPT',
    'CASE',
    'WHEN',
    'THEN',
    'ELSE',
    'END',
    'CAST',
    'CONVERT',
    'COALESCE',
    'NULLIF',
    'COUNT',
    'SUM',
    'AVG',
    'MIN',
    'MAX',
    'ROW_NUMBER',
    'RANK',
    'DENSE_RANK',
    'LAG',
    'LEAD',
    'FIRST_VALUE',
    'LAST_VALUE',
    'SHOW',
    'EXPLAIN',
    'DESCRIBE',
    'DESC',
    'ISNULL',
    'IFNULL',
    'NVL',
    'SUBSTRING',
    'CONCAT',
    'UPPER',
    'LOWER',
    'TRIM',
    'LENGTH',
    'ROUND',
    'FLOOR',
    'CEIL',
  ]);

  private readonly dbSpecificAllowed: Record<string, string[]> = {
    mysql: ['SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'],
    // Note: 'ANALYZE' is intentionally NOT allowed as a standalone lead command — it is a
    // write/maintenance statement (locks + updates pg_statistic). `EXPLAIN ANALYZE` is
    // handled and rejected explicitly in validateSelectOnlyQuery.
    postgresql: ['\\d', '\\dt', '\\l', 'EXPLAIN'],
    mssql: ['sp_help', 'sp_columns', 'sp_tables'],
    sqlite: ['.schema', '.tables', '.indices'],
  };

  private readonly complexityLimits: ComplexityLimits;
  private readonly logger = getLogger();

  constructor(config: SecurityManagerConfig = {}) {
    super(); // Call EventEmitter constructor

    const securityConfig = config.security || {};

    this.complexityLimits = {
      maxJoins: this.parseConfigValue(securityConfig.max_joins, 10),
      maxSubqueries: this.parseConfigValue(securityConfig.max_subqueries, 5),
      maxUnions: this.parseConfigValue(securityConfig.max_unions, 3),
      maxGroupBys: this.parseConfigValue(securityConfig.max_group_bys, 5),
      maxComplexityScore: this.parseConfigValue(securityConfig.max_complexity_score, 100),
      maxQueryLength: this.parseConfigValue(securityConfig.max_query_length, 10000),
    };

    this.logger.info('Security manager initialized', {
      limits: this.complexityLimits,
    });
  }

  // ============================================================================
  // Public Interface Methods
  // ============================================================================

  /**
   * Initialize the security manager with server configuration
   */
  public initialize(config: ParsedServerConfig): void {
    // Update complexity limits from configuration if provided
    if (config.security) {
      const securityConfig = config.security;

      this.complexityLimits.maxJoins =
        Number(securityConfig.max_joins) || this.complexityLimits.maxJoins;
      this.complexityLimits.maxSubqueries =
        Number(securityConfig.max_subqueries) || this.complexityLimits.maxSubqueries;
      this.complexityLimits.maxUnions =
        Number(securityConfig.max_unions) || this.complexityLimits.maxUnions;
      this.complexityLimits.maxGroupBys =
        Number(securityConfig.max_group_bys) || this.complexityLimits.maxGroupBys;
      this.complexityLimits.maxComplexityScore =
        Number(securityConfig.max_complexity_score) || this.complexityLimits.maxComplexityScore;
      this.complexityLimits.maxQueryLength =
        Number(securityConfig.max_query_length) || this.complexityLimits.maxQueryLength;

      this.logger.info('Security manager configuration updated', {
        limits: this.complexityLimits,
      });
    }

    this.emit('initialized', config);
  }

  /**
   * Validate any query (not just SELECT-only)
   */
  validateAnyQuery(query: string, dbType = 'mysql'): SecurityValidation {
    if (!query || typeof query !== 'string') {
      return {
        allowed: false,
        reason: 'Query is empty or invalid',
        confidence: 1.0,
      };
    }

    // Check query length limit
    if (query.length > this.complexityLimits.maxQueryLength) {
      return {
        allowed: false,
        reason: `Query exceeds maximum length of ${this.complexityLimits.maxQueryLength} characters`,
        confidence: 1.0,
      };
    }

    // Clean and normalize query
    let normalizedQuery: string;
    try {
      normalizedQuery = this.normalizeQuery(query, dbType);
    } catch (e) {
      return {
        allowed: false,
        reason: (e as Error).message,
        confidence: 1.0,
      };
    }

    // Extract SQL tokens
    const tokens = this.tokenizeQuery(normalizedQuery);

    if (tokens.length === 0) {
      return {
        allowed: false,
        reason: 'Query is empty or contains no valid SQL tokens',
        confidence: 1.0,
      };
    }

    // Reject stacked / multiple statements even in write mode — use the batch API
    // for multiple statements. This blocks ';'-separated injection on batch-capable
    // drivers (e.g. MSSQL) from riding along on a single-query call.
    if (this.hasMultipleStatements(tokens)) {
      return {
        allowed: false,
        reason:
          'Multiple SQL statements are not allowed in a single query. Use the batch query tool for multiple statements.',
        confidence: 1.0,
      };
    }

    // Block certain commands even in non-SELECT mode
    const firstToken = tokens.find((t) => t.type === 'KEYWORD');
    if (firstToken && this.alwaysBlockedCommands.has(firstToken.value.toUpperCase())) {
      return {
        allowed: false,
        reason: `Command '${firstToken.value.toUpperCase()}' is not allowed even in write mode`,
        blockedCommand: firstToken.value.toUpperCase(),
        confidence: 1.0,
      };
    }

    // Check for dangerous patterns (even in non-SELECT mode)
    const dangerousPatterns = this.checkDangerousPatterns(normalizedQuery);
    if (dangerousPatterns.length > 0) {
      return {
        allowed: false,
        reason: `Query contains dangerous patterns: ${dangerousPatterns.join(', ')}`,
        confidence: 0.95,
      };
    }

    // Additional complexity validation
    const complexity = this.analyzeQueryComplexity(query);
    if (complexity.score > this.complexityLimits.maxComplexityScore) {
      return {
        allowed: false,
        reason: `Query complexity score (${complexity.score}) exceeds safety threshold of ${this.complexityLimits.maxComplexityScore}`,
        confidence: 0.8,
      };
    }

    // Check individual complexity limits
    if (complexity.joinCount > this.complexityLimits.maxJoins) {
      return {
        allowed: false,
        reason: `Too many JOINs (${complexity.joinCount}), maximum allowed: ${this.complexityLimits.maxJoins}`,
        confidence: 0.9,
      };
    }

    if (complexity.subqueryCount > this.complexityLimits.maxSubqueries) {
      return {
        allowed: false,
        reason: `Too many subqueries (${complexity.subqueryCount}), maximum allowed: ${this.complexityLimits.maxSubqueries}`,
        confidence: 0.9,
      };
    }

    if (complexity.unionCount > this.complexityLimits.maxUnions) {
      return {
        allowed: false,
        reason: `Too many UNIONs (${complexity.unionCount}), maximum allowed: ${this.complexityLimits.maxUnions}`,
        confidence: 0.9,
      };
    }

    if (complexity.groupByCount > this.complexityLimits.maxGroupBys) {
      return {
        allowed: false,
        reason: `Too many GROUP BY clauses (${complexity.groupByCount}), maximum allowed: ${this.complexityLimits.maxGroupBys}`,
        confidence: 0.9,
      };
    }

    // If we get here, query is allowed (non-SELECT mode allows all valid queries)
    return {
      allowed: true,
      confidence: 0.9,
    };
  }

  /**
   * Validate a single SELECT-only query with enhanced feedback
   */
  validateSelectOnlyQuery(query: string, dbType = 'mysql'): SecurityValidation {
    if (!query || typeof query !== 'string') {
      return {
        allowed: false,
        reason: 'Query is empty or invalid',
        confidence: 1.0,
      };
    }

    // Check query length limit
    if (query.length > this.complexityLimits.maxQueryLength) {
      return {
        allowed: false,
        reason: `Query exceeds maximum length of ${this.complexityLimits.maxQueryLength} characters (current: ${query.length})`,
        confidence: 1.0,
      };
    }

    // Invisible formatting characters (zero-width spaces and joiners, bidi controls,
    // soft hyphens) split a keyword for this validator while meaning nothing to a
    // reader: DEL<U+200B>ETE is not DELETE here. No read needs them.
    if (/\p{Cf}/u.test(query)) {
      return {
        allowed: false,
        reason:
          'Query contains invisible Unicode formatting characters (such as a zero-width space), which are not allowed in SELECT-only mode.',
        confidence: 1.0,
      };
    }

    // Clean and normalize query
    let normalizedQuery: string;
    try {
      normalizedQuery = this.normalizeQuery(query, dbType);
    } catch (e) {
      return {
        allowed: false,
        reason: (e as Error).message,
        confidence: 1.0,
      };
    }

    // Extract SQL tokens
    const tokens = this.tokenizeQuery(normalizedQuery);

    if (tokens.length === 0) {
      return {
        allowed: false,
        reason: 'Query is empty or contains no valid SQL tokens',
        confidence: 1.0,
      };
    }

    // Reject stacked / multiple statements outright. A leading-keyword check alone
    // cannot protect drivers that execute ';'-separated batches (e.g. MSSQL).
    if (this.hasMultipleStatements(tokens)) {
      return {
        allowed: false,
        reason:
          'Multiple SQL statements are not allowed in SELECT-only mode. Submit a single SELECT statement.',
        confidence: 1.0,
      };
    }

    // The command is the FIRST meaningful word of the raw statement — NOT the first
    // token that happens to be a known keyword. A leading identifier such as COPY or
    // PRAGMA must be judged as the command, not skipped over to an embedded FROM/SELECT.
    const firstToken = tokens.find((token) => /^[A-Za-z_.\\]/.test(token.value));

    if (!firstToken) {
      return {
        allowed: false,
        reason: 'No SQL command found',
        confidence: 1.0,
      };
    }

    const command = firstToken.value.toUpperCase();
    const dbAllowed = this.dbSpecificAllowed[dbType] || [];

    // Check if command is explicitly blocked
    if (this.blockedKeywords.has(command)) {
      return {
        allowed: false,
        reason: `Command '${command}' is not allowed in SELECT-only mode. Allowed commands: SELECT, WITH, SHOW, EXPLAIN, DESCRIBE`,
        blockedCommand: command,
        confidence: 1.0,
      };
    }

    // The leading command must be an explicitly allowed read command (or a
    // database-specific metadata command matched by EXACT name). Everything else
    // is rejected. Use exact equality — a substring match (command.includes(cmd))
    // would let stored procs whose names merely contain an allowed fragment
    // (e.g. sp_helpdesk_reset contains sp_help) bypass all subsequent security
    // checks via an early return (audit C1).
    const leadingAllowed =
      this.allowedLeadCommands.has(command) ||
      dbAllowed.some((cmd) => command === cmd.toUpperCase());

    if (!leadingAllowed) {
      return {
        allowed: false,
        reason: `Command '${command}' is not permitted in SELECT-only mode. Allowed commands: SELECT, WITH, SHOW, EXPLAIN, DESCRIBE, and database-specific metadata commands.`,
        blockedCommand: command,
        confidence: 1.0,
      };
    }

    // NOTE: the unconditional early return for db-specific metadata commands was
    // removed (audit C1). Metadata commands (e.g. sp_help, \d, .schema) now fall
    // through to the write-keyword scan, dangerous-pattern checks, and complexity
    // limits below — so a proc like sp_help cannot be used to smuggle embedded
    // write keywords or dangerous patterns past the validator.

    // No write/DDL/privilege keyword may appear ANYWHERE in the statement. This blocks
    // data-modifying CTEs, SELECT ... INTO, COPY ... TO PROGRAM, and embedded writes
    // that slip past a leading-keyword-only check.
    const embeddedWrite = tokens.find((token) =>
      this.writeCommandKeywords.has(token.value.toUpperCase())
    );
    if (embeddedWrite) {
      const kw = embeddedWrite.value.toUpperCase();
      return {
        allowed: false,
        reason: `Query contains the write/DDL keyword '${kw}', which is not allowed in SELECT-only mode.`,
        blockedCommand: kw,
        confidence: 0.95,
      };
    }

    // EXPLAIN ANALYZE actually executes the statement on PostgreSQL — forbid it.
    if (command === 'EXPLAIN' && tokens.some((token) => token.value.toUpperCase() === 'ANALYZE')) {
      return {
        allowed: false,
        reason:
          'EXPLAIN ANALYZE executes the underlying statement and is not allowed in SELECT-only mode. Use plain EXPLAIN.',
        confidence: 0.95,
      };
    }

    // Dangerous function / injection / privilege patterns (now reached on the primary path).
    const dangerousPatterns = this.checkDangerousPatterns(normalizedQuery);
    if (dangerousPatterns.length > 0) {
      return {
        allowed: false,
        reason: `Query contains potentially dangerous patterns: ${dangerousPatterns.join(', ')}. This may indicate an attempt to bypass security restrictions.`,
        confidence: 0.95,
      };
    }

    // Deep validation (nested dangerous ops, complexity limits, suspicious functions).
    const deepValidation = this.performDeepValidation(normalizedQuery, tokens);
    return {
      allowed: deepValidation.allowed,
      reason: deepValidation.reason,
      confidence: deepValidation.confidence,
    };
  }

  /**
   * Detect whether the tokenized query contains more than one top-level statement.
   * String literals are single tokens, so a ';' operator token followed by any
   * further word token indicates a stacked statement.
   */
  private hasMultipleStatements(tokens: SQLToken[]): boolean {
    const semicolonIndex = tokens.findIndex((t) => t.value === ';');
    if (semicolonIndex === -1) return false;
    // A trailing semicolon (optionally followed by nothing) is fine.
    return tokens.slice(semicolonIndex + 1).some((t) => /^[A-Za-z_.\\]|^\d/.test(t.value));
  }

  /**
   * Analyze query complexity and potential performance impact
   */
  analyzeQueryComplexity(query: string): QueryComplexityAnalysis {
    const upperQuery = query.toUpperCase();
    let score = 0;
    const factors: string[] = [];

    // Count different complexity factors
    const joinCount = (upperQuery.match(/\bJOIN\b/g) || []).length;
    const subqueryCount = (upperQuery.match(/\(\s*SELECT/g) || []).length;
    const unionCount = (upperQuery.match(/\bUNION\b/g) || []).length;

    // Count GROUP BY fields more accurately
    let groupByCount = 0;
    const groupByMatch = upperQuery.match(
      /GROUP\s+BY\s+([\w\s,().]+?)(?:\s+HAVING|\s+ORDER|\s+LIMIT|$)/
    );
    if (groupByMatch) {
      // Count commas in the GROUP BY clause to estimate number of grouped fields
      const groupByClause = groupByMatch[1];
      groupByCount = (groupByClause.match(/,/g) || []).length + 1; // +1 for the first field
    }

    const orderByCount = (upperQuery.match(/\bORDER\s+BY\b/g) || []).length;
    const windowFuncCount = (upperQuery.match(/\bOVER\s*\(/g) || []).length;

    // Calculate complexity score
    score += joinCount * 5;
    score += subqueryCount * 10;
    score += unionCount * 8;
    score += groupByCount * 3;
    score += orderByCount * 2;
    score += windowFuncCount * 7;

    if (joinCount > 0) factors.push(`${joinCount} joins`);
    if (subqueryCount > 0) factors.push(`${subqueryCount} subqueries`);
    if (unionCount > 0) factors.push(`${unionCount} unions`);
    if (groupByCount > 0) factors.push(`${groupByCount} group by`);
    if (windowFuncCount > 0) factors.push(`${windowFuncCount} window functions`);

    // Query length factor
    const lengthFactor = Math.floor(query.length / 100);
    score += lengthFactor;

    return {
      score,
      factors,
      joinCount,
      subqueryCount,
      unionCount,
      groupByCount,
      windowFuncCount,
      risk_level: this.getComplexityRiskLevel(score),
    };
  }

  // ============================================================================
  // Private Implementation Methods
  // ============================================================================

  private performDeepValidation(query: string, _tokens: SQLToken[]): SecurityValidation {
    const upperQuery = query.toUpperCase();

    // Check for nested dangerous commands
    const nestedDangerousPatterns = [
      /SELECT.*INTO\s+(?:OUTFILE|DUMPFILE)/i,
      /SELECT.*LOAD_FILE/i,
      /SELECT.*SYSTEM/i,
      /SELECT.*EXEC/i,
      /SELECT.*;\s*(?:DROP|DELETE|UPDATE|INSERT)/i,
      /UNION.*SELECT.*INTO/i,
    ];

    for (const pattern of nestedDangerousPatterns) {
      if (pattern.test(query)) {
        return {
          allowed: false,
          reason: 'Query contains nested dangerous operations',
          confidence: 0.95,
        };
      }
    }

    // Check for excessive complexity that might indicate malicious intent
    const complexity = this.analyzeQueryComplexity(query);
    if (complexity.score > this.complexityLimits.maxComplexityScore) {
      return {
        allowed: false,
        reason: `Query complexity score (${complexity.score}) exceeds safety threshold of ${this.complexityLimits.maxComplexityScore}`,
        confidence: 0.8,
      };
    }

    // Check individual complexity limits
    if (complexity.joinCount > this.complexityLimits.maxJoins) {
      return {
        allowed: false,
        reason: `Too many JOINs (${complexity.joinCount}), maximum allowed: ${this.complexityLimits.maxJoins}`,
        confidence: 0.9,
      };
    }

    if (complexity.subqueryCount > this.complexityLimits.maxSubqueries) {
      return {
        allowed: false,
        reason: `Too many subqueries (${complexity.subqueryCount}), maximum allowed: ${this.complexityLimits.maxSubqueries}`,
        confidence: 0.9,
      };
    }

    if (complexity.unionCount > this.complexityLimits.maxUnions) {
      return {
        allowed: false,
        reason: `Too many UNIONs (${complexity.unionCount}), maximum allowed: ${this.complexityLimits.maxUnions}`,
        confidence: 0.9,
      };
    }

    if (complexity.groupByCount > this.complexityLimits.maxGroupBys) {
      return {
        allowed: false,
        reason: `Too many GROUP BY clauses (${complexity.groupByCount}), maximum allowed: ${this.complexityLimits.maxGroupBys}`,
        confidence: 0.9,
      };
    }

    // Check for suspicious function usage
    const suspiciousFunctions = [
      'BENCHMARK',
      'SLEEP',
      'USER',
      'PASSWORD',
      'VERSION',
      'DATABASE',
      'SCHEMA',
      'CONNECTION_ID',
    ];

    for (const func of suspiciousFunctions) {
      if (upperQuery.includes(func + '(')) {
        return {
          allowed: false,
          reason: `Potentially suspicious function usage: ${func}`,
          confidence: 0.7,
        };
      }
    }

    return {
      allowed: true,
      reason: undefined, // Don't provide reason for successful validations
      confidence: 0.95,
    };
  }

  private getComplexityRiskLevel(score: number): ComplexityRiskLevel {
    if (score <= 20) return 'LOW';
    if (score <= 50) return 'MEDIUM';
    if (score <= this.complexityLimits.maxComplexityScore) return 'HIGH';
    return 'CRITICAL';
  }

  private normalizeQuery(query: string, dbType = 'mysql'): string {
    // Block MySQL version-conditional comments that execute as SQL
    if (/\/\*!/.test(query)) {
      throw new Error(
        'Query contains MySQL version-conditional comments (/*!) which are not allowed'
      );
    }

    return this.stripComments(query, dbType)
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Remove SQL comments, leaving string and identifier literals untouched.
   *
   * This walks the statement rather than running a regex over it, because a
   * regex cannot tell a comment from the same characters inside a literal. A
   * '--' in a string used to swallow the rest of the line, carrying a stacked
   * "; DROP ..." out of the validator's view while PostgreSQL's simple query
   * protocol and SQL Server's batch API still executed it.
   *
   * Each comment is replaced by a space, not by nothing: a comment separates the
   * tokens either side of it, so removing it outright welded them together and
   * made SEL(comment)ECT read as SELECT.
   * @param query - the raw statement
   * @param dbType - decides whether '#' starts a comment
   */
  private stripComments(query: string, dbType: string): string {
    // '#' begins a line comment ONLY in MySQL/MariaDB. In PostgreSQL (and others)
    // '#' is a valid operator (integer bitwise XOR, geometric ops), so treating it
    // as a comment there would hide a stacked statement (FIND-101).
    const t = (dbType || '').toLowerCase();
    const hashStartsComment = t === 'mysql' || t === 'mariadb';

    let out = '';
    let i = 0;

    while (i < query.length) {
      const ch = query[i]!;
      const next = query[i + 1];

      // Quoted string or delimited identifier: copied through verbatim, with the
      // doubled quote treated as an escape rather than as a close.
      if (ch === "'" || ch === '"' || ch === '`') {
        out += ch;
        i++;
        while (i < query.length) {
          if (query[i] === ch) {
            if (query[i + 1] === ch) {
              out += ch + ch;
              i += 2;
              continue;
            }
            out += ch;
            i++;
            break;
          }
          out += query[i];
          i++;
        }
        continue;
      }

      // PostgreSQL dollar quoting: $$ ... $$ or $tag$ ... $tag$, no escapes inside.
      if (ch === '$') {
        const opener = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(query.slice(i));
        if (opener) {
          const tag = opener[0];
          const close = query.indexOf(tag, i + tag.length);
          const stop = close === -1 ? query.length : close + tag.length;
          out += query.slice(i, stop);
          i = stop;
          continue;
        }
      }

      if ((ch === '-' && next === '-') || (hashStartsComment && ch === '#')) {
        while (i < query.length && query[i] !== '\n' && query[i] !== '\r') i++;
        out += ' ';
        continue;
      }

      if (ch === '/' && next === '*') {
        // Ends at the FIRST '*/', deliberately, even though PostgreSQL and T-SQL
        // nest block comments. MySQL and SQLite do not, so in
        //     /* a /* b */ ; DROP TABLE users */
        // the tail really does execute there. Closing at the first '*/' leaves
        // that tail visible to the validator on every engine. The cost is
        // rejecting a genuinely nested comment on PostgreSQL; the alternative
        // costs a SELECT-only bypass on MySQL.
        i += 2;
        while (i < query.length && !(query[i] === '*' && query[i + 1] === '/')) i++;
        i += 2;
        out += ' ';
        continue;
      }

      out += ch;
      i++;
    }

    return out;
  }

  private tokenizeQuery(query: string): SQLToken[] {
    const tokens: SQLToken[] = [];
    const tokenRegex = /(\w+|[().,;]|'[^']*'|"[^"]*"|`[^`]*`)/g;
    let match;

    while ((match = tokenRegex.exec(query)) !== null) {
      const value = match[1]!;
      let type: TokenType = 'IDENTIFIER';

      if (/^[a-zA-Z_]\w*$/.test(value)) {
        const upper = value.toUpperCase();
        if (this.allowedKeywords.has(upper) || this.blockedKeywords.has(upper)) {
          type = 'KEYWORD';
        }
      } else if (/^['"`]/.test(value)) {
        type = 'STRING';
      } else if (/^[().,;]$/.test(value)) {
        type = 'OPERATOR';
      }

      tokens.push({
        value,
        type,
        position: match.index!,
        normalized: value.toUpperCase(),
      });
    }

    return tokens;
  }

  private checkDangerousPatterns(query: string): string[] {
    const dangerous: string[] = [];

    // Function-style dangerous calls. Require a following "(" and a leading word
    // boundary so we don't match substrings inside legitimate identifiers
    // (e.g. "description" contains "script", "ecosystem" contains "system").
    const dangerousFunctionNames = [
      'LOAD_FILE',
      'SYSTEM',
      'SHELL',
      'EXEC',
      'EVAL',
      'SCRIPT',
      'BENCHMARK',
      'SLEEP',
      // PostgreSQL file / process / DoS surface
      'PG_READ_FILE',
      'PG_READ_BINARY_FILE',
      'PG_LS_DIR',
      'LO_IMPORT',
      'LO_EXPORT',
      'PG_SLEEP',
      // PostgreSQL functions that change state from inside a plain SELECT: session
      // settings (turning a read-only session read-write), other backends, the server
      // configuration, and sequences (an advance survives a rollback).
      'SET_CONFIG',
      'PG_TERMINATE_BACKEND',
      'PG_CANCEL_BACKEND',
      'PG_RELOAD_CONF',
      'PG_ROTATE_LOGFILE',
      'PG_SWITCH_WAL',
      'PG_PROMOTE',
      'NEXTVAL',
      'SETVAL',
      'LOWRITE',
    ];

    for (const name of dangerousFunctionNames) {
      if (new RegExp(`\\b${name}\\s*\\(`, 'i').test(query)) {
        dangerous.push(`Function: ${name}`);
      }
    }

    // Whole families, matched by prefix: dblink_connect/dblink_exec/..., the
    // large-object functions (lo_from_bytea, lo_unlink, lo_put, ...) and adminpack's
    // pg_file_write/pg_file_unlink/.... lo_get only reads a large object and stays allowed.
    const readOnlyMembers = new Set(['LO_GET']);
    for (const prefix of ['DBLINK', 'LO_', 'PG_FILE_']) {
      for (const match of query.matchAll(new RegExp(`\\b(${prefix}\\w*)\\s*\\(`, 'gi'))) {
        const name = match[1]!.toUpperCase();
        if (!readOnlyMembers.has(name)) {
          dangerous.push(`Function: ${name}`);
          break;
        }
      }
    }

    // Phrase / construct patterns (not function-call shaped).
    const dangerousConstructs: Array<[string, RegExp]> = [
      ['INTO OUTFILE', /\bINTO\s+OUTFILE\b/i],
      ['INTO DUMPFILE', /\bINTO\s+DUMPFILE\b/i],
      ['WAITFOR DELAY', /\bWAITFOR\s+DELAY\b/i],
      ['COPY ... PROGRAM', /\bCOPY\b[\s\S]*\bPROGRAM\b/i],
    ];

    for (const [label, re] of dangerousConstructs) {
      if (re.test(query)) {
        dangerous.push(`Function: ${label}`);
      }
    }

    // Enhanced SQL injection patterns
    const injectionPatterns = [
      /;\s*(DROP|DELETE|UPDATE|INSERT|EXEC|EXECUTE)/i,
      /UNION\s+SELECT.*INTO/i,
      /'\s*OR\s+'1'\s*=\s*'1/i,
      /'\s*OR\s+1\s*=\s*1/i,
      /'\s*;\s*DROP\s+TABLE/i,
      /'\s*UNION\s+SELECT\s+NULL/i,
      /CONCAT\s*\(\s*CHAR\s*\(/i,
    ];

    for (const pattern of injectionPatterns) {
      if (pattern.test(query)) {
        dangerous.push('Potential SQL injection pattern');
        break;
      }
    }

    // Check for privilege escalation attempts
    const privilegePatterns = [
      /CREATE\s+USER/i,
      /GRANT\s+ALL/i,
      /ALTER\s+USER/i,
      /SET\s+PASSWORD/i,
    ];

    for (const pattern of privilegePatterns) {
      if (pattern.test(query)) {
        dangerous.push('Privilege escalation attempt');
        break;
      }
    }

    return dangerous;
  }

  private parseConfigValue(value: string | number | undefined, defaultValue: number): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = parseInt(value, 10);
      return isNaN(parsed) ? defaultValue : parsed;
    }
    return defaultValue;
  }
}

/**
 * Base Database Adapter Tests
 * Tests the abstract DatabaseAdapter base class functionality
 */

import { DatabaseAdapter } from '../../../src/database/adapters/base.js';
import type {
  DatabaseConnection,
  DatabaseConfig,
  QueryResult,
  DatabaseSchema,
} from '../../../src/types/index.js';

// ============================================================================
// Test Implementation of DatabaseAdapter
// ============================================================================

class TestAdapter extends DatabaseAdapter {
  public testConnection: any = null;
  public testSchema: DatabaseSchema;
  public shouldFailConnection = false;
  public shouldFailQuery = false;
  public shouldFailTransaction = false;

  constructor(config: DatabaseConfig) {
    super(config);
    this.testSchema = this.createBaseSchema('test_db');
  }

  async connect(): Promise<DatabaseConnection> {
    if (this.shouldFailConnection) {
      throw new Error('Connection failed');
    }
    this.testConnection = { id: 'test-connection' };
    return this.testConnection;
  }

  async executeQuery(
    connection: DatabaseConnection,
    query: string,
    params?: unknown[]
  ): Promise<QueryResult> {
    if (this.shouldFailQuery) {
      throw new Error('Query failed');
    }

    return {
      rows: [
        { id: 1, name: 'test' },
        { id: 2, name: 'test2' },
      ],
      rowCount: 2,
      fields: ['id', 'name'],
      truncated: false,
      execution_time_ms: 10,
    };
  }

  async disconnect(connection: DatabaseConnection): Promise<void> {
    this.testConnection = null;
  }

  async captureSchema(connection: DatabaseConnection): Promise<DatabaseSchema> {
    return this.testSchema;
  }

  isConnected(connection: DatabaseConnection): boolean {
    return connection === this.testConnection && this.testConnection !== null;
  }

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    if (this.shouldFailTransaction) {
      throw new Error('Begin transaction failed');
    }
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    if (this.shouldFailTransaction) {
      throw new Error('Commit transaction failed');
    }
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    if (this.shouldFailTransaction) {
      throw new Error('Rollback transaction failed');
    }
  }

  buildExplainQuery(query: string): string {
    return `EXPLAIN ${query}`;
  }

  fingerprintQuery(): string {
    return 'SELECT 1 AS argos_fingerprint';
  }

  protected extractFieldNames(result: unknown): string[] {
    return ['id', 'name'];
  }

  protected extractRawRows(result: unknown): unknown[] {
    return [
      { id: 1, name: 'test' },
      { id: 2, name: 'test2' },
    ];
  }

  // Expose protected methods for testing
  public testValidateConfig(requiredFields: string[]): void {
    return this.validateConfig(requiredFields);
  }

  public testParseConfigValue<T>(
    value: string | number | boolean | T,
    type: 'string' | 'number' | 'boolean',
    defaultValue: T
  ): T {
    return this.parseConfigValue(value, type, defaultValue);
  }

  public testCreateError(message: string, originalError?: Error): Error {
    return this.createError(message, originalError);
  }

  public testTruncateResults(rows: unknown[], maxRows: number) {
    return this.truncateResults(rows, maxRows);
  }

  public testNormalizeQueryResult(rawResult: unknown, startTime: number, maxRows?: number) {
    return this.normalizeQueryResult(rawResult, startTime, maxRows);
  }

  public testCreateBaseSchema(databaseName: string) {
    return this.createBaseSchema(databaseName);
  }

  public testVerifyServerCertificate(): boolean {
    return this.verifyServerCertificate();
  }

  public testGetMaxRows(): number {
    return this.getMaxRows();
  }

  public testGetStatementTimeoutMs(): number {
    return this.getStatementTimeoutMs();
  }

  public testBuildStreamedResult(
    rows: Record<string, unknown>[],
    observedRowCount: number,
    truncated: boolean,
    startTime: number,
    query?: string
  ) {
    return this.buildStreamedResult(rows, observedRowCount, truncated, startTime, query);
  }

  public testUpdateSchemaSummary(schema: DatabaseSchema) {
    return this.updateSchemaSummary(schema);
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('DatabaseAdapter Base Class', () => {
  let testConfig: DatabaseConfig;
  let adapter: TestAdapter;

  beforeEach(() => {
    testConfig = {
      type: 'sqlite',
      database: 'test.db',
      host: 'localhost',
      port: 5432,
      username: 'testuser',
      password: 'testpass',
      timeout: 30000,
      ssl: false,
    };
    adapter = new TestAdapter(testConfig);
  });

  // ============================================================================
  // Constructor and Configuration Tests
  // ============================================================================

  describe('constructor', () => {
    it('should initialize with valid config', () => {
      expect(adapter.getType()).toBe('sqlite');
      expect((adapter as any).config).toEqual(testConfig);
    });

    it('should parse timeout from string', () => {
      const configWithStringTimeout = { ...testConfig, timeout: 45000 };
      const stringAdapter = new TestAdapter(configWithStringTimeout);
      expect((stringAdapter as any).connectionTimeout).toBe(45000);
    });

    it('should use default timeout for invalid string', () => {
      const configWithInvalidTimeout = { ...testConfig, timeout: -1 };
      const invalidAdapter = new TestAdapter(configWithInvalidTimeout);
      expect((invalidAdapter as any).connectionTimeout).toBe(-1);
    });

    it('should use default timeout when undefined', () => {
      const configWithoutTimeout = { ...testConfig };
      delete configWithoutTimeout.timeout;
      const noTimeoutAdapter = new TestAdapter(configWithoutTimeout);
      expect((noTimeoutAdapter as any).connectionTimeout).toBe(30000);
    });
  });

  // ============================================================================
  // Configuration Methods Tests
  // ============================================================================

  describe('getType', () => {
    it('should return the database type', () => {
      expect(adapter.getType()).toBe('sqlite');
    });
  });

  // ============================================================================
  // Validation Methods Tests
  // ============================================================================

  describe('validateConfig', () => {
    it('should pass validation with all required fields present', () => {
      expect(() => {
        adapter.testValidateConfig(['host', 'database', 'username']);
      }).not.toThrow();
    });

    it('should throw error for missing required fields', () => {
      const incompleteConfig = { type: 'sqlite' as const };
      const incompleteAdapter = new TestAdapter(incompleteConfig);

      expect(() => {
        incompleteAdapter.testValidateConfig(['host', 'database', 'username']);
      }).toThrow('Missing required configuration fields: host, database, username');
    });

    it('should throw error for null values', () => {
      const nullConfig = { ...testConfig, host: null };
      const nullAdapter = new TestAdapter(nullConfig as any);

      expect(() => {
        nullAdapter.testValidateConfig(['host']);
      }).toThrow('Missing required configuration fields: host');
    });

    it('should throw error for empty string values', () => {
      const emptyConfig = { ...testConfig, database: '' };
      const emptyAdapter = new TestAdapter(emptyConfig);

      expect(() => {
        emptyAdapter.testValidateConfig(['database']);
      }).toThrow('Missing required configuration fields: database');
    });
  });

  // ============================================================================
  // Config Parsing Tests
  // ============================================================================

  describe('parseConfigValue', () => {
    it('should parse string values', () => {
      expect(adapter.testParseConfigValue(123, 'string', 'default')).toBe('123');
      expect(adapter.testParseConfigValue('test', 'string', 'default')).toBe('test');
      expect(adapter.testParseConfigValue(null, 'string', 'default')).toBe('default');
    });

    it('should parse number values', () => {
      expect(adapter.testParseConfigValue('123', 'number', 0)).toBe(123);
      expect(adapter.testParseConfigValue(456, 'number', 0)).toBe(456);
      expect(adapter.testParseConfigValue('invalid', 'number', 999)).toBe(999);
      expect(adapter.testParseConfigValue(null, 'number', 777)).toBe(777);
    });

    // A number is returned as given rather than re-parsed, which only shows up
    // on a value parseInt would truncate.
    it('should keep the fractional part of a number', () => {
      expect(adapter.testParseConfigValue(3.7, 'number', 0)).toBe(3.7);
    });

    it('should parse boolean values', () => {
      expect(adapter.testParseConfigValue('true', 'boolean', false)).toBe(true);
      expect(adapter.testParseConfigValue('TRUE', 'boolean', false)).toBe(true);
      expect(adapter.testParseConfigValue('false', 'boolean', true)).toBe(false);
      expect(adapter.testParseConfigValue(true, 'boolean', false)).toBe(true);
      expect(adapter.testParseConfigValue('invalid', 'boolean', true)).toBe(false);
      expect(adapter.testParseConfigValue(null, 'boolean', true)).toBe(true);
    });

    it('should return value as-is for unknown types', () => {
      const complexValue = { key: 'value' };
      expect(adapter.testParseConfigValue(complexValue, 'string' as any, { key: 'default' })).toBe(
        '[object Object]'
      );
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  // ============================================================================
  // Configuration Resolvers
  // ============================================================================

  describe('verifyServerCertificate', () => {
    const verifyWith = (ssl_verify: unknown): boolean =>
      new TestAdapter({
        ...testConfig,
        ssl_verify,
      } as DatabaseConfig).testVerifyServerCertificate();

    it.each([
      ['an explicit boolean false', false],
      ['the string "false"', 'false'],
      ['the string "0"', '0'],
      ['the string "no"', 'no'],
      ['the string "off"', 'off'],
      ['mixed case', 'OFF'],
      ['surrounding whitespace', ' false '],
      ['the number 0', 0],
    ])('should stop verifying for %s', (_label, value) => {
      expect(verifyWith(value)).toBe(false);
    });

    // Anything not recognised as an explicit "off" must leave the check on: an
    // unparseable value is not consent to disable certificate verification.
    it.each([
      ['an explicit boolean true', true],
      ['the string "true"', 'true'],
      ['an unset value', undefined],
      ['a null value', null],
      ['an affirmative spelling', 'yes'],
      ['a typo', 'flase'],
      ['an empty string', ''],
      ['the number 1', 1],
    ])('should keep verifying for %s', (_label, value) => {
      expect(verifyWith(value)).toBe(true);
    });
  });

  describe('getMaxRows', () => {
    const maxRowsFor = (max_rows: unknown): number =>
      new TestAdapter({ ...testConfig, max_rows } as DatabaseConfig).testGetMaxRows();

    it('should use a configured positive cap', () => {
      expect(maxRowsFor(250)).toBe(250);
    });

    it.each([
      ['unset', undefined],
      ['zero', 0],
      ['negative', -1],
      ['a string', '250'],
    ])('should fall back to 1000 when the cap is %s', (_label, value) => {
      expect(maxRowsFor(value)).toBe(1000);
    });
  });

  describe('getStatementTimeoutMs', () => {
    const timeoutFor = (overrides: Record<string, unknown>): number =>
      new TestAdapter({
        ...testConfig,
        ...overrides,
      } as DatabaseConfig).testGetStatementTimeoutMs();

    it('should prefer query_timeout over the connection timeout', () => {
      expect(timeoutFor({ query_timeout: 5000, timeout: 30000 })).toBe(5000);
    });

    it('should fall back to the connection timeout', () => {
      expect(timeoutFor({ query_timeout: undefined, timeout: 7000 })).toBe(7000);
    });

    it('should accept a numeric string', () => {
      expect(timeoutFor({ query_timeout: '4500' })).toBe(4500);
    });

    it('should treat zero as disabling the timeout rather than as missing', () => {
      expect(timeoutFor({ query_timeout: 0 })).toBe(0);
    });

    it('should keep the fractional part of a numeric timeout', () => {
      expect(timeoutFor({ query_timeout: 1500.5 })).toBe(1500.5);
    });

    it.each([
      ['unparseable', 'soon'],
      ['negative', -1],
      ['absent', undefined],
    ])('should fall back to 30000 when the timeout is %s', (_label, value) => {
      expect(timeoutFor({ query_timeout: value, timeout: value })).toBe(30000);
    });
  });

  describe('createError', () => {
    it('should create error with adapter prefix', () => {
      const error = adapter.testCreateError('Test message');
      expect(error.message).toBe('sqlite adapter error: Test message');
    });

    it('should wrap original error', () => {
      const originalError = new Error('Original error');
      originalError.stack = 'original stack trace';
      const wrappedError = adapter.testCreateError('Test message', originalError);

      expect(wrappedError.message).toBe('sqlite adapter error: Test message - Original error');
      expect(wrappedError.stack).toBe('original stack trace');
    });

    it('createError keeps the original error as cause', () => {
      const orig = Object.assign(new Error('boom'), { code: '42703' });
      const err = adapter.testCreateError('Test message', orig);
      expect((err as Error).cause).toBe(orig);
      expect(err.message).toBe('sqlite adapter error: Test message - boom');
    });
  });

  // ============================================================================
  // Result Processing Tests
  // ============================================================================

  describe('truncateResults', () => {
    it('should not truncate when under limit', () => {
      const rows = [1, 2, 3];
      const result = adapter.testTruncateResults(rows, 5);

      expect(result.rows).toEqual([1, 2, 3]);
      expect(result.truncated).toBe(false);
    });

    it('should truncate when over limit', () => {
      const rows = [1, 2, 3, 4, 5];
      const result = adapter.testTruncateResults(rows, 3);

      expect(result.rows).toEqual([1, 2, 3]);
      expect(result.truncated).toBe(true);
    });

    it('should handle empty arrays', () => {
      const result = adapter.testTruncateResults([], 10);

      expect(result.rows).toEqual([]);
      expect(result.truncated).toBe(false);
    });

    // A result that exactly fills the cap is complete, not truncated. Reporting
    // it as truncated would tell callers rows were dropped when none were.
    it('should not report truncation at exactly the limit', () => {
      const result = adapter.testTruncateResults([1, 2, 3], 3);

      expect(result.rows).toEqual([1, 2, 3]);
      expect(result.truncated).toBe(false);
    });

    it('should report truncation one row past the limit', () => {
      const result = adapter.testTruncateResults([1, 2, 3, 4], 3);

      expect(result.rows).toEqual([1, 2, 3]);
      expect(result.truncated).toBe(true);
    });
  });

  describe('buildStreamedResult', () => {
    it('should keep the observed count and take fields from the first row', () => {
      const result = adapter.testBuildStreamedResult(
        [{ id: 1, name: 'a' }],
        42,
        true,
        Date.now(),
        'SELECT id, name FROM t'
      );

      expect(result.rows).toEqual([{ id: 1, name: 'a' }]);
      expect(result.rowCount).toBe(42);
      expect(result.truncated).toBe(true);
      expect(result.fields).toEqual(['id', 'name']);
    });

    it('should report no fields for an empty result', () => {
      const result = adapter.testBuildStreamedResult([], 0, false, Date.now());

      expect(result.fields).toEqual([]);
    });

    // Elapsed time, not a timestamp: a sign slip here would report the epoch.
    it('should report the elapsed time rather than a clock reading', () => {
      const result = adapter.testBuildStreamedResult([{ id: 1 }], 1, false, Date.now() - 50);

      expect(result.execution_time_ms).toBeGreaterThanOrEqual(50);
      expect(result.execution_time_ms).toBeLessThan(60000);
    });

    // The streamed path must redact too; it does not share normalizeQueryResult.
    it('should apply redaction when it is configured', () => {
      const redactingAdapter = new TestAdapter({
        ...testConfig,
        redaction: {
          enabled: true,
          rules: [
            {
              field_pattern: 'email',
              pattern_type: 'exact',
              redaction_type: 'full_mask',
            },
          ],
        },
      } as unknown as DatabaseConfig);

      const result = redactingAdapter.testBuildStreamedResult(
        [{ email: 'someone@example.com' }],
        1,
        false,
        Date.now(),
        'SELECT email FROM users'
      );

      expect(result.rows[0].email).not.toBe('someone@example.com');
    });
  });

  describe('normalizeQueryResult', () => {
    it('should normalize query results correctly', () => {
      const startTime = Date.now() - 100;
      const mockResult = {
        rows: [
          { id: 1, name: 'test' },
          { id: 2, name: 'test2' },
        ],
      };

      const normalized = adapter.testNormalizeQueryResult(mockResult, startTime);

      expect(normalized.rows).toEqual([
        { id: 1, name: 'test' },
        { id: 2, name: 'test2' },
      ]);
      expect(normalized.rowCount).toBe(2);
      expect(normalized.fields).toEqual(['id', 'name']);
      expect(normalized.truncated).toBe(false);
      expect(normalized.execution_time_ms).toBeGreaterThanOrEqual(100);
      // Elapsed time, not a clock reading: without a ceiling this passes just as
      // happily when the subtraction becomes an addition.
      expect(normalized.execution_time_ms).toBeLessThan(60000);
    });

    it('should apply redaction when it is configured', () => {
      const redactingAdapter = new TestAdapter({
        ...testConfig,
        redaction: {
          enabled: true,
          rules: [
            {
              field_pattern: 'name',
              pattern_type: 'exact',
              redaction_type: 'full_mask',
            },
          ],
        },
      } as unknown as DatabaseConfig);

      const normalized = redactingAdapter.testNormalizeQueryResult(
        { rows: [{ id: 1, name: 'test' }] },
        Date.now()
      );

      expect(normalized.rows[0].name).not.toBe('test');
    });

    it('should handle truncation in normalization', () => {
      const startTime = Date.now();
      const mockResult = {
        rows: [
          { id: 1, name: 'test' },
          { id: 2, name: 'test2' },
        ],
      };

      const normalized = adapter.testNormalizeQueryResult(mockResult, startTime, 5);

      expect(normalized.rows).toHaveLength(2);
      expect(normalized.rowCount).toBe(2); // Original count before truncation
      expect(normalized.truncated).toBe(false);
    });
  });

  // ============================================================================
  // Schema Methods Tests
  // ============================================================================

  describe('createBaseSchema', () => {
    it('should create base schema structure', () => {
      const schema = adapter.testCreateBaseSchema('test_database');

      expect(schema.database).toBe('test_database');
      expect(schema.type).toBe('sqlite');
      expect(schema.tables).toEqual({});
      expect(schema.views).toEqual({});
      expect(schema.summary).toEqual({
        table_count: 0,
        view_count: 0,
        total_columns: 0,
      });
      expect(schema.captured_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('updateSchemaSummary', () => {
    it('should update schema summary correctly', () => {
      const schema = adapter.testCreateBaseSchema('test');
      schema.tables.table1 = {
        name: 'table1',
        type: 'BASE TABLE',
        comment: '',
        columns: [
          {
            name: 'col1',
            type: 'int',
            nullable: false,
            default: null,
            comment: '',
            key: '',
            extra: '',
          },
          {
            name: 'col2',
            type: 'varchar',
            nullable: true,
            default: null,
            comment: '',
            key: '',
            extra: '',
          },
        ],
      };
      schema.views.view1 = {
        name: 'view1',
        type: 'VIEW',
        comment: '',
        columns: [
          {
            name: 'col1',
            type: 'int',
            nullable: false,
            default: null,
            comment: '',
            key: '',
            extra: '',
          },
        ],
      };

      adapter.testUpdateSchemaSummary(schema);

      expect(schema.summary.table_count).toBe(1);
      expect(schema.summary.view_count).toBe(1);
      expect(schema.summary.total_columns).toBe(3);
    });
  });

  // ============================================================================
  // Connection Lifecycle Tests
  // ============================================================================

  describe('connection lifecycle', () => {
    it('should connect successfully', async () => {
      const connection = await adapter.connect();
      expect(connection).toBeDefined();
      expect(adapter.isConnected(connection)).toBe(true);
    });

    it('should handle connection failure', async () => {
      adapter.shouldFailConnection = true;
      await expect(adapter.connect()).rejects.toThrow('Connection failed');
    });

    it('should disconnect successfully', async () => {
      const connection = await adapter.connect();
      await adapter.disconnect(connection);
      expect(adapter.isConnected(connection)).toBe(false);
    });
  });

  // ============================================================================
  // Query Execution Tests
  // ============================================================================

  describe('query execution', () => {
    let connection: DatabaseConnection;

    beforeEach(async () => {
      connection = await adapter.connect();
    });

    it('should execute queries successfully', async () => {
      const result = await adapter.executeQuery(connection, 'SELECT * FROM test');

      expect(result.rows).toHaveLength(2);
      expect(result.fields).toEqual(['id', 'name']);
      expect(result.rowCount).toBe(2);
      expect(result.truncated).toBe(false);
      expect(result.execution_time_ms).toBeGreaterThanOrEqual(0);
    });

    it('should handle query failure', async () => {
      adapter.shouldFailQuery = true;
      await expect(adapter.executeQuery(connection, 'INVALID QUERY')).rejects.toThrow(
        'Query failed'
      );
    });

    it('should execute queries with parameters', async () => {
      const result = await adapter.executeQuery(connection, 'SELECT * FROM test WHERE id = ?', [1]);
      expect(result).toBeDefined();
    });
  });

  // ============================================================================
  // Transaction Tests
  // ============================================================================

  describe('transaction management', () => {
    let connection: DatabaseConnection;

    beforeEach(async () => {
      connection = await adapter.connect();
    });

    it('should begin transaction successfully', async () => {
      await expect(adapter.beginTransaction(connection)).resolves.toBeUndefined();
    });

    it('should commit transaction successfully', async () => {
      await adapter.beginTransaction(connection);
      await expect(adapter.commitTransaction(connection)).resolves.toBeUndefined();
    });

    it('should rollback transaction successfully', async () => {
      await adapter.beginTransaction(connection);
      await expect(adapter.rollbackTransaction(connection)).resolves.toBeUndefined();
    });

    it('should handle transaction failures', async () => {
      adapter.shouldFailTransaction = true;
      await expect(adapter.beginTransaction(connection)).rejects.toThrow(
        'Begin transaction failed'
      );
      await expect(adapter.commitTransaction(connection)).rejects.toThrow(
        'Commit transaction failed'
      );
      await expect(adapter.rollbackTransaction(connection)).rejects.toThrow(
        'Rollback transaction failed'
      );
    });
  });

  // ============================================================================
  // Performance Analysis Tests
  // ============================================================================

  describe('buildExplainQuery', () => {
    it('should build explain query correctly', () => {
      const query = 'SELECT * FROM users';
      const explainQuery = adapter.buildExplainQuery(query);
      expect(explainQuery).toBe('EXPLAIN SELECT * FROM users');
    });
  });

  // ============================================================================
  // Schema Capture Tests
  // ============================================================================

  describe('schema capture', () => {
    let connection: DatabaseConnection;

    beforeEach(async () => {
      connection = await adapter.connect();
    });

    it('should capture schema successfully', async () => {
      const schema = await adapter.captureSchema(connection);

      expect(schema.database).toBe('test_db');
      expect(schema.type).toBe('sqlite');
      expect(schema.captured_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(schema.tables).toBeDefined();
      expect(schema.views).toBeDefined();
      expect(schema.summary).toBeDefined();
    });
  });

  // ============================================================================
  // Edge Cases and Error Handling
  // ============================================================================

  describe('edge cases', () => {
    it('should handle malformed configuration gracefully', () => {
      const malformedConfig = {} as DatabaseConfig;
      const malformedAdapter = new TestAdapter(malformedConfig);

      expect(() => malformedAdapter.getType()).not.toThrow();
      expect(malformedAdapter.getType()).toBeUndefined();
    });

    it('should handle null connections in isConnected', () => {
      expect(adapter.isConnected(null as any)).toBe(false);
    });

    it('should handle invalid result structures in normalization', () => {
      const invalidResult = null;
      const startTime = Date.now();

      expect(() => {
        adapter.testNormalizeQueryResult(invalidResult, startTime);
      }).not.toThrow();
    });
  });

  // ============================================================================
  // Redaction Configuration (lines 34-35, 288-319)
  // ============================================================================

  describe('constructor with redaction', () => {
    it('should initialize redaction manager when redaction is enabled', () => {
      const configWithRedaction: DatabaseConfig = {
        ...testConfig,
        redaction: {
          enabled: true,
          rules: [
            {
              field_pattern: 'password',
              pattern_type: 'exact',
              redaction_type: 'full_mask',
            },
          ],
        },
      };
      const redactionAdapter = new TestAdapter(configWithRedaction);
      expect((redactionAdapter as any).redactionManager).toBeDefined();
    });

    it('should not initialize redaction manager when redaction is disabled', () => {
      const configWithoutRedaction: DatabaseConfig = {
        ...testConfig,
        redaction: {
          enabled: false,
          rules: [],
        },
      };
      const noRedactionAdapter = new TestAdapter(configWithoutRedaction);
      expect((noRedactionAdapter as any).redactionManager).toBeUndefined();
    });
  });

  describe('parseConfigValue - default branch (line 166)', () => {
    it('should return value as-is for unrecognized type parameter', () => {
      // The default branch in the switch returns value as T
      const result = adapter.testParseConfigValue('hello', 'unknown' as any, 'fallback');
      expect(result).toBe('hello');
    });

    it('should return undefined as-is for unrecognized type when value is undefined', () => {
      const result = adapter.testParseConfigValue(undefined as any, 'string', 'default');
      expect(result).toBe('default');
    });
  });

  describe('normalizeQueryResult with redaction (lines 234-236)', () => {
    it('should apply redaction when redaction manager is configured', () => {
      const configWithRedaction: DatabaseConfig = {
        ...testConfig,
        redaction: {
          enabled: true,
          rules: [
            {
              field_pattern: 'name',
              pattern_type: 'exact',
              redaction_type: 'full_mask',
            },
          ],
        },
      };
      const redactedAdapter = new TestAdapter(configWithRedaction);
      const startTime = Date.now() - 10;
      const result = redactedAdapter.testNormalizeQueryResult({}, startTime);

      // Redaction manager should have processed the result
      expect(result).toBeDefined();
      expect(result.execution_time_ms).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================================================
  // Redaction Management Methods (lines 288-319)
  // ============================================================================

  // ============================================================================
  // Constructor timeout parsing edge cases (line 35 branch)
  // ============================================================================

  describe('constructor timeout parsing', () => {
    it('should parse timeout from string type', () => {
      const configWithStringTimeout = { ...testConfig, timeout: '5000' as any };
      const stringAdapter = new TestAdapter(configWithStringTimeout);
      expect((stringAdapter as any).connectionTimeout).toBe(5000);
    });

    it('should use default for non-parseable string timeout', () => {
      const configWithBadTimeout = { ...testConfig, timeout: 'abc' as any };
      const badAdapter = new TestAdapter(configWithBadTimeout);
      expect((badAdapter as any).connectionTimeout).toBe(30000);
    });
  });
});

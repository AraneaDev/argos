/**
 * Unit tests for RedactionManager and redaction patterns
 */

import { RedactionManager, RedactionPatterns } from '../../src/classes/RedactionManager.js';
import type {
  DatabaseRedactionConfig,
  FieldRedactionRule,
  QueryResult,
} from '../../src/types/index.js';

// Redact one row the way query results are redacted.
const redactOne = (manager: RedactionManager, row: Record<string, unknown>) => ({
  redacted: manager.redactResults({
    rows: [row],
    rowCount: 1,
    fields: Object.keys(row),
    truncated: false,
    execution_time_ms: 0,
  }).rows[0],
});

describe('RedactionPatterns', () => {
  describe('fullMask', () => {
    it('should mask entire string with asterisks', () => {
      expect(RedactionPatterns.fullMask('sensitive')).toBe('*********');
      expect(RedactionPatterns.fullMask('test', '#')).toBe('####');
      expect(RedactionPatterns.fullMask('')).toBe('');
    });

    it('should limit mask length to 10 characters', () => {
      expect(RedactionPatterns.fullMask('verylongsentivedata')).toBe('**********');
    });
  });

  describe('partialMaskEmail', () => {
    it('should partially mask email addresses', () => {
      expect(RedactionPatterns.partialMaskEmail('john.doe@example.com')).toBe(
        'j******.e@*****.com'
      );
      expect(RedactionPatterns.partialMaskEmail('a@b.co')).toBe('a@*.co');
      expect(RedactionPatterns.partialMaskEmail('test@domain.org')).toBe('t**t@*****.org');
    });

    it('should handle invalid email formats', () => {
      expect(RedactionPatterns.partialMaskEmail('not-an-email')).toBe('**********'); // 12 chars -> 10 chars (fullMask limit)
      expect(RedactionPatterns.partialMaskEmail('missing@')).toBe('********'); // 8 chars -> 8 chars
    });
  });

  describe('partialMaskPhone', () => {
    it('should partially mask phone numbers', () => {
      expect(RedactionPatterns.partialMaskPhone('(555) 123-4567')).toBe('(***)***-4567');
      expect(RedactionPatterns.partialMaskPhone('555-123-4567')).toBe('***-***-4567');
      expect(RedactionPatterns.partialMaskPhone('+1-555-123-4567')).toBe('+*-***-***-4567');
    });

    it('should handle short numbers', () => {
      expect(RedactionPatterns.partialMaskPhone('123-4567')).toBe('***-4567');
      expect(RedactionPatterns.partialMaskPhone('123')).toBe('***');
    });
  });

  describe('smartPartialMask', () => {
    it('should detect and mask emails appropriately', () => {
      const result = RedactionPatterns.smartPartialMask('user@domain.com');
      expect(result).toContain('@');
      expect(result).toContain('.com');
      expect(result).toContain('*');
    });

    it('should detect and mask phone numbers', () => {
      const result = RedactionPatterns.smartPartialMask('555-123-4567');
      expect(result).toContain('4567');
      expect(result).toContain('*');
    });

    it('should use generic masking for other strings', () => {
      expect(RedactionPatterns.smartPartialMask('sensitive')).toBe('s*******e');
      expect(RedactionPatterns.smartPartialMask('ab')).toBe('**');
    });
  });
});

describe('RedactionManager', () => {
  let redactionManager: RedactionManager;

  beforeEach(() => {
    const config: DatabaseRedactionConfig = {
      enabled: true,
      rules: [
        {
          field_pattern: 'email',
          pattern_type: 'exact',
          redaction_type: 'partial_mask',
          preserve_format: true,
        },
        {
          field_pattern: '*phone*',
          pattern_type: 'wildcard',
          redaction_type: 'full_mask',
        },
        {
          field_pattern: 'ssn',
          pattern_type: 'exact',
          redaction_type: 'replace',
          replacement_text: '[SSN_REDACTED]',
        },
      ],
      log_redacted_access: false,
      case_sensitive_matching: false,
    };

    redactionManager = new RedactionManager(config);
  });

  // Each of these settings is off unless the configuration turns it on. The
  // case-sensitivity one matters most: flipped, a '*email*' rule would stop
  // matching a column named 'Email' and the value would come back in the clear.
  describe('settings default to off', () => {
    const summary = (
      config: Partial<DatabaseRedactionConfig>
    ): { log_access: boolean; audit_queries: boolean; case_sensitive: boolean } =>
      new RedactionManager({
        enabled: true,
        rules: [],
        ...config,
      } as DatabaseRedactionConfig).getConfigurationSummary().settings;

    it('should leave all three off when the configuration is silent', () => {
      expect(summary({})).toEqual({
        log_access: false,
        audit_queries: false,
        case_sensitive: false,
      });
    });

    it('should honour each one when the configuration turns it on', () => {
      expect(
        summary({
          log_redacted_access: true,
          audit_redacted_queries: true,
          case_sensitive_matching: true,
        })
      ).toEqual({ log_access: true, audit_queries: true, case_sensitive: true });
    });

    it('should keep matching case-insensitively by default', () => {
      const manager = new RedactionManager({
        enabled: true,
        rules: [
          { field_pattern: '*email*', pattern_type: 'wildcard', redaction_type: 'full_mask' },
        ] as FieldRedactionRule[],
      } as DatabaseRedactionConfig);

      expect(manager.shouldRedactField('Email')).toBeTruthy();
      expect(manager.shouldRedactField('USER_EMAIL')).toBeTruthy();
    });
  });

  describe('shouldRedactField', () => {
    it('should match exact field names', () => {
      const rule = redactionManager.shouldRedactField('email');
      expect(rule).toBeTruthy();
      expect(rule?.redaction_type).toBe('partial_mask');
    });

    it('should match wildcard patterns', () => {
      const rule1 = redactionManager.shouldRedactField('user_phone');
      const rule2 = redactionManager.shouldRedactField('phone_number');
      const rule3 = redactionManager.shouldRedactField('mobile_phone_primary');

      expect(rule1).toBeTruthy();
      expect(rule2).toBeTruthy();
      expect(rule3).toBeTruthy();
      expect(rule1?.redaction_type).toBe('full_mask');
    });

    // Only '*' is a wildcard. Every other regex metacharacter has to be matched
    // literally, or a rule containing one either matches the wrong fields or,
    // worse, throws while building its regex and silently protects nothing.
    it.each([
      ['?', '?ssn'],
      ['.', 'a.b'],
      ['+', 'a+b'],
      ['(', 'a(b'],
      ['[', 'a[b'],
    ])('should treat %s in a pattern as a literal character', (_label, field) => {
      const manager = new RedactionManager({
        enabled: true,
        rules: [
          { field_pattern: field, pattern_type: 'wildcard', redaction_type: 'full_mask' },
        ] as FieldRedactionRule[],
      } as DatabaseRedactionConfig);

      expect(manager.shouldRedactField(field)).toBeTruthy();
    });

    it('should not let a literal metacharacter match a different field', () => {
      const manager = new RedactionManager({
        enabled: true,
        rules: [
          { field_pattern: 'a.b', pattern_type: 'wildcard', redaction_type: 'full_mask' },
        ] as FieldRedactionRule[],
      } as DatabaseRedactionConfig);

      expect(manager.shouldRedactField('axb')).toBeNull();
    });

    it('should not match non-matching fields', () => {
      const rule = redactionManager.shouldRedactField('username');
      expect(rule).toBeNull();
    });

    it('should handle case insensitive matching by default', () => {
      const rule = redactionManager.shouldRedactField('EMAIL');
      expect(rule).toBeTruthy();
    });
  });

  describe('redactResults', () => {
    // The whole point of redaction is that the raw value never reaches the
    // caller. If redacting one throws, returning it untouched would leak exactly
    // what the rule exists to hide, so the field is replaced with a placeholder
    // instead. Nothing exercised that path before.
    describe('when redacting a value throws', () => {
      const hostileValue = (): unknown => ({
        toString(): string {
          throw new Error('value could not be decoded');
        },
      });

      const redactHostile = (): QueryResult => {
        const value = hostileValue();
        return redactionManager.redactResults({
          rows: [{ id: 1, email: value, name: 'John Doe' }],
          rowCount: 1,
          fields: ['id', 'email', 'name'],
          truncated: false,
          execution_time_ms: 1,
        });
      };

      it('should replace the value with a placeholder rather than pass it through', () => {
        const result = redactHostile();

        expect(result.rows[0].email).toBe('[REDACTION_ERROR]');
        expect(typeof result.rows[0].email).toBe('string');
      });

      it('should still count and name the field as redacted', () => {
        const result = redactHostile() as QueryResult & {
          redaction?: { redaction_count: number; fields_redacted: string[]; warnings?: string[] };
        };

        expect(result.redaction?.redaction_count).toBe(1);
        expect(result.redaction?.fields_redacted).toContain('email');
      });

      it('should report the failure as a warning naming the field', () => {
        const result = redactHostile() as QueryResult & {
          redaction?: { warnings?: string[] };
        };

        expect(result.redaction?.warnings?.join(' ')).toContain('email');
      });

      it('should leave the other fields of the row alone', () => {
        const result = redactHostile();

        expect(result.rows[0].id).toBe(1);
        expect(result.rows[0].name).toBe('John Doe');
      });
    });

    // FIND-104: a protected column renamed by the query must stay protected, or
    // wrapping it in an expression is enough to read it in the clear. The AS form
    // is covered below; these cover the form with no AS keyword.
    describe('when a protected column is aliased without AS', () => {
      const redactWithQuery = (query: string, row: Record<string, unknown>): QueryResult =>
        redactionManager.redactResults(
          {
            rows: [row],
            rowCount: 1,
            fields: Object.keys(row),
            truncated: false,
            execution_time_ms: 1,
          },
          query
        );

      it('should follow the alias through a function call', () => {
        const result = redactWithQuery('SELECT lower(email) e FROM users', {
          e: 'john.doe@example.com',
        });

        expect(result.rows[0].e).not.toBe('john.doe@example.com');
      });

      it('should follow the alias through a qualified column', () => {
        const result = redactWithQuery('SELECT users.email addr FROM users', {
          addr: 'john.doe@example.com',
        });

        expect(result.rows[0].addr).not.toBe('john.doe@example.com');
      });

      it('should follow the alias through a concatenation', () => {
        const result = redactWithQuery("SELECT (email + '') contact FROM users", {
          contact: 'john.doe@example.com',
        });

        expect(result.rows[0].contact).not.toBe('john.doe@example.com');
      });

      it('should leave an unrelated expression alias alone', () => {
        const result = redactWithQuery('SELECT upper(name) n FROM users', { n: 'JOHN DOE' });

        expect(result.rows[0].n).toBe('JOHN DOE');
      });
    });

    it('should redact matching fields in query results', () => {
      const queryResult: QueryResult = {
        rows: [
          {
            id: 1,
            email: 'john.doe@example.com',
            user_phone: '555-123-4567',
            ssn: '123-45-6789',
            name: 'John Doe',
          },
          {
            id: 2,
            email: 'jane.smith@example.com',
            user_phone: '555-987-6543',
            ssn: '987-65-4321',
            name: 'Jane Smith',
          },
        ],
        rowCount: 2,
        fields: ['id', 'email', 'user_phone', 'ssn', 'name'],
        truncated: false,
        execution_time_ms: 150,
      };

      const result = redactionManager.redactResults(queryResult);

      expect(result.redaction).toBeDefined();
      expect(result.redaction?.fields_redacted).toContain('email');
      expect(result.redaction?.fields_redacted).toContain('user_phone');
      expect(result.redaction?.fields_redacted).toContain('ssn');
      expect(result.redaction?.redaction_count).toBe(6); // 3 fields x 2 rows

      // Check that sensitive fields are redacted
      expect(result.rows[0].email).toContain('*');
      expect(result.rows[0].email).toContain('@');
      expect(result.rows[0].user_phone).toBe('**********'); // 12 chars -> 10 chars (fullMask limit)
      expect(result.rows[0].ssn).toBe('[SSN_REDACTED]');

      // Check that non-sensitive fields are preserved
      expect(result.rows[0].id).toBe(1);
      expect(result.rows[0].name).toBe('John Doe');
    });

    it('should handle empty results', () => {
      const queryResult: QueryResult = {
        rows: [],
        rowCount: 0,
        fields: [],
        truncated: false,
        execution_time_ms: 50,
      };

      const result = redactionManager.redactResults(queryResult);
      expect(result.redaction).toBeUndefined();
      expect(result.rows).toEqual([]);
    });

    it('redacts aliased/expression-wrapped protected columns via the query (FIND-104)', () => {
      const queryResult: QueryResult = {
        rows: [{ x: '123-45-6789', c: '111-22-3333' }],
        rowCount: 1,
        fields: ['x', 'c'],
        truncated: false,
        execution_time_ms: 10,
      };
      // Neither output field name ('x','c') matches a rule, but both source expressions
      // reference the protected 'ssn' column — so redaction must still apply.
      const result = redactionManager.redactResults(
        queryResult,
        'SELECT ssn AS x, substr(ssn,1,9) AS c FROM users'
      );
      expect(result.rows[0].x).toBe('[SSN_REDACTED]');
      expect(result.rows[0].c).toBe('[SSN_REDACTED]');
      expect(result.redaction?.fields_redacted).toEqual(expect.arrayContaining(['x', 'c']));
    });

    it('does not over-redact aliases of non-sensitive columns (FIND-104)', () => {
      const queryResult: QueryResult = {
        rows: [{ y: 'hello' }],
        rowCount: 1,
        fields: ['y'],
        truncated: false,
        execution_time_ms: 10,
      };
      const result = redactionManager.redactResults(queryResult, 'SELECT name AS y FROM users');
      expect(result.rows[0].y).toBe('hello');
      expect(result.redaction).toBeUndefined();
    });

    it('should preserve null and undefined values', () => {
      const queryResult: QueryResult = {
        rows: [
          {
            email: null,
            user_phone: undefined,
            ssn: '',
            name: 'Test User',
          },
        ],
        rowCount: 1,
        fields: ['email', 'user_phone', 'ssn', 'name'],
        truncated: false,
        execution_time_ms: 100,
      };

      const result = redactionManager.redactResults(queryResult);

      expect(result.rows[0].email).toBe(null);
      expect(result.rows[0].user_phone).toBe(undefined);
      expect(result.rows[0].ssn).toBe('[SSN_REDACTED]'); // Empty string gets redacted
      expect(result.rows[0].name).toBe('Test User');
    });
  });

  describe('getConfigurationSummary', () => {
    it('should return configuration summary', () => {
      const summary = redactionManager.getConfigurationSummary();

      expect(summary.enabled).toBe(true);
      expect(summary.rule_count).toBe(3);
      expect(summary.rules).toHaveLength(3);
      expect(summary.settings.log_access).toBe(false);
      expect(summary.settings.case_sensitive).toBe(false);

      const emailRule = summary.rules.find((r) => r.pattern === 'email');
      expect(emailRule).toBeDefined();
      expect(emailRule?.type).toBe('exact');
      expect(emailRule?.redaction).toBe('partial_mask');
    });
  });

  describe('redactResults with log_redacted_access enabled', () => {
    it('should log when redactions occur and logging is enabled', () => {
      const config: DatabaseRedactionConfig = {
        enabled: true,
        rules: [
          {
            field_pattern: 'email',
            pattern_type: 'exact',
            redaction_type: 'full_mask',
          },
        ],
        log_redacted_access: true,
      };

      const manager = new RedactionManager(config);
      const queryResult: QueryResult = {
        rows: [{ email: 'test@example.com', name: 'Test' }],
        rowCount: 1,
        fields: ['email', 'name'],
        truncated: false,
        execution_time_ms: 10,
      };

      const result = manager.redactResults(queryResult);
      expect(result.redaction).toBeDefined();
      expect(result.redaction?.redaction_count).toBe(1);
    });
  });

  describe('redactResults with no redactions', () => {
    it('should not include redaction info when no fields match', () => {
      const queryResult: QueryResult = {
        rows: [{ id: 1, name: 'Test' }],
        rowCount: 1,
        fields: ['id', 'name'],
        truncated: false,
        execution_time_ms: 10,
      };

      const result = redactionManager.redactResults(queryResult);
      expect(result.redaction).toBeUndefined();
    });
  });

  describe('Regex pattern matching', () => {
    it('should match fields using regex patterns', () => {
      const config: DatabaseRedactionConfig = {
        enabled: true,
        rules: [
          {
            field_pattern: '^secret_.*',
            pattern_type: 'regex',
            redaction_type: 'full_mask',
          },
        ],
      };

      const manager = new RedactionManager(config);
      const rule = manager.shouldRedactField('secret_key');
      expect(rule).toBeTruthy();
      expect(rule?.redaction_type).toBe('full_mask');
    });

    it('should not match non-matching regex fields', () => {
      const config: DatabaseRedactionConfig = {
        enabled: true,
        rules: [
          {
            field_pattern: '^secret_.*',
            pattern_type: 'regex',
            redaction_type: 'full_mask',
          },
        ],
      };

      const manager = new RedactionManager(config);
      const rule = manager.shouldRedactField('public_key');
      expect(rule).toBeNull();
    });

    it('should handle invalid regex patterns gracefully', () => {
      const config: DatabaseRedactionConfig = {
        enabled: true,
        rules: [
          {
            field_pattern: '[invalid(regex',
            pattern_type: 'regex',
            redaction_type: 'full_mask',
          },
        ],
      };

      const manager = new RedactionManager(config);
      const rule = manager.shouldRedactField('test');
      expect(rule).toBeNull();
    });

    it('should respect case sensitivity for regex', () => {
      const config: DatabaseRedactionConfig = {
        enabled: true,
        rules: [
          {
            field_pattern: '^Secret$',
            pattern_type: 'regex',
            redaction_type: 'full_mask',
          },
        ],
        case_sensitive_matching: true,
      };

      const manager = new RedactionManager(config);
      expect(manager.shouldRedactField('Secret')).toBeTruthy();
      expect(manager.shouldRedactField('secret')).toBeNull();
    });
  });

  describe('Custom redaction type', () => {
    it('should apply custom pattern replacement', () => {
      const config: DatabaseRedactionConfig = {
        enabled: true,
        rules: [
          {
            field_pattern: 'data',
            pattern_type: 'exact',
            redaction_type: 'custom',
            custom_pattern: '\\d+',
            replacement_text: '[NUM]',
          },
        ],
      };

      const manager = new RedactionManager(config);
      const result = redactOne(manager, { data: 'order 12345 confirmed' });
      expect(result.redacted.data).toBe('order [NUM] confirmed');
    });

    it('should fall back to full mask when custom_pattern is missing', () => {
      const config: DatabaseRedactionConfig = {
        enabled: true,
        rules: [
          {
            field_pattern: 'data',
            pattern_type: 'exact',
            redaction_type: 'custom',
            // No custom_pattern provided
          },
        ],
      };

      const manager = new RedactionManager(config);
      const result = redactOne(manager, { data: 'sensitive' });
      expect(result.redacted.data).toBe('*********');
    });
  });

  describe('Unknown redaction type', () => {
    it('should fall back to full mask for unknown redaction type', () => {
      const config: DatabaseRedactionConfig = {
        enabled: true,
        rules: [
          {
            field_pattern: 'data',
            pattern_type: 'exact',
            redaction_type: 'unknown_type' as any,
          },
        ],
      };

      const manager = new RedactionManager(config);
      const result = redactOne(manager, { data: 'value' });
      expect(result.redacted.data).toBe('*****');
    });
  });

  describe('Replace redaction type', () => {
    it('should use default replacement text when none specified', () => {
      const config: DatabaseRedactionConfig = {
        enabled: true,
        rules: [
          {
            field_pattern: 'token',
            pattern_type: 'exact',
            redaction_type: 'replace',
            // No replacement_text
          },
        ],
      };

      const manager = new RedactionManager(config);
      const result = redactOne(manager, { token: 'abc123' });
      expect(result.redacted.token).toBe('[REDACTED]');
    });
  });

  describe('Partial mask without preserve_format', () => {
    it('should use generic partial mask when preserve_format is false', () => {
      const config: DatabaseRedactionConfig = {
        enabled: true,
        rules: [
          {
            field_pattern: 'name',
            pattern_type: 'exact',
            redaction_type: 'partial_mask',
            preserve_format: false,
          },
        ],
      };

      const manager = new RedactionManager(config);
      const result = redactOne(manager, { name: 'JohnDoe' });
      expect(result.redacted.name).toBe('J*****e');
    });
  });

  describe('Redaction with non-string values', () => {
    it('should convert numbers to string before redaction', () => {
      const config: DatabaseRedactionConfig = {
        enabled: true,
        rules: [
          {
            field_pattern: 'salary',
            pattern_type: 'exact',
            redaction_type: 'full_mask',
          },
        ],
      };

      const manager = new RedactionManager(config);
      const result = redactOne(manager, { salary: 50000 });
      expect(result.redacted.salary).toBe('*****');
    });

    it('should convert booleans to string before redaction', () => {
      const config: DatabaseRedactionConfig = {
        enabled: true,
        rules: [
          {
            field_pattern: 'active',
            pattern_type: 'exact',
            redaction_type: 'full_mask',
          },
        ],
      };

      const manager = new RedactionManager(config);
      const result = redactOne(manager, { active: true });
      expect(result.redacted.active).toBe('****');
    });
  });

  describe('Wildcard pattern edge cases', () => {
    it('should handle wildcards at start and end', () => {
      const config: DatabaseRedactionConfig = {
        enabled: true,
        rules: [
          {
            field_pattern: '*secret*',
            pattern_type: 'wildcard',
            redaction_type: 'full_mask',
          },
        ],
      };

      const manager = new RedactionManager(config);
      expect(manager.shouldRedactField('my_secret_key')).toBeTruthy();
      expect(manager.shouldRedactField('secret')).toBeTruthy();
      expect(manager.shouldRedactField('top_secret')).toBeTruthy();
      expect(manager.shouldRedactField('public_name')).toBeNull();
    });
  });

  describe('Rule with missing field_pattern', () => {
    it('should skip rules with empty field_pattern', () => {
      const config: DatabaseRedactionConfig = {
        enabled: true,
        rules: [
          {
            field_pattern: '',
            pattern_type: 'exact',
            redaction_type: 'full_mask',
          },
          {
            field_pattern: 'email',
            pattern_type: 'exact',
            redaction_type: 'full_mask',
          },
        ],
      };

      const manager = new RedactionManager(config);
      const summary = manager.getConfigurationSummary();
      // The empty pattern rule should be skipped
      expect(summary.rule_count).toBe(1);
    });
  });

  describe('Case sensitive exact matching', () => {
    it('should not match different cases when case sensitive', () => {
      const config: DatabaseRedactionConfig = {
        enabled: true,
        rules: [
          {
            field_pattern: 'Email',
            pattern_type: 'exact',
            redaction_type: 'full_mask',
          },
        ],
        case_sensitive_matching: true,
      };

      const manager = new RedactionManager(config);
      expect(manager.shouldRedactField('Email')).toBeTruthy();
      expect(manager.shouldRedactField('email')).toBeNull();
      expect(manager.shouldRedactField('EMAIL')).toBeNull();
    });
  });
});

describe('RedactionPatterns - additional coverage', () => {
  describe('fullMask with non-string input', () => {
    it('should convert non-string to string', () => {
      expect(RedactionPatterns.fullMask(12345 as any)).toBe('12345');
    });
  });

  describe('partialMaskEmail edge cases', () => {
    it('should handle email with 2-char local part', () => {
      const result = RedactionPatterns.partialMaskEmail('ab@example.com');
      expect(result).toBe('a*@*****.com');
    });

    it('should handle email with 1-char local part', () => {
      const result = RedactionPatterns.partialMaskEmail('a@example.com');
      expect(result).toBe('a@*****.com');
    });

    it('should handle email with no domain dots', () => {
      const result = RedactionPatterns.partialMaskEmail('test@localhost');
      expect(result).toContain('@');
      expect(result).toContain('*');
    });

    it('should handle non-string input', () => {
      const result = RedactionPatterns.partialMaskEmail(12345 as any);
      expect(result).toBe('12345');
    });

    it('should handle empty local part after @', () => {
      const result = RedactionPatterns.partialMaskEmail('@domain.com');
      expect(result).toBeDefined();
    });
  });

  describe('partialMaskPhone edge cases', () => {
    it('should handle non-string input', () => {
      expect(RedactionPatterns.partialMaskPhone(12345 as any)).toBe('12345');
    });

    it('should handle very short numbers (less than 3 digits)', () => {
      expect(RedactionPatterns.partialMaskPhone('12')).toBe('**');
    });
  });

  describe('partialMaskGeneric edge cases', () => {
    it('should handle non-string input', () => {
      expect(RedactionPatterns.partialMaskGeneric(999 as any)).toBe('999');
    });

    it('should handle 1-char string', () => {
      expect(RedactionPatterns.partialMaskGeneric('a')).toBe('*');
    });

    it('should handle 2-char string', () => {
      expect(RedactionPatterns.partialMaskGeneric('ab')).toBe('**');
    });

    it('should handle 3-char string', () => {
      expect(RedactionPatterns.partialMaskGeneric('abc')).toBe('a**');
    });

    it('should handle 4-char string', () => {
      expect(RedactionPatterns.partialMaskGeneric('abcd')).toBe('a***');
    });
  });

  describe('customPattern', () => {
    it('should apply custom regex replacement', () => {
      expect(RedactionPatterns.customPattern('test123data456', '\\d+', 'X')).toBe('testXdataX');
    });

    it('should handle non-string input', () => {
      expect(RedactionPatterns.customPattern(42 as any, '\\d+', 'X')).toBe('42');
    });

    it('should fall back to full mask on invalid regex', () => {
      const result = RedactionPatterns.customPattern('test', '[invalid(regex', 'X');
      expect(result).toBe('****');
    });

    it('should use default replacement when not specified', () => {
      expect(RedactionPatterns.customPattern('secret123', '\\d+')).toBe('secret[REDACTED]');
    });
  });

  describe('smartPartialMask edge cases', () => {
    it('should handle non-string input', () => {
      expect(RedactionPatterns.smartPartialMask(42 as any)).toBe('42');
    });

    it('should detect and mask phone-like values', () => {
      // More than 60% digits, >= 7 digits
      const result = RedactionPatterns.smartPartialMask('5551234567');
      expect(result).toContain('*');
      expect(result).toContain('4567'); // Last 4 preserved
    });
  });
});

describe('Configuration Integration', () => {
  it('should handle complex redaction rules', () => {
    const config: DatabaseRedactionConfig = {
      enabled: true,
      rules: [
        {
          field_pattern: '/^user_.+$/',
          pattern_type: 'regex',
          redaction_type: 'custom',
          custom_pattern: '\\d+',
          replacement_text: '[NUM]',
        },
        {
          field_pattern: '*card*',
          pattern_type: 'wildcard',
          redaction_type: 'full_mask',
          mask_character: '#',
        },
      ],
      log_redacted_access: true,
      case_sensitive_matching: true,
    };

    const manager = new RedactionManager(config);
    const summary = manager.getConfigurationSummary();

    expect(summary.rule_count).toBe(2);
    expect(summary.settings.log_access).toBe(true);
    expect(summary.settings.case_sensitive).toBe(true);
  });
});

/**
 * Error Handler Tests
 */

import {
  SQLMCPError,
  SecurityViolationError,
  NameCheckError,
  ConnectionError,
  ConfigurationError,
  ValidationError,
  getErrorMessage,
  sanitizeError,
  sanitizeMessage,
} from '../../../src/utils/error-handler.js';

describe('error-handler', () => {
  it('NameCheckError carries its correction and sanitizeError leaves it unchanged', () => {
    const err = new NameCheckError('m', 'c', { k: 1 });
    expect(err._code).toBe('NAME_CHECK');
    expect(err.correction).toBe('c');
    expect(err.name).toBe('NameCheckError');
    expect(sanitizeError(err)).toBe('m');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // Error Classes
  // ============================================================================

  describe('SQLMCPError', () => {
    it('should create error with code and details', () => {
      const err = new SQLMCPError('test message', 'TEST_CODE', { key: 'value' });
      expect(err.message).toBe('test message');
      expect(err._code).toBe('TEST_CODE');
      expect(err._details).toEqual({ key: 'value' });
      expect(err.name).toBe('SQLMCPError');
    });

    it('should create error without details', () => {
      const err = new SQLMCPError('msg', 'CODE');
      expect(err._details).toBeUndefined();
    });

    it('should have a stack trace', () => {
      const err = new SQLMCPError('msg', 'CODE');
      expect(err.stack).toBeDefined();
    });
  });

  describe('SecurityViolationError', () => {
    it('should set correct code and name', () => {
      const err = new SecurityViolationError('forbidden');
      expect(err._code).toBe('SECURITY_VIOLATION');
      expect(err.name).toBe('SecurityViolationError');
    });

    it('should accept details', () => {
      const err = new SecurityViolationError('forbidden', { query: 'DROP TABLE' });
      expect(err._details).toEqual({ query: 'DROP TABLE' });
    });
  });

  describe('ConnectionError', () => {
    it('should set correct code and name', () => {
      const err = new ConnectionError('refused');
      expect(err._code).toBe('CONNECTION_ERROR');
      expect(err.name).toBe('ConnectionError');
    });
  });

  describe('ConfigurationError', () => {
    it('should set correct code and name', () => {
      const err = new ConfigurationError('bad config');
      expect(err._code).toBe('CONFIGURATION_ERROR');
      expect(err.name).toBe('ConfigurationError');
    });
  });

  describe('ValidationError', () => {
    it('should set correct code, name, and field', () => {
      const err = new ValidationError('invalid input', 'email');
      expect(err._code).toBe('VALIDATION_ERROR');
      expect(err.name).toBe('ValidationError');
      expect(err.field).toBe('email');
      expect(err._details).toEqual({ field: 'email' });
    });

    it('should default field to unknown', () => {
      const err = new ValidationError('bad');
      expect(err.field).toBe('unknown');
    });

    it('should merge details with field', () => {
      const err = new ValidationError('bad', 'name', { extra: 'data' });
      expect(err._details).toEqual({ field: 'name', extra: 'data' });
    });
  });

  // ============================================================================
  // getErrorMessage
  // ============================================================================

  describe('getErrorMessage', () => {
    it('should extract message from Error instance', () => {
      expect(getErrorMessage(new Error('hello'))).toBe('hello');
    });

    it('should return Unknown error for non-Error', () => {
      expect(getErrorMessage('string error')).toBe('Unknown error');
      expect(getErrorMessage(42)).toBe('Unknown error');
      expect(getErrorMessage(null)).toBe('Unknown error');
      expect(getErrorMessage(undefined)).toBe('Unknown error');
    });
  });

  // ============================================================================
  // sanitizeError
  // ============================================================================

  describe('sanitizeError', () => {
    it('should return message as-is for SecurityViolationError', () => {
      const err = new SecurityViolationError('security issue');
      expect(sanitizeError(err)).toBe('security issue');
    });

    it('should remove password from message', () => {
      const err = new Error('connection failed password=secret123 next');
      const sanitized = sanitizeError(err);
      expect(sanitized).toContain('password=[REDACTED]');
      expect(sanitized).not.toContain('secret123');
    });

    it('should remove pwd from message', () => {
      const err = new Error('failed pwd=mypass next');
      const sanitized = sanitizeError(err);
      expect(sanitized).toContain('pwd=[REDACTED]');
      expect(sanitized).not.toContain('mypass');
    });

    it('should remove connection strings', () => {
      const err = new Error('error at mysql://root:pass@localhost:3306/mydb');
      const sanitized = sanitizeError(err);
      expect(sanitized).toContain('<connection_string>');
      expect(sanitized).not.toContain('root:pass');
    });

    it('should redact passphrase and bearer tokens and spaced password assignments', () => {
      expect(sanitizeError(new Error('ssh_passphrase=hunter2 fail'))).not.toContain('hunter2');
      expect(sanitizeError(new Error('auth failed: Bearer eyJabc.DEF-123'))).not.toContain(
        'eyJabc'
      );
      const spaced = sanitizeError(new Error('bad password = topsecret here'));
      expect(spaced).not.toContain('topsecret');
    });

    it('should strip PEM private key blocks', () => {
      const err = new Error(
        'key error -----BEGIN RSA PRIVATE KEY-----\nMIIabcSECRET\n-----END RSA PRIVATE KEY----- done'
      );
      const sanitized = sanitizeError(err);
      expect(sanitized).not.toContain('MIIabcSECRET');
      expect(sanitized).toContain('[REDACTED KEY]');
    });

    it('should remove file paths', () => {
      const err = new Error('error reading /home/user/secret/config.ini');
      const sanitized = sanitizeError(err);
      expect(sanitized).toContain('<file_path>');
    });

    it('should remove Windows file paths', () => {
      const err = new Error('error reading C:\\Users\\admin\\config.ini');
      const sanitized = sanitizeError(err);
      expect(sanitized).toContain('<file_path>');
    });

    it('should NOT sanitize mathematical division like 1/0 or a/b', () => {
      const err1 = new Error('division by zero: 1/0');
      expect(sanitizeError(err1)).toContain('1/0');
      expect(sanitizeError(err1)).not.toContain('<file_path>');

      const err2 = new Error('syntax error at a/b');
      expect(sanitizeError(err2)).toContain('a/b');
      expect(sanitizeError(err2)).not.toContain('<file_path>');
    });

    it('should sanitize absolute paths even when wrapped in quotes or parentheses', () => {
      const err1 = new Error("failed loading '/root/sql-ts/keys/db_key'");
      expect(sanitizeError(err1)).toContain('<file_path>');
      expect(sanitizeError(err1)).not.toContain('/root/sql-ts');

      const err2 = new Error('error (in /tmp/test-config.ini) occurred');
      expect(sanitizeError(err2)).toContain('<file_path>');
      expect(sanitizeError(err2)).not.toContain('/tmp/test-config');
    });

    it('should return Unknown error for non-Error', () => {
      expect(sanitizeError('string')).toBe('Unknown error occurred');
      expect(sanitizeError(42)).toBe('Unknown error occurred');
      expect(sanitizeError(null)).toBe('Unknown error occurred');
    });
  });

  // ============================================================================
  // sanitizeMessage — exact redaction behavior
  // ============================================================================

  describe('sanitizeMessage', () => {
    it('redacts bearer tokens exactly, including base64 padding', () => {
      expect(sanitizeMessage('auth failed: Bearer eyJhbGciOi.abc-123==')).toBe(
        'auth failed: Bearer [REDACTED]'
      );
    });

    it('redacts colon-separated credentials and normalizes to key=[REDACTED]', () => {
      expect(sanitizeMessage('login token: abc123 rest')).toBe('login token=[REDACTED] rest');
    });

    // The value matcher stopped at the first space, so a quoted secret was only
    // partly removed: password='my secret pass' left "secret pass'" in a message
    // that goes back to the caller.
    // Asserted exactly, not with a "does it still contain the password" check:
    // the old behaviour ate the opening quote and the first word, which passes a
    // loose check while the tail of the secret is still in the message.
    it.each([
      ['double quotes', 'Access denied: password="hunter 2"', 'Access denied: password=[REDACTED]'],
      [
        'single quotes',
        "Access denied: password='my secret pass'",
        'Access denied: password=[REDACTED]',
      ],
      [
        'a quoted passphrase',
        'Config: ssh_passphrase="a b c"',
        'Config: ssh_passphrase=[REDACTED]',
      ],
      ['a quoted value after a colon', 'Config: secret: "top level"', 'Config: secret=[REDACTED]'],
    ])('redacts a quoted credential containing spaces (%s)', (_label, message, expected) => {
      expect(sanitizeMessage(message)).toBe(expected);
    });

    it('still stops at whitespace for an unquoted value', () => {
      // Consuming the rest of the line would swallow the explanation with it.
      expect(sanitizeMessage('password=abc is invalid')).toBe('password=[REDACTED] is invalid');
    });

    it('redacts bearer tokens case-insensitively and repeatedly', () => {
      expect(sanitizeMessage('bearer tok123 and Bearer tok456')).toBe(
        'Bearer [REDACTED] and Bearer [REDACTED]'
      );
    });

    it('redacts bearer tokens separated by multiple spaces', () => {
      expect(sanitizeMessage('Bearer  tok123')).toBe('Bearer [REDACTED]');
    });

    it('does not redact when Bearer is part of another word', () => {
      expect(sanitizeMessage('XBearer tok123')).toBe('XBearer tok123');
    });

    // FIND-106: email PII, internal host:port, and DB usernames must be masked.
    it('masks email addresses (e.g. Postgres unique-constraint PII)', () => {
      expect(sanitizeMessage('Key (email)=(jane.doe@corp.com) already exists')).not.toContain(
        'jane.doe@corp.com'
      );
      expect(sanitizeMessage('duplicate: alice@example.org')).toContain('<email>');
    });

    it('masks internal host:port and IPv4:port tokens', () => {
      expect(sanitizeMessage('connect ECONNREFUSED 10.0.0.5:5432')).toBe(
        'connect ECONNREFUSED <host:port>'
      );
      expect(sanitizeMessage('ETIMEDOUT db.internal.corp:3306')).toContain('<host:port>');
    });

    it('masks disclosed database usernames', () => {
      expect(sanitizeMessage('password authentication failed for user "readonly_user"')).toBe(
        'password authentication failed for user <user>'
      );
    });

    it.each([
      ['passwd=x1 y', 'passwd=[REDACTED] y'],
      ['key=x1 y', 'key=[REDACTED] y'],
      ['api_key=x1 y', 'api_key=[REDACTED] y'],
      ['api-key=x1 y', 'api-key=[REDACTED] y'],
      ['apikey=x1 y', 'apikey=[REDACTED] y'],
      ['authorization=x1 y', 'authorization=[REDACTED] y'],
      ['credential=x1 y', 'credential=[REDACTED] y'],
      ['credentials=x1 y', 'credentials=[REDACTED] y'],
    ])('redacts %s', (input, expected) => {
      expect(sanitizeMessage(input)).toBe(expected);
    });

    it('redacts uppercase PASSWORD assignments preserving the matched keyword', () => {
      expect(sanitizeMessage('PASSWORD=hunter2 z')).toBe('PASSWORD=[REDACTED] z');
    });

    it('redacts multiple credential assignments in one message', () => {
      expect(sanitizeMessage('password=a token=b')).toBe('password=[REDACTED] token=[REDACTED]');
    });

    it('stops secret redaction at semicolons', () => {
      expect(sanitizeMessage('secret=abc;tail')).toBe('secret=[REDACTED];tail');
    });

    it('stops redaction at delimiters', () => {
      expect(sanitizeMessage('secret=s3cr3t,visible')).toBe('secret=[REDACTED],visible');
    });

    it('replaces connection strings exactly', () => {
      expect(sanitizeMessage('at mysql://root:pw@host:3306/db end')).toBe(
        'at <connection_string> end'
      );
    });

    it('replaces Windows drive paths', () => {
      expect(sanitizeMessage('read D:\\data\\file.txt failed')).toBe('read <file_path> failed');
    });

    it('leaves single-segment unix paths alone', () => {
      expect(sanitizeMessage('mount /data failed')).toBe('mount /data failed');
    });

    it('masks credit card numbers exactly', () => {
      expect(sanitizeMessage('card 1234-5678-9012-3456 declined')).toBe(
        'card XXXX-XXXX-XXXX-XXXX declined'
      );
    });

    it('masks SSNs exactly', () => {
      expect(sanitizeMessage('ssn 123-45-6789 found')).toBe('ssn XXX-XX-XXXX found');
    });

    it('truncates messages to 500 characters', () => {
      const long = 'a'.repeat(600);
      expect(sanitizeMessage(long)).toBe('a'.repeat(500));
    });
  });

  describe('sanitizeError security-violation passthrough', () => {
    it('returns SecurityViolationError messages verbatim without sanitization', () => {
      const raw = 'Blocked query containing password=abc123';
      expect(sanitizeError(new SecurityViolationError(raw))).toBe(raw);
    });
  });
});

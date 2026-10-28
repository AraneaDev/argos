/**
 * Configuration Loading and Validation Tests
 */

import {
  ConfigValidationError,
  loadConfiguration,
  parseConfiguration,
  parseDatabaseConfig,
  validateConfiguration,
  getConfigurationPath,
  saveConfigFile,
} from '../../../src/utils/config.js';
import type { ParsedServerConfig, DatabaseConfig } from '../../../src/types/index.js';

// Mock fs operations
jest.mock('fs', () => ({
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  existsSync: jest.fn(),
  statSync: jest.fn(),
  mkdirSync: jest.fn(),
  renameSync: jest.fn(),
}));

jest.mock('path', () => ({
  join: jest.fn((...args: string[]) => args.join('/')),
  dirname: jest.fn((p) => p.substring(0, p.lastIndexOf('/')) || '/'),
}));

jest.mock('ini', () => ({
  parse: jest.fn(),
}));

jest.mock('../../../src/utils/error-handler.js', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : 'Unknown error'),
}));

import { readFileSync, existsSync, writeFileSync, statSync, mkdirSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { parse as parseIni } from 'ini';

const mockFs = {
  readFileSync: readFileSync as jest.MockedFunction<typeof readFileSync>,
  existsSync: existsSync as jest.MockedFunction<typeof existsSync>,
  writeFileSync: writeFileSync as jest.MockedFunction<typeof writeFileSync>,
  statSync: statSync as jest.MockedFunction<typeof statSync>,
  mkdirSync: mkdirSync as jest.MockedFunction<typeof mkdirSync>,
  renameSync: renameSync as jest.MockedFunction<typeof renameSync>,
};
const mockParseIni = parseIni as jest.MockedFunction<typeof parseIni>;
const mockJoin = join as jest.MockedFunction<typeof join>;
const mockDirname = dirname as jest.MockedFunction<typeof dirname>;

describe('config', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // ConfigValidationError
  // ============================================================================

  describe('ConfigValidationError', () => {
    it('should create error with field and database', () => {
      const err = new ConfigValidationError('test message', 'host', 'mydb');
      expect(err.message).toBe('test message');
      expect(err.name).toBe('ConfigValidationError');
      expect(err._field).toBe('host');
      expect(err._database).toBe('mydb');
    });

    it('should create error without database', () => {
      const err = new ConfigValidationError('test', 'field');
      expect(err._database).toBeUndefined();
    });

    it('should be an instance of Error', () => {
      const err = new ConfigValidationError('msg', 'f');
      expect(err).toBeInstanceOf(Error);
    });
  });

  // ============================================================================
  // loadConfiguration
  // ============================================================================

  describe('loadConfiguration', () => {
    it('should throw if config file not found', () => {
      mockFs.existsSync.mockReturnValue(false);

      expect(() => loadConfiguration('/some/path')).toThrow('Configuration file not found');
    });

    it('should use default path when none provided', () => {
      mockFs.existsSync.mockReturnValue(false);

      expect(() => loadConfiguration()).toThrow();
      expect(mockJoin).toHaveBeenCalled();
    });

    it('should load and parse configuration successfully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        '[database.mydb]\ntype=mysql\nhost=localhost\nusername=root'
      );
      mockParseIni.mockReturnValue({
        database: {
          mydb: { type: 'mysql', host: 'localhost', username: 'root' },
        },
      });

      const config = loadConfiguration('/test/config.ini');

      expect(config.databases).toBeDefined();
      expect(config.databases.mydb).toBeDefined();
    });

    it('should wrap parse errors', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('Read error');
      });

      expect(() => loadConfiguration('/test/config.ini')).toThrow('Failed to load configuration');
    });
  });

  // ============================================================================
  // parseConfiguration
  // ============================================================================

  describe('parseConfiguration', () => {
    it('should parse nested database configurations', () => {
      const raw = {
        database: {
          mydb: { type: 'mysql', host: 'localhost', username: 'root' },
        },
      };

      const config = parseConfiguration(raw);
      expect(config.databases.mydb).toBeDefined();
      expect(config.databases.mydb.type).toBe('mysql');
    });

    it('should parse flat database.name configurations', () => {
      const raw = {
        'database.mydb': { type: 'postgresql', host: 'localhost', username: 'admin' },
      };

      const config = parseConfiguration(raw);
      expect(config.databases.mydb).toBeDefined();
    });

    it('should skip flat configs that already exist in nested', () => {
      const raw = {
        database: {
          mydb: { type: 'mysql', host: 'localhost', username: 'root' },
        },
        'database.mydb': { type: 'postgresql', host: 'otherhost', username: 'admin' },
      };

      const config = parseConfiguration(raw);
      expect(config.databases.mydb.type).toBe('mysql'); // nested takes precedence
    });

    it('should throw if no databases configured', () => {
      expect(() => parseConfiguration({})).toThrow('No databases configured');
    });

    it('should skip non-object database entries', () => {
      const raw = {
        database: {
          valid: { type: 'mysql', host: 'localhost', username: 'root' },
          invalid: 'not-an-object',
        },
      };

      const config = parseConfiguration(raw);
      expect(config.databases.valid).toBeDefined();
      expect(config.databases['invalid']).toBeUndefined();
    });

    it('should skip non-object flat entries', () => {
      const raw = {
        'database.bad': 'string-value',
        'database.good': { type: 'mysql', host: 'localhost', username: 'root' },
      };

      const config = parseConfiguration(raw);
      expect(config.databases.good).toBeDefined();
      expect(config.databases.bad).toBeUndefined();
    });

    it('should parse security and extension configs', () => {
      const raw = {
        database: {
          mydb: { type: 'mysql', host: 'localhost', username: 'root' },
        },
        security: { max_joins: '20' },
        extension: { max_rows: '500' },
      };

      const config = parseConfiguration(raw);
      expect(config.security.max_joins).toBe(20);
      expect(config.extension.max_rows).toBe(500);
    });

    it('should use default security config when not provided', () => {
      const raw = {
        database: {
          mydb: { type: 'mysql', host: 'localhost', username: 'root' },
        },
      };

      const config = parseConfiguration(raw);
      expect(config.security.max_joins).toBe(10);
      expect(config.security.max_subqueries).toBe(5);
      expect(config.security.max_unions).toBe(3);
      expect(config.security.max_group_bys).toBe(5);
      expect(config.security.max_complexity_score).toBe(100);
      expect(config.security.max_query_length).toBe(10000);
    });

    it('should use default extension config when not provided', () => {
      const raw = {
        database: {
          mydb: { type: 'mysql', host: 'localhost', username: 'root' },
        },
      };

      const config = parseConfiguration(raw);
      expect(config.extension.max_rows).toBe(1000);
      expect(config.extension.max_batch_size).toBe(10);
      expect(config.extension.query_timeout).toBe(30000);
    });
  });

  // ============================================================================
  // parseDatabaseConfig
  // ============================================================================

  describe('parseDatabaseConfig', () => {
    it('should throw if type is missing', () => {
      expect(() => parseDatabaseConfig('db', {} as any)).toThrow("missing required 'type'");
    });

    it('should throw for invalid type', () => {
      expect(() => parseDatabaseConfig('db', { type: 'oracle' })).toThrow('invalid type');
    });

    it('should accept all valid types', () => {
      const validTypes = ['mysql', 'postgresql', 'postgres', 'sqlite', 'mssql', 'sqlserver'];
      for (const type of validTypes) {
        if (type === 'sqlite') {
          expect(() => parseDatabaseConfig('db', { type, file: '/tmp/test.db' })).not.toThrow();
        } else {
          expect(() =>
            parseDatabaseConfig('db', {
              type,
              host: 'localhost',
              username: 'root',
              password: 'secret',
            })
          ).not.toThrow();
        }
      }
    });

    describe('azure-cli authentication', () => {
      it('should accept azure-cli authentication for mssql without a username', () => {
        const config = parseDatabaseConfig('db', {
          type: 'mssql',
          host: 'myserver.database.windows.net',
          database: 'db',
          authentication: 'azure-cli',
        });
        expect(config.authentication).toBe('azure-cli');
        expect(config.username).toBeUndefined();
      });

      it('should still require a username for mssql using sql authentication', () => {
        expect(() =>
          parseDatabaseConfig('db', { type: 'mssql', host: 'localhost', database: 'db' })
        ).toThrow("missing required 'username'");
      });

      it('should reject azure-cli authentication for a non-mssql database', () => {
        expect(() =>
          parseDatabaseConfig('db', {
            type: 'mysql',
            host: 'localhost',
            username: 'root',
            authentication: 'azure-cli',
          })
        ).toThrow('authentication');
      });

      it('should reject an unknown authentication value', () => {
        expect(() =>
          parseDatabaseConfig('db', {
            type: 'mssql',
            host: 'localhost',
            username: 'u',
            authentication: 'kerberos',
          })
        ).toThrow('kerberos');
      });

      it('should reject encrypt=false alongside azure-cli authentication', () => {
        expect(() =>
          parseDatabaseConfig('db', {
            type: 'mssql',
            host: 'myserver.database.windows.net',
            database: 'db',
            authentication: 'azure-cli',
            encrypt: 'false',
          })
        ).toThrow('encrypt');
      });

      it('should accept encrypt=true alongside azure-cli authentication', () => {
        expect(() =>
          parseDatabaseConfig('db', {
            type: 'mssql',
            host: 'myserver.database.windows.net',
            database: 'db',
            authentication: 'azure-cli',
            encrypt: 'true',
          })
        ).not.toThrow();
      });

      it('should require a password for mssql sql authentication', () => {
        expect(() =>
          parseDatabaseConfig('db', {
            type: 'mssql',
            host: 'localhost',
            database: 'db',
            username: 'u',
          })
        ).toThrow("missing required 'password'");
      });

      it('should not require a password for mssql azure-cli authentication', () => {
        expect(() =>
          parseDatabaseConfig('db', {
            type: 'mssql',
            host: 'myserver.database.windows.net',
            database: 'db',
            authentication: 'azure-cli',
          })
        ).not.toThrow();
      });

      it('should not require a password for other database types', () => {
        // postgresql peer/trust auth and .pgpass are legitimate passwordless
        // setups, so this check stays scoped to mssql.
        expect(() =>
          parseDatabaseConfig('db', { type: 'postgresql', host: 'localhost', username: 'u' })
        ).not.toThrow();
      });

      it('should accept encrypt=false when authentication is explicitly sql', () => {
        // The encrypt rejection is specific to token authentication. SQL
        // authentication may legitimately turn encryption off, so the guard
        // must test both halves of its condition, not just the azure-cli one.
        // authentication has to be spelled out: parseAuthentication returns
        // early when the key is absent, so omitting it never reaches the guard.
        expect(() =>
          parseDatabaseConfig('db', {
            type: 'mssql',
            host: 'localhost',
            database: 'db',
            username: 'u',
            password: 'p',
            authentication: 'sql',
            encrypt: 'false',
          })
        ).not.toThrow();
      });

      it('should trim surrounding whitespace from the authentication value', () => {
        const config = parseDatabaseConfig('db', {
          type: 'mssql',
          host: 'myserver.database.windows.net',
          database: 'db',
          authentication: '  azure-cli  ',
        });
        expect(config.authentication).toBe('azure-cli');
      });

      it('should name the offending field on each authentication error', () => {
        // ConfigValidationError carries a structured field alongside the
        // message. A wrong one is invisible to a test that only matches text.
        // The property is _field, not field: it is a public constructor
        // property wearing a private-by-convention name.
        const fieldOf = (raw: Record<string, string>): string | undefined => {
          try {
            parseDatabaseConfig('db', raw);
            return undefined;
          } catch (error) {
            return (error as { _field?: string })._field;
          }
        };

        expect(
          fieldOf({ type: 'mssql', host: 'h', username: 'u', authentication: 'kerberos' })
        ).toBe('authentication');
        expect(
          fieldOf({
            type: 'mssql',
            host: 'h',
            database: 'db',
            authentication: 'azure-cli',
            encrypt: 'false',
          })
        ).toBe('encrypt');
        expect(fieldOf({ type: 'mssql', host: 'h', database: 'db', username: 'u' })).toBe(
          'password'
        );
      });

      it('should carry azure_tenant_id through to the parsed config', () => {
        const config = parseDatabaseConfig('db', {
          type: 'mssql',
          host: 'myserver.database.windows.net',
          database: 'db',
          authentication: 'azure-cli',
          azure_tenant_id: 'd958da54-24bc-444a-981b-317de09e73ee',
        });
        expect(config.azure_tenant_id).toBe('d958da54-24bc-444a-981b-317de09e73ee');
      });

      it('should reject azure_tenant_id without azure-cli authentication', () => {
        expect(() =>
          parseDatabaseConfig('db', {
            type: 'mssql',
            host: 'localhost',
            database: 'db',
            username: 'u',
            password: 'p',
            azure_tenant_id: 'd958da54-24bc-444a-981b-317de09e73ee',
          })
        ).toThrow('azure_tenant_id');
      });

      it('should reject an azure_tenant_id that is not a GUID', () => {
        expect(() =>
          parseDatabaseConfig('db', {
            type: 'mssql',
            host: 'myserver.database.windows.net',
            database: 'db',
            authentication: 'azure-cli',
            azure_tenant_id: 'yielder-group',
          })
        ).toThrow('azure_tenant_id');
      });

      it('should accept an explicit sql authentication value', () => {
        const config = parseDatabaseConfig('db', {
          type: 'mssql',
          host: 'localhost',
          username: 'u',
          password: 'p',
          authentication: 'sql',
        });
        expect(config.authentication).toBe('sql');
      });

      it('should leave authentication undefined when the key is absent', () => {
        const config = parseDatabaseConfig('db', {
          type: 'mssql',
          host: 'localhost',
          username: 'u',
          password: 'p',
        });
        expect(config.authentication).toBeUndefined();
      });
    });

    it('should normalize type to lowercase', () => {
      const config = parseDatabaseConfig('db', {
        type: 'MySQL',
        host: 'localhost',
        username: 'root',
      });
      expect(config.type).toBe('mysql');
    });

    it('should parse boolean fields correctly', () => {
      const config = parseDatabaseConfig('db', {
        type: 'mysql',
        host: 'localhost',
        username: 'root',
        select_only: 'true',
        mcp_configurable: 'true',
      });
      expect(config.select_only).toBe(true);
      expect(config.mcp_configurable).toBe(true);
    });

    // Booleans in config.ini come from a human. Guessing at a spelling this does
    // not recognise means guessing at a security setting, so an unrecognised
    // value is a startup error rather than a silent false.
    describe('boolean vocabulary', () => {
      const base = { type: 'mysql', host: 'localhost', username: 'root' };

      it.each(['true', 'TRUE', 'True', '1', 'yes', 'YES', 'on', 'enabled', ' true '])(
        'should read %s as true',
        (value) => {
          expect(parseDatabaseConfig('db', { ...base, select_only: value }).select_only).toBe(true);
        }
      );

      it.each(['false', 'FALSE', '0', 'no', 'off', 'disabled', ' false '])(
        'should read %s as false',
        (value) => {
          expect(parseDatabaseConfig('db', { ...base, select_only: value }).select_only).toBe(
            false
          );
        }
      );

      it('should accept a real boolean, which the ini parser produces for true/false', () => {
        const config = parseDatabaseConfig('db', {
          ...base,
          select_only: false as unknown as string,
        });
        expect(config.select_only).toBe(false);
      });

      it.each(['ture', 'maybe', 'y', '', '2'])('should reject %s rather than guess', (value) => {
        expect(() => parseDatabaseConfig('db', { ...base, select_only: value })).toThrow(
          ConfigValidationError
        );
      });

      // `select_only=null` in an ini file parses to a real null, not the string.
      // That is a value someone wrote, not an omission, and it says nothing about
      // whether writes should be allowed, so it is refused like any other.
      it('should reject a literal null rather than read it as off', () => {
        expect(() =>
          parseDatabaseConfig('db', { ...base, select_only: null as unknown as string })
        ).toThrow(ConfigValidationError);
      });

      it('should still treat an absent key as the caller default', () => {
        const config = parseDatabaseConfig('db', { ...base });

        expect(config.select_only).toBe(true);
        expect(config.mcp_configurable).toBe(false);
      });

      it('should name the field, the database and the accepted values', () => {
        expect(() => parseDatabaseConfig('reports', { ...base, select_only: 'ture' })).toThrow(
          /Database 'reports'.*select_only.*'ture'.*true, 1, yes, on, enabled, false, 0, no, off, disabled/s
        );
      });

      // Every security flag goes through the same gate. Each of these silently
      // meant "off" before, so an operator writing an affirmative got the
      // dangerous setting: writes enabled, or certificate checking disabled.
      it.each([
        ['select_only', {}],
        ['ssl', {}],
        ['ssl_verify', {}],
        ['mcp_configurable', {}],
        ['redaction_enabled', {}],
        ['ssh_strict_host_key_checking', { ssh_host: 'b', ssh_username: 'u', ssh_password: 'p' }],
      ])('should reject an unrecognised %s', (field, extra) => {
        expect(() =>
          parseDatabaseConfig('db', { ...base, ...(extra as object), [field]: 'ture' })
        ).toThrow(ConfigValidationError);
      });

      it('should keep reading an affirmative spelling as on for ssl_verify', () => {
        const config = parseDatabaseConfig('db', { ...base, ssl: 'yes', ssl_verify: 'yes' });

        expect(config.ssl).toBe(true);
        expect(config.ssl_verify).toBe(true);
      });

      it('should keep host key checking on for an affirmative spelling', () => {
        const config = parseDatabaseConfig('db', {
          ...base,
          ssh_host: 'b',
          ssh_username: 'u',
          ssh_password: 'p',
          ssh_strict_host_key_checking: 'yes',
        });

        expect(config.ssh_strict_host_key_checking).toBe(true);
      });
    });

    it('should fail secure: select_only defaults to true, mcp_configurable to false', () => {
      const config = parseDatabaseConfig('db', {
        type: 'mysql',
        host: 'localhost',
        username: 'root',
      });
      // Omitting select_only must NOT silently grant write access.
      expect(config.select_only).toBe(true);
      expect(config.mcp_configurable).toBe(false);
    });

    it('parses name_check: default true, explicit false, junk rejected', () => {
      const b = { type: 'mysql', host: 'localhost', username: 'root' };
      expect(parseDatabaseConfig('db', b).name_check).toBe(true);
      expect(parseDatabaseConfig('db', { ...b, name_check: 'false' }).name_check).toBe(false);
      expect(() => parseDatabaseConfig('db', { ...b, name_check: 'maybe' })).toThrow(/name_check/);
    });

    it('honors an explicit select_only=false', () => {
      const config = parseDatabaseConfig('db', {
        type: 'mysql',
        host: 'localhost',
        username: 'root',
        select_only: 'false',
      });
      expect(config.select_only).toBe(false);
    });

    // SQLite specific
    it('should require file for sqlite', () => {
      expect(() => parseDatabaseConfig('db', { type: 'sqlite' })).toThrow(
        "missing required 'file'"
      );
    });

    it('should parse sqlite config with file', () => {
      const config = parseDatabaseConfig('db', { type: 'sqlite', file: '/tmp/test.db' });
      expect(config.type).toBe('sqlite');
      expect(config.file).toBe('/tmp/test.db');
    });

    // Networked database validations
    it('should require host for networked databases', () => {
      expect(() => parseDatabaseConfig('db', { type: 'mysql', username: 'root' })).toThrow(
        "missing required 'host'"
      );
    });

    it('should require username for networked databases', () => {
      expect(() => parseDatabaseConfig('db', { type: 'mysql', host: 'localhost' })).toThrow(
        "missing required 'username'"
      );
    });

    it('should parse all networked database fields', () => {
      const config = parseDatabaseConfig('db', {
        type: 'mysql',
        host: 'localhost',
        port: '3307',
        database: 'mydb',
        username: 'root',
        password: 'secret',
        ssl: 'true',
        ssl_verify: 'true',
        timeout: '5000',
      });

      expect(config.host).toBe('localhost');
      expect(config.port).toBe(3307);
      expect(config.database).toBe('mydb');
      expect(config.username).toBe('root');
      expect(config.password).toBe('secret');
      expect(config.ssl).toBe(true);
      expect(config.ssl_verify).toBe(true);
      expect(config.timeout).toBe(5000);
    });

    it('should use default port when not specified', () => {
      const config = parseDatabaseConfig('db', {
        type: 'mysql',
        host: 'localhost',
        username: 'root',
      });
      expect(config.port).toBe(3306);
    });

    it('should clamp timeout to valid range', () => {
      const low = parseDatabaseConfig('db', {
        type: 'mysql',
        host: 'localhost',
        username: 'root',
        timeout: '100',
      });
      expect(low.timeout).toBe(1000);

      const high = parseDatabaseConfig('db', {
        type: 'mysql',
        host: 'localhost',
        username: 'root',
        timeout: '999999',
      });
      expect(high.timeout).toBe(300000);
    });

    it('should default timeout to 30000 for NaN', () => {
      const config = parseDatabaseConfig('db', {
        type: 'mysql',
        host: 'localhost',
        username: 'root',
        timeout: 'invalid',
      });
      expect(config.timeout).toBe(30000);
    });

    it('should throw for invalid port range', () => {
      expect(() =>
        parseDatabaseConfig('db', {
          type: 'mysql',
          host: 'localhost',
          username: 'root',
          port: '99999',
        })
      ).toThrow('invalid port');
    });

    // SSH config
    it('should parse SSH configuration', () => {
      const config = parseDatabaseConfig('db', {
        type: 'mysql',
        host: 'localhost',
        username: 'root',
        ssh_host: 'bastion.example.com',
        ssh_port: '2222',
        ssh_username: 'admin',
        ssh_private_key: '/path/to/key',
        ssh_passphrase: 'pass',
      });

      expect(config.ssh_host).toBe('bastion.example.com');
      expect(config.ssh_port).toBe(2222);
      expect(config.ssh_username).toBe('admin');
      expect(config.ssh_private_key).toBe('/path/to/key');
      expect(config.ssh_passphrase).toBe('pass');
    });

    it('should default SSH port to 22', () => {
      const config = parseDatabaseConfig('db', {
        type: 'mysql',
        host: 'localhost',
        username: 'root',
        ssh_host: 'bastion',
        ssh_private_key: '/key',
      });
      expect(config.ssh_port).toBe(22);
    });

    it('should throw for invalid SSH port', () => {
      expect(() =>
        parseDatabaseConfig('db', {
          type: 'mysql',
          host: 'localhost',
          username: 'root',
          ssh_host: 'bastion',
          ssh_port: '99999',
          ssh_private_key: '/key',
        })
      ).toThrow('invalid SSH port');
    });

    it('should throw if SSH has no auth method', () => {
      expect(() =>
        parseDatabaseConfig('db', {
          type: 'mysql',
          host: 'localhost',
          username: 'root',
          ssh_host: 'bastion',
        })
      ).toThrow('ssh_password');
    });

    it('should accept SSH with password auth', () => {
      const config = parseDatabaseConfig('db', {
        type: 'mysql',
        host: 'localhost',
        username: 'root',
        ssh_host: 'bastion',
        ssh_password: 'secret',
      });
      expect(config.ssh_password).toBe('secret');
    });

    it('should parse valid local_port for SSH tunnel', () => {
      const config = parseDatabaseConfig('db', {
        type: 'mysql',
        host: 'localhost',
        username: 'root',
        ssh_host: 'bastion',
        ssh_private_key: '/key',
        local_port: '3307',
      });
      expect(config.local_port).toBe(3307);
    });

    it('should throw for invalid local_port', () => {
      expect(() =>
        parseDatabaseConfig('db', {
          type: 'mysql',
          host: 'localhost',
          username: 'root',
          ssh_host: 'bastion',
          ssh_private_key: '/key',
          local_port: '-1',
        })
      ).toThrow('invalid local_port');
    });

    it('should not set local_port for empty string', () => {
      const config = parseDatabaseConfig('db', {
        type: 'mysql',
        host: 'localhost',
        username: 'root',
        ssh_host: 'bastion',
        ssh_private_key: '/key',
        local_port: '',
      });
      expect(config.local_port).toBeUndefined();
    });

    // Redaction config
    it('should parse redaction configuration', () => {
      const config = parseDatabaseConfig('db', {
        type: 'mysql',
        host: 'localhost',
        username: 'root',
        redaction_enabled: 'true',
        redaction_rules: 'email:partial_mask,phone:full_mask',
        redaction_log_access: 'true',
        redaction_audit_queries: 'true',
        redaction_case_sensitive: 'true',
        redaction_replacement_text: '[HIDDEN]',
      });

      expect(config.redaction).toBeDefined();
      expect(config.redaction!.enabled).toBe(true);
      expect(config.redaction!.rules).toHaveLength(2);
      expect(config.redaction!.log_redacted_access).toBe(true);
      expect(config.redaction!.audit_redacted_queries).toBe(true);
      expect(config.redaction!.case_sensitive_matching).toBe(true);
      expect(config.redaction!.default_redaction?.replacement_text).toBe('[HIDDEN]');
    });

    it('should parse redaction rules with replace type', () => {
      const config = parseDatabaseConfig('db', {
        type: 'mysql',
        host: 'localhost',
        username: 'root',
        redaction_enabled: 'true',
        redaction_rules: 'ssn:replace:[PROTECTED]',
      });

      expect(config.redaction!.rules[0].redaction_type).toBe('replace');
      expect(config.redaction!.rules[0].replacement_text).toBe('[PROTECTED]');
    });

    it('should default replace text to [REDACTED]', () => {
      const config = parseDatabaseConfig('db', {
        type: 'mysql',
        host: 'localhost',
        username: 'root',
        redaction_enabled: 'true',
        redaction_rules: 'ssn:replace',
      });

      expect(config.redaction!.rules[0].replacement_text).toBe('[REDACTED]');
    });

    it('should parse custom redaction type', () => {
      const config = parseDatabaseConfig('db', {
        type: 'mysql',
        host: 'localhost',
        username: 'root',
        redaction_enabled: 'true',
        redaction_rules: 'field:custom:pattern',
      });

      expect(config.redaction!.rules[0].redaction_type).toBe('custom');
      expect(config.redaction!.rules[0].custom_pattern).toBe('pattern');
    });

    it('should detect wildcard pattern type', () => {
      const config = parseDatabaseConfig('db', {
        type: 'mysql',
        host: 'localhost',
        username: 'root',
        redaction_enabled: 'true',
        redaction_rules: 'email*:full_mask',
      });

      expect(config.redaction!.rules[0].pattern_type).toBe('wildcard');
    });

    it('should detect regex pattern type', () => {
      const config = parseDatabaseConfig('db', {
        type: 'mysql',
        host: 'localhost',
        username: 'root',
        redaction_enabled: 'true',
        redaction_rules: '/email/:full_mask',
      });

      expect(config.redaction!.rules[0].pattern_type).toBe('regex');
    });

    it('should throw for invalid redaction rule format', () => {
      expect(() =>
        parseDatabaseConfig('db', {
          type: 'mysql',
          host: 'localhost',
          username: 'root',
          redaction_enabled: 'true',
          redaction_rules: 'invalid-rule',
        })
      ).toThrow('invalid redaction rules');
    });

    it('should throw for empty field pattern', () => {
      expect(() =>
        parseDatabaseConfig('db', {
          type: 'mysql',
          host: 'localhost',
          username: 'root',
          redaction_enabled: 'true',
          redaction_rules: ':full_mask',
        })
      ).toThrow('invalid redaction rules');
    });

    it('should throw for invalid redaction type', () => {
      expect(() =>
        parseDatabaseConfig('db', {
          type: 'mysql',
          host: 'localhost',
          username: 'root',
          redaction_enabled: 'true',
          redaction_rules: 'field:invalid_type',
        })
      ).toThrow('invalid redaction rules');
    });

    it('should skip empty rules in comma-separated string', () => {
      const config = parseDatabaseConfig('db', {
        type: 'mysql',
        host: 'localhost',
        username: 'root',
        redaction_enabled: 'true',
        redaction_rules: 'email:full_mask,,phone:partial_mask',
      });

      expect(config.redaction!.rules).toHaveLength(2);
    });

    it('should not parse redaction when not enabled', () => {
      const config = parseDatabaseConfig('db', {
        type: 'mysql',
        host: 'localhost',
        username: 'root',
        redaction_enabled: 'false',
      });

      expect(config.redaction).toBeUndefined();
    });
  });

  // ============================================================================
  // Security config validation
  // ============================================================================

  describe('security config validation', () => {
    const makeRaw = (security: Record<string, string>) => ({
      database: { db: { type: 'mysql', host: 'localhost', username: 'root' } },
      security,
    });

    it('should throw for max_joins out of range', () => {
      expect(() => parseConfiguration(makeRaw({ max_joins: '101' }))).toThrow('max_joins');
    });

    it('should throw for max_subqueries out of range', () => {
      expect(() => parseConfiguration(makeRaw({ max_subqueries: '51' }))).toThrow('max_subqueries');
    });

    it('should throw for max_unions out of range', () => {
      expect(() => parseConfiguration(makeRaw({ max_unions: '21' }))).toThrow('max_unions');
    });

    it('should throw for max_group_bys out of range', () => {
      expect(() => parseConfiguration(makeRaw({ max_group_bys: '51' }))).toThrow('max_group_bys');
    });

    it('should throw for max_complexity_score out of range', () => {
      expect(() => parseConfiguration(makeRaw({ max_complexity_score: '1001' }))).toThrow(
        'max_complexity_score'
      );
    });

    it('should throw for max_query_length out of range', () => {
      expect(() => parseConfiguration(makeRaw({ max_query_length: '50' }))).toThrow(
        'max_query_length'
      );
    });
  });

  // ============================================================================
  // Extension config validation
  // ============================================================================

  describe('extension config validation', () => {
    const makeRaw = (extension: Record<string, string>) => ({
      database: { db: { type: 'mysql', host: 'localhost', username: 'root' } },
      extension,
    });

    it('should throw for max_rows out of range', () => {
      expect(() => parseConfiguration(makeRaw({ max_rows: '50001' }))).toThrow('max_rows');
    });

    it('should throw for max_batch_size out of range', () => {
      expect(() => parseConfiguration(makeRaw({ max_batch_size: '101' }))).toThrow(
        'max_batch_size'
      );
    });
  });

  // ============================================================================
  // validateConfiguration
  // ============================================================================

  describe('validateConfiguration', () => {
    it('should throw if no databases configured', () => {
      expect(() => validateConfiguration({ databases: {} } as any)).toThrow('No databases');
    });

    it('should throw if databases is empty', () => {
      expect(() =>
        validateConfiguration({ databases: {}, security: {} as any, extension: {} as any })
      ).toThrow('No databases');
    });

    it('should validate non-sqlite db missing host', () => {
      expect(() =>
        validateConfiguration({
          databases: { db: { type: 'mysql', username: 'root' } as any },
          security: {} as any,
          extension: {} as any,
        })
      ).toThrow('missing host');
    });

    it('should validate non-sqlite db missing username', () => {
      expect(() =>
        validateConfiguration({
          databases: { db: { type: 'mysql', host: 'localhost' } as any },
          security: {} as any,
          extension: {} as any,
        })
      ).toThrow('missing username');
    });

    it('should not require a username for mssql using azure-cli authentication', () => {
      expect(() =>
        validateConfiguration({
          databases: {
            db: {
              type: 'mssql',
              host: 'myserver.database.windows.net',
              authentication: 'azure-cli',
            } as any,
          },
          security: {} as any,
          extension: {} as any,
        })
      ).not.toThrow();
    });

    it('should validate sqlite db missing file', () => {
      expect(() =>
        validateConfiguration({
          databases: { db: { type: 'sqlite' } as any },
          security: {} as any,
          extension: {} as any,
        })
      ).toThrow('missing file');
    });

    it('should pass for valid config', () => {
      expect(() =>
        validateConfiguration({
          databases: { db: { type: 'mysql', host: 'localhost', username: 'root' } as any },
          security: {} as any,
          extension: {} as any,
        })
      ).not.toThrow();
    });

    it('should pass for valid sqlite config', () => {
      expect(() =>
        validateConfiguration({
          databases: { db: { type: 'sqlite', file: '/tmp/test.db' } as any },
          security: {} as any,
          extension: {} as any,
        })
      ).not.toThrow();
    });
  });

  // ============================================================================
  // Utility functions
  // ============================================================================

  describe('getConfigurationPath', () => {
    it('should return provided path', () => {
      expect(getConfigurationPath('/custom/path')).toBe('/custom/path');
    });

    it('should use default path when none provided', () => {
      getConfigurationPath();
      expect(mockJoin).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // saveConfigFile
  // ============================================================================

  describe('loadConfiguration - permission warning', () => {
    it('logs a warning when config file is group- or world-readable (mode 0o644)', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ mode: 0o100644 } as ReturnType<typeof statSync>);
      mockFs.readFileSync.mockReturnValue('[database.test]\ntype=sqlite\nfile=test.db\n');
      mockParseIni.mockReturnValue({ 'database.test': { type: 'sqlite', file: 'test.db' } });
      const warnSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      loadConfiguration('/tmp/test-config-perms.ini');
      const warned = warnSpy.mock.calls.some((c) =>
        String(c[0]).includes('group- or world-readable')
      );
      warnSpy.mockRestore();
      expect(warned).toBe(true);
    });

    it('does not warn when config file is owner-only (mode 0o600)', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ mode: 0o100600 } as ReturnType<typeof statSync>);
      mockFs.readFileSync.mockReturnValue('[database.test]\ntype=sqlite\nfile=test.db\n');
      mockParseIni.mockReturnValue({ 'database.test': { type: 'sqlite', file: 'test.db' } });
      const warnSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      loadConfiguration('/tmp/test-config-perms-ok.ini');
      const warned = warnSpy.mock.calls.some((c) =>
        String(c[0]).includes('group- or world-readable')
      );
      warnSpy.mockRestore();
      expect(warned).toBe(false);
    });
  });

  describe('saveConfigFile', () => {
    it('should write config to file', () => {
      const config: ParsedServerConfig = {
        databases: {
          mydb: {
            type: 'mysql',
            host: 'localhost',
            port: 3306,
            username: 'root',
            password: 'pass',
            select_only: false,
          } as DatabaseConfig,
        },
        security: {
          max_joins: 10,
          max_subqueries: 5,
          max_unions: 3,
          max_group_bys: 5,
          max_complexity_score: 100,
          max_query_length: 10000,
        },
        extension: { max_rows: 1000, max_batch_size: 10, query_timeout: 30000 },
      };

      saveConfigFile(config, '/test/config.ini');

      // Atomic write: content goes to a unique temp file (0600) then is renamed into place.
      // The temp name includes pid + timestamp to avoid collisions (FIND-117).
      const tempPathRe = /^\/test\/config\.ini\.\d+\.\d+\.tmp$/;
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(tempPathRe),
        expect.stringContaining('[database.mydb]'),
        { encoding: 'utf-8', mode: 0o600 }
      );
      expect(mockFs.renameSync).toHaveBeenCalledWith(
        expect.stringMatching(tempPathRe),
        '/test/config.ini'
      );
    });

    it('should write security section', () => {
      const config: ParsedServerConfig = {
        databases: {
          mydb: {
            type: 'mysql',
            host: 'localhost',
            username: 'root',
            select_only: false,
          } as DatabaseConfig,
        },
        security: {
          max_joins: 10,
          max_subqueries: 5,
          max_unions: 3,
          max_group_bys: 5,
          max_complexity_score: 100,
          max_query_length: 10000,
        },
        extension: { max_rows: 1000, max_batch_size: 10, query_timeout: 30000 },
      };

      saveConfigFile(config, '/test/config.ini');

      const written = (mockFs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
      expect(written).toContain('[security]');
      expect(written).toContain('max_joins=10');
    });

    it('should write extension section', () => {
      const config: ParsedServerConfig = {
        databases: {
          mydb: {
            type: 'mysql',
            host: 'localhost',
            username: 'root',
            select_only: false,
          } as DatabaseConfig,
        },
        security: {
          max_joins: 10,
          max_subqueries: 5,
          max_unions: 3,
          max_group_bys: 5,
          max_complexity_score: 100,
          max_query_length: 10000,
        },
        extension: { max_rows: 1000, max_batch_size: 10, query_timeout: 30000 },
      };

      saveConfigFile(config, '/test/config.ini');

      const written = (mockFs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
      expect(written).toContain('[extension]');
      expect(written).toContain('max_rows=1000');
    });

    it('should write redaction configuration', () => {
      const config: ParsedServerConfig = {
        databases: {
          mydb: {
            type: 'mysql',
            host: 'localhost',
            username: 'root',
            select_only: false,
            redaction: {
              enabled: true,
              rules: [
                {
                  field_pattern: 'email',
                  pattern_type: 'exact',
                  redaction_type: 'replace',
                  replacement_text: '[HIDDEN]',
                  preserve_format: false,
                },
              ],
              log_redacted_access: true,
              audit_redacted_queries: true,
              case_sensitive_matching: true,
              default_redaction: { redaction_type: 'replace', replacement_text: '[DEFAULT]' },
            },
          } as DatabaseConfig,
        },
        security: {
          max_joins: 10,
          max_subqueries: 5,
          max_unions: 3,
          max_group_bys: 5,
          max_complexity_score: 100,
          max_query_length: 10000,
        },
        extension: { max_rows: 1000, max_batch_size: 10, query_timeout: 30000 },
      };

      saveConfigFile(config, '/test/config.ini');

      const written = (mockFs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
      expect(written).toContain('redaction_enabled=true');
      expect(written).toContain('redaction_rules=email:replace:[HIDDEN]');
      expect(written).toContain('redaction_replacement_text=[DEFAULT]');
      expect(written).toContain('redaction_log_access=true');
      expect(written).toContain('redaction_audit_queries=true');
      expect(written).toContain('redaction_case_sensitive=true');
    });

    it('should write mcp_configurable flag', () => {
      const config: ParsedServerConfig = {
        databases: {
          mydb: {
            type: 'mysql',
            host: 'localhost',
            username: 'root',
            select_only: false,
            mcp_configurable: true,
          } as DatabaseConfig,
        },
        security: {
          max_joins: 10,
          max_subqueries: 5,
          max_unions: 3,
          max_group_bys: 5,
          max_complexity_score: 100,
          max_query_length: 10000,
        },
        extension: { max_rows: 1000, max_batch_size: 10, query_timeout: 30000 },
      };

      saveConfigFile(config, '/test/config.ini');

      const written = (mockFs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
      expect(written).toContain('mcp_configurable=true');
    });

    it('should skip null and undefined values', () => {
      const config: ParsedServerConfig = {
        databases: {
          mydb: {
            type: 'mysql',
            host: 'localhost',
            username: 'root',
            password: undefined,
            select_only: false,
          } as any,
        },
        security: {
          max_joins: 10,
          max_subqueries: 5,
          max_unions: 3,
          max_group_bys: 5,
          max_complexity_score: 100,
          max_query_length: 10000,
        },
        extension: { max_rows: 1000, max_batch_size: 10, query_timeout: 30000 },
      };

      saveConfigFile(config, '/test/config.ini');

      const written = (mockFs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
      expect(written).not.toContain('password=');
    });

    it('should extract multiline ssh_private_key to a separate secure file and store path', () => {
      const privateKeyContent =
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----';
      const config: ParsedServerConfig = {
        databases: {
          mydb: {
            type: 'postgresql',
            host: 'localhost',
            username: 'root',
            select_only: true,
            ssh_host: 'bastion.com',
            ssh_username: 'sshuser',
            ssh_private_key: privateKeyContent,
          } as DatabaseConfig,
        },
        security: {
          max_joins: 10,
          max_subqueries: 5,
          max_unions: 3,
          max_group_bys: 5,
          max_complexity_score: 100,
          max_query_length: 10000,
        },
        extension: { max_rows: 1000, max_batch_size: 10, query_timeout: 30000 },
      };

      saveConfigFile(config, '/test/config.ini');

      // writeFileSync should have been called twice:
      // 1. to write the key to '/test/keys/mydb_ssh_key'
      // 2. to write the INI file to '/test/config.ini'
      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(2);

      // Verify key extraction file call
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        '/test/keys/mydb_ssh_key',
        privateKeyContent,
        { mode: 0o600 }
      );

      // Verify INI content uses the key file path (config is written atomically to a unique .tmp)
      const written = (mockFs.writeFileSync as jest.Mock).mock.calls.find((call) =>
        /^\/test\/config\.ini\.\d+\.\d+\.tmp$/.test(call[0] as string)
      )[1] as string;
      expect(written).toContain('ssh_private_key=/test/keys/mydb_ssh_key');
      expect(written).not.toContain(privateKeyContent);
    });
  });
});

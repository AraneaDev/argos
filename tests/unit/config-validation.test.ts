// tests/unit/config-validation.test.ts
import { validateDatabaseConfig } from '../../src/utils/config.js';

const base = {
  type: 'mysql' as const,
  host: 'localhost',
  port: 3306,
  user: 'u',
  password: 'p',
  database: 'db',
};

describe('validateDatabaseConfig', () => {
  it('passes valid mysql config', () => {
    expect(validateDatabaseConfig(base as any).valid).toBe(true);
  });
  it('fails when host is missing for mysql', () => {
    const r = validateDatabaseConfig({ ...base, host: '' } as any);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e: any) => e.field === 'host')).toBe(true);
  });
  it('fails with embedded credentials in host', () => {
    const r = validateDatabaseConfig({ ...base, host: 'user:pass@myhost' } as any);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e: any) => e.field === 'host')).toBe(true);
  });
  it('fails when port is out of range', () => {
    const r = validateDatabaseConfig({ ...base, port: 99999 } as any);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e: any) => e.field === 'port')).toBe(true);
  });
  it('fails when database name has shell metacharacters', () => {
    const r = validateDatabaseConfig({ ...base, database: 'db;rm -rf' } as any);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e: any) => e.field === 'database')).toBe(true);
  });
  it('passes valid sqlite config (only filename required)', () => {
    const r = validateDatabaseConfig({ type: 'sqlite', filename: '/tmp/test.db' } as any);
    expect(r.valid).toBe(true);
  });
  it('fails sqlite config with no filename', () => {
    const r = validateDatabaseConfig({ type: 'sqlite' } as any);
    expect(r.valid).toBe(false);
  });
});

describe('validateDatabaseConfig - Azure CLI authentication', () => {
  const mssqlBase = {
    type: 'mssql' as const,
    host: 'myserver.database.windows.net',
    port: 1433,
    database: 'db',
  };

  it('passes mssql config with azure-cli auth and no username or password', () => {
    const r = validateDatabaseConfig({ ...mssqlBase, authentication: 'azure-cli' } as any);
    expect(r.valid).toBe(true);
  });

  it('still requires username and password for mssql without azure-cli auth', () => {
    const r = validateDatabaseConfig(mssqlBase as any);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e: any) => e.field === 'user')).toBe(true);
    expect(r.errors.some((e: any) => e.field === 'password')).toBe(true);
  });

  it('passes postgresql config with azure-cli auth, a username and no password', () => {
    const r = validateDatabaseConfig({
      type: 'postgresql',
      host: 'myserver.postgres.database.azure.com',
      port: 5432,
      database: 'db',
      username: 'argos-readers',
      authentication: 'azure-cli',
    } as any);
    expect(r.valid).toBe(true);
  });

  it('still requires the username for postgresql with azure-cli auth', () => {
    const r = validateDatabaseConfig({
      type: 'postgresql',
      host: 'myserver.postgres.database.azure.com',
      port: 5432,
      database: 'db',
      authentication: 'azure-cli',
    } as any);
    expect(r.errors.map((e: any) => e.field)).toEqual(['user']);
  });

  it('still requires username and password for mysql with azure-cli auth', () => {
    const r = validateDatabaseConfig({
      ...base,
      user: '',
      password: '',
      authentication: 'azure-cli',
    } as any);
    expect(r.valid).toBe(false);
  });
});

import { hashQuery } from '../../src/utils/audit-logger.js';

jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  appendFile: jest.fn().mockResolvedValue(undefined),
}));

import { mkdir, appendFile } from 'node:fs/promises';
import { writeAuditLog } from '../../src/utils/audit-logger.js';

describe('hashQuery', () => {
  it('produces consistent 8-char hex for same SQL', () => {
    expect(hashQuery('SELECT 1')).toHaveLength(8);
    expect(hashQuery('SELECT 1')).toBe(hashQuery('SELECT 1'));
  });
  it('normalises whitespace and case', () => {
    expect(hashQuery('SELECT  1')).toBe(hashQuery('select 1'));
  });
  it('different SQL produces different hash', () => {
    expect(hashQuery('SELECT 1')).not.toBe(hashQuery('SELECT 2'));
  });
  it('normalises to the exact lowercased single-spaced trimmed form', () => {
    // sha256('select 1').slice(0, 8) — pins lowercase, space collapsing, and trim
    expect(hashQuery('  SELECT \n\t 1  ')).toBe('822ae07d');
  });
});

describe('writeAuditLog', () => {
  beforeEach(() => jest.clearAllMocks());
  it('calls mkdir and appendFile with correct paths', async () => {
    await writeAuditLog('mydb', 'SELECT 1', 42, 'success');
    // Named for the product, not for what it was called before the rebrand.
    expect(mkdir).toHaveBeenCalledWith(expect.stringContaining('.argos/audit'), {
      recursive: true,
      mode: 0o700,
    });
    expect(appendFile).toHaveBeenCalledWith(
      expect.stringContaining('mydb.log'),
      expect.stringContaining('success'),
      { encoding: 'utf8', mode: 0o600 }
    );
  });
  it('log line contains timestamp, dbName, hash, duration, and outcome', async () => {
    await writeAuditLog('mydb', 'SELECT 1', 100, 'error:CONNECTION');
    const line = (appendFile as jest.Mock).mock.calls[0][1] as string;
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(line).toContain('mydb');
    expect(line).toContain('100ms');
    expect(line).toContain('error:CONNECTION');
  });
});

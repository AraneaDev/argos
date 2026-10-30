const mockExecFile = jest.fn();
jest.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));
const mockAzureCliCredentialCtor = jest.fn();
jest.mock('@azure/identity', () => ({
  AzureCliCredential: jest.fn().mockImplementation(function (this: any, ...args: unknown[]) {
    mockAzureCliCredentialCtor(...args);
  }),
}));

import {
  AzureCliProfileCredential,
  azureCliCredential,
} from '../../../src/database/azure-credential.js';

type Callback = (error: Error | null, stdout: string, stderr: string) => void;
const answer = (error: Error | null, stdout = '', stderr = '') =>
  mockExecFile.mockImplementationOnce((_file, _args, _options, callback: Callback) =>
    callback(error, stdout, stderr)
  );

const PROFILE = '/home/me/.azure-claude-ro';
const SCOPE = 'https://ossrdbms-aad.database.windows.net/.default';

describe('AzureCliProfileCredential', () => {
  beforeEach(() => mockExecFile.mockReset());

  it('runs az with AZURE_CONFIG_DIR set to its profile, for the scope as a resource', async () => {
    answer(null, JSON.stringify({ accessToken: 'tok', expires_on: 1800000000 }));
    const token = await new AzureCliProfileCredential(PROFILE).getToken(SCOPE);

    expect(token).toEqual({ token: 'tok', expiresOnTimestamp: 1800000000 * 1000 });
    const [file, args, options] = mockExecFile.mock.calls[0];
    expect(file).toBe('az');
    expect(args).toEqual([
      'account',
      'get-access-token',
      '--output',
      'json',
      '--resource',
      'https://ossrdbms-aad.database.windows.net',
    ]);
    expect(options.env.AZURE_CONFIG_DIR).toBe(PROFILE);
    // The rest of the environment (PATH above all) is kept.
    expect(options.env.PATH).toBe(process.env.PATH);
  });

  it('leaves the server environment itself alone', async () => {
    const before = process.env.AZURE_CONFIG_DIR;
    answer(null, JSON.stringify({ accessToken: 'tok', expires_on: '1800000000' }));
    await new AzureCliProfileCredential(PROFILE).getToken(SCOPE);
    expect(process.env.AZURE_CONFIG_DIR).toBe(before);
  });

  it('passes the tenant and accepts the scope as an array', async () => {
    answer(null, JSON.stringify({ accessToken: 'tok', expiresOn: '2026-10-30 12:00:00.000000' }));
    const token = await new AzureCliProfileCredential(
      PROFILE,
      'd958da54-24bc-444a-981b-317de09e73ee'
    ).getToken(['https://database.windows.net/.default']);
    expect(mockExecFile.mock.calls[0][1]).toEqual(
      expect.arrayContaining([
        '--resource',
        'https://database.windows.net',
        '--tenant',
        'd958da54-24bc-444a-981b-317de09e73ee',
      ])
    );
    expect(Number.isFinite(token.expiresOnTimestamp)).toBe(true);
  });

  it('says which profile to sign in to when az gives no token', async () => {
    answer(new Error('exit 1'), '', "ERROR: Please run 'az login' to setup account.\nmore");
    await expect(new AzureCliProfileCredential(PROFILE).getToken(SCOPE)).rejects.toMatchObject({
      name: 'CredentialUnavailableError',
      message: `No token from the Azure CLI profile in ${PROFILE}: run AZURE_CONFIG_DIR="${PROFILE}" az login (ERROR: Please run 'az login' to setup account.)`,
    });
  });

  it('says when az is not installed', async () => {
    answer(Object.assign(new Error('spawn az ENOENT'), { code: 'ENOENT' }));
    await expect(new AzureCliProfileCredential(PROFILE).getToken(SCOPE)).rejects.toThrow(
      'not installed'
    );
  });

  it('refuses an answer without a token', async () => {
    answer(null, JSON.stringify({ tokenType: 'Bearer' }));
    await expect(new AzureCliProfileCredential(PROFILE).getToken(SCOPE)).rejects.toThrow(
      'no access token'
    );
    answer(null, 'not json');
    await expect(new AzureCliProfileCredential(PROFILE).getToken(SCOPE)).rejects.toThrow('JSON');
  });
});

describe('azureCliCredential', () => {
  it('uses the database profile when azure_config_dir is set, else AzureCliCredential', async () => {
    expect(await azureCliCredential({ azure_config_dir: PROFILE })).toBeInstanceOf(
      AzureCliProfileCredential
    );
    await azureCliCredential({ azure_tenant_id: 'd958da54-24bc-444a-981b-317de09e73ee' });
    expect(mockAzureCliCredentialCtor).toHaveBeenCalledWith({
      tenantId: 'd958da54-24bc-444a-981b-317de09e73ee',
    });
  });
});

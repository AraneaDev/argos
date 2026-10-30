/**
 * The Azure CLI credential the SQL Server and PostgreSQL adapters take Entra
 * tokens from.
 *
 * `@azure/identity`'s AzureCliCredential runs `az` in the server's own
 * environment, so the whole server shares one Azure CLI profile (the default, or
 * whatever AZURE_CONFIG_DIR the server was started with). A database that sets
 * `azure_config_dir` gets its own profile instead: a dedicated reader identity
 * signed in with `AZURE_CONFIG_DIR=<dir> az login`, kept apart from the person's
 * own, possibly admin, login.
 */

import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import type { DatabaseConfig } from '../types/index.js';

/** The part of `@azure/identity`'s TokenCredential the drivers call. */
export interface EntraCredential {
  getToken(
    scopes: string | string[]
  ): Promise<{ token: string; expiresOnTimestamp: number } | null>;
}

const AZ_TIMEOUT_MS = 30_000;

/** An error the adapters read as "the token could not be acquired". */
function unavailable(message: string): Error {
  const error = new Error(message);
  error.name = 'CredentialUnavailableError';
  return error;
}

/**
 * `az account get-access-token`, run with AZURE_CONFIG_DIR set to one profile
 * directory. Nothing is cached here: `az` keeps and refreshes its own tokens.
 */
export class AzureCliProfileCredential implements EntraCredential {
  constructor(
    private readonly configDir: string,
    private readonly tenantId?: string
  ) {}

  /** A token for the first scope, from this profile; throws CredentialUnavailableError when there is none. */
  async getToken(
    scopes: string | string[]
  ): Promise<{ token: string; expiresOnTimestamp: number }> {
    const scope = Array.isArray(scopes) ? scopes[0] : scopes;
    if (!scope) throw unavailable('No scope to request an Azure CLI token for');
    const resource = scope.replace(/\/\.default$/, '');
    const args = ['account', 'get-access-token', '--output', 'json', '--resource', resource];
    if (this.tenantId) args.push('--tenant', this.tenantId);

    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        'az',
        args,
        {
          env: { ...process.env, AZURE_CONFIG_DIR: this.configDir },
          cwd: homedir(),
          timeout: AZ_TIMEOUT_MS,
          encoding: 'utf8',
          // az is a batch file on Windows; the arguments are fixed strings and a GUID.
          shell: process.platform === 'win32',
        },
        (error, out, err) => {
          if (!error) return resolve(out);
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return reject(unavailable('The Azure CLI (az) is not installed or not on PATH'));
          }
          const detail = String(err ?? '')
            .trim()
            .split('\n')[0];
          reject(
            unavailable(
              `No token from the Azure CLI profile in ${this.configDir}: ` +
                `run AZURE_CONFIG_DIR="${this.configDir}" az login` +
                (detail ? ` (${detail})` : '')
            )
          );
        }
      );
    });

    let parsed: { accessToken?: unknown; expires_on?: unknown; expiresOn?: unknown };
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw unavailable('The Azure CLI answered with something other than JSON');
    }
    if (typeof parsed.accessToken !== 'string' || parsed.accessToken === '') {
      throw unavailable('The Azure CLI returned no access token');
    }
    // expires_on is epoch seconds (az 2.54+); expiresOn a local date-time string.
    const expiresOnTimestamp =
      typeof parsed.expires_on === 'number'
        ? parsed.expires_on * 1000
        : typeof parsed.expires_on === 'string' && /^\d+$/.test(parsed.expires_on)
          ? Number(parsed.expires_on) * 1000
          : Date.parse(String(parsed.expiresOn ?? ''));
    return {
      token: parsed.accessToken,
      expiresOnTimestamp: Number.isFinite(expiresOnTimestamp) ? expiresOnTimestamp : Date.now(),
    };
  }
}

/**
 * The credential for a database using authentication=azure-cli: its own profile
 * when it sets azure_config_dir, else `@azure/identity`'s AzureCliCredential
 * (imported lazily so installs that never touch Azure do not load it).
 */
export async function azureCliCredential(
  config: Pick<DatabaseConfig, 'azure_tenant_id' | 'azure_config_dir'>
): Promise<EntraCredential> {
  const tenantId = config.azure_tenant_id;
  if (config.azure_config_dir)
    return new AzureCliProfileCredential(config.azure_config_dir, tenantId);
  const { AzureCliCredential } = await import('@azure/identity');
  return tenantId ? new AzureCliCredential({ tenantId }) : new AzureCliCredential();
}

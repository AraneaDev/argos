import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

/**
 *
 */
export function hashQuery(sql: string): string {
  const normalized = sql.replace(/\s+/g, ' ').toLowerCase().trim();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 8);
}

/**
 *
 */
export async function writeAuditLog(
  dbName: string,
  sql: string,
  durationMs: number,
  outcome: 'success' | string
): Promise<void> {
  // Named for the product. Installations that ran a pre-rebrand version have
  // their earlier records under ~/.sql-ts/audit; those files are left where they
  // are rather than moved, because relocating an audit trail is not something
  // this should do behind the operator's back.
  const dir = join(homedir(), '.argos', 'audit');
  // Owner-only dir/file (FIND-114): the audit log holds query metadata/timing. It carries no
  // secrets or plaintext SQL, but keep it consistent with the rest of the 0600 hardening.
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const ts = new Date().toISOString();
  const line = `${ts}  ${dbName}  ${hashQuery(sql)}  ${durationMs}ms  ${outcome}\n`;
  await appendFile(join(dir, `${dbName}.log`), line, { encoding: 'utf8', mode: 0o600 });
}

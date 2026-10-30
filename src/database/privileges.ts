/**
 * What the database itself would let a connection do.
 *
 * Argos's SQL filter is a second net. The boundary is the role the connection
 * logs in as: a select_only database connected as a principal that can write
 * is one filter bug away from a DELETE. The probe asks the database, with
 * read-only queries, whether the role can write, so that can be said out loud.
 *
 * The mapping functions here are pure: each adapter runs its own query and hands
 * the rows over.
 */

import type { QueryResult } from '../types/index.js';

export interface PrivilegeReport {
  /** True when the database would let this connection change data or schema. */
  canWrite: boolean;
  /** Who the database says the connection is, e.g. `dbo`, `reader@contoso.com`. */
  principal: string | null;
  /** Why it can write, one short phrase each: `db_owner`, `INSERT on 12 tables`. */
  reasons: string[];
  /** Facts that matter but do not make it writable on their own. */
  notes: string[];
  /** ISO timestamp of the probe. */
  checkedAt: string;
}

/** A probe that could not run. Never fatal: the warning is advice, not a gate. */
export interface PrivilegeProbeFailure {
  error: string;
  checkedAt: string;
}

export type PrivilegeProbe = PrivilegeReport | PrivilegeProbeFailure;

/** Whether a probe result is a report rather than a failure. */
export function isPrivilegeReport(probe: PrivilegeProbe | undefined): probe is PrivilegeReport {
  return probe !== undefined && 'canWrite' in probe;
}

const now = (): string => new Date().toISOString();

/** A flag as a driver returns it: 1, true, '1', 't' (pg text), 'on'. */
function truthy(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'bigint') return value === 1n;
  if (typeof value === 'string')
    return ['1', 't', 'true', 'on', 'yes'].includes(value.toLowerCase());
  return false;
}

function count(value: unknown): number {
  const n =
    typeof value === 'string' ? Number(value) : typeof value === 'bigint' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function firstRow(result: QueryResult): Record<string, unknown> {
  const row = result.rows[0];
  if (!row) throw new Error('the privilege query returned no row');
  return row;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

// ============================================================================
// SQL Server
// ============================================================================

/**
 * One row. IS_SRVROLEMEMBER is NULL on Azure SQL Database, where server roles
 * do not exist for a contained user; NULL is read as "not a member".
 * HAS_PERMS_BY_NAME on the database covers grants made outside the fixed roles.
 */
export const MSSQL_PRIVILEGE_QUERY = `SELECT
  USER_NAME() AS principal,
  IS_ROLEMEMBER('db_owner') AS db_owner,
  IS_ROLEMEMBER('db_datawriter') AS db_datawriter,
  IS_ROLEMEMBER('db_ddladmin') AS db_ddladmin,
  IS_SRVROLEMEMBER('sysadmin') AS sysadmin,
  HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CREATE TABLE') AS create_table,
  HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'INSERT') AS db_insert,
  HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'UPDATE') AS db_update,
  HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'DELETE') AS db_delete,
  (SELECT COUNT(*) FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE HAS_PERMS_BY_NAME(QUOTENAME(s.name) + '.' + QUOTENAME(t.name), 'OBJECT', 'INSERT') = 1
       OR HAS_PERMS_BY_NAME(QUOTENAME(s.name) + '.' + QUOTENAME(t.name), 'OBJECT', 'UPDATE') = 1
       OR HAS_PERMS_BY_NAME(QUOTENAME(s.name) + '.' + QUOTENAME(t.name), 'OBJECT', 'DELETE') = 1
  ) AS writable_tables`;

/** Map the SQL Server probe's row. */
export function mssqlPrivileges(result: QueryResult): PrivilegeReport {
  const row = firstRow(result);
  const principal = text(row.principal);
  const reasons: string[] = [];
  if (truthy(row.sysadmin)) reasons.push('sysadmin');
  if (truthy(row.db_owner)) reasons.push('db_owner');
  // dbo owns the database whatever its role membership says.
  else if (principal === 'dbo') reasons.push('database owner');
  if (truthy(row.db_datawriter)) reasons.push('db_datawriter');
  if (truthy(row.db_ddladmin)) reasons.push('db_ddladmin');
  // The roles above imply these; only say them when nothing else did.
  if (reasons.length === 0) {
    const granted = ['INSERT', 'UPDATE', 'DELETE'].filter((p) =>
      truthy(row[`db_${p.toLowerCase()}`])
    );
    if (granted.length > 0) reasons.push(`${granted.join('/')} on the database`);
    if (truthy(row.create_table)) reasons.push('CREATE TABLE');
    const tables = count(row.writable_tables);
    if (tables > 0) reasons.push(`INSERT/UPDATE/DELETE on ${plural(tables, 'table')}`);
  }
  return { canWrite: reasons.length > 0, principal, reasons, notes: [], checkedAt: now() };
}

// ============================================================================
// PostgreSQL
// ============================================================================

/**
 * One row. The predefined roles are looked up by name in pg_roles so the query
 * still runs on versions that do not have them. Tables are counted in every
 * schema the role can use, catalogs excluded.
 */
export const POSTGRES_PRIVILEGE_QUERY = `SELECT
  current_user AS principal,
  (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser,
  COALESCE((SELECT string_agg(g.rolname, ',' ORDER BY g.rolname) FROM pg_roles g
    WHERE g.rolname IN ('pg_execute_server_program', 'pg_read_server_files', 'pg_write_server_files', 'pg_write_all_data')
      AND pg_has_role(current_user, g.oid, 'MEMBER')), '') AS server_roles,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_toast%'
      AND has_schema_privilege(n.oid, 'USAGE')
      AND has_table_privilege(c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE')) AS writable_tables,
  COALESCE((SELECT string_agg(n.nspname, ',' ORDER BY n.nspname) FROM pg_namespace n
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'
      AND has_schema_privilege(n.oid, 'CREATE')), '') AS create_schemas,
  current_setting('default_transaction_read_only') AS default_read_only`;

/** Map the PostgreSQL probe's row. */
export function postgresPrivileges(result: QueryResult): PrivilegeReport {
  const row = firstRow(result);
  const reasons: string[] = [];
  const notes: string[] = [];
  if (truthy(row.is_superuser)) reasons.push('superuser');
  const roles = (text(row.server_roles) ?? '').split(',').filter((r) => r !== '');
  // pg_read_server_files reads, the rest write or run programs: all of them reach past the tables.
  for (const role of roles) reasons.push(role);
  const tables = count(row.writable_tables);
  if (tables > 0) reasons.push(`INSERT/UPDATE/DELETE/TRUNCATE on ${plural(tables, 'table')}`);
  const schemas = (text(row.create_schemas) ?? '').split(',').filter((s) => s !== '');
  if (schemas.length > 0) reasons.push(`CREATE in schema ${schemas.join(', ')}`);
  if (truthy(row.default_read_only)) {
    notes.push('default_transaction_read_only is on, but a session can turn it off');
  }
  return {
    canWrite: reasons.length > 0,
    principal: text(row.principal),
    reasons,
    notes,
    checkedAt: now(),
  };
}

// ============================================================================
// MySQL
// ============================================================================

export const MYSQL_PRIVILEGE_QUERY = 'SHOW GRANTS FOR CURRENT_USER()';

/** Privileges that only read. USAGE is "no privileges". */
const MYSQL_READ_PRIVILEGES = new Set(['SELECT', 'SHOW VIEW', 'USAGE', 'SHOW DATABASES']);

/**
 * Split a GRANT's privilege list on top-level commas: column privileges carry
 * their own comma lists, as in `SELECT (a, b), INSERT (c)`.
 */
function splitPrivileges(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
    } else current += ch;
  }
  out.push(current);
  return out
    .map((p) =>
      p
        .replace(/\(.*\)/, '')
        .trim()
        .toUpperCase()
    )
    .filter((p) => p !== '');
}

/** Map SHOW GRANTS: one row per GRANT statement, in a column named `Grants for user@host`. */
export function mysqlPrivileges(result: QueryResult): PrivilegeReport {
  const reasons: string[] = [];
  const notes: string[] = [];
  let principal: string | null = null;
  for (const row of result.rows) {
    const [column, value] = Object.entries(row)[0] ?? [];
    if (principal === null && column?.startsWith('Grants for '))
      principal = column.slice('Grants for '.length);
    if (typeof value !== 'string') continue;
    const grant = /^GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+/i.exec(value);
    if (!grant) {
      // A role grant (`GRANT role TO user`): its privileges are not listed here.
      const role = /^GRANT\s+(.+?)\s+TO\s+/i.exec(value);
      if (role) notes.push(`has role ${role[1]}, whose privileges this check does not expand`);
      continue;
    }
    const target = grant[2]!.trim();
    for (const privilege of splitPrivileges(grant[1]!)) {
      if (MYSQL_READ_PRIVILEGES.has(privilege)) continue;
      if (privilege === 'PROXY') reasons.push(`PROXY on ${target}`);
      else if (privilege === 'FILE') reasons.push('FILE (reads and writes files on the server)');
      else reasons.push(`${privilege} on ${target}`);
    }
  }
  return {
    canWrite: reasons.length > 0,
    principal,
    reasons: [...new Set(reasons)],
    notes,
    checkedAt: now(),
  };
}

// ============================================================================
// SQLite
// ============================================================================

/** SQLite has no roles: the boundary is whether the file was opened read-only. */
export function sqlitePrivileges(readOnly: boolean): PrivilegeReport {
  return {
    canWrite: !readOnly,
    principal: null,
    reasons: readOnly ? [] : ['the file is opened read-write'],
    notes: readOnly ? ['the file is opened read-only'] : [],
    checkedAt: now(),
  };
}

// ============================================================================
// The warning
// ============================================================================

/**
 * The one-line warning for a select_only database whose connection can write,
 * or null when there is nothing to warn about.
 */
export function privilegeWarning(probe: PrivilegeProbe | undefined): string | null {
  if (!isPrivilegeReport(probe) || !probe.canWrite) return null;
  const who = probe.principal === null ? '' : ` as ${probe.principal}`;
  return (
    `select_only is on, but this connection can write${who} (${probe.reasons.join('; ')}). ` +
    "Argos's filter is the only guard. Connect as a read-only role."
  );
}

/**
 * The privilege check as lines for a tool response. Nothing for a database
 * that is not select_only: full access is what it says.
 */
export function describePrivileges(
  selectOnly: boolean,
  probe: PrivilegeProbe | undefined
): string[] {
  if (!selectOnly) return [];
  if (probe === undefined)
    return ['Database role: not checked yet (it is checked when Argos connects)'];
  if (!isPrivilegeReport(probe)) return [`Database role: could not be checked (${probe.error})`];
  const notes = probe.notes.map((n) => `Note: ${n}`);
  const warning = privilegeWarning(probe);
  if (warning) return [`Warning: ${warning}`, ...notes];
  const who = probe.principal === null ? '' : ` (${probe.principal})`;
  return [`Database role: read-only${who}`, ...notes];
}

import {
  isPrivilegeReport,
  mssqlPrivileges,
  mysqlPrivileges,
  postgresPrivileges,
  privilegeWarning,
  sqlitePrivileges,
} from '../../../src/database/privileges.js';
import type { QueryResult } from '../../../src/types/database.js';

const rows = (...r: Record<string, unknown>[]): QueryResult => ({
  rows: r,
  rowCount: r.length,
  fields: Object.keys(r[0] ?? {}),
  truncated: false,
  execution_time_ms: 1,
});

const MSSQL_READER = {
  principal: 'reader@contoso.com',
  db_owner: 0,
  db_datawriter: 0,
  db_ddladmin: 0,
  sysadmin: null,
  create_table: 0,
  db_insert: 0,
  db_update: 0,
  db_delete: 0,
  writable_tables: 0,
};

describe('mssqlPrivileges', () => {
  it('reads a db_datareader as unable to write, with sysadmin NULL as on Azure SQL Database', () => {
    const report = mssqlPrivileges(rows(MSSQL_READER));
    expect(report).toMatchObject({ canWrite: false, principal: 'reader@contoso.com', reasons: [] });
  });

  it('reads the Entra admin, entering as dbo with db_owner, as able to write', () => {
    const report = mssqlPrivileges(
      rows({ ...MSSQL_READER, principal: 'dbo', db_owner: 1, create_table: 1, db_insert: 1 })
    );
    expect(report.canWrite).toBe(true);
    expect(report.principal).toBe('dbo');
    // The roles imply the database grants; they are not listed twice.
    expect(report.reasons).toEqual(['db_owner']);
  });

  it('reads dbo without db_owner membership as the database owner', () => {
    expect(mssqlPrivileges(rows({ ...MSSQL_READER, principal: 'dbo' })).reasons).toEqual([
      'database owner',
    ]);
  });

  it('lists sysadmin, db_datawriter and db_ddladmin', () => {
    const report = mssqlPrivileges(
      rows({ ...MSSQL_READER, sysadmin: 1, db_datawriter: 1, db_ddladmin: true })
    );
    expect(report.reasons).toEqual(['sysadmin', 'db_datawriter', 'db_ddladmin']);
  });

  it('catches grants made outside the fixed roles', () => {
    const report = mssqlPrivileges(
      rows({ ...MSSQL_READER, db_delete: 1, create_table: 1, writable_tables: 3 })
    );
    expect(report.reasons).toEqual([
      'DELETE on the database',
      'CREATE TABLE',
      'INSERT/UPDATE/DELETE on 3 tables',
    ]);
  });

  it('refuses an empty result instead of calling it safe', () => {
    expect(() => mssqlPrivileges(rows())).toThrow(/no row/);
  });
});

const PG_READER = {
  principal: 'reader',
  is_superuser: false,
  server_roles: '',
  writable_tables: '0',
  create_schemas: '',
  default_read_only: 'off',
};

describe('postgresPrivileges', () => {
  it('reads a role with SELECT only as unable to write', () => {
    expect(postgresPrivileges(rows(PG_READER))).toMatchObject({
      canWrite: false,
      principal: 'reader',
      reasons: [],
      notes: [],
    });
  });

  it('reads a superuser and the server-file roles as able to write', () => {
    const report = postgresPrivileges(
      rows({
        ...PG_READER,
        is_superuser: true,
        server_roles: 'pg_execute_server_program,pg_write_server_files',
      })
    );
    expect(report.canWrite).toBe(true);
    expect(report.reasons).toEqual([
      'superuser',
      'pg_execute_server_program',
      'pg_write_server_files',
    ]);
  });

  it('counts writable tables (count(*) arrives as a string) and schemas it can create in', () => {
    const report = postgresPrivileges(
      rows({ ...PG_READER, writable_tables: '1', create_schemas: 'public' })
    );
    expect(report.reasons).toEqual([
      'INSERT/UPDATE/DELETE/TRUNCATE on 1 table',
      'CREATE in schema public',
    ]);
  });

  it('notes default_transaction_read_only without treating it as a boundary', () => {
    const report = postgresPrivileges(
      rows({ ...PG_READER, writable_tables: 4, default_read_only: 'on' })
    );
    expect(report.canWrite).toBe(true);
    expect(report.notes).toEqual([
      'default_transaction_read_only is on, but a session can turn it off',
    ]);
  });
});

const grants = (user: string, ...g: string[]): QueryResult =>
  rows(...g.map((v) => ({ [`Grants for ${user}`]: v })));

describe('mysqlPrivileges', () => {
  it('reads SELECT and SHOW VIEW as unable to write', () => {
    const report = mysqlPrivileges(
      grants(
        'reader@%',
        'GRANT USAGE ON *.* TO `reader`@`%`',
        'GRANT SELECT, SHOW VIEW ON `shop`.* TO `reader`@`%`'
      )
    );
    expect(report).toMatchObject({ canWrite: false, principal: 'reader@%', reasons: [] });
  });

  it('flags anything beyond SELECT, and FILE in particular', () => {
    const report = mysqlPrivileges(
      grants(
        'app@%',
        'GRANT FILE ON *.* TO `app`@`%`',
        'GRANT SELECT, INSERT, UPDATE ON `shop`.* TO `app`@`%`'
      )
    );
    expect(report.canWrite).toBe(true);
    expect(report.reasons).toEqual([
      'FILE (reads and writes files on the server)',
      'INSERT on `shop`.*',
      'UPDATE on `shop`.*',
    ]);
  });

  it('reads ALL PRIVILEGES and column grants with their own comma lists', () => {
    const report = mysqlPrivileges(
      grants(
        'root@localhost',
        'GRANT ALL PRIVILEGES ON *.* TO `root`@`localhost` WITH GRANT OPTION',
        'GRANT SELECT (id, name), UPDATE (name) ON `shop`.`users` TO `root`@`localhost`'
      )
    );
    expect(report.reasons).toEqual(['ALL PRIVILEGES on *.*', 'UPDATE on `shop`.`users`']);
  });

  it('notes role grants it cannot expand', () => {
    const report = mysqlPrivileges(
      grants(
        'reader@%',
        'GRANT SELECT ON `shop`.* TO `reader`@`%`',
        'GRANT `ro_role`@`%` TO `reader`@`%`'
      )
    );
    expect(report.canWrite).toBe(false);
    expect(report.notes).toEqual([
      'has role `ro_role`@`%`, whose privileges this check does not expand',
    ]);
  });
});

describe('sqlitePrivileges', () => {
  it('reads a read-only file as unable to write, a read-write one as able', () => {
    expect(sqlitePrivileges(true)).toMatchObject({
      canWrite: false,
      reasons: [],
      notes: ['the file is opened read-only'],
    });
    expect(sqlitePrivileges(false)).toMatchObject({
      canWrite: true,
      reasons: ['the file is opened read-write'],
    });
  });
});

describe('privilegeWarning', () => {
  it('names the principal and the reasons, and says the filter is the only guard', () => {
    const report = mssqlPrivileges(rows({ ...MSSQL_READER, principal: 'dbo', db_owner: 1 }));
    expect(privilegeWarning(report)).toBe(
      "select_only is on, but this connection can write as dbo (db_owner). Argos's filter is the only guard. " +
        'Connect as a read-only role.'
    );
  });

  it('says nothing for a reader, a failed probe or no probe', () => {
    expect(privilegeWarning(mssqlPrivileges(rows(MSSQL_READER)))).toBeNull();
    expect(privilegeWarning({ error: 'permission denied', checkedAt: 'now' })).toBeNull();
    expect(privilegeWarning(undefined)).toBeNull();
    expect(isPrivilegeReport({ error: 'x', checkedAt: 'now' })).toBe(false);
  });
});

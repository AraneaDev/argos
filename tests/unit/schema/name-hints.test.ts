import { classifyNameError, formatCorrection } from '../../../src/schema/name-hints.js';
import type { ColumnInfo, DatabaseSchema, TableInfo } from '../../../src/types/database.js';

const withCause = (cause: unknown, message = 'adapter error'): Error =>
  new Error(message, { cause });

describe('classifyNameError', () => {
  const rows: Array<[string, unknown, unknown]> = [
    [
      'pg quoted column',
      withCause({ code: '42703', message: 'column "user_name" does not exist' }),
      { kind: 'column', name: 'user_name' },
    ],
    [
      'pg qualified column',
      withCause({ code: '42703', message: 'column u.user_name does not exist' }),
      { kind: 'column', name: 'user_name' },
    ],
    [
      'pg relation',
      withCause({ code: '42P01', message: 'relation "userz" does not exist' }),
      { kind: 'table', name: 'userz' },
    ],
    [
      'mysql column',
      withCause({
        errno: 1054,
        code: 'ER_BAD_FIELD_ERROR',
        message: "Unknown column 'u.user_name' in 'field list'",
      }),
      { kind: 'column', name: 'user_name' },
    ],
    [
      'mysql table',
      withCause({
        errno: 1146,
        code: 'ER_NO_SUCH_TABLE',
        message: "Table 'shop.userz' doesn't exist",
      }),
      { kind: 'table', name: 'userz' },
    ],
    [
      'mssql column',
      withCause({ number: 207, message: "Invalid column name 'user_name'." }),
      { kind: 'column', name: 'user_name' },
    ],
    [
      'mssql object',
      withCause({ number: 208, message: "Invalid object name 'dbo.userz'." }),
      { kind: 'table', name: 'userz' },
    ],
    [
      'sqlite column',
      withCause({ code: 'SQLITE_ERROR', message: 'SQLITE_ERROR: no such column: u.user_name' }),
      { kind: 'column', name: 'user_name' },
    ],
    [
      'sqlite table',
      withCause({ code: 'SQLITE_ERROR', message: 'SQLITE_ERROR: no such table: userz' }),
      { kind: 'table', name: 'userz' },
    ],
    [
      'message-only fallback',
      new Error(
        'postgresql adapter error: Failed to execute PostgreSQL query - column "x" does not exist'
      ),
      { kind: 'column', name: 'x' },
    ],
    [
      'batch string',
      'postgresql adapter error: Failed to execute PostgreSQL query - column "x" does not exist',
      { kind: 'column', name: 'x' },
    ],
    [
      'code without parseable name',
      withCause({ code: '42703', message: 'something unparseable' }),
      { kind: 'column', name: null },
    ],
    ['unrelated syntax error', withCause({ code: '42601', message: 'syntax error' }), null],
    ['non-error', 'not an error', null],
  ];

  it.each(rows)('%s', (_label, input, expected) => {
    expect(classifyNameError(input)).toEqual(expected);
  });
});

describe('formatCorrection', () => {
  const col = (name: string, type: string): ColumnInfo => ({
    name,
    type,
    nullable: true,
    default: null,
  });
  const table = (name: string, columns: ColumnInfo[]): TableInfo => ({
    name,
    type: 'BASE TABLE',
    columns,
  });
  const schema = {
    database: 'db',
    tables: {
      users: table('users', [
        col('id', 'integer'),
        col('username', 'text'),
        col('email', 'text'),
        col('created_at', 'timestamp'),
      ]),
      orders: table('orders', [
        col('id', 'integer'),
        col('user_id', 'integer'),
        col('total', 'numeric'),
        col('status', 'text'),
        col('created_at', 'timestamp'),
      ]),
    },
    views: {},
  } as unknown as DatabaseSchema;

  it('explains a qualified column with suggestion and column list', () => {
    const text = formatCorrection(schema, [
      { name: 'user_name', table: 'users', inScope: ['users'] },
    ]);
    expect(text).toContain('users.user_name');
    expect(text).toContain('Did you mean: username');
    expect(text).toContain('id (integer), username (text), email (text), created_at (timestamp)');
  });

  it('suggests tables without listing every table columns', () => {
    const text = formatCorrection(schema, [{ kind: 'table', name: 'userz' }]);
    expect(text).toContain('Did you mean: users');
    expect(text).not.toContain('username (text)');
  });

  it('caps columns at 40 and points to sql_get_schema', () => {
    const wide = {
      ...schema,
      tables: {
        wide: table(
          'wide',
          Array.from({ length: 45 }, (_, i) => col(`c${i}`, 'int'))
        ),
      },
    } as unknown as DatabaseSchema;
    const text = formatCorrection(wide, [{ name: 'zzz', table: null, inScope: ['wide'] }]);
    expect(text).toContain('c39 (int)');
    expect(text).not.toContain('c40 (int)');
    expect(text).toContain('5 more');
    expect(text).toContain('sql_get_schema');
  });

  it('caps tables in scope at 3', () => {
    const many = {
      ...schema,
      tables: Object.fromEntries(
        ['t1', 't2', 't3', 't4', 't5'].map((n) => [n, table(n, [col('id', 'int')])])
      ),
    } as unknown as DatabaseSchema;
    const text = formatCorrection(many, [
      { name: 'zzz', table: null, inScope: ['t1', 't2', 't3', 't4', 't5'] },
    ]);
    expect(text).toContain('t3');
    expect(text).not.toContain('Columns of t4');
    expect(text).toContain('sql_get_schema');
  });

  it('numbers statements from 1 for people', () => {
    const text = formatCorrection(schema, [
      { name: 'user_name', table: 'users', inScope: ['users'], statement: 2 },
    ]);
    expect(text).toContain('statement 3');
  });
});

import { classifyNameError } from '../../../src/schema/name-hints.js';

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

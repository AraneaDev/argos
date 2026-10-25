/**
 * Schema capture: primary keys, foreign keys and row estimates on every engine.
 * Catalog queries are answered by matching on the SQL text, so the tests do not
 * depend on the order the adapters issue them in.
 */

import { PostgreSQLAdapter } from '../../../src/database/adapters/postgresql.js';
import { MySQLAdapter } from '../../../src/database/adapters/mysql.js';
import { SQLiteAdapter } from '../../../src/database/adapters/sqlite.js';
import { MSSQLAdapter } from '../../../src/database/adapters/mssql.js';
import type { DatabaseConnection, DatabaseSchema } from '../../../src/types/index.js';

const mockPgQuery = jest.fn();
const mockMysqlExecute = jest.fn();
const mockSqliteAll = jest.fn();
const mockMssqlQuery = jest.fn();

jest.mock('pg', () => ({ Pool: jest.fn() }));
jest.mock('mysql2/promise', () => ({ createPool: jest.fn() }));
jest.mock('sqlite3', () => ({ Database: jest.fn(), OPEN_READONLY: 1, OPEN_READWRITE: 2 }));
jest.mock('mssql', () => ({ ConnectionPool: jest.fn() }));
jest.mock('@azure/identity', () => ({ AzureCliCredential: jest.fn() }));

const expectedOrders = (estimate: number | null) => ({
  primary_key: ['id'],
  foreign_keys: [{ column: 'customer_id', references: { table: 'customers', column: 'id' } }],
  row_estimate: estimate,
});

function expectOrders(schema: DatabaseSchema, estimate: number | null) {
  const orders = schema.tables.orders;
  expect(orders).toMatchObject(expectedOrders(estimate));
  expect(orders.columns[0].key).toBe('PRI');
  expect(orders.columns[1].key).not.toBe('PRI');
}

describe('schema capture keys, relations and row estimates', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('PostgreSQL', () => {
    const adapter = new PostgreSQLAdapter({
      type: 'postgresql',
      host: 'h',
      port: 5432,
      database: 'db',
      username: 'u',
      password: 'p',
    });
    const connection = { query: mockPgQuery } as unknown as DatabaseConnection;
    const col = (name: string) => ({
      column_name: name,
      data_type: 'integer',
      is_nullable: 'NO',
      column_default: null,
    });

    const route = (reltuples: unknown) =>
      mockPgQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('table_constraints')) {
          return {
            rows: [
              { constraint_type: 'PRIMARY KEY', table_name: 'orders', column_name: 'id' },
              {
                constraint_type: 'FOREIGN KEY',
                table_name: 'orders',
                column_name: 'customer_id',
                foreign_table_name: 'customers',
                foreign_column_name: 'id',
              },
            ],
          };
        }
        if (sql.includes('reltuples')) {
          return { rows: [{ table_name: 'orders', row_estimate: reltuples }] };
        }
        if (sql.includes('information_schema.columns')) {
          return { rows: [col('id'), col('customer_id')] };
        }
        return { rows: [{ table_name: 'orders', table_type: 'BASE TABLE', table_comment: '' }] };
      });

    it('captures primary key, foreign key and reltuples', async () => {
      route(1234);
      expectOrders(await adapter.captureSchema(connection), 1234);
    });

    it('turns a never-analyzed reltuples of -1 into null', async () => {
      route(-1);
      const schema = await adapter.captureSchema(connection);
      expect(schema.tables.orders.row_estimate).toBeNull();
    });
  });

  describe('MySQL', () => {
    const adapter = new MySQLAdapter({
      type: 'mysql',
      host: 'h',
      port: 3306,
      database: 'db',
      username: 'u',
      password: 'p',
    });
    const connection = { execute: mockMysqlExecute } as unknown as DatabaseConnection;
    const col = (name: string, key: string) => ({
      COLUMN_NAME: name,
      DATA_TYPE: 'int',
      IS_NULLABLE: 'NO',
      COLUMN_DEFAULT: null,
      COLUMN_KEY: key,
    });

    it('captures primary key, foreign key and TABLE_ROWS', async () => {
      mockMysqlExecute.mockImplementation(async (sql: string) => {
        if (sql.includes('KEY_COLUMN_USAGE')) {
          return [
            [
              {
                TABLE_NAME: 'orders',
                COLUMN_NAME: 'id',
                CONSTRAINT_NAME: 'PRIMARY',
                REFERENCED_TABLE_NAME: null,
                REFERENCED_COLUMN_NAME: null,
              },
              {
                TABLE_NAME: 'orders',
                COLUMN_NAME: 'customer_id',
                CONSTRAINT_NAME: 'fk_customer',
                REFERENCED_TABLE_NAME: 'customers',
                REFERENCED_COLUMN_NAME: 'id',
              },
            ],
          ];
        }
        if (sql.includes('TABLE_ROWS')) return [[{ TABLE_NAME: 'orders', TABLE_ROWS: 42 }]];
        if (sql.includes('information_schema.COLUMNS')) {
          return [[col('id', 'PRI'), col('customer_id', 'MUL')]];
        }
        return [[{ TABLE_NAME: 'orders', TABLE_TYPE: 'BASE TABLE', TABLE_COMMENT: '' }]];
      });
      expectOrders(await adapter.captureSchema(connection), 42);
    });
  });

  describe('SQLite', () => {
    const adapter = new SQLiteAdapter({ type: 'sqlite', file: '/tmp/x.db' });
    const connection = { all: mockSqliteAll } as unknown as DatabaseConnection;
    const col = (cid: number, name: string, pk: number) => ({
      cid,
      name,
      type: 'INTEGER',
      notnull: 0,
      dflt_value: null,
      pk,
    });

    it('captures primary key, foreign key and a null estimate', async () => {
      mockSqliteAll.mockImplementation((sql: string, cb: Function) => {
        let rows: unknown[] = [];
        if (sql.includes('foreign_key_list')) {
          rows = [{ id: 0, seq: 0, table: 'customers', from: 'customer_id', to: 'id' }];
        } else if (sql.includes('table_info')) {
          rows = [col(0, 'id', 1), col(1, 'customer_id', 0)];
        } else if (sql.includes('sqlite_master')) {
          rows = [{ name: 'orders', type: 'table' }];
        }
        process.nextTick(() => cb(null, rows));
      });
      expectOrders(await adapter.captureSchema(connection), null);
    });

    it('marks every column of a composite primary key as PRI', async () => {
      mockSqliteAll.mockImplementation((sql: string, cb: Function) => {
        let rows: unknown[] = [];
        if (sql.includes('table_info')) rows = [col(0, 'a', 1), col(1, 'b', 2)];
        else if (sql.includes('sqlite_master')) rows = [{ name: 'pair', type: 'table' }];
        process.nextTick(() => cb(null, rows));
      });
      const schema = await adapter.captureSchema(connection);
      expect(schema.tables.pair.primary_key).toEqual(['a', 'b']);
      expect(schema.tables.pair.columns.map((c) => c.key)).toEqual(['PRI', 'PRI']);
    });
  });

  describe('MSSQL', () => {
    const adapter = new MSSQLAdapter({
      type: 'mssql',
      host: 'h',
      port: 1433,
      database: 'db',
      username: 'u',
      password: 'p',
    });
    const request = { input: jest.fn().mockReturnThis(), query: mockMssqlQuery };
    const connection = { request: () => request } as unknown as DatabaseConnection;
    const col = (name: string, key: string) => ({
      COLUMN_NAME: name,
      DATA_TYPE: 'int',
      IS_NULLABLE: 'NO',
      COLUMN_DEFAULT: null,
      COLUMN_KEY: key,
    });

    it('captures primary key, foreign key and sys.partitions rows', async () => {
      mockMssqlQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('is_primary_key')) {
          return { recordset: [{ table_name: 'orders', column_name: 'id' }] };
        }
        if (sql.includes('foreign_key_columns')) {
          return {
            recordset: [
              {
                table_name: 'orders',
                column_name: 'customer_id',
                referenced_table: 'customers',
                referenced_column: 'id',
              },
            ],
          };
        }
        if (sql.includes('sys.partitions')) {
          return { recordset: [{ table_name: 'orders', row_estimate: 7 }] };
        }
        if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
          return { recordset: [col('id', 'PRI'), col('customer_id', '')] };
        }
        return {
          recordset: [{ TABLE_NAME: 'orders', TABLE_TYPE: 'BASE TABLE', TABLE_COMMENT: '' }],
        };
      });
      expectOrders(await adapter.captureSchema(connection), 7);
    });
  });
});

import { diffSchemas, formatSchemaChanges } from '../../../src/schema/diff.js';
import type { DatabaseSchema, TableInfo } from '../../../src/types/database.js';

const col = (name: string, type: string) => ({ name, type, nullable: true, default: null });
const tbl = (name: string, cols: [string, string][], type = 'BASE TABLE'): TableInfo => ({
  name,
  type,
  columns: cols.map(([n, t]) => col(n, t)),
});
const schema = (tables: TableInfo[], views: TableInfo[] = []): DatabaseSchema => ({
  database: 'd',
  type: 'postgresql',
  captured_at: 'now',
  tables: Object.fromEntries(tables.map((t) => [t.name, t])),
  views: Object.fromEntries(views.map((t) => [t.name, t])),
  summary: { table_count: tables.length, view_count: views.length, total_columns: 0 },
});

describe('diffSchemas / formatSchemaChanges', () => {
  it('reports a column added and a table dropped', () => {
    const before = schema([tbl('orders', [['id', 'int']]), tbl('legacy_users', [['id', 'int']])]);
    const after = schema([
      tbl('orders', [
        ['id', 'int'],
        ['shipped_at', 'timestamptz'],
      ]),
    ]);
    expect(formatSchemaChanges(diffSchemas(before, after))).toBe(
      'Schema changed since last look: orders + shipped_at (timestamptz); legacy_users dropped.'
    );
  });

  it('returns nothing when unchanged, ignoring key metadata', () => {
    const a = schema([tbl('t', [['id', 'int']])]);
    const b = schema([{ ...tbl('t', [['id', 'int']]), primary_key: ['id'], row_estimate: 5 }]);
    expect(diffSchemas(a, b)).toEqual([]);
    expect(formatSchemaChanges([])).toBe('');
  });

  it('reports a type change and a dropped column', () => {
    const before = schema([
      tbl('orders', [
        ['total', 'numeric'],
        ['x', 'int'],
      ]),
    ]);
    const after = schema([tbl('orders', [['total', 'text']])]);
    expect(diffSchemas(before, after)).toEqual([
      { kind: 'column-changed', table: 'orders', column: 'total', from: 'numeric', to: 'text' },
      { kind: 'column-dropped', table: 'orders', column: 'x' },
    ]);
    expect(formatSchemaChanges(diffSchemas(before, after))).toBe(
      'Schema changed since last look: orders.total numeric → text; orders - x.'
    );
  });

  it('truncates after 8 items', () => {
    const cols = Array.from({ length: 10 }, (_, i) => [`c${i}`, 'int'] as [string, string]);
    const out = formatSchemaChanges(diffSchemas(schema([tbl('t', [])]), schema([tbl('t', cols)])));
    expect(out.endsWith('; +2 more.')).toBe(true);
    expect(out).toContain('t + c7 (int)');
    expect(out).not.toContain('c8');
  });

  it('counts an added view as table-added', () => {
    const changes = diffSchemas(schema([]), schema([], [tbl('v', [['a', 'int']], 'VIEW')]));
    expect(changes).toEqual([{ kind: 'table-added', table: 'v' }]);
  });
});

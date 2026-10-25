import type { DatabaseSchema, TableInfo } from '../types/database.js';

export type SchemaChange =
  | { kind: 'table-added' | 'table-dropped'; table: string }
  | { kind: 'column-added'; table: string; column: string; type: string }
  | { kind: 'column-dropped'; table: string; column: string }
  | { kind: 'column-changed'; table: string; column: string; from: string; to: string };

const MAX_LISTED = 8;

function relations(schema: DatabaseSchema): Map<string, TableInfo> {
  return new Map<string, TableInfo>([
    ...Object.entries(schema.tables ?? {}),
    ...Object.entries(schema.views ?? {}),
  ]);
}

/** Compare tables and views by name, columns by name and type. Key metadata is ignored. */
export function diffSchemas(before: DatabaseSchema, after: DatabaseSchema): SchemaChange[] {
  const a = relations(before);
  const b = relations(after);
  const names = [...new Set([...a.keys(), ...b.keys()])].sort();
  const changes: SchemaChange[] = [];
  const added: SchemaChange[] = [];
  const dropped: SchemaChange[] = [];

  for (const table of names) {
    const old = a.get(table);
    const next = b.get(table);
    if (!old) {
      added.push({ kind: 'table-added', table });
      continue;
    }
    if (!next) {
      dropped.push({ kind: 'table-dropped', table });
      continue;
    }
    const oldCols = new Map(old.columns.map((c) => [c.name, c]));
    const newCols = new Map(next.columns.map((c) => [c.name, c]));
    for (const col of next.columns) {
      const prev = oldCols.get(col.name);
      if (!prev) {
        changes.push({ kind: 'column-added', table, column: col.name, type: col.type });
      } else if (prev.type !== col.type) {
        changes.push({
          kind: 'column-changed',
          table,
          column: col.name,
          from: prev.type,
          to: col.type,
        });
      }
    }
    for (const col of old.columns) {
      if (!newCols.has(col.name)) {
        changes.push({ kind: 'column-dropped', table, column: col.name });
      }
    }
  }
  // Column changes in surviving tables come first, then whole tables added, then dropped.
  return [...changes, ...added, ...dropped];
}

function describe(c: SchemaChange): string {
  switch (c.kind) {
    case 'table-added':
      return `${c.table} added`;
    case 'table-dropped':
      return `${c.table} dropped`;
    case 'column-added':
      return `${c.table} + ${c.column} (${c.type})`;
    case 'column-dropped':
      return `${c.table} - ${c.column}`;
    case 'column-changed':
      return `${c.table}.${c.column} ${c.from} → ${c.to}`;
  }
}

/**
 *
 */
export function formatSchemaChanges(changes: SchemaChange[]): string {
  if (changes.length === 0) return '';
  const shown = changes.slice(0, MAX_LISTED).map(describe).join('; ');
  const more = changes.length > MAX_LISTED ? `; +${changes.length - MAX_LISTED} more` : '';
  return `Schema changed since last look: ${shown}${more}.`;
}

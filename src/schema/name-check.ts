/**
 * Pre-flight checks of table/column names against the cached schema, plus the
 * fuzzy matching used to suggest corrections.
 */

import type { DatabaseSchema, DatabaseTypeString } from '../types/database.js';
import { scanSql, type TableRef } from './sql-scan.js';

export interface NameProblem {
  /** The wrong column as written (unquoted). */
  name: string;
  /** Known table it was qualified with; null for a bare column. */
  table: string | null;
  /** Known tables whose columns to list (cache keys). */
  inScope: string[];
  /** 0-based batch index, set by the batch handler. */
  statement?: number;
}

function normalize(name: string): string {
  const base = name.toLowerCase().replace(/_/g, '');
  return base.length > 1 && base.endsWith('s') ? base.slice(0, -1) : base;
}

/** Edit distance where swapping two adjacent letters counts as one edit. */
function levenshtein(a: string, b: string): number {
  let before: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j], before[j - 2] + 1);
      }
    }
    before = prev;
    prev = row;
  }
  return prev[b.length];
}

/** Closest candidates to `wrong`, best first; empty when nothing is close. */
export function suggest(wrong: string, candidates: string[], max = 3): string[] {
  const target = normalize(wrong);
  const limit = Math.max(1, Math.floor(target.length / 3));
  return candidates
    .map((candidate) => ({ candidate, score: levenshtein(target, normalize(candidate)) }))
    .filter((entry) => entry.score <= limit)
    .sort((a, b) => a.score - b.score)
    .slice(0, max)
    .map((entry) => entry.candidate);
}

/** The schema an unqualified table name resolves to on each engine. */
export function defaultSchemaFor(
  type: DatabaseTypeString,
  database: string | undefined
): string | null {
  switch (type) {
    case 'postgresql':
    case 'postgres':
      return 'public';
    case 'mssql':
    case 'sqlserver':
      return 'dbo';
    case 'mysql':
      return database ?? null;
    case 'sqlite':
      return 'main';
  }
}

/** Columns every row has without being declared, so the cache never lists them. */
const HIDDEN_COLUMNS = new Set(
  'rowid oid _rowid_ _rowid ctid xmin xmax cmin cmax tableoid'.split(' ')
);

/** Cache key for a table ref, or null when it isn't certainly a cached table or view. */
function resolveTable(
  ref: TableRef,
  schema: DatabaseSchema,
  defaultSchema: string | null,
  ctes: Set<string>
): string | null {
  if (ref.schema !== null && ref.schema.toLowerCase() !== defaultSchema?.toLowerCase()) return null;
  if (ctes.has(ref.name.toLowerCase())) return null;
  const keys = [...Object.keys(schema.tables), ...Object.keys(schema.views ?? {})];
  if (ref.quoted && keys.includes(ref.name)) return isVirtual(schema, ref.name) ? null : ref.name;
  const matches = keys.filter((k) => k.toLowerCase() === ref.name.toLowerCase());
  // Two tables differing only in case: can't tell which one is meant.
  return matches.length === 1 && !isVirtual(schema, matches[0]) ? matches[0] : null;
}

/** A virtual table (SQLite FTS and the like) has hidden columns the cache doesn't list. */
function isVirtual(schema: DatabaseSchema, key: string): boolean {
  return (schema.tables[key] ?? schema.views?.[key])?.type === 'VIRTUAL TABLE';
}

function hasColumn(schema: DatabaseSchema, key: string, name: string): boolean {
  const info = schema.tables[key] ?? schema.views?.[key];
  const lower = name.toLowerCase();
  return !!info && info.columns.some((c) => c.name.toLowerCase() === lower);
}

/** Cache keys of the known tables and views a query names; empty when it can't be scanned. */
export function knownTables(
  sql: string,
  schema: DatabaseSchema,
  defaultSchema: string | null
): string[] {
  const scan = scanSql(sql);
  if (!scan.checkable) return [];
  const ctes = new Set(scan.ctes.map((c) => c.toLowerCase()));
  const keys = scan.tables.map((ref) => resolveTable(ref, schema, defaultSchema, ctes));
  return [...new Set(keys.filter((k): k is string => k !== null))];
}

/**
 * Columns the query names that certainly don't exist. Anything uncertain (an
 * unknown table, a shadowed alias, a statement the scanner can't place) gives
 * no problem, so a valid query is never blocked.
 */
export function checkNames(
  sql: string,
  schema: DatabaseSchema,
  defaultSchema: string | null
): NameProblem[] {
  const scan = scanSql(sql);
  if (!scan.checkable) return [];
  const ctes = new Set(scan.ctes.map((c) => c.toLowerCase()));
  const keys = scan.tables.map((ref) => resolveTable(ref, schema, defaultSchema, ctes));
  const inScope = [...new Set(keys.filter((k): k is string => k !== null))];

  // Qualifier → cache key; null when unknown, shadowed, or bound to two tables.
  const qualifiers = new Map<string, string | null>();
  const bind = (qualifier: string, key: string | null) => {
    const q = qualifier.toLowerCase();
    qualifiers.set(q, qualifiers.has(q) && qualifiers.get(q) !== key ? null : key);
  };
  scan.tables.forEach((ref, i) => bind(ref.alias ?? ref.name, keys[i]));
  for (const name of [...scan.ctes, ...scan.derivedAliases]) bind(name, null);

  const problems: NameProblem[] = [];
  const seen = new Set<string>();
  const report = (name: string, table: string | null) => {
    const id = `${table ?? ''}.${name.toLowerCase()}`;
    if (seen.has(id)) return;
    seen.add(id);
    problems.push({ name, table, inScope });
  };

  for (const col of scan.qualified) {
    if (!col.qualifier || HIDDEN_COLUMNS.has(col.name.toLowerCase())) continue;
    const key = qualifiers.get(col.qualifier.toLowerCase());
    if (key && !hasColumn(schema, key, col.name)) report(col.name, key);
  }

  const allKnown = keys.length > 0 && keys.every((k) => k !== null);
  if (scan.simple && allKnown) {
    // MySQL and SQLite read "x" as a string literal.
    const quotedIsString = schema.type === 'mysql' || schema.type === 'sqlite';
    for (const col of scan.bare) {
      const lower = col.name.toLowerCase();
      if (col.quoted && quotedIsString) continue;
      // A bare table name or alias is a whole-row reference.
      if (HIDDEN_COLUMNS.has(lower) || qualifiers.has(lower)) continue;
      if (inScope.every((key) => !hasColumn(schema, key, col.name))) report(col.name, null);
    }
  }
  return problems;
}

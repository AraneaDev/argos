/**
 * Recognize "unknown table/column" errors from the supported drivers so callers
 * can offer a correction instead of just relaying the driver message.
 */

import type { DatabaseSchema, TableInfo } from '../types/database.js';
import { suggest, type NameProblem } from './name-check.js';

export type NameErrorKind = 'column' | 'table';

export interface NameErrorInfo {
  kind: NameErrorKind;
  /** The offending name without quotes or qualifier, or null when it can't be parsed. */
  name: string | null;
}

const COLUMN_CODES = new Set(['42703', '1054', 'ER_BAD_FIELD_ERROR', '207']);
const TABLE_CODES = new Set(['42P01', '1146', 'ER_NO_SUCH_TABLE', '208']);

const COLUMN_PATTERNS: RegExp[] = [
  /column\s+(\S+?)(?:\s+of relation\s+\S+)?\s+does not exist/i,
  /Unknown column '([^']+)'/i,
  /Invalid column name '([^']+)'/i,
  /no such column:\s*(\S+)/i,
];

const TABLE_PATTERNS: RegExp[] = [
  /relation\s+(\S+)\s+does not exist/i,
  /Table '([^']+)' doesn't exist/i,
  /Invalid object name '([^']+)'/i,
  /no such table:\s*(\S+)/i,
];

function messageOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '';
}

function codesOf(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const { code, errno, number } = value as Record<string, unknown>;
  return [code, errno, number]
    .filter((v) => typeof v === 'string' || typeof v === 'number')
    .map((v) => String(v));
}

function extractName(patterns: RegExp[], messages: string[]): string | null {
  for (const message of messages) {
    for (const pattern of patterns) {
      const match = pattern.exec(message);
      if (match) {
        const parts = match[1].replace(/["'`[\]]/g, '').split('.');
        const name = parts[parts.length - 1];
        if (name) return name;
      }
    }
  }
  return null;
}

/**
 * Classify an error (or batch error string) as an unknown column/table error.
 * Looks at the error and one level of `cause`; driver codes win over messages.
 */
export function classifyNameError(error: unknown): NameErrorInfo | null {
  const candidates: unknown[] = [error];
  if (error && typeof error === 'object' && 'cause' in error) {
    candidates.push((error as { cause?: unknown }).cause);
  }
  const messages = candidates.map(messageOf).filter(Boolean);

  let kind: NameErrorKind | null = null;
  for (const candidate of candidates) {
    for (const code of codesOf(candidate)) {
      if (COLUMN_CODES.has(code)) kind = 'column';
      else if (TABLE_CODES.has(code)) kind = 'table';
      if (kind) break;
    }
    if (kind) break;
  }

  if (!kind) {
    for (const message of messages) {
      if (COLUMN_PATTERNS.some((p) => p.test(message))) kind = 'column';
      else if (TABLE_PATTERNS.some((p) => p.test(message))) kind = 'table';
      if (kind) break;
    }
  }
  if (!kind) return null;

  return {
    kind,
    name: extractName(kind === 'column' ? COLUMN_PATTERNS : TABLE_PATTERNS, messages),
  };
}

export type Correction =
  | NameProblem
  | { kind: 'table'; name: string | null }
  | { kind: 'column'; name: string | null; inScope: string[] };

const MAX_TABLES = 3;
const MAX_COLUMNS = 40;

function lookupTable(schema: DatabaseSchema, key: string): TableInfo | undefined {
  return schema.tables[key] ?? schema.views?.[key];
}

function describeTable(schema: DatabaseSchema, key: string): string {
  const info = lookupTable(schema, key);
  if (!info) return `Columns of ${key}: unknown`;
  const shown = info.columns.slice(0, MAX_COLUMNS).map((c) => `${c.name} (${c.type})`);
  const extra = info.columns.length - shown.length;
  const more = extra > 0 ? `, ... ${extra} more (use sql_get_schema for the full list)` : '';
  return `Columns of ${key}: ${shown.join(', ')}${more}`;
}

function formatOne(schema: DatabaseSchema, item: Correction): string[] {
  const lines: string[] = [];
  const where =
    'statement' in item && item.statement !== undefined
      ? ` in statement ${item.statement + 1}`
      : '';

  if ('kind' in item && item.kind === 'table') {
    const known = [...Object.keys(schema.tables), ...Object.keys(schema.views ?? {})];
    lines.push(`Table ${item.name ?? '(unknown)'} does not exist${where}.`);
    const hints = item.name ? suggest(item.name, known) : [];
    if (hints.length > 0) lines.push(`Did you mean: ${hints.join(', ')}`);
    else lines.push('Use sql_get_schema to see the available tables.');
    return lines;
  }

  const name = item.name ?? '(unknown)';
  const table = 'table' in item ? item.table : null;
  lines.push(`Column ${table ? `${table}.` : ''}${name} does not exist${where}.`);

  const scope = table ? [table] : item.inScope;
  const shownTables = scope.slice(0, MAX_TABLES);
  const pool = (table ? [table] : shownTables).flatMap(
    (key) => lookupTable(schema, key)?.columns.map((c) => c.name) ?? []
  );
  const hints = item.name ? suggest(item.name, [...new Set(pool)]) : [];
  if (hints.length > 0) lines.push(`Did you mean: ${hints.join(', ')}`);

  for (const key of shownTables) lines.push(describeTable(schema, key));
  if (scope.length > shownTables.length) {
    lines.push(
      `... ${scope.length - shownTables.length} more tables in scope (use sql_get_schema to see them)`
    );
  }
  return lines;
}

/**
 * Build a plain-text correction (names and types only, never row data). Callers
 * append it after sanitizing the driver error, so it is not sanitized here.
 */
export function formatCorrection(schema: DatabaseSchema, items: Correction[]): string {
  return items.flatMap((item) => formatOne(schema, item)).join('\n');
}

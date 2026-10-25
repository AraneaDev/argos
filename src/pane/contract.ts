import type { SchemaChange } from '../schema/diff.js';

export type Source = 'claude' | 'pane';
export type Outcome = 'ok' | 'error' | 'blocked';

export interface JournalEntry {
  id: string;
  at: string;
  source: Source;
  database: string;
  tool: 'sql_query' | 'sql_batch_query' | 'sql_analyze_performance' | 'pane_query';
  sql: string;
  batchId?: string;
  durationMs: number | null;
  rowCount: number | null;
  outcome: Outcome;
  reason?: string;
  schemaChange?: SchemaChange[];
  spool: string | null;
}

export interface SpoolPage {
  id: string;
  fields: string[];
  rows: unknown[][];
  total: number;
  offset: number;
  truncated: boolean;
}

export interface Pin {
  id: string;
  name: string | null;
  database: string;
  sql: string;
  createdAt: string;
  lastJournalId: string | null;
}

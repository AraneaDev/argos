import type { SchemaChange } from '../schema/diff.js';
import type { TableInfo } from '../types/database.js';

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
  /** Claude passed bound parameters; the SQL alone cannot be rerun faithfully. */
  hasParams?: boolean;
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

export interface ConnectionView {
  name: string;
  type: string;
  host: string | null;
  ssh: boolean;
  ssl: boolean;
  selectOnly: boolean;
  mcpConfigurable: boolean;
  schemaCapturedAt: string | null;
  /** The server's last check of a select_only connection's database role; null when none ran. */
  role: RoleView | null;
}

/**
 * What the database role may do, as the MCP server last found it. `canWrite` is
 * null when the check could not run.
 */
export interface RoleView {
  checkedAt: string;
  canWrite: boolean | null;
  principal: string | null;
  reasons: string[];
}

export interface SchemaView {
  database: string;
  type: string;
  capturedAt: string | null;
  tables: TableInfo[];
  views: TableInfo[];
  lastChange: SchemaChange[] | null;
}

export type CliError = { error: string };

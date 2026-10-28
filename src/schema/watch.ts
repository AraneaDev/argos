import type { ConnectionManager } from '../classes/ConnectionManager.js';
import type { SchemaManager } from '../classes/SchemaManager.js';
import type { DatabaseConfig } from '../types/index.js';
import { getLogger } from '../utils/logger.js';
import { diffSchemas, type SchemaChange } from './diff.js';

/** Where the last check time is shared between processes (the pane store in `.argos/`). */
export interface FingerprintChecks {
  fingerprintCheckedAt(database: string): Promise<number | undefined>;
  recordFingerprintCheck(database: string, at: number): Promise<void>;
}

/**
 * Notices schema changes on an already-open connection. Rate-limited per connection,
 * no timers: callers invoke `check` around a query they are running anyway. With shared
 * check times the limit holds across processes (the MCP server and each pane CLI run).
 */
export class SchemaWatch {
  private lastCheck = new Map<string, number>();
  private logger = getLogger();

  constructor(
    private readonly cm: ConnectionManager,
    private readonly sm: SchemaManager,
    private readonly now: () => number = Date.now,
    private readonly intervalMs = 60_000,
    private readonly shared: () => FingerprintChecks | null = () => null
  ) {}

  /** Newest check time known here or (when ours is due) recorded by another process. */
  private async lastChecked(dbName: string, t: number): Promise<number | undefined> {
    const mine = this.lastCheck.get(dbName);
    if (mine !== undefined && t - mine < this.intervalMs) return mine;
    let theirs: number | undefined;
    try {
      theirs = await this.shared()?.fingerprintCheckedAt(dbName);
    } catch {
      return mine; // unreadable shared state never blocks a check
    }
    if (theirs !== undefined && (mine === undefined || theirs > mine)) {
      this.lastCheck.set(dbName, theirs);
      return theirs;
    }
    return mine;
  }

  private async recordCheck(dbName: string, t: number): Promise<void> {
    this.lastCheck.set(dbName, t);
    try {
      await this.shared()?.recordFingerprintCheck(dbName, t);
    } catch (error) {
      this.logger.warning('Could not record schema check time', {
        database: dbName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Returns [] when skipped, unchanged, first seen or failed. Never throws.
   * `force` bypasses only the rate limit; it still records the check time.
   */
  async check(
    dbName: string,
    _config: DatabaseConfig,
    opts: { force?: boolean } = {}
  ): Promise<SchemaChange[]> {
    try {
      const t = this.now();
      const last = await this.lastChecked(dbName, t);
      if (!opts.force && last !== undefined && t - last < this.intervalMs) return [];
      if (!this.cm.isConnected(dbName)) return [];

      const cached = this.sm.getSchema(dbName);
      if (!cached) return [];

      await this.recordCheck(dbName, t);
      const current = await this.cm.schemaFingerprint(dbName);

      if (!cached.fingerprint) {
        await this.sm.setFingerprint(dbName, current);
        return [];
      }
      if (cached.fingerprint === current) return [];

      const refreshed = await this.sm.refreshSchema(dbName);
      return diffSchemas(cached, refreshed);
    } catch (error) {
      this.logger.warning('Schema change check failed', {
        database: dbName,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}

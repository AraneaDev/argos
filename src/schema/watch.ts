import type { ConnectionManager } from '../classes/ConnectionManager.js';
import type { SchemaManager } from '../classes/SchemaManager.js';
import type { DatabaseConfig } from '../types/index.js';
import { getLogger } from '../utils/logger.js';
import { diffSchemas, type SchemaChange } from './diff.js';

/**
 * Notices schema changes on an already-open connection. Rate-limited per connection,
 * no timers: callers invoke `check` around a query they are running anyway.
 */
export class SchemaWatch {
  private lastCheck = new Map<string, number>();
  private logger = getLogger();

  constructor(
    private readonly cm: ConnectionManager,
    private readonly sm: SchemaManager,
    private readonly now: () => number = Date.now,
    private readonly intervalMs = 60_000
  ) {}

  /** Returns [] when skipped, unchanged, first seen or failed. Never throws. */
  async check(dbName: string, _config: DatabaseConfig): Promise<SchemaChange[]> {
    try {
      const last = this.lastCheck.get(dbName);
      const t = this.now();
      if (last !== undefined && t - last < this.intervalMs) return [];
      if (!this.cm.isConnected(dbName)) return [];

      const cached = this.sm.getSchema(dbName);
      if (!cached) return [];

      this.lastCheck.set(dbName, t);
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

// src/classes/MetricsManager.ts
export interface LatencyStats {
  min: number;
  max: number;
  avg: number;
  p95: number;
  count: number;
}

export interface MetricsSnapshot {
  database: string;
  uptime: number;
  queries: { total: number; success: number; failed: number };
  latency: LatencyStats;
  errors: Record<string, number>;
  circuit: { events: Array<{ ts: number; event: string }> };
  cache: { hits: number; misses: number; hitRate: number };
}

const LATENCY_WINDOW = 1000;

interface DBMetrics {
  latencies: number[];
  queries: { total: number; success: number; failed: number };
  errors: Record<string, number>;
  circuitEvents: Array<{ ts: number; event: string }>;
  cacheHits: number;
  cacheMisses: number;
  startedAt: number;
}

function emptyMetrics(): DBMetrics {
  return {
    latencies: [],
    queries: { total: 0, success: 0, failed: 0 },
    errors: {},
    circuitEvents: [],
    cacheHits: 0,
    cacheMisses: 0,
    startedAt: Date.now(),
  };
}

function computeLatencyStats(latencies: number[]): LatencyStats {
  if (latencies.length === 0) return { min: 0, max: 0, avg: 0, p95: 0, count: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const p95Idx = Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: Math.round(sum / sorted.length),
    p95: sorted[p95Idx],
    count: sorted.length,
  };
}

/**
 *
 */
export class MetricsManager {
  private readonly dbs = new Map<string, DBMetrics>();

  private getOrCreate(dbName: string): DBMetrics {
    let m = this.dbs.get(dbName);
    if (!m) {
      m = emptyMetrics();
      this.dbs.set(dbName, m);
    }
    return m;
  }

  /**
   *
   */
  recordQuery(dbName: string, durationMs: number, success: boolean, errorCategory?: string): void {
    const m = this.getOrCreate(dbName);
    m.queries.total++;
    if (success) {
      m.queries.success++;
    } else {
      m.queries.failed++;
      if (errorCategory) m.errors[errorCategory] = (m.errors[errorCategory] ?? 0) + 1;
    }
    m.latencies.push(durationMs);
    if (m.latencies.length > LATENCY_WINDOW) m.latencies.shift();
  }

  /**
   *
   */
  recordCircuitEvent(dbName: string, event: 'open' | 'closed' | 'half_open'): void {
    this.getOrCreate(dbName).circuitEvents.push({ ts: Date.now(), event });
  }

  /**
   *
   */
  recordCacheHit(dbName: string): void {
    this.getOrCreate(dbName).cacheHits++;
  }
  /**
   *
   */
  recordCacheMiss(dbName: string): void {
    this.getOrCreate(dbName).cacheMisses++;
  }

  /**
   *
   */
  getSnapshot(dbName: string): MetricsSnapshot;
  /**
   *
   */
  getSnapshot(): MetricsSnapshot[];
  /**
   *
   */
  getSnapshot(dbName?: string): MetricsSnapshot | MetricsSnapshot[] {
    if (dbName !== undefined) return this.buildSnapshot(dbName, this.getOrCreate(dbName));
    return [...this.dbs.entries()].map(([name, m]) => this.buildSnapshot(name, m));
  }

  private buildSnapshot(database: string, m: DBMetrics): MetricsSnapshot {
    const total = m.cacheHits + m.cacheMisses;
    return {
      database,
      uptime: Date.now() - m.startedAt,
      queries: { ...m.queries },
      latency: computeLatencyStats(m.latencies),
      errors: { ...m.errors },
      circuit: { events: [...m.circuitEvents] },
      cache: {
        hits: m.cacheHits,
        misses: m.cacheMisses,
        hitRate: total === 0 ? 0 : m.cacheHits / total,
      },
    };
  }
}

// tests/unit/metrics-manager.test.ts
import { MetricsManager } from '../../src/classes/MetricsManager.js';

describe('MetricsManager', () => {
  let m: MetricsManager;
  beforeEach(() => {
    m = new MetricsManager();
  });

  describe('recordQuery', () => {
    it('increments total and success counts', () => {
      m.recordQuery('db1', 100, true);
      m.recordQuery('db1', 200, true);
      const snap = m.getSnapshot('db1');
      expect(snap.queries.total).toBe(2);
      expect(snap.queries.success).toBe(2);
      expect(snap.queries.failed).toBe(0);
    });
    it('increments failed count and error category on failure', () => {
      m.recordQuery('db1', 50, false, 'CONNECTION');
      const snap = m.getSnapshot('db1');
      expect(snap.queries.failed).toBe(1);
      expect(snap.errors['CONNECTION']).toBe(1);
    });
    it('keeps latency rolling window at max 1000 entries', () => {
      for (let i = 0; i < 1100; i++) m.recordQuery('db1', i % 100, true);
      const snap = m.getSnapshot('db1');
      expect(snap.latency.count).toBe(1000);
    });
  });

  describe('computeLatencyStats / p95', () => {
    it('computes p95 correctly for known sequence', () => {
      for (let i = 1; i <= 100; i++) m.recordQuery('db1', i, true);
      const snap = m.getSnapshot('db1');
      expect(snap.latency.p95).toBe(96);
      expect(snap.latency.min).toBe(1);
      expect(snap.latency.max).toBe(100);
      expect(snap.latency.avg).toBe(51);
    });
    it('returns zeros for empty latency window', () => {
      const snap = m.getSnapshot('db1');
      expect(snap.latency).toEqual({ min: 0, max: 0, avg: 0, p95: 0, count: 0 });
    });
  });

  describe('recordCircuitEvent', () => {
    it('records circuit events with timestamps', () => {
      m.recordCircuitEvent('db1', 'open');
      m.recordCircuitEvent('db1', 'half_open');
      const snap = m.getSnapshot('db1');
      expect(snap.circuit.events).toHaveLength(2);
      expect(snap.circuit.events[0].event).toBe('open');
    });
  });

  describe('recordCacheHit / recordCacheMiss', () => {
    it('computes hit rate correctly', () => {
      m.recordCacheHit('db1');
      m.recordCacheHit('db1');
      m.recordCacheMiss('db1');
      const snap = m.getSnapshot('db1');
      expect(snap.cache.hits).toBe(2);
      expect(snap.cache.misses).toBe(1);
      expect(snap.cache.hitRate).toBeCloseTo(0.667, 2);
    });
  });

  describe('getSnapshot', () => {
    it('returns all-DB snapshot when no dbName given', () => {
      m.recordQuery('db1', 100, true);
      m.recordQuery('db2', 200, true);
      const all = m.getSnapshot();
      expect(all).toHaveLength(2);
    });
    it('returns single-DB snapshot', () => {
      m.recordQuery('db1', 100, true);
      const snap = m.getSnapshot('db1');
      expect(snap).not.toBeNull();
    });
  });
});

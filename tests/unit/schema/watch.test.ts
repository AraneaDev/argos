import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SchemaWatch } from '../../../src/schema/watch.js';
import { PaneStore } from '../../../src/pane/store.js';
import type { DatabaseSchema } from '../../../src/types/database.js';

const schema = (cols: string[], fingerprint?: string): DatabaseSchema => ({
  database: 'd',
  type: 'postgresql',
  captured_at: 'now',
  tables: {
    t: {
      name: 't',
      type: 'BASE TABLE',
      columns: cols.map((name) => ({ name, type: 'int', nullable: true, default: null })),
    },
  },
  views: {},
  summary: { table_count: 1, view_count: 0, total_columns: cols.length },
  ...(fingerprint ? { fingerprint } : {}),
});

function setup(cached: DatabaseSchema | null, connected = true) {
  let time = 1_000_000;
  const cm = {
    isConnected: jest.fn().mockReturnValue(connected),
    schemaFingerprint: jest.fn().mockResolvedValue('fp1'),
  };
  const sm = {
    getSchema: jest.fn().mockReturnValue(cached),
    setFingerprint: jest.fn().mockResolvedValue(undefined),
    refreshSchema: jest.fn(),
  };
  const watch = new SchemaWatch(cm as any, sm as any, () => time);
  return { cm, sm, watch, advance: (ms: number) => (time += ms) };
}
const cfg = {} as any;

describe('SchemaWatch', () => {
  it('does not query again within 60 s, and does after', async () => {
    const { cm, watch, advance } = setup(schema(['id'], 'fp1'));
    await watch.check('d', cfg);
    advance(59_000);
    await watch.check('d', cfg);
    expect(cm.schemaFingerprint).toHaveBeenCalledTimes(1);
    advance(1_000);
    await watch.check('d', cfg);
    expect(cm.schemaFingerprint).toHaveBeenCalledTimes(2);
  });

  it('force runs the fingerprint check inside the 60 s window', async () => {
    const { cm, watch, advance } = setup(schema(['id'], 'fp1'));
    await watch.check('d', cfg);
    advance(1_000);
    await watch.check('d', cfg, { force: true });
    expect(cm.schemaFingerprint).toHaveBeenCalledTimes(2);
    // force still records the check time: an unforced call right after is rate-limited
    advance(1_000);
    await watch.check('d', cfg);
    expect(cm.schemaFingerprint).toHaveBeenCalledTimes(2);
  });

  it('force still skips when nothing is cached', async () => {
    const { cm, watch } = setup(null);
    await watch.check('d', cfg, { force: true });
    expect(cm.schemaFingerprint).not.toHaveBeenCalled();
  });

  it('force checks a schema loaded from disk before any connection is open', async () => {
    // After a restart the cache comes from disk and connections open lazily: the check
    // before a block must still compare fingerprints (schemaFingerprint connects).
    const { cm, sm, watch } = setup(schema(['id'], 'old'), false);
    sm.refreshSchema.mockResolvedValue(schema(['id', 'extra'], 'fp1'));
    const changes = await watch.check('d', cfg, { force: true });
    expect(cm.schemaFingerprint).toHaveBeenCalledWith('d');
    expect(sm.refreshSchema).toHaveBeenCalledWith('d');
    expect(changes).toEqual([{ kind: 'column-added', table: 't', column: 'extra', type: 'int' }]);
  });

  it('force refreshes a legacy cache that has no fingerprint', async () => {
    const { sm, watch } = setup(schema(['id']));
    sm.refreshSchema.mockResolvedValue(schema(['id', 'extra'], 'fp1'));
    const changes = await watch.check('d', cfg, { force: true });
    expect(sm.refreshSchema).toHaveBeenCalledWith('d');
    expect(changes).toEqual([{ kind: 'column-added', table: 't', column: 'extra', type: 'int' }]);
  });

  it('skips when no connection is open', async () => {
    const { cm, watch } = setup(schema(['id'], 'fp1'), false);
    expect(await watch.check('d', cfg)).toEqual([]);
    expect(cm.schemaFingerprint).not.toHaveBeenCalled();
  });

  it('returns [] without querying when there is no cached schema', async () => {
    const { cm, watch } = setup(null);
    expect(await watch.check('d', cfg)).toEqual([]);
    expect(cm.schemaFingerprint).not.toHaveBeenCalled();
  });

  it('stores the fingerprint silently for a legacy cache', async () => {
    const { sm, watch } = setup(schema(['id']));
    expect(await watch.check('d', cfg)).toEqual([]);
    expect(sm.setFingerprint).toHaveBeenCalledWith('d', 'fp1');
    expect(sm.refreshSchema).not.toHaveBeenCalled();
  });

  it('returns [] when the fingerprint is unchanged', async () => {
    const { sm, watch } = setup(schema(['id'], 'fp1'));
    expect(await watch.check('d', cfg)).toEqual([]);
    expect(sm.refreshSchema).not.toHaveBeenCalled();
  });

  it('refreshes and returns the diff when the fingerprint changed', async () => {
    const { sm, watch } = setup(schema(['id'], 'old'));
    sm.refreshSchema.mockResolvedValue(schema(['id', 'extra'], 'fp1'));
    const changes = await watch.check('d', cfg);
    expect(sm.refreshSchema).toHaveBeenCalledWith('d');
    expect(changes).toEqual([{ kind: 'column-added', table: 't', column: 'extra', type: 'int' }]);
  });

  it('returns [] when the fingerprint query throws', async () => {
    const { cm, watch } = setup(schema(['id'], 'fp1'));
    cm.schemaFingerprint.mockRejectedValue(new Error('boom'));
    await expect(watch.check('d', cfg)).resolves.toEqual([]);
  });

  it('returns [] when refresh throws', async () => {
    const { sm, watch } = setup(schema(['id'], 'old'));
    sm.refreshSchema.mockRejectedValue(new Error('boom'));
    await expect(watch.check('d', cfg)).resolves.toEqual([]);
  });

  describe('across processes (persisted check time)', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'argos-watch-'));
    });
    afterEach(() => rm(dir, { recursive: true, force: true }));

    it('a second watch within 60 s of the first does not query, and does after', async () => {
      let time = 1_000_000;
      const now = () => time;
      const mk = () => {
        const cm = {
          isConnected: jest.fn().mockReturnValue(true),
          schemaFingerprint: jest.fn().mockResolvedValue('fp1'),
        };
        const sm = {
          getSchema: jest.fn().mockReturnValue(schema(['id'], 'fp1')),
          setFingerprint: jest.fn(),
          refreshSchema: jest.fn(),
        };
        // a separate PaneStore per watch, as two processes would have
        const store = new PaneStore(join(dir, '.argos'));
        return { cm, watch: new SchemaWatch(cm as any, sm as any, now, 60_000, () => store) };
      };
      const first = mk();
      await first.watch.check('d', cfg);
      expect(first.cm.schemaFingerprint).toHaveBeenCalledTimes(1);

      time += 30_000;
      const second = mk();
      await second.watch.check('d', cfg);
      expect(second.cm.schemaFingerprint).not.toHaveBeenCalled();
      // and the other connection is unaffected
      await second.watch.check('other', cfg);
      expect(second.cm.schemaFingerprint).toHaveBeenCalledTimes(1);

      time += 30_000;
      await second.watch.check('d', cfg);
      expect(second.cm.schemaFingerprint).toHaveBeenCalledTimes(2);
    });

    it('still checks when the persisted state cannot be read or written', async () => {
      const { cm, sm } = setup(schema(['id'], 'fp1'));
      const broken = {
        fingerprintCheckedAt: jest.fn().mockRejectedValue(new Error('EACCES')),
        recordFingerprintCheck: jest.fn().mockRejectedValue(new Error('EACCES')),
      };
      const watch = new SchemaWatch(
        cm as any,
        sm as any,
        () => 5,
        60_000,
        () => broken
      );
      await expect(watch.check('d', cfg)).resolves.toEqual([]);
      expect(cm.schemaFingerprint).toHaveBeenCalledTimes(1);
    });
  });
});

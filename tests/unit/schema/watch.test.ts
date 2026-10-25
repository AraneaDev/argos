import { SchemaWatch } from '../../../src/schema/watch.js';
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
});

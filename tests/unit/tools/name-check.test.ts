import {
  CAPTURE_RETRY_MS,
  ensureSchema,
  SCHEMA_CAPTURE_LIMIT_MS,
} from '../../../src/tools/handlers/name-check.js';
import type { ToolHandlerContext } from '../../../src/tools/handlers/types.js';
import type { DatabaseConfig, DatabaseSchema } from '../../../src/types/index.js';

const schema = { database: 'd', tables: {}, views: {} } as unknown as DatabaseSchema;
const cfg = { type: 'postgresql' } as DatabaseConfig;

function makeCtx(cached: DatabaseSchema | null, capture: jest.Mock, capturing = false) {
  const logger = { info: jest.fn(), debug: jest.fn(), warning: jest.fn(), error: jest.fn() };
  const ctx = {
    schemaManager: {
      getSchema: jest.fn().mockReturnValue(cached),
      captureSchemaOnce: capture,
      isCapturing: jest.fn().mockReturnValue(capturing),
    },
    logger,
  } as unknown as ToolHandlerContext;
  return { ctx, logger };
}

describe('ensureSchema', () => {
  afterEach(() => jest.useRealTimers());

  it('returns the cached schema without capturing', async () => {
    const capture = jest.fn();
    const { ctx } = makeCtx(schema, capture);
    expect(await ensureSchema(ctx, 'd', cfg)).toBe(schema);
    expect(capture).not.toHaveBeenCalled();
  });

  it('captures when nothing is cached', async () => {
    const capture = jest.fn().mockResolvedValue(schema);
    const { ctx } = makeCtx(null, capture);
    expect(await ensureSchema(ctx, 'd', cfg)).toBe(schema);
    expect(capture).toHaveBeenCalledWith('d', cfg);
  });

  it('returns null and warns when the capture rejects', async () => {
    const capture = jest.fn().mockRejectedValue(new Error('boom'));
    const { ctx, logger } = makeCtx(null, capture);
    expect(await ensureSchema(ctx, 'd', cfg)).toBeNull();
    expect(logger.warning).toHaveBeenCalled();
  });

  it('gives up after the limit; a later rejection is swallowed and no timer is left', async () => {
    jest.useFakeTimers();
    let rejectCapture!: (e: Error) => void;
    const capture = jest.fn().mockReturnValue(
      new Promise((_, reject) => {
        rejectCapture = reject;
      })
    );
    const { ctx, logger } = makeCtx(null, capture);
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const result = ensureSchema(ctx, 'd', cfg);
      await jest.advanceTimersByTimeAsync(SCHEMA_CAPTURE_LIMIT_MS);
      expect(await result).toBeNull();
      expect(jest.getTimerCount()).toBe(0);
      rejectCapture(new Error('late'));
      jest.useRealTimers();
      await new Promise((r) => setImmediate(r));
      expect(unhandled).not.toHaveBeenCalled();
      expect(logger.warning).toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('clears the timer when the capture wins', async () => {
    jest.useFakeTimers();
    const capture = jest.fn().mockResolvedValue(schema);
    const { ctx } = makeCtx(null, capture);
    await ensureSchema(ctx, 'd', cfg);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not wait for a capture another call already started', async () => {
    jest.useFakeTimers();
    const capture = jest.fn();
    const { ctx } = makeCtx(null, capture, true);
    // Resolves without any timer advancing: no 5 s wait
    expect(await ensureSchema(ctx, 'd', cfg)).toBeNull();
    expect(capture).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('with wait set, joins a capture already in flight (sql_get_schema)', async () => {
    const capture = jest.fn().mockResolvedValue(schema);
    const { ctx } = makeCtx(null, capture, true);
    expect(await ensureSchema(ctx, 'd', cfg, { wait: true })).toBe(schema);
  });

  it('does not retry a failed capture within 60 s, and does after', async () => {
    jest.useFakeTimers();
    const capture = jest.fn().mockRejectedValue(new Error('boom'));
    const { ctx } = makeCtx(null, capture);
    expect(await ensureSchema(ctx, 'd', cfg)).toBeNull();
    expect(capture).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(CAPTURE_RETRY_MS - 1);
    expect(await ensureSchema(ctx, 'd', cfg)).toBeNull();
    expect(capture).toHaveBeenCalledTimes(1);
    // another database is unaffected
    await ensureSchema(ctx, 'other', cfg);
    expect(capture).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(1);
    capture.mockResolvedValue(schema);
    expect(await ensureSchema(ctx, 'd', cfg)).toBe(schema);
    expect(capture).toHaveBeenCalledTimes(3);
  });

  it('with wait set, retries a recently failed capture (sql_get_schema)', async () => {
    const capture = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(schema);
    const { ctx } = makeCtx(null, capture);
    expect(await ensureSchema(ctx, 'd', cfg)).toBeNull();
    expect(await ensureSchema(ctx, 'd', cfg, { wait: true })).toBe(schema);
  });

  it('remembers a capture that fails after the limit', async () => {
    jest.useFakeTimers();
    let rejectCapture!: (e: Error) => void;
    const capture = jest.fn().mockReturnValue(
      new Promise((_, reject) => {
        rejectCapture = reject;
      })
    );
    const { ctx } = makeCtx(null, capture);
    const first = ensureSchema(ctx, 'd', cfg);
    await jest.advanceTimersByTimeAsync(SCHEMA_CAPTURE_LIMIT_MS);
    expect(await first).toBeNull();
    rejectCapture(new Error('late'));
    await jest.advanceTimersByTimeAsync(0);
    expect(await ensureSchema(ctx, 'd', cfg)).toBeNull();
    expect(capture).toHaveBeenCalledTimes(1);
  });
});

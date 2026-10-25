/**
 * Logger Tests
 *
 * Note: The Logger class uses import.meta.url which isn't supported in Jest/SWC.
 * We mock the entire module's internal dependencies to work around this.
 */

// Must mock url before any imports that trigger logger.ts loading
jest.mock('url', () => ({
  fileURLToPath: jest.fn(() => '/mock/project/src/utils/logger.ts'),
  pathToFileURL: jest.fn((p: string) => ({ href: 'file://' + p })),
}));

jest.mock('fs', () => ({
  createWriteStream: jest.fn(),
  existsSync: jest.fn(),
  unlinkSync: jest.fn(),
  renameSync: jest.fn(),
}));

jest.mock('path', () => ({
  join: jest.fn((...args: string[]) => args.join('/')),
  dirname: jest.fn((_p: string) => '/mock/project/src/utils'),
  resolve: jest.fn((...args: string[]) => {
    // Simulate resolve for PROJECT_ROOT calculation
    // resolve('/mock/project/src/utils', '..', '..') => '/mock/project'
    const parts = args[0].split('/');
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '..') parts.pop();
      else parts.push(args[i]);
    }
    return parts.join('/');
  }),
}));

import { Logger, getLogger, initializeLogger, cleanupLogger } from '../../../src/utils/logger.js';

import { createWriteStream, existsSync, unlinkSync } from 'fs';

const mockCreateWriteStream = createWriteStream as jest.MockedFunction<typeof createWriteStream>;
const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockUnlinkSync = unlinkSync as jest.MockedFunction<typeof unlinkSync>;

describe('Logger', () => {
  let mockStream: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockStream = {
      write: jest.fn(),
      end: jest.fn((cb?: () => void) => cb && cb()),
      on: jest.fn(),
    };
    mockCreateWriteStream.mockReturnValue(mockStream as any);
    mockExistsSync.mockReturnValue(false);

    // Suppress console output during tests
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    // Clean up global logger between tests
    await cleanupLogger();
  });

  // ============================================================================
  // Constructor and Configuration
  // ============================================================================

  describe('constructor', () => {
    it('should create logger with default config', () => {
      const logger = new Logger();
      expect(logger).toBeInstanceOf(Logger);
    });

    it('should create logger with custom config', () => {
      const logger = new Logger({
        logFile: '/custom/log.log',
        enableConsole: false,
        enableFile: false,
        logLevel: 'ERROR',
        timestampFormat: 'short',
        component: 'test',
      });
      expect(logger).toBeInstanceOf(Logger);
    });
  });

  // ============================================================================
  // Initialization
  // ============================================================================

  describe('initialize', () => {
    it('should initialize with file logging', async () => {
      mockExistsSync.mockReturnValue(false);

      const logger = new Logger({ enableFile: true, enableConsole: false });
      await logger.initialize();

      expect(mockCreateWriteStream).toHaveBeenCalled();
    });

    it('should rotate log file on start when configured', async () => {
      mockExistsSync.mockReturnValue(true);

      const logger = new Logger({ rotateOnStart: true, enableConsole: false });
      await logger.initialize();

      expect(mockUnlinkSync).toHaveBeenCalled();
    });

    it('should not rotate when rotateOnStart is false', async () => {
      const logger = new Logger({ rotateOnStart: false, enableConsole: false });
      await logger.initialize();

      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });

    it('should not re-initialize if already initialized', async () => {
      const logger = new Logger({ enableFile: true, enableConsole: false });
      await logger.initialize();
      await logger.initialize(); // second call

      expect(mockCreateWriteStream).toHaveBeenCalledTimes(1);
    });

    it('should skip file setup when enableFile is false', async () => {
      const logger = new Logger({ enableFile: false, enableConsole: false });
      await logger.initialize();

      expect(mockCreateWriteStream).not.toHaveBeenCalled();
    });

    it('should handle rotation error gracefully', async () => {
      mockExistsSync.mockReturnValue(true);
      mockUnlinkSync.mockImplementation(() => {
        throw new Error('Delete failed');
      });

      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

      const logger = new Logger({ rotateOnStart: true, enableConsole: false });
      // Should not throw
      await logger.initialize();

      stderrSpy.mockRestore();
    });

    it('should handle createWriteStream error and disable file logging', async () => {
      mockCreateWriteStream.mockImplementation(() => {
        throw new Error('Stream error');
      });

      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

      const logger = new Logger({ enableFile: true, enableConsole: false });
      await logger.initialize();

      // Should not throw - file logging gets disabled
      stderrSpy.mockRestore();
    });
  });

  // ============================================================================
  // Cleanup
  // ============================================================================

  describe('cleanup', () => {
    it('should close log stream on cleanup', async () => {
      const logger = new Logger({ enableConsole: false });
      await logger.initialize();
      await logger.cleanup();

      expect(mockStream.end).toHaveBeenCalled();
    });

    it('should handle cleanup without stream', async () => {
      const logger = new Logger({ enableFile: false, enableConsole: false });
      await logger.initialize();
      await logger.cleanup(); // should not throw
    });
  });

  // ============================================================================
  // Logging Methods
  // ============================================================================

  describe('info', () => {
    it('should log info messages', () => {
      const logger = new Logger({ enableFile: false, enableConsole: true, logLevel: 'INFO' });
      logger.info('test message');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('test message'));
    });

    it('should log info with context', () => {
      const logger = new Logger({ enableFile: false, enableConsole: true, logLevel: 'INFO' });
      logger.info('test', { key: 'value' });
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Context'));
    });

    it('should not include context string when context is empty', () => {
      const logger = new Logger({ enableFile: false, enableConsole: true, logLevel: 'INFO' });
      logger.info('test', {});
      const call = (console.log as jest.Mock).mock.calls[0][0];
      expect(call).not.toContain('Context');
    });
  });

  describe('warning', () => {
    it('should log warning messages', () => {
      const logger = new Logger({ enableFile: false, enableConsole: true, logLevel: 'INFO' });
      logger.warning('warn message');
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('warn message'));
    });
  });

  describe('error', () => {
    it('should log error messages', () => {
      const logger = new Logger({ enableFile: false, enableConsole: true, logLevel: 'INFO' });
      logger.error('error message');
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('error message'));
    });

    it('should log error with Error object', () => {
      const logger = new Logger({ enableFile: false, enableConsole: true, logLevel: 'INFO' });
      logger.error('fail', new Error('test error'));
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('fail'));
    });

    it('should log error with context object', () => {
      const logger = new Logger({ enableFile: false, enableConsole: true, logLevel: 'INFO' });
      logger.error('fail', { detail: 'info' });
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('detail'));
    });

    it('should handle error method with no context', () => {
      const logger = new Logger({ enableFile: false, enableConsole: true, logLevel: 'INFO' });
      logger.error('bare error');
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('bare error'));
    });
  });

  describe('critical', () => {
    it('should log critical messages', () => {
      const logger = new Logger({ enableFile: false, enableConsole: true, logLevel: 'INFO' });
      logger.critical('critical message');
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('critical message'));
    });

    it('should log critical with Error object', () => {
      const logger = new Logger({ enableFile: false, enableConsole: true, logLevel: 'INFO' });
      logger.critical('fail', new Error('critical error'));
      expect(console.error).toHaveBeenCalled();
    });

    it('should log critical with context object', () => {
      const logger = new Logger({ enableFile: false, enableConsole: true, logLevel: 'INFO' });
      logger.critical('fail', { detail: 'info' });
      expect(console.error).toHaveBeenCalled();
    });

    it('should handle critical with no context', () => {
      const logger = new Logger({ enableFile: false, enableConsole: true, logLevel: 'INFO' });
      logger.critical('bare critical');
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('bare critical'));
    });
  });

  describe('debug', () => {
    it('should log debug messages when level is INFO', () => {
      const logger = new Logger({ enableFile: false, enableConsole: true, logLevel: 'INFO' });
      logger.debug('debug message');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[DEBUG] debug message'));
    });

    it('should not log debug messages when level is WARNING', () => {
      const logger = new Logger({ enableFile: false, enableConsole: true, logLevel: 'WARNING' });
      logger.debug('debug message');
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Log Level Filtering
  // ============================================================================

  describe('log level filtering', () => {
    it('should filter INFO when level is WARNING', () => {
      const logger = new Logger({ enableFile: false, enableConsole: true, logLevel: 'WARNING' });
      logger.info('should not appear');
      expect(console.log).not.toHaveBeenCalled();
    });

    it('should filter WARNING when level is ERROR', () => {
      const logger = new Logger({ enableFile: false, enableConsole: true, logLevel: 'ERROR' });
      logger.warning('should not appear');
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('should filter ERROR when level is CRITICAL', () => {
      const logger = new Logger({ enableFile: false, enableConsole: true, logLevel: 'CRITICAL' });
      logger.error('should not appear');
      expect(console.error).not.toHaveBeenCalled();
    });

    it('should show CRITICAL at all levels', () => {
      const logger = new Logger({ enableFile: false, enableConsole: true, logLevel: 'CRITICAL' });
      logger.critical('should appear');
      expect(console.error).toHaveBeenCalled();
    });

    it('should show WARNING and above when level is WARNING', () => {
      const logger = new Logger({ enableFile: false, enableConsole: true, logLevel: 'WARNING' });
      logger.warning('warn');
      logger.error('err');
      logger.critical('crit');
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================================
  // Timestamp Formatting
  // ============================================================================

  describe('timestamp formatting', () => {
    it('should use ISO format by default', () => {
      const logger = new Logger({ enableFile: false, enableConsole: true, timestampFormat: 'iso' });
      logger.info('test');
      const call = (console.log as jest.Mock).mock.calls[0][0];
      expect(call).toMatch(/\d{4}-\d{2}-\d{2}T/);
    });

    it('should use short format', () => {
      const logger = new Logger({
        enableFile: false,
        enableConsole: true,
        timestampFormat: 'short',
      });
      logger.info('test');
      expect(console.log).toHaveBeenCalled();
    });

    it('should use no timestamp', () => {
      const logger = new Logger({
        enableFile: false,
        enableConsole: true,
        timestampFormat: 'none',
      });
      logger.info('test');
      const call = (console.log as jest.Mock).mock.calls[0][0];
      expect(call).toContain('[]'); // empty timestamp
    });
  });

  // ============================================================================
  // File Output
  // ============================================================================

  describe('file output', () => {
    it('should write to log stream', async () => {
      const logger = new Logger({ enableFile: true, enableConsole: false });
      await logger.initialize();

      logger.info('file log message');
      expect(mockStream.write).toHaveBeenCalledWith(expect.stringContaining('file log message'));
    });

    it('should handle EPIPE write errors gracefully', async () => {
      const logger = new Logger({ enableFile: true, enableConsole: false });
      await logger.initialize();

      mockStream.write.mockImplementation(() => {
        const err: any = new Error('EPIPE');
        err.code = 'EPIPE';
        throw err;
      });

      // Should not throw
      logger.info('message');
    });

    it('should log non-EPIPE write errors to stderr', async () => {
      const logger = new Logger({ enableFile: true, enableConsole: false });
      await logger.initialize();

      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

      mockStream.write.mockImplementation(() => {
        const err: any = new Error('EIO');
        err.code = 'EIO';
        throw err;
      });

      logger.info('message');
      expect(stderrSpy).toHaveBeenCalled();
      stderrSpy.mockRestore();
    });
  });

  // ============================================================================
  // Console Output Safety
  // ============================================================================

  describe('console output safety', () => {
    it('should handle EPIPE console errors by disabling console', () => {
      const logger = new Logger({ enableFile: false, enableConsole: true, logLevel: 'INFO' });

      let callCount = 0;
      (console.log as jest.Mock).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          const err: any = new Error('EPIPE');
          err.code = 'EPIPE';
          throw err;
        }
      });

      logger.info('first message'); // triggers EPIPE
      logger.info('second message'); // console should be disabled now
      // First call threw EPIPE, second should not call console.log
      expect(callCount).toBe(1);
    });

    it('should handle non-EPIPE console errors with stderr fallback', () => {
      const logger = new Logger({ enableFile: false, enableConsole: true, logLevel: 'INFO' });
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

      (console.log as jest.Mock).mockImplementationOnce(() => {
        const err: any = new Error('OTHER');
        err.code = 'OTHER';
        throw err;
      });

      logger.info('message');
      expect(stderrSpy).toHaveBeenCalled();
      stderrSpy.mockRestore();
    });

    it('should disable console when stderr also fails', () => {
      const logger = new Logger({ enableFile: false, enableConsole: true, logLevel: 'INFO' });
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => {
        throw new Error('stderr broken');
      });

      (console.log as jest.Mock).mockImplementationOnce(() => {
        const err: any = new Error('OTHER');
        err.code = 'OTHER';
        throw err;
      });

      // Should not throw even when stderr fails
      logger.info('message');
      stderrSpy.mockRestore();
    });
  });

  // ============================================================================
  // Global Logger Functions
  // ============================================================================

  describe('getLogger', () => {
    it('should return same instance on multiple calls', () => {
      const logger1 = getLogger();
      const logger2 = getLogger();
      expect(logger1).toBe(logger2);
    });

    it('should create new instance after cleanup', async () => {
      const logger1 = getLogger();
      await cleanupLogger();
      const logger2 = getLogger();
      expect(logger1).not.toBe(logger2);
    });
  });

  describe('initializeLogger', () => {
    it('should initialize and return logger', async () => {
      const logger = await initializeLogger({ enableFile: false, enableConsole: false });
      expect(logger).toBeInstanceOf(Logger);
    });
  });

  describe('cleanupLogger', () => {
    it('should cleanup global logger', async () => {
      await initializeLogger({ enableFile: false, enableConsole: false });
      await cleanupLogger();
      // Should not throw on double cleanup
      await cleanupLogger();
    });
  });

  // ============================================================================
  // Convenience Functions
  // ============================================================================

  describe('secret redaction in file output', () => {
    it('redacts secret-looking context fields before writing to the log file', async () => {
      const writes: string[] = [];
      const fakeStream = {
        write: (s: string) => {
          writes.push(s);
          return true;
        },
        on: jest.fn(),
        end: (cb?: () => void) => {
          if (cb) cb();
        },
      };
      (createWriteStream as jest.Mock).mockReturnValue(fakeStream);
      (existsSync as jest.Mock).mockReturnValue(false);

      const logger = new Logger({
        enableConsole: false,
        enableFile: true,
        rotateOnStart: false,
        logFile: '/mock/project/secret-test.log',
      });
      await logger.initialize();

      logger.info('Handling tool call: sql_add_database', {
        args: {
          name: 'prod',
          password: 'hunter2',
          ssh_private_key: '-----BEGIN KEY-----abc',
          nested: { ssh_passphrase: 'topsecret', token: 'xyz' },
        },
      });

      const joined = writes.join('');
      expect(joined).not.toContain('hunter2');
      expect(joined).not.toContain('BEGIN KEY');
      expect(joined).not.toContain('topsecret');
      expect(joined).not.toContain('xyz');
      expect(joined).toContain('[REDACTED]');
      // Non-secret fields survive.
      expect(joined).toContain('prod');
    });
  });
});

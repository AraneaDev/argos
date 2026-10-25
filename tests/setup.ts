/**
 * Global test setup for Jest
 */

// Mock console methods to reduce noise in tests
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

beforeEach(() => {
  // Mock console.log to reduce test output noise
  if (!process.env.VERBOSE_TESTS) {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    // Keep error for debugging
    jest.spyOn(console, 'error').mockImplementation(() => {});
  }
});

afterEach(() => {
  // Restore console methods
  if (!process.env.VERBOSE_TESTS) {
    jest.restoreAllMocks();
  }
});

// Global test timeout
jest.setTimeout(30000);

// Increase max listeners to prevent warnings during parallel test execution
process.setMaxListeners(20);

// Handle unhandled promise rejections in tests
// Use a global flag to ensure we only register once across all test files
declare global {
  var __testUnhandledRejectionHandlerRegistered: boolean;
}

let unhandledRejectionHandler: ((reason: any, promise: Promise<any>) => void) | null = null;

// Only add the listener once globally
if (!global.__testUnhandledRejectionHandlerRegistered) {
  unhandledRejectionHandler = (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't crash the test suite, but log the error
  };
  process.on('unhandledRejection', unhandledRejectionHandler);
  global.__testUnhandledRejectionHandlerRegistered = true;
}

// Clean up the listener when all tests are done
afterAll(() => {
  if (unhandledRejectionHandler && global.__testUnhandledRejectionHandlerRegistered) {
    process.removeListener('unhandledRejection', unhandledRejectionHandler);
    unhandledRejectionHandler = null;
    global.__testUnhandledRejectionHandlerRegistered = false;
  }
});

// Set up test environment variables
process.env.NODE_ENV = 'test';
process.env.SQL_DEBUG = 'false';
process.env.SQL_LOG_LEVEL = 'error';

// Mock file system operations that might interfere with tests
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';

// Ensure temp directory exists for test files
const testTempDir = path.join(tmpdir(), 'argos-tests');
if (!fs.existsSync(testTempDir)) {
  fs.mkdirSync(testTempDir, { recursive: true });
}

// Global cleanup function
global.cleanupTestFiles = () => {
  try {
    if (fs.existsSync(testTempDir)) {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    }
  } catch (error) {
    // Ignore cleanup errors
  }
};

// Clean up after all tests
afterAll(() => {
  global.cleanupTestFiles();
});

// Custom matchers for better test assertions
expect.extend({
  toBeValidQuery(received: any) {
    const pass = typeof received === 'string' && received.trim().length > 0;
    return {
      message: () => `Expected ${received} to be a valid SQL query`,
      pass,
    };
  },

  toContainSqlKeyword(received: string, keyword: string) {
    const normalizedQuery = received.toLowerCase().replace(/\s+/g, ' ').trim();
    const normalizedKeyword = keyword.toLowerCase();
    const pass = normalizedQuery.includes(normalizedKeyword);

    return {
      message: () =>
        pass
          ? `Expected query not to contain SQL keyword "${keyword}"`
          : `Expected query to contain SQL keyword "${keyword}"`,
      pass,
    };
  },

  toBeValidMCPResponse(received: any) {
    const hasJsonRpc = received && received.jsonrpc === '2.0';
    const hasId = received && typeof received.id !== 'undefined';
    const hasResultOrError = received && (received.result || received.error);

    const pass = hasJsonRpc && hasId && hasResultOrError;

    return {
      message: () => `Expected ${JSON.stringify(received)} to be a valid MCP response`,
      pass,
    };
  },

  toHaveValidQueryResult(received: any) {
    const hasRows = received && Array.isArray(received.rows);
    const hasRowCount = received && typeof received.rowCount === 'number';
    const hasFields = received && Array.isArray(received.fields);
    const hasExecutionTime = received && typeof received.execution_time_ms === 'number';

    const pass = hasRows && hasRowCount && hasFields && hasExecutionTime;

    return {
      message: () => `Expected ${JSON.stringify(received)} to be a valid query result`,
      pass,
    };
  },
});

// Global types for custom matchers
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidQuery(): R;
      toContainSqlKeyword(keyword: string): R;
      toBeValidMCPResponse(): R;
      toHaveValidQueryResult(): R;
    }
  }

  function cleanupTestFiles(): void;
}

// Export test utilities
export const testUtils = {
  tempDir: testTempDir,

  createTempFile(filename: string, content: string): string {
    const filePath = path.join(testTempDir, filename);
    fs.writeFileSync(filePath, content);
    return filePath;
  },

  async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  randomString(length = 8): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  },
};

// Mock external dependencies that might not be available in test environment
jest.mock('mssql', () => ({
  ConnectionPool: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    request: jest.fn().mockReturnValue({
      query: jest.fn().mockResolvedValue({ recordset: [], rowsAffected: [0] }),
    }),
    close: jest.fn(),
  })),
  config: {},
}));

jest.mock('mysql2', () => ({
  createConnection: jest.fn().mockReturnValue({
    connect: jest.fn(),
    query: jest.fn(),
    end: jest.fn(),
  }),
  createPool: jest.fn().mockReturnValue({
    getConnection: jest.fn(),
    end: jest.fn(),
  }),
}));

jest.mock('pg', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: jest.fn(),
  })),
  Pool: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    query: jest.fn(),
    end: jest.fn(),
  })),
}));

jest.mock('sqlite3', () => ({
  Database: jest.fn().mockImplementation(() => ({
    run: jest.fn(),
    all: jest.fn(),
    close: jest.fn(),
  })),
}));

jest.mock('ssh2', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    forwardOut: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
  })),
}));

/**
 * Enhanced logging utilities for Argos
 */
import { createWriteStream, existsSync, unlinkSync, renameSync, chmodSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { WriteStream } from 'fs';

/**
 * Scrub only secret-shaped substrings from a log MESSAGE string (defense in depth,
 * FIND-120). Unlike the error sanitizer, this deliberately leaves file paths / IPs / host
 * names intact — those are legitimate operational detail in an owner-only (0600) log — and
 * only removes PEM blocks, bearer tokens, and `key=value` secret pairs that must never be
 * written even if accidentally interpolated into a message.
 */
function scrubSecretsFromMessage(message: string): string {
  return message
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[REDACTED KEY]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(
      /(password|passwd|pwd|passphrase|token|secret|api[_-]?key|authorization|credentials?)\s*[=:]\s*[^\s,;]+/gi,
      '$1=[REDACTED]'
    );
}

const _currentFile = fileURLToPath(import.meta.url);
const _currentDir = dirname(_currentFile);
const PROJECT_ROOT = resolve(_currentDir, '..', '..');

// Substrings that mark a context key as holding a secret. Values under such keys
// are replaced with [REDACTED] before anything is written to the log file, so that
// credentials passed as tool arguments never land on disk in cleartext.
const SECRET_KEY_PATTERNS = [
  'password',
  'passwd',
  'pwd',
  'passphrase',
  'secret',
  'token',
  'private_key',
  'privatekey',
  'api_key',
  'apikey',
  'authorization',
  'credential',
];

/**
 * Deep-redact secret-looking fields in an arbitrary log context value.
 */
function redactSecretsDeep(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactSecretsDeep(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const lowered = key.toLowerCase();
    if (val !== undefined && val !== null && SECRET_KEY_PATTERNS.some((p) => lowered.includes(p))) {
      out[key] = '[REDACTED]';
    } else {
      out[key] = redactSecretsDeep(val, depth + 1);
    }
  }
  return out;
}

/**
 * Logger configuration interface
 */
interface LoggerConfig {
  logFile?: string;
  enableConsole?: boolean;
  enableFile?: boolean;
  rotateOnStart?: boolean;
  maxLogSize?: number;
  logLevel?: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  timestampFormat?: 'iso' | 'short' | 'none';
  component?: string;
}

/**
 * Log entry interface
 */
interface LogEntry {
  timestamp: Date;
  level: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  message: string;
  context?: Record<string, unknown>;
}

// ============================================================================
// Logger Class
// ============================================================================

/**
 *
 */
export class Logger {
  private config: Required<LoggerConfig>;
  private logStream?: WriteStream;
  private initialized = false;
  private bytesWritten = 0;

  constructor(config: LoggerConfig = {}) {
    this.config = {
      // Both entry points pass this explicitly; the default only applies to a
      // Logger built without one, and it names the same file so that never
      // produces a second log under an older name.
      logFile: join(PROJECT_ROOT, 'argos.log'),
      enableConsole: true,
      enableFile: true,
      rotateOnStart: true,
      maxLogSize: 10 * 1024 * 1024, // 10MB
      logLevel: 'INFO',
      timestampFormat: 'iso',
      component: 'default',
      ...config,
    };
  }

  /**
   * Initialize the logger
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.config.enableFile) {
      if (this.config.rotateOnStart) {
        this.rotateLogFile();
      }
      this.createLogStream();
    }

    this.initialized = true;
    this.info('Logger initialized', { config: this.sanitizeConfig() });
  }

  /**
   * Clean up logger resources
   */
  async cleanup(): Promise<void> {
    if (this.logStream) {
      await new Promise<void>((resolve) => {
        if (this.logStream) {
          this.logStream.end(resolve);
        } else {
          resolve();
        }
      });
      this.logStream = undefined;
    }
    this.initialized = false;
  }

  // ============================================================================
  // Logging Methods
  // ============================================================================

  /**
   *
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log('INFO', message, context);
  }

  /**
   *
   */
  warning(message: string, context?: Record<string, unknown>): void {
    this.log('WARNING', message, context);
  }

  /**
   *
   */
  error(message: string, contextOrError?: Record<string, unknown> | Error): void {
    let actualContext: Record<string, unknown> = {};

    if (contextOrError) {
      if (contextOrError instanceof Error) {
        actualContext.error = this.serializeError(contextOrError);
      } else {
        actualContext = contextOrError;
      }
    }

    this.log('ERROR', message, actualContext);
  }

  /**
   *
   */
  critical(message: string, contextOrError?: Record<string, unknown> | Error): void {
    let actualContext: Record<string, unknown> = {};

    if (contextOrError) {
      if (contextOrError instanceof Error) {
        actualContext.error = this.serializeError(contextOrError);
      } else {
        actualContext = contextOrError;
      }
    }

    this.log('CRITICAL', message, actualContext);
  }

  /**
   *
   */
  debug(message: string, context?: Record<string, unknown>): void {
    // Debug logs are only shown when log level is INFO or lower
    if (this.shouldLog('INFO')) {
      this.log('INFO', `[DEBUG] ${message}`, context);
    }
  }

  // ============================================================================
  // Core Logging Method
  // ============================================================================

  private log(level: LogEntry['level'], message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      context,
    };

    const formattedMessage = this.formatLogEntry(entry);

    // Console output with EPIPE protection
    if (this.config.enableConsole) {
      this.safeConsoleOutput(level, formattedMessage);
    }

    // File output
    if (this.config.enableFile && this.logStream) {
      const line = formattedMessage + '\n';
      this.maybeRotateBySize(line.length);
      try {
        this.logStream?.write(line);
        this.bytesWritten += line.length;
      } catch (error) {
        // Ignore write errors to avoid cascading failures
        if (error && typeof error === 'object' && 'code' in error && error.code !== 'EPIPE') {
          // Only log non-EPIPE errors to stderr as last resort
          try {
            process.stderr.write(`Logger write error: ${error}\n`);
          } catch {
            // Completely ignore if even stderr fails
          }
        }
      }
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private shouldLog(level: LogEntry['level']): boolean {
    const levels = {
      INFO: 0,
      WARNING: 1,
      ERROR: 2,
      CRITICAL: 3,
    };

    return levels[level] >= levels[this.config.logLevel];
  }

  private formatLogEntry(entry: LogEntry): string {
    const timestamp = this.formatTimestamp(entry.timestamp);
    // Defense in depth (FIND-120): scrub secret/PII patterns from the message string too,
    // not just the structured context — in case a secret is ever interpolated into a message.
    let formatted = `[${timestamp}] [${entry.level}] ${scrubSecretsFromMessage(entry.message)}`;

    if (entry.context && Object.keys(entry.context).length > 0) {
      formatted += ` | Context: ${JSON.stringify(redactSecretsDeep(entry.context))}`;
    }

    return formatted;
  }

  private formatTimestamp(date: Date): string {
    switch (this.config.timestampFormat) {
      case 'iso':
        return date.toISOString();
      case 'short':
        return date.toLocaleString();
      case 'none':
        return '';
      default:
        return date.toISOString();
    }
  }

  /**
   * Safe console output that handles EPIPE errors gracefully
   */
  private safeConsoleOutput(level: LogEntry['level'], message: string): void {
    try {
      const consoleMethod = this.getConsoleMethod(level);
      consoleMethod(message);
    } catch (error) {
      // Handle EPIPE and other console errors gracefully
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === 'EPIPE') {
          // EPIPE means the output pipe is broken (client disconnected)
          // Disable console output to prevent further errors
          this.config.enableConsole = false;
          return;
        }
      }

      // For other errors, try stderr as fallback
      try {
        process.stderr.write(`Console output error: ${error}\n`);
      } catch {
        // If even stderr fails, give up silently
        this.config.enableConsole = false;
      }
    }
  }

  private getConsoleMethod(level: LogEntry['level']): (..._args: unknown[]) => void {
    switch (level) {
      case 'INFO':
        return console.log; // eslint-disable-line no-console
      case 'WARNING':
        return console.warn; // eslint-disable-line no-console
      case 'ERROR':
      case 'CRITICAL':
        return console.error;
      default:
        return console.log; // eslint-disable-line no-console
    }
  }

  private rotateLogFile(): void {
    // Preserve the previous log as <logFile>.1 instead of deleting it, so a prior
    // session's record survives a restart. Only one generation is kept.
    try {
      if (existsSync(this.config.logFile)) {
        const previous = `${this.config.logFile}.1`;
        try {
          if (existsSync(previous)) unlinkSync(previous);
        } catch {
          /* ignore */
        }
        renameSync(this.config.logFile, previous);
        try {
          chmodSync(previous, 0o600);
        } catch {
          /* best effort */
        }
      }
    } catch (error) {
      try {
        process.stderr.write(`Log rotation failed: ${error}\n`);
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Rotate the active log when it would exceed maxLogSize, keeping one generation.
   * Prevents unbounded growth (disk-fill) within a long-running session.
   */
  private maybeRotateBySize(nextChunkLength: number): void {
    if (!this.config.enableFile || !this.logStream) return;
    if (!(this.config.maxLogSize > 0)) return;
    if (this.bytesWritten + nextChunkLength <= this.config.maxLogSize) return;

    try {
      this.logStream.end();
    } catch {
      /* ignore */
    }
    this.logStream = undefined;
    this.rotateLogFile();
    this.bytesWritten = 0;
    this.createLogStream();
  }

  private createLogStream(): void {
    try {
      // 0o600: the log can contain query text and connection context — owner-only.
      this.logStream = createWriteStream(this.config.logFile, { flags: 'a', mode: 0o600 });
      // createWriteStream's `mode` only applies when the file is newly created. A log left
      // world-readable (0644) by a pre-fix version or prior umask keeps its old perms on
      // append, so explicitly tighten it (FIND-113).
      try {
        chmodSync(this.config.logFile, 0o600);
      } catch {
        /* best effort — file may not exist yet on some platforms */
      }
      this.bytesWritten = 0;

      this.logStream.on('error', (error) => {
        try {
          process.stderr.write(`Log stream error: ${error.message}\n`);
        } catch {
          /* ignore */
        }
      });
    } catch (error) {
      try {
        process.stderr.write(`Failed to create log stream: ${error}\n`);
      } catch {
        /* ignore */
      }
      this.config.enableFile = false;
    }
  }

  private serializeError(error: Error): Record<string, unknown> {
    return {
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack,
      // Include other enumerable properties from the error
      ...(error.constructor !== Error ? { constructor: error.constructor.name } : {}),
    };
  }

  private sanitizeConfig(): Partial<LoggerConfig> {
    // Return config without sensitive information
    return {
      logFile: this.config.logFile,
      enableConsole: this.config.enableConsole,
      enableFile: this.config.enableFile,
      logLevel: this.config.logLevel,
    };
  }
}

// ============================================================================
// Global Logger Instance
// ============================================================================

let globalLogger: Logger | undefined;

/**
 *
 */
export function getLogger(config?: LoggerConfig): Logger {
  if (!globalLogger) {
    globalLogger = new Logger(config);
  }
  return globalLogger;
}

/**
 *
 */
export async function initializeLogger(config?: LoggerConfig): Promise<Logger> {
  const logger = getLogger(config);
  await logger.initialize();
  return logger;
}

/**
 *
 */
export async function cleanupLogger(): Promise<void> {
  if (globalLogger) {
    await globalLogger.cleanup();
    globalLogger = undefined;
  }
}

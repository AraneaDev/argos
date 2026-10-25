/**
 * Centralized Error Handling Utilities
 * Provides consistent error handling and reporting across Argos
 */

import type { Logger } from './logger.js';

/**
 * Base SQL MCP Error class
 */
export class SQLMCPError extends Error {
  constructor(
    message: string,
    public _code: string,
    public _details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'SQLMCPError';
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert error to JSON representation
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this._code,
      details: this._details,
      stack: this.stack,
    };
  }
}

/**
 * Security violation error
 */
export class SecurityViolationError extends SQLMCPError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'SECURITY_VIOLATION', details);
    this.name = 'SecurityViolationError';
  }
}

/**
 * Database connection error
 */
export class ConnectionError extends SQLMCPError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONNECTION_ERROR', details);
    this.name = 'ConnectionError';
  }
}

/**
 * Query execution error
 */
export class QueryExecutionError extends SQLMCPError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'QUERY_EXECUTION_ERROR', details);
    this.name = 'QueryExecutionError';
  }
}

/**
 * Configuration error
 */
export class ConfigurationError extends SQLMCPError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFIGURATION_ERROR', details);
    this.name = 'ConfigurationError';
  }
}

/**
 * Schema error
 */
export class SchemaError extends SQLMCPError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'SCHEMA_ERROR', details);
    this.name = 'SchemaError';
  }
}

/**
 * SSH tunnel error
 */
export class SSHTunnelError extends SQLMCPError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'SSH_TUNNEL_ERROR', details);
    this.name = 'SSHTunnelError';
  }
}

/**
 * Circuit breaker open error
 */
export class CircuitOpenError extends ConnectionError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'CircuitOpenError';
  }
}

/**
 * Validation error
 */
export class ValidationError extends SQLMCPError {
  constructor(
    message: string,
    public field: string = 'unknown',
    details?: Record<string, unknown>
  ) {
    super(message, 'VALIDATION_ERROR', { field, ...details });
    this.name = 'ValidationError';
  }
}

/**
 * Timeout error
 */
export class TimeoutError extends SQLMCPError {
  constructor(
    message: string,
    public timeoutMs: number,
    details?: Record<string, unknown>
  ) {
    super(message, 'TIMEOUT_ERROR', { timeoutMs, ...details });
    this.name = 'TimeoutError';
  }
}

/**
 * Extract error message from unknown error type
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * Error categories for classification
 */
/* eslint-disable no-unused-vars */
export enum ErrorCategory {
  SECURITY = 'security',
  CONNECTION = 'connection',
  QUERY = 'query',
  CONFIGURATION = 'configuration',
  SCHEMA = 'schema',
  SSH = 'ssh',
  VALIDATION = 'validation',
  TIMEOUT = 'timeout',
  UNKNOWN = 'unknown',
}
/* eslint-enable no-unused-vars */

/**
 * Error severity levels
 */
/* eslint-disable no-unused-vars */
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}
/* eslint-enable no-unused-vars */

/**
 * Enhanced error information
 */
export interface ErrorInfo {
  category: ErrorCategory;
  severity: ErrorSeverity;
  userMessage: string;
  technicalMessage: string;
  recoverable: boolean;
  retryable: boolean;
  troubleshooting?: string[];
}

/**
 * Error handler class for centralized error management
 */
export class ErrorHandler {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Handle and classify errors
   */
  handleError(error: unknown, context?: string): ErrorInfo {
    const errorInfo = this.classifyError(error);

    // Log the error with appropriate level
    const logData = {
      error: error instanceof Error ? error.message : String(error),
      context,
      category: errorInfo.category,
      severity: errorInfo.severity,
      stack: error instanceof Error ? error.stack : undefined,
    };

    switch (errorInfo.severity) {
      case ErrorSeverity.CRITICAL:
        this.logger.error(`Critical error in ${context || 'unknown context'}`, logData);
        break;
      case ErrorSeverity.HIGH:
        this.logger.error(`High severity error in ${context || 'unknown context'}`, logData);
        break;
      case ErrorSeverity.MEDIUM:
        this.logger.warning(`Medium severity error in ${context || 'unknown context'}`, logData);
        break;
      case ErrorSeverity.LOW:
        this.logger.info(`Low severity error in ${context || 'unknown context'}`, logData);
        break;
    }

    return errorInfo;
  }

  /**
   * Classify errors into categories and determine severity
   */
  private classifyError(error: unknown): ErrorInfo {
    if (error instanceof SecurityViolationError) {
      return {
        category: ErrorCategory.SECURITY,
        severity: ErrorSeverity.HIGH,
        userMessage: 'Security policy violation',
        technicalMessage: error.message,
        recoverable: true,
        retryable: false,
        troubleshooting: [
          'Review the query for prohibited operations',
          'Check if the database is configured for SELECT-only mode',
          'Ensure the query complies with security limits',
          'Contact administrator for full access permissions if needed',
        ],
      };
    }

    if (error instanceof ConnectionError) {
      return {
        category: ErrorCategory.CONNECTION,
        severity: ErrorSeverity.HIGH,
        userMessage: 'Database connection failed',
        technicalMessage: error.message,
        recoverable: true,
        retryable: true,
        troubleshooting: [
          'Check database server is running',
          'Verify connection credentials',
          'Confirm network connectivity',
          'Check SSH tunnel configuration if applicable',
          'Review firewall settings',
        ],
      };
    }

    if (error instanceof QueryExecutionError) {
      return {
        category: ErrorCategory.QUERY,
        severity: ErrorSeverity.MEDIUM,
        userMessage: 'Query execution failed',
        technicalMessage: error.message,
        recoverable: true,
        retryable: false,
        troubleshooting: [
          'Review SQL syntax',
          'Check table and column names exist',
          'Verify data types in conditions',
          'Check for sufficient permissions',
          'Review query complexity limits',
        ],
      };
    }

    if (error instanceof ConfigurationError) {
      return {
        category: ErrorCategory.CONFIGURATION,
        severity: ErrorSeverity.CRITICAL,
        userMessage: 'Configuration error',
        technicalMessage: error.message,
        recoverable: true,
        retryable: false,
        troubleshooting: [
          'Check config.ini file syntax',
          'Verify all required fields are present',
          'Validate configuration values',
          'Run setup wizard to reconfigure',
          'Check file permissions',
        ],
      };
    }

    if (error instanceof SchemaError) {
      return {
        category: ErrorCategory.SCHEMA,
        severity: ErrorSeverity.MEDIUM,
        userMessage: 'Schema operation failed',
        technicalMessage: error.message,
        recoverable: true,
        retryable: true,
        troubleshooting: [
          'Ensure database connection is active',
          'Check database permissions for schema access',
          'Verify table names and structures',
          'Clear schema cache and retry',
          'Check for database structure changes',
        ],
      };
    }

    if (error instanceof SSHTunnelError) {
      return {
        category: ErrorCategory.SSH,
        severity: ErrorSeverity.HIGH,
        userMessage: 'SSH tunnel connection failed',
        technicalMessage: error.message,
        recoverable: true,
        retryable: true,
        troubleshooting: [
          'Check SSH server accessibility',
          'Verify SSH credentials',
          'Confirm SSH key permissions',
          'Check SSH port configuration',
          'Verify network connectivity to SSH host',
        ],
      };
    }

    if (error instanceof ValidationError) {
      return {
        category: ErrorCategory.VALIDATION,
        severity: ErrorSeverity.MEDIUM,
        userMessage: 'Invalid input provided',
        technicalMessage: error.message,
        recoverable: true,
        retryable: false,
        troubleshooting: [
          `Check the '${error.field}' field`,
          'Verify input format and constraints',
          'Review parameter requirements',
          'Check for required vs optional fields',
        ],
      };
    }

    if (error instanceof TimeoutError) {
      return {
        category: ErrorCategory.TIMEOUT,
        severity: ErrorSeverity.MEDIUM,
        userMessage: 'Operation timed out',
        technicalMessage: error.message,
        recoverable: true,
        retryable: true,
        troubleshooting: [
          `Operation exceeded ${error.timeoutMs}ms limit`,
          'Simplify the query to reduce execution time',
          'Check database performance',
          'Increase timeout limit if appropriate',
          'Review query optimization opportunities',
        ],
      };
    }

    // Handle standard Node.js errors
    if (error instanceof Error) {
      if (error.message.includes('ECONNREFUSED')) {
        return {
          category: ErrorCategory.CONNECTION,
          severity: ErrorSeverity.HIGH,
          userMessage: 'Connection refused',
          technicalMessage: error.message,
          recoverable: true,
          retryable: true,
          troubleshooting: [
            'Check if database server is running',
            'Verify correct host and port',
            'Check firewall settings',
            'Confirm network connectivity',
          ],
        };
      }

      if (error.message.includes('ENOTFOUND')) {
        return {
          category: ErrorCategory.CONNECTION,
          severity: ErrorSeverity.HIGH,
          userMessage: 'Host not found',
          technicalMessage: error.message,
          recoverable: true,
          retryable: true,
          troubleshooting: [
            'Check hostname spelling',
            'Verify DNS resolution',
            'Check network connectivity',
            'Try using IP address instead of hostname',
          ],
        };
      }

      if (error.message.includes('ETIMEDOUT')) {
        return {
          category: ErrorCategory.TIMEOUT,
          severity: ErrorSeverity.MEDIUM,
          userMessage: 'Connection timed out',
          technicalMessage: error.message,
          recoverable: true,
          retryable: true,
          troubleshooting: [
            'Check network connectivity',
            'Verify server responsiveness',
            'Increase timeout values',
            'Check for network latency issues',
          ],
        };
      }

      if (error.message.includes('EACCES') || error.message.includes('permission denied')) {
        return {
          category: ErrorCategory.CONFIGURATION,
          severity: ErrorSeverity.HIGH,
          userMessage: 'Permission denied',
          technicalMessage: error.message,
          recoverable: true,
          retryable: false,
          troubleshooting: [
            'Check file permissions',
            'Verify user has required access',
            'Check SSH key permissions',
            'Run with appropriate privileges',
          ],
        };
      }
    }

    // Default classification for unknown errors
    return {
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.MEDIUM,
      userMessage: 'An unexpected error occurred',
      technicalMessage: error instanceof Error ? error.message : String(error),
      recoverable: true,
      retryable: false,
      troubleshooting: [
        'Check server logs for more details',
        'Verify all configuration settings',
        'Try the operation again',
        'Contact support if the issue persists',
      ],
    };
  }

  /**
   * Format error for user display
   */
  formatUserError(error: unknown, context?: string): string {
    const errorInfo = this.handleError(error, context);

    let message = ` **Error**: ${errorInfo.userMessage}\n`;
    // Sanitize the technical detail — it may carry raw driver text (FIND-119).
    message += ` **Details**: ${sanitizeMessage(errorInfo.technicalMessage)}\n`;

    if (errorInfo.troubleshooting && errorInfo.troubleshooting.length > 0) {
      message += `\n **Troubleshooting:**\n`;
      for (const tip of errorInfo.troubleshooting) {
        message += ` - ${tip}\n`;
      }
    }

    if (errorInfo.retryable) {
      message += `\n This operation can be retried.`;
    }

    return message;
  }

  /**
   * Format error for MCP tool response
   */
  formatToolError(error: unknown, toolName: string): string {
    const errorInfo = this.handleError(error, `tool:${toolName}`);

    let message = ` **${toolName} Failed**\n\n`;
    message += ` **Error**: ${errorInfo.userMessage}\n`;
    // Sanitize the technical detail — it may carry raw driver text (FIND-119).
    message += ` **Details**: ${sanitizeMessage(errorInfo.technicalMessage)}\n`;

    if (errorInfo.troubleshooting && errorInfo.troubleshooting.length > 0) {
      message += `\n **Troubleshooting Steps:**\n`;
      for (const tip of errorInfo.troubleshooting) {
        message += ` - ${tip}\n`;
      }
    }

    return message;
  }

  /**
   * Check if error is recoverable
   */
  isRecoverable(error: unknown): boolean {
    const errorInfo = this.classifyError(error);
    return errorInfo.recoverable;
  }

  /**
   * Check if error is retryable
   */
  isRetryable(error: unknown): boolean {
    const errorInfo = this.classifyError(error);
    return errorInfo.retryable;
  }

  /**
   * Get error severity
   */
  getErrorSeverity(error: unknown): ErrorSeverity {
    const errorInfo = this.classifyError(error);
    return errorInfo.severity;
  }
}

/**
 * Create a sanitized error message for security
 */
export function sanitizeError(error: unknown): string {
  if (error instanceof SecurityViolationError) {
    // Already sanitized for security violations
    return error.message;
  }

  if (error instanceof Error) {
    return sanitizeMessage(error.message);
  }

  return 'Unknown error occurred';
}

/**
 * Sanitize a raw error message string by removing sensitive information.
 * Shared by both sanitizeError and SecurityManager.sanitizeErrorMessage.
 */
export function sanitizeMessage(message: string): string {
  // Strip PEM key blocks entirely (private keys, certificates).
  message = message.replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[REDACTED KEY]');

  // Bearer / authorization tokens (no key=value shape).
  message = message.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]');

  // Remove potential sensitive data leaks. Allow whitespace around the separator so
  // "password = secret" is caught as well as "password=secret".
  //
  // A quoted value is consumed whole. Matching only up to the first space left
  // the tail of anything containing one in the message: password='my secret pass'
  // became password=[REDACTED] secret pass'. An unquoted value still stops at
  // whitespace, so an explanation following the value survives.
  message = message.replace(
    /(password|passwd|pwd|passphrase|token|secret|key|api[_-]?key|authorization|credentials?)\s*[=:]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi,
    '$1=[REDACTED]'
  );

  // Remove potential connection strings
  message = message.replace(/[a-zA-Z0-9]+:\/\/[^\s]+/g, '<connection_string>');

  // Mask email addresses (PII commonly surfaced in unique-constraint violations, e.g.
  // `Key (email)=(jane@corp.com) already exists`).
  message = message.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '<email>');

  // Mask database usernames disclosed in driver auth errors
  // (`for user "readonly_user"`, `user 'root'@'10.0.0.5'`).
  message = message.replace(/\b(for\s+user|user)\s+["']([^"']+)["']/gi, '$1 <user>');

  // Mask bare host:port / IPv4:port tokens that leak internal network topology
  // (`ECONNREFUSED 10.0.0.5:5432`, `connect ETIMEDOUT db.internal.corp:3306`).
  message = message.replace(
    /\b(?:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+):\d{2,5}\b/g,
    '<host:port>'
  );

  // Remove file paths that might contain sensitive info
  message = message.replace(/[C-Z]:\\[^\s,;]+/gi, '<file_path>');
  message = message.replace(/(?<![a-zA-Z0-9._-])(?:\/[a-zA-Z0-9._-]+){2,}/g, '<file_path>');

  // Mask credit card numbers
  message = message.replace(/\b\d{4}-\d{4}-\d{4}-\d{4}\b/g, 'XXXX-XXXX-XXXX-XXXX');

  // Mask SSN format
  message = message.replace(/\b\d{3}-\d{2}-\d{4}\b/g, 'XXX-XX-XXXX');

  // Limit message length to prevent information leakage
  message = message.substring(0, 500);

  return message;
}

/**
 * Wrap async functions with error handling
 */
export function withErrorHandling<T extends (..._args: unknown[]) => Promise<unknown>>(
  fn: T,
  errorHandler: ErrorHandler,
  context: string
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      errorHandler.handleError(error, context);
      throw error;
    }
  }) as T;
}

/**
 * Create error response for MCP tools
 */
export function createErrorResponse(
  error: unknown,
  toolName: string
): {
  content: Array<{ type: 'text'; text: string }>;
  isError: boolean;
  _meta: { progressToken: null };
} {
  // Sanitize before surfacing — this helper builds client-facing text from a raw error
  // message and must not leak driver detail if it is ever wired into a response (FIND-119).
  const errorMessage = sanitizeMessage(error instanceof Error ? error.message : String(error));
  const troubleshooting = [
    '**Troubleshooting:**',
    '- Check that all required parameters are provided',
    '- Verify database connection is working',
    '- Review server logs for more details',
    '- Ensure proper permissions are configured',
  ].join('\n');

  return {
    content: [
      {
        type: 'text',
        text: ` Error in ${toolName}: ${errorMessage}\n\n${troubleshooting}`,
      },
    ],
    isError: true,
    _meta: { progressToken: null },
  };
}

/**
 * Export all error types for easy importing
 * (Classes are already exported inline above)
 */

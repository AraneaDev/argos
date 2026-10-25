/**
 * Centralized Error Handling Utilities
 * Provides consistent error handling and reporting across Argos
 */

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
 * Configuration error
 */
export class ConfigurationError extends SQLMCPError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFIGURATION_ERROR', details);
    this.name = 'ConfigurationError';
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
 * Extract error message from unknown error type
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * Error categories for classification
 */
 
 

/**
 * Error severity levels
 */
 
 

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
 * Used by sanitizeError and by SQLMCPServer when it logs tool arguments.
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
 * Export all error types for easy importing
 * (Classes are already exported inline above)
 */

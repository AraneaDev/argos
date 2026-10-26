/**
 * Configuration Loading and Validation Utilities
 * Handles loading and validating database configuration from config.ini
 */

import { readFileSync, existsSync, writeFileSync, statSync, mkdirSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { parse as parseIni } from 'ini';

import type {
  DatabaseConfig,
  DatabaseTypeString,
  ParsedServerConfig,
  ParsedSecurityConfig,
  ParsedExtensionConfig,
  DatabaseRedactionConfig,
  FieldRedactionRule,
} from '../types/index.js';
import {
  isValidRedactionType,
  DEFAULT_DATABASE_PORTS,
  MSSQL_AUTHENTICATION_MODES,
} from '../types/index.js';
import { getErrorMessage } from './error-handler.js';

/**
 * Configuration validation error
 */
export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public _field: string,
    public _database?: string
  ) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

export interface ConfigFieldError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ConfigFieldError[];
}

/**
 * What the parser actually produces. `security` and `extension` are optional on
 * ParsedServerConfig because a config object can be assembled by hand, but
 * parseSecurityConfig and parseExtensionConfig both fall back to defaults, so
 * anything that came out of parseConfiguration has them. Saying so here means
 * callers of the parser do not need a guard that can never be false.
 */
export type FullyParsedConfig = ParsedServerConfig & {
  security: ParsedSecurityConfig;
  extension: ParsedExtensionConfig;
};

const SHELL_METACHAR_RE = /[;&|$()><]/;
const EMBEDDED_CREDENTIALS_RE = /[^@]+:[^@]+@/;

/**
 * Azure CLI authentication takes its identity from the signed-in `az` session,
 * so a username and password are not merely optional but absent by design.
 * Every credential check has to agree on that, or a config valid at parse time
 * fails at connect time (or the reverse).
 */
export function usesAzureCliAuth(config: Pick<DatabaseConfig, 'type' | 'authentication'>): boolean {
  return config.type === 'mssql' && config.authentication === 'azure-cli';
}

/**
 *
 */
export function validateDatabaseConfig(config: DatabaseConfig): ValidationResult {
  const errors: ConfigFieldError[] = [];
  const t = config.type;

  if (t === 'mysql' || t === 'postgresql' || t === 'mssql') {
    if (!config.host) errors.push({ field: 'host', message: 'host is required' });
    if (!config.port) errors.push({ field: 'port', message: 'port is required' });
    if (!usesAzureCliAuth(config)) {
      if (!(config as unknown as Record<string, unknown>).user && !config.username)
        errors.push({ field: 'user', message: 'user is required' });
      if (!config.password) errors.push({ field: 'password', message: 'password is required' });
    }
    if (!config.database) errors.push({ field: 'database', message: 'database is required' });
  }
  if (t === 'sqlite') {
    if (
      !(config as unknown as Record<string, unknown>).filename &&
      !(config as unknown as Record<string, unknown>).file
    )
      errors.push({ field: 'filename', message: 'filename is required for sqlite' });
  }
  if (config.host) {
    if (EMBEDDED_CREDENTIALS_RE.test(config.host)) {
      errors.push({
        field: 'host',
        message: 'host must not contain embedded credentials (user:pass@host)',
      });
    }
  }
  if (config.port !== undefined) {
    const p = Number(config.port);
    if (isNaN(p) || p < 1 || p > 65535) {
      errors.push({ field: 'port', message: 'port must be between 1 and 65535' });
    }
  }
  if (config.database && SHELL_METACHAR_RE.test(config.database)) {
    errors.push({ field: 'database', message: 'database name contains invalid characters' });
  }

  // Reject newlines in all string values to prevent INI injection
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string' && /[\r\n]/.test(value)) {
      errors.push({
        field: key,
        message: `${key} must not contain newlines to prevent INI injection`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Load configuration from config.ini file
 */
export function loadConfiguration(configPath?: string): FullyParsedConfig {
  const path = configPath || join(process.cwd(), 'config.ini');

  if (!existsSync(path)) {
    throw new Error(
      `Configuration file not found: ${path}. Run setup to create initial configuration.`
    );
  }

  try {
    // Warn if config file is group- or world-readable (mask 0o044 covers both)
    try {
      const stat = statSync(path);
      const mode = stat.mode & 0o777;
      if (mode & 0o044) {
        process.stderr.write(
          `WARNING: Config file ${path} is group- or world-readable ` +
            `(mode ${mode.toString(8).padStart(3, '0')}). ` +
            `It contains credentials. Run: chmod 600 ${path}\n`
        );
      }
    } catch {
      // statSync failure is non-fatal — proceed with load
    }

    const configContent = readFileSync(path, 'utf-8');
    const rawConfig = parseIni(configContent);

    return parseConfiguration(rawConfig);
  } catch (error) {
    throw new Error(`Failed to load configuration from ${path}: ${getErrorMessage(error)}`, {
      cause: error,
    });
  }
}

/**
 * Parse raw INI configuration into typed configuration
 */
export function parseConfiguration(rawConfig: Record<string, unknown>): FullyParsedConfig {
  const databases: Record<string, DatabaseConfig> = {};

  // Handle nested database configurations (database.name.property)
  if (rawConfig.database && typeof rawConfig.database === 'object') {
    for (const [name, config] of Object.entries(rawConfig.database)) {
      if (typeof config === 'object') {
        databases[name] = parseDatabaseConfig(name, config as Record<string, string>);
      }
    }
  }

  // Handle flat database configurations (database.name format)
  const dbKeys = Object.keys(rawConfig).filter((key) => key.startsWith('database.'));
  for (const key of dbKeys) {
    const dbName = key.replace('database.', '');
    if (!databases[dbName] && typeof rawConfig[key] === 'object') {
      databases[dbName] = parseDatabaseConfig(dbName, rawConfig[key] as Record<string, string>);
    }
  }

  // Validate we have at least one database
  if (Object.keys(databases).length === 0) {
    throw new ConfigValidationError('No databases configured', 'databases');
  }

  const extension = parseExtensionConfig(rawConfig.extension as Record<string, string> | undefined);

  // Propagate global result/timeout limits onto each database so the adapters and
  // the query-timeout logic actually honor the configured [extension] values
  // (they read these off the per-database config, not the global one).
  for (const dbConfig of Object.values(databases)) {
    if (dbConfig.max_rows === undefined) dbConfig.max_rows = extension.max_rows;
    if (dbConfig.query_timeout === undefined) dbConfig.query_timeout = extension.query_timeout;
  }

  return {
    databases,
    security: parseSecurityConfig(rawConfig.security as Record<string, string> | undefined),
    extension,
  };
}

/**
 * Parse individual database configuration
 */
export function parseDatabaseConfig(name: string, config: Record<string, string>): DatabaseConfig {
  // Validate required type field
  if (!config.type) {
    throw new ConfigValidationError(
      `Database '${name}' missing required 'type' field`,
      'type',
      name
    );
  }

  const validTypes = ['mysql', 'postgresql', 'postgres', 'sqlite', 'mssql', 'sqlserver'];
  if (!validTypes.includes(config.type.toLowerCase())) {
    throw new ConfigValidationError(
      `Database '${name}' has invalid type '${config.type}'. Valid types: ${validTypes.join(', ')}`,
      'type',
      name
    );
  }

  const dbConfig: DatabaseConfig = {
    type: config.type.toLowerCase() as DatabaseTypeString,
    // Fail secure: default to SELECT-only (read-only) unless explicitly disabled.
    // An omitted select_only must NOT silently grant write access.
    select_only:
      config.select_only === undefined ? true : parseBool(config.select_only, 'select_only', name),
    mcp_configurable: parseBool(config.mcp_configurable, 'mcp_configurable', name),
  };

  // Handle SQLite specific configuration
  if (dbConfig.type === 'sqlite') {
    if (!config.file) {
      throw new ConfigValidationError(
        `SQLite database '${name}' missing required 'file' field`,
        'file',
        name
      );
    }
    dbConfig.file = config.file;
  } else {
    // Handle other database types
    validateNetworkedDatabase(name, config, dbConfig);
  }

  // Parse SSH configuration if present
  if (config.ssh_host) {
    parseSSHConfig(name, config, dbConfig);
  }

  // Parse redaction configuration if present
  if (parseBool(config.redaction_enabled, 'redaction_enabled', name)) {
    dbConfig.redaction = parseRedactionConfig(name, config);
  }

  return dbConfig;
}

const AZURE_TENANT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse and validate the optional 'azure_tenant_id' key.
 *
 * A tenant only means something to the Azure CLI credential, so setting it
 * without that credential is a mistake worth naming rather than ignoring. The
 * GUID check catches the likelier typo: a tenant's display name in place of its
 * id, which otherwise fails much later as an opaque auth error.
 */
function parseAzureTenantId(
  name: string,
  config: Record<string, string>,
  dbConfig: DatabaseConfig
): void {
  if (config.azure_tenant_id === undefined) {
    return;
  }

  const tenant = config.azure_tenant_id.trim();

  if (!usesAzureCliAuth(dbConfig)) {
    throw new ConfigValidationError(
      `Database '${name}' sets 'azure_tenant_id' but that requires authentication=azure-cli`,
      'azure_tenant_id',
      name
    );
  }

  if (!AZURE_TENANT_ID_RE.test(tenant)) {
    throw new ConfigValidationError(
      `Database '${name}' has invalid azure_tenant_id '${config.azure_tenant_id}'. ` +
        'Expected a GUID, for example 00000000-0000-0000-0000-000000000000',
      'azure_tenant_id',
      name
    );
  }

  dbConfig.azure_tenant_id = tenant;
}

/**
 * Parse and validate the optional 'authentication' key.
 *
 * Only the SQL Server adapter can act on it, so accepting it elsewhere would
 * mean silently ignoring a key the user believed changed how they authenticate.
 */
function parseAuthentication(
  name: string,
  config: Record<string, string>,
  dbConfig: DatabaseConfig
): void {
  if (config.authentication === undefined) {
    return;
  }

  const mode = config.authentication.trim().toLowerCase();

  if (dbConfig.type !== 'mssql') {
    throw new ConfigValidationError(
      `Database '${name}' sets 'authentication' but that is only supported for type 'mssql'`,
      'authentication',
      name
    );
  }

  if (!(MSSQL_AUTHENTICATION_MODES as readonly string[]).includes(mode)) {
    throw new ConfigValidationError(
      `Database '${name}' has invalid authentication '${config.authentication}'. ` +
        `Valid values: ${MSSQL_AUTHENTICATION_MODES.join(', ')}`,
      'authentication',
      name
    );
  }

  dbConfig.authentication = mode as DatabaseConfig['authentication'];

  // The adapter forces encryption on for token authentication. Accepting
  // encrypt=false here would mean quietly doing the opposite of what the file
  // says, so an explicit one is a startup error instead.
  if (mode === 'azure-cli' && config.encrypt !== undefined) {
    if (!parseBool(config.encrypt, 'encrypt', name)) {
      throw new ConfigValidationError(
        `Database '${name}' sets encrypt=false with authentication=azure-cli. ` +
          'An access token requires a verified, encrypted connection; remove encrypt or set it to true',
        'encrypt',
        name
      );
    }
  }
}

/**
 * Validate networked database configuration (non-SQLite)
 */
function validateNetworkedDatabase(
  name: string,
  config: Record<string, string>,
  dbConfig: DatabaseConfig
): void {
  // Validate required fields
  if (!config.host) {
    throw new ConfigValidationError(
      `Database '${name}' missing required 'host' field`,
      'host',
      name
    );
  }
  parseAuthentication(name, config, dbConfig);
  parseAzureTenantId(name, config, dbConfig);

  if (!config.username && !usesAzureCliAuth(dbConfig)) {
    throw new ConfigValidationError(
      `Database '${name}' missing required 'username' field`,
      'username',
      name
    );
  }

  // SQL Server has no passwordless login, so a missing password there is a
  // mistake worth catching at startup. It stays a warning-free omission for the
  // other engines, where peer/trust auth and .pgpass are legitimate.
  if (dbConfig.type === 'mssql' && !config.password && !usesAzureCliAuth(dbConfig)) {
    throw new ConfigValidationError(
      `Database '${name}' missing required 'password' field`,
      'password',
      name
    );
  }

  dbConfig.host = config.host;
  dbConfig.port =
    parseInt(config.port) || (DEFAULT_DATABASE_PORTS[dbConfig.type as DatabaseTypeString] ?? 0);
  dbConfig.database = config.database;
  dbConfig.username = config.username;
  dbConfig.password = config.password;
  dbConfig.ssl = parseBool(config.ssl, 'ssl', name);
  // Leave ssl_verify undefined when unset so the adapter default (verify ON) applies.
  // parseBool(undefined) would return false and silently disable certificate validation.
  if (config.ssl_verify !== undefined) {
    dbConfig.ssl_verify = parseBool(config.ssl_verify, 'ssl_verify', name);
  }

  // Validate timeout
  const timeout = parseInt(config.timeout);
  dbConfig.timeout = isNaN(timeout) ? 30000 : Math.max(1000, Math.min(300000, timeout));

  // Validate port range
  if (dbConfig.port && (dbConfig.port < 1 || dbConfig.port > 65535)) {
    throw new ConfigValidationError(
      `Database '${name}' has invalid port '${dbConfig.port}'. Port must be between 1 and 65535`,
      'port',
      name
    );
  }
}

/**
 * Parse SSH configuration
 */
function parseSSHConfig(
  name: string,
  config: Record<string, string>,
  dbConfig: DatabaseConfig
): void {
  dbConfig.ssh_host = config.ssh_host;

  const sshPort = parseInt(config.ssh_port);
  dbConfig.ssh_port = isNaN(sshPort) ? 22 : sshPort;

  if (dbConfig.ssh_port < 1 || dbConfig.ssh_port > 65535) {
    throw new ConfigValidationError(
      `Database '${name}' has invalid SSH port '${dbConfig.ssh_port}'. Port must be between 1 and 65535`,
      'ssh_port',
      name
    );
  }

  dbConfig.ssh_username = config.ssh_username;
  dbConfig.ssh_password = config.ssh_password;
  dbConfig.ssh_private_key = config.ssh_private_key;
  dbConfig.ssh_passphrase = config.ssh_passphrase;
  dbConfig.ssh_local_host = config.ssh_local_host || '127.0.0.1';
  if (config.ssh_host_fingerprint) {
    dbConfig.ssh_host_fingerprint = config.ssh_host_fingerprint;
  }
  // Fail secure: host key checking is ON unless explicitly disabled.
  dbConfig.ssh_strict_host_key_checking =
    config.ssh_strict_host_key_checking === undefined
      ? true
      : parseBool(config.ssh_strict_host_key_checking, 'ssh_strict_host_key_checking', name);

  // Parse local_port for SSH tunnel (new feature)
  if (config.local_port !== undefined && config.local_port !== '') {
    const localPort = parseInt(config.local_port);
    if (!isNaN(localPort) && localPort > 0 && localPort < 65536) {
      dbConfig.local_port = localPort;
    } else if (config.local_port !== '0') {
      // 0 means auto-assign
      throw new ConfigValidationError(
        `Database '${name}' has invalid local_port '${config.local_port}'. Port must be between 1 and 65535, or 0 for auto-assignment`,
        'local_port',
        name
      );
    }
  }

  // Validate SSH authentication method
  if (!dbConfig.ssh_password && !dbConfig.ssh_private_key) {
    throw new ConfigValidationError(
      `Database '${name}' SSH configuration requires either 'ssh_password' or 'ssh_private_key'`,
      'ssh_authentication',
      name
    );
  }
}

/**
 * Parse redaction configuration from config section
 */
function parseRedactionConfig(
  dbName: string,
  config: Record<string, string>
): DatabaseRedactionConfig {
  const redactionConfig: DatabaseRedactionConfig = {
    enabled: true,
    rules: [],
    log_redacted_access: parseBool(config.redaction_log_access, 'redaction_log_access', dbName),
    audit_redacted_queries: parseBool(
      config.redaction_audit_queries,
      'redaction_audit_queries',
      dbName
    ),
    case_sensitive_matching: parseBool(
      config.redaction_case_sensitive,
      'redaction_case_sensitive',
      dbName
    ),
  };

  // Parse redaction rules from configuration
  if (config.redaction_rules && typeof config.redaction_rules === 'string') {
    try {
      redactionConfig.rules = parseRedactionRules(config.redaction_rules);
    } catch (error) {
      throw new ConfigValidationError(
        `Database '${dbName}' has invalid redaction rules: ${getErrorMessage(error)}`,
        'redaction_rules',
        dbName
      );
    }
  }

  // Parse default replacement text
  if (config.redaction_replacement_text) {
    redactionConfig.default_redaction = {
      redaction_type: 'replace',
      replacement_text: config.redaction_replacement_text,
    };
  }

  return redactionConfig;
}

/**
 * Parse redaction rules from string format
 * Expected format: "email:partial_mask,phone:full_mask,ssn:replace:[PROTECTED]"
 */
function parseRedactionRules(rulesString: string): FieldRedactionRule[] {
  const rules: FieldRedactionRule[] = [];

  const ruleDefinitions = rulesString.split(',');

  for (const ruleDef of ruleDefinitions) {
    const trimmedRule = ruleDef.trim();
    if (!trimmedRule) continue;

    const parts = trimmedRule.split(':');
    if (parts.length < 2) {
      throw new ConfigValidationError(
        `Invalid redaction rule format: ${ruleDef}. Expected format: field:type[:options]`,
        'redaction_rules'
      );
    }

    let fieldPattern = parts[0].trim();
    const redactionTypeStr = parts[1].trim();

    if (!fieldPattern) {
      throw new ConfigValidationError(
        `Empty field pattern in redaction rule: ${ruleDef}`,
        'redaction_rules'
      );
    }

    if (!isValidRedactionType(redactionTypeStr)) {
      throw new ConfigValidationError(
        `Invalid redaction type '${redactionTypeStr}' in rule: ${ruleDef}. Valid types: full_mask, partial_mask, replace, custom`,
        'redaction_rules'
      );
    }

    // Determine pattern type based on field pattern
    let patternType: FieldRedactionRule['pattern_type'] = 'exact';
    if (fieldPattern.includes('*')) {
      patternType = 'wildcard';
    } else if (fieldPattern.startsWith('/') && fieldPattern.endsWith('/')) {
      patternType = 'regex';
      // Remove the surrounding /.../ delimiters so the stored pattern compiles correctly.
      fieldPattern = fieldPattern.slice(1, -1);
    }

    const rule: FieldRedactionRule = {
      field_pattern: fieldPattern,
      pattern_type: patternType,
      redaction_type: redactionTypeStr as FieldRedactionRule['redaction_type'],
      preserve_format: redactionTypeStr === 'partial_mask',
    };

    // Handle additional options
    if (parts.length > 2) {
      const optionsStr = parts.slice(2).join(':');

      if (redactionTypeStr === 'replace') {
        rule.replacement_text = optionsStr || '[REDACTED]';
      } else if (redactionTypeStr === 'custom') {
        rule.replacement_text = optionsStr || '[REDACTED]';
        rule.custom_pattern = optionsStr;
      }
    } else if (redactionTypeStr === 'replace') {
      rule.replacement_text = '[REDACTED]';
    }

    rules.push(rule);
  }

  return rules;
}

/**
 * Parse security configuration
 */
function parseSecurityConfig(securityRaw?: Record<string, string>): ParsedSecurityConfig {
  if (!securityRaw || typeof securityRaw !== 'object') {
    return {
      max_joins: 10,
      max_subqueries: 5,
      max_unions: 3,
      max_group_bys: 5,
      max_complexity_score: 100,
      max_query_length: 10000,
    };
  }

  const security: ParsedSecurityConfig = {
    max_joins: parseInt(securityRaw.max_joins || '10') || 10,
    max_subqueries: parseInt(securityRaw.max_subqueries || '5') || 5,
    max_unions: parseInt(securityRaw.max_unions || '3') || 3,
    max_group_bys: parseInt(securityRaw.max_group_bys || '5') || 5,
    max_complexity_score: parseInt(securityRaw.max_complexity_score || '100') || 100,
    max_query_length: parseInt(securityRaw.max_query_length || '10000') || 10000,
  };

  // Validate security limits
  if (security.max_joins < 0 || security.max_joins > 100) {
    throw new ConfigValidationError('max_joins must be between 0 and 100', 'max_joins');
  }
  if (security.max_subqueries < 0 || security.max_subqueries > 50) {
    throw new ConfigValidationError('max_subqueries must be between 0 and 50', 'max_subqueries');
  }
  if (security.max_unions < 0 || security.max_unions > 20) {
    throw new ConfigValidationError('max_unions must be between 0 and 20', 'max_unions');
  }
  if (security.max_group_bys < 0 || security.max_group_bys > 50) {
    throw new ConfigValidationError('max_group_bys must be between 0 and 50', 'max_group_bys');
  }
  if (security.max_complexity_score < 1 || security.max_complexity_score > 1000) {
    throw new ConfigValidationError(
      'max_complexity_score must be between 1 and 1000',
      'max_complexity_score'
    );
  }
  if (security.max_query_length < 100 || security.max_query_length > 100000) {
    throw new ConfigValidationError(
      'max_query_length must be between 100 and 100000',
      'max_query_length'
    );
  }

  return security;
}

/**
 * Parse extension configuration
 */
function parseExtensionConfig(extensionRaw?: Record<string, string>): ParsedExtensionConfig {
  if (!extensionRaw || typeof extensionRaw !== 'object') {
    return {
      max_rows: 1000,
      max_batch_size: 10,
      query_timeout: 30000,
    };
  }

  const extension: ParsedExtensionConfig = {
    max_rows: parseInt(extensionRaw.max_rows || '1000') || 1000,
    max_batch_size: parseInt(extensionRaw.max_batch_size || '10') || 10,
    query_timeout: parseInt(extensionRaw.query_timeout || '30000') || 30000,
  };

  // Validate extension limits
  if (extension.max_rows < 1 || extension.max_rows > 50000) {
    throw new ConfigValidationError('max_rows must be between 1 and 50000', 'max_rows');
  }
  if (extension.max_batch_size < 1 || extension.max_batch_size > 100) {
    throw new ConfigValidationError('max_batch_size must be between 1 and 100', 'max_batch_size');
  }

  return extension;
}

/**
 * Validate configuration object
 */
export function validateConfiguration(config: ParsedServerConfig): void {
  // Check if databases exist
  if (!config.databases || Object.keys(config.databases).length === 0) {
    throw new ConfigValidationError('No databases configured', 'databases');
  }

  // Validate each database configuration
  for (const [name, dbConfig] of Object.entries(config.databases)) {
    validateDatabaseConfiguration(name, dbConfig);
  }
}

/**
 * Validate individual database configuration
 */
function validateDatabaseConfiguration(name: string, config: DatabaseConfig): void {
  // Run the exported validator and log any warnings
  const result = validateDatabaseConfig(config);
  if (!result.valid) {
    for (const err of result.errors) {
      // eslint-disable-next-line no-console -- logger.ts uses ESM imports incompatible with this module's test harness
      console.warn(`[config] Database '${name}' validation warning: ${err.field}: ${err.message}`);
    }
  }

  // Type validation is already done during parsing

  // Additional runtime validations
  if (config.type !== 'sqlite') {
    if (!config.host) {
      throw new ConfigValidationError(`Database '${name}' missing host`, 'host', name);
    }
    if (!config.username && !usesAzureCliAuth(config)) {
      throw new ConfigValidationError(`Database '${name}' missing username`, 'username', name);
    }
  } else {
    if (!config.file) {
      throw new ConfigValidationError(`SQLite database '${name}' missing file path`, 'file', name);
    }
  }
}

/**
 * Get environment variable with optional default value
 */
export function getEnvironmentVariable(name: string, defaultValue?: string): string | undefined {
  return process.env[name] || defaultValue;
}

/**
 * Check if configuration file exists
 */
export function configurationExists(configPath?: string): boolean {
  const path = configPath || join(process.cwd(), 'config.ini');
  return existsSync(path);
}

/**
 * Get configuration file path
 */
export function getConfigurationPath(configPath?: string): string {
  return configPath || join(process.cwd(), 'config.ini');
}

/**
 * Load config using the simpler interface expected by setup modules
 */
export const loadConfig = loadConfiguration;

/**
 * Validate config using the interface expected by setup modules
 */
export const validateConfig = validateConfiguration;

/**
 * Save configuration file
 */
export function saveConfigFile(config: ParsedServerConfig, configPath?: string): void {
  const path = getConfigurationPath(configPath);

  // Convert back to INI format manually to avoid dot escaping
  let iniString = '';

  // Convert databases
  if (config.databases) {
    for (const [name, dbConfig] of Object.entries(config.databases)) {
      iniString += `[database.${name}]\n`;
      for (const [key, value] of Object.entries(dbConfig)) {
        if (
          value !== undefined &&
          value !== null &&
          key !== 'redaction' &&
          key !== 'mcp_configurable'
        ) {
          if (key === 'ssh_private_key' && String(value).includes('-----BEGIN')) {
            try {
              const configDir = dirname(path);
              const keysDir = join(configDir, 'keys');
              if (!existsSync(keysDir)) {
                mkdirSync(keysDir, { recursive: true });
              }
              const keyPath = join(keysDir, `${name}_ssh_key`);
              writeFileSync(keyPath, String(value), { mode: 0o600 });
              iniString += `${key}=${keyPath}\n`;
            } catch (keyError) {
              // Never inline a private key into the (potentially group-readable) INI.
              // Fail loudly so the operator can fix permissions rather than leak the key.
              throw new Error(
                `Failed to write SSH private key for '${name}' to a protected key file: ` +
                  `${getErrorMessage(keyError)}. Refusing to embed the private key in config.ini.`,
                { cause: keyError }
              );
            }
          } else {
            iniString += `${key}=${value}\n`;
          }
        }
      }

      // Write mcp_configurable flag explicitly
      if (dbConfig.mcp_configurable !== undefined) {
        iniString += `mcp_configurable=${dbConfig.mcp_configurable}\n`;
      }

      // Handle redaction configuration separately
      if (dbConfig.redaction?.enabled) {
        iniString += 'redaction_enabled=true\n';

        if (dbConfig.redaction.rules.length > 0) {
          const rulesString = dbConfig.redaction.rules
            .map((rule: FieldRedactionRule) => {
              let ruleStr = `${rule.field_pattern}:${rule.redaction_type}`;
              if (
                rule.replacement_text &&
                (rule.redaction_type === 'replace' || rule.redaction_type === 'custom')
              ) {
                ruleStr += `:${rule.replacement_text}`;
              }
              return ruleStr;
            })
            .join(',');
          iniString += `redaction_rules=${rulesString}\n`;
        }

        if (dbConfig.redaction.default_redaction?.replacement_text) {
          iniString += `redaction_replacement_text=${dbConfig.redaction.default_redaction.replacement_text}\n`;
        }

        if (dbConfig.redaction.log_redacted_access) {
          iniString += 'redaction_log_access=true\n';
        }

        if (dbConfig.redaction.audit_redacted_queries) {
          iniString += 'redaction_audit_queries=true\n';
        }

        if (dbConfig.redaction.case_sensitive_matching) {
          iniString += 'redaction_case_sensitive=true\n';
        }
      }

      iniString += '\n';
    }
  }

  // Convert security config
  if (config.security) {
    iniString += '[security]\n';
    for (const [key, value] of Object.entries(config.security)) {
      if (value !== undefined && value !== null) {
        iniString += `${key}=${value}\n`;
      }
    }
    iniString += '\n';
  }

  // Convert extension config
  if (config.extension) {
    iniString += '[extension]\n';
    for (const [key, value] of Object.entries(config.extension)) {
      if (value !== undefined && value !== null) {
        iniString += `${key}=${value}\n`;
      }
    }
    iniString += '\n';
  }

  // Write atomically (temp file + rename) so a concurrent or interrupted save cannot
  // leave a truncated/corrupt config.ini. 0o600: the file holds plaintext DB/SSH
  // credentials — restrict to the owner only.
  // Unique temp filename so overlapping/concurrent saves (or a second process) cannot
  // collide on a shared `${path}.tmp` and corrupt each other (FIND-117).
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, iniString, { encoding: 'utf-8', mode: 0o600 });
  renameSync(tempPath, path);
}

/**
 * Helper to parse boolean values robustly
 */
const TRUE_WORDS = ['true', '1', 'yes', 'on', 'enabled'];
const FALSE_WORDS = ['false', '0', 'no', 'off', 'disabled'];

/**
 * Read a boolean setting, refusing to guess.
 *
 * The ini parser only turns bare `true` and `false` into real booleans, so every
 * other spelling arrives here as a string. Mapping the ones this does not
 * recognise to `false` made an affirmative the operator wrote, or a typo, select
 * the dangerous side of a security setting: `select_only = yes` granted write
 * access, and `ssl_verify = yes` turned certificate checking off. A value that
 * cannot be read is now a startup error naming the field, which is how the rest
 * of this module treats configuration it cannot make sense of.
 *
 * An absent key is not an error: callers decide what missing means, and the
 * security-relevant ones already default to the safe side before calling here.
 * A key written as `null` is not absent, though - the ini parser turns it into a
 * real null - so it is refused like any other value that says nothing about
 * which way the setting should go.
 *
 * Booleans need no special case: the ini parser produces them for bare `true`
 * and `false`, and those stringify onto the right list.
 * @param val - the raw value from the config file
 * @param field - field name, for the error message
 * @param dbName - owning database
 */
function parseBool(val: unknown, field: string, dbName: string): boolean {
  if (val === undefined) return false;

  const str = String(val).trim().toLowerCase();
  if (TRUE_WORDS.includes(str)) return true;
  if (FALSE_WORDS.includes(str)) return false;

  throw new ConfigValidationError(
    `Database '${dbName}' has an unreadable value for '${field}': '${String(val)}'. ` +
      `Use one of ${[...TRUE_WORDS, ...FALSE_WORDS].join(', ')}.`,
    field,
    dbName
  );
}

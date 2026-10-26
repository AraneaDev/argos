/**
 * Config Tool Handlers
 * Handles sql_add_database, sql_update_database, sql_remove_database,
 * sql_get_config, sql_set_mcp_configurable
 */

import { resolve, sep } from 'node:path';
import type { DatabaseConfig, DatabaseTypeString, MCPToolResponse } from '../../types/index.js';
import { DEFAULT_DATABASE_PORTS } from '../../types/index.js';
import { saveConfigFile, validateDatabaseConfig } from '../../utils/config.js';
import { createToolResponse } from '../../utils/response-formatter.js';
import type { ToolHandlerContext } from './types.js';
import { requireDbConfig } from './types.js';
import { ValidationError, ConfigurationError } from '../../utils/error-handler.js';
import { writeAuditLog } from '../../utils/audit-logger.js';

const BLOCKED_PATH_PREFIXES = ['/dev/', '/proc/', '/sys/', '/etc/'];

function validatePathNoTraversal(filePath: string, fieldName: string): void {
  if (filePath.includes('..')) {
    throw new ValidationError(`${fieldName} path traversal (..) is not allowed`, fieldName);
  }
  const resolved = resolve(filePath);
  if (BLOCKED_PATH_PREFIXES.some((prefix) => resolved.startsWith(prefix))) {
    throw new ValidationError(
      `${fieldName} path '${resolved}' is not allowed — must be a regular file path`,
      fieldName
    );
  }

  // Opt-in allowlist (FIND-110): when SQL_MCP_SQLITE_BASE_DIR is configured, model-supplied
  // file/key paths must resolve INSIDE that directory. The prefix denylist above is only a
  // weak backstop; a rooted allowlist is the robust control against opening/creating files
  // anywhere on the host. Operators editing config.ini directly are unaffected — this guards
  // only the MCP add/update tool paths.
  const baseDir = process.env.SQL_MCP_SQLITE_BASE_DIR;
  if (baseDir) {
    const root = resolve(baseDir);
    const withinRoot = resolved === root || resolved.startsWith(root + sep);
    if (!withinRoot) {
      throw new ValidationError(
        `${fieldName} path '${resolved}' is outside the permitted base directory '${root}'.`,
        fieldName
      );
    }
  }
}

/**
 *
 */
export async function handleAddDatabase(
  ctx: ToolHandlerContext,
  args: Record<string, unknown>
): Promise<MCPToolResponse> {
  const name = args.name as string;

  // Validate database name to prevent INI injection and shell metacharacter attacks
  const DB_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
  if (!name || name.length > 64 || !DB_NAME_RE.test(name)) {
    throw new ValidationError(
      `Database name '${name.substring(0, 20)}' contains invalid characters. ` +
        `Names must be alphanumeric with hyphens/underscores, 1-64 characters.`,
      'name'
    );
  }

  if (ctx.config.databases[name]) {
    throw new ConfigurationError(
      `Database '${name}' already exists. Use sql_update_database to modify it.`
    );
  }

  const dbType = (args.type as string).toLowerCase();
  const validTypes = ['mysql', 'postgresql', 'postgres', 'sqlite', 'mssql', 'sqlserver'];
  if (!validTypes.includes(dbType)) {
    throw new ValidationError(
      `Invalid database type '${dbType}'. Valid types: ${validTypes.join(', ')}`
    );
  }

  const dbConfig: DatabaseConfig = {
    type: dbType as DatabaseConfig['type'],
    // Fail secure: databases added via MCP tools are always read-only. Enabling write
    // access requires a human to edit config.ini, mirroring the rule that select_only
    // cannot be changed via MCP — the AI must not provision its own write access.
    select_only: true,
    mcp_configurable: true,
  };

  if (dbType === 'sqlite') {
    if (!args.file) throw new ValidationError("SQLite databases require 'file' parameter", 'file');
    const filePath = args.file as string;

    validatePathNoTraversal(filePath, 'file');

    dbConfig.file = filePath;
  } else {
    if (!args.host)
      throw new ValidationError(`Database type '${dbType}' requires 'host' parameter`);
    if (!args.username)
      throw new ValidationError(`Database type '${dbType}' requires 'username' parameter`);
    dbConfig.host = args.host as string;
    dbConfig.port =
      (args.port as number) || (DEFAULT_DATABASE_PORTS[dbType as DatabaseTypeString] ?? 0);
    dbConfig.database = args.database as string;
    dbConfig.username = args.username as string;
    dbConfig.password = args.password as string;
    dbConfig.ssl = (args.ssl as boolean) || false;
    if (args.ssl_verify !== undefined) {
      // Fail secure: the model must not be able to DISABLE TLS certificate verification
      // (that would enable MITM). Disabling requires a manual config.ini edit.
      // Only a literal boolean true passes. Tool arguments are not validated
      // against the declared schema, and the adapters coerce with
      // String(value) === 'true', so 'false', 0 and 'no' would each disable the
      // check just as effectively as the boolean false did.
      if (args.ssl_verify !== true) {
        throw new ValidationError(
          'ssl_verify can only be set to true via MCP tools (any other value would disable TLS ' +
            'certificate verification and enable MITM). To disable verification, edit config.ini ' +
            'manually.',
          'ssl_verify'
        );
      }
      dbConfig.ssl_verify = true;
    }
    dbConfig.timeout = 30000;
  }

  if (args.ssh_host) {
    dbConfig.ssh_host = args.ssh_host as string;
    dbConfig.ssh_port = (args.ssh_port as number) || 22;
    dbConfig.ssh_username = args.ssh_username as string;
    dbConfig.ssh_password = args.ssh_password as string;
    dbConfig.ssh_private_key = args.ssh_private_key as string;
    if (dbConfig.ssh_private_key) {
      validatePathNoTraversal(dbConfig.ssh_private_key, 'ssh_private_key');
    }
  }

  // Validate the complete config (shell metacharacters, embedded credentials, port range)
  const validationResult = validateDatabaseConfig(dbConfig);
  if (!validationResult.valid) {
    const messages = validationResult.errors.map((e) => `${e.field}: ${e.message}`).join(', ');
    throw new ValidationError(
      `Invalid database configuration: ${messages}`,
      validationResult.errors[0]?.field ?? 'config'
    );
  }

  ctx.config.databases[name] = dbConfig;
  ctx.connectionManager.registerDatabase(name, dbConfig);

  saveConfigFile(ctx.config, ctx.configPath);
  ctx.logger.info(`Database '${name}' added via MCP`, { type: dbType });

  writeAuditLog(name, 'CONFIG_ADD', 0, 'success').catch(() => undefined);

  return createToolResponse(
    ` Database '${name}' added successfully (type: ${dbType})\n` +
      ` MCP configurable: yes (can be locked via sql_set_mcp_configurable)\n` +
      ` SELECT-only: yes (read-only). To allow writes, set select_only=false in config.ini manually.\n` +
      `Use sql_test_connection to verify connectivity.`
  );
}

/**
 *
 */
export async function handleUpdateDatabase(
  ctx: ToolHandlerContext,
  args: Record<string, unknown>
): Promise<MCPToolResponse> {
  const database = args.database as string;

  const dbConfig = requireDbConfig(ctx.config, database);

  if (!dbConfig.mcp_configurable) {
    throw new ConfigurationError(
      `Database '${database}' is not MCP-configurable. ` +
        `Set mcp_configurable=true in config.ini manually to enable MCP configuration.`
    );
  }

  // Audit H1: validate ALL inputs BEFORE mutating the live config object.
  // dbConfig is a reference to ctx.config.databases[database]; previously, fields
  // were assigned directly and path validation ran afterwards, so a thrown
  // ValidationError left the in-memory config poisoned (pointing at a traversal
  // path or invalid value) until the server restarted. Now we run every validator
  // first; only if all pass do we touch dbConfig.

  // 1. Validate path-related fields before any mutation.
  if (args.file !== undefined && dbConfig.type === 'sqlite') {
    validatePathNoTraversal(args.file as string, 'file');
  }
  if (args.ssh_private_key !== undefined) {
    validatePathNoTraversal(args.ssh_private_key as string, 'ssh_private_key');
  }
  // Fail secure: anything but a literal boolean true is rejected before mutation.
  // See handleAddDatabase for why `!== false` is not enough.
  if (args.ssl_verify !== undefined && args.ssl_verify !== true) {
    throw new ValidationError(
      'ssl_verify can only be set to true via MCP tools (any other value would disable TLS ' +
        'certificate verification and enable MITM). To disable verification, edit config.ini ' +
        'manually.',
      'ssl_verify'
    );
  }
  if (args.select_only !== undefined) {
    throw new ConfigurationError(
      `Security setting 'select_only' cannot be changed via MCP tools.\n` +
        `To change SELECT-only mode, manually edit config.ini under [database.${database}].\n` +
        `This prevents an AI from escalating its own database privileges.`
    );
  }

  // 2. Build a staging copy with the requested changes, then validate it as a
  //    whole. Only if validation passes do we apply the changes to dbConfig.
  const staged: DatabaseConfig = { ...dbConfig };
  const updated: string[] = [];

  if (args.host !== undefined) {
    staged.host = args.host as string;
    updated.push('host');
  }
  if (args.port !== undefined) {
    staged.port = args.port as number;
    updated.push('port');
  }
  if (args.database_name !== undefined) {
    staged.database = args.database_name as string;
    updated.push('database');
  }
  if (args.username !== undefined) {
    staged.username = args.username as string;
    updated.push('username');
  }
  if (args.password !== undefined) {
    staged.password = args.password as string;
    updated.push('password');
  }
  if (args.file !== undefined) {
    staged.file = args.file as string;
    updated.push('file');
  }
  if (args.ssl !== undefined) {
    staged.ssl = args.ssl as boolean;
    updated.push('ssl');
  }
  if (args.ssl_verify !== undefined) {
    staged.ssl_verify = args.ssl_verify as boolean;
    updated.push('ssl_verify');
  }

  if (args.ssh_host !== undefined) {
    staged.ssh_host = args.ssh_host as string;
    updated.push('ssh_host');
  }
  if (args.ssh_port !== undefined) {
    staged.ssh_port = args.ssh_port as number;
    updated.push('ssh_port');
  }
  if (args.ssh_username !== undefined) {
    staged.ssh_username = args.ssh_username as string;
    updated.push('ssh_username');
  }
  if (args.ssh_password !== undefined) {
    staged.ssh_password = args.ssh_password as string;
    updated.push('ssh_password');
  }
  if (args.ssh_private_key !== undefined) {
    staged.ssh_private_key = args.ssh_private_key as string;
    updated.push('ssh_private_key');
  }

  if (updated.length === 0) {
    return createToolResponse(`No changes provided for database '${database}'.`);
  }

  // 3. Validate the complete staged config (shell metacharacters, embedded
  //    credentials, port range, newlines). If this throws, dbConfig is untouched.
  const validationResult = validateDatabaseConfig(staged);
  if (!validationResult.valid) {
    const messages = validationResult.errors.map((e) => `${e.field}: ${e.message}`).join(', ');
    throw new ValidationError(`Invalid configuration after update: ${messages}`, 'database');
  }

  // 4. All validators passed — now apply the staged changes to the live config.
  for (const field of updated) {
    (dbConfig as unknown as Record<string, unknown>)[field] = (
      staged as unknown as Record<string, unknown>
    )[field];
  }

  ctx.connectionManager.unregisterDatabase(database);
  ctx.connectionManager.registerDatabase(database, dbConfig);

  saveConfigFile(ctx.config, ctx.configPath);
  ctx.logger.info(`Database '${database}' updated via MCP`, { fields: updated });

  writeAuditLog(database, `CONFIG_UPDATE: ${updated.join(', ')}`, 0, 'success').catch(
    () => undefined
  );

  return createToolResponse(
    ` Database '${database}' updated successfully\n` +
      ` Changed fields: ${updated.join(', ')}\n` +
      `Use sql_test_connection to verify connectivity with new settings.`
  );
}

/**
 *
 */
export async function handleRemoveDatabase(
  ctx: ToolHandlerContext,
  database: string
): Promise<MCPToolResponse> {
  const dbConfig = requireDbConfig(ctx.config, database);

  if (!dbConfig.mcp_configurable) {
    throw new ConfigurationError(
      `Database '${database}' is not MCP-configurable. ` +
        `Cannot remove databases that are not MCP-configurable. Edit config.ini manually.`
    );
  }

  ctx.connectionManager.unregisterDatabase(database);
  if (ctx.sshTunnelManager.hasTunnel(database)) {
    await ctx.sshTunnelManager.closeTunnel(database);
  }

  delete ctx.config.databases[database];

  saveConfigFile(ctx.config, ctx.configPath);
  ctx.logger.info(`Database '${database}' removed via MCP`);

  writeAuditLog(database, 'CONFIG_REMOVE', 0, 'success').catch(() => undefined);

  return createToolResponse(
    ` Database '${database}' removed successfully\nConnection closed and configuration saved.`
  );
}

/**
 *
 */
export async function handleGetConfig(
  ctx: ToolHandlerContext,
  database: string
): Promise<MCPToolResponse> {
  const dbConfig = requireDbConfig(ctx.config, database);

  const redactedConfig: Record<string, unknown> = { ...dbConfig };

  if (redactedConfig.password) redactedConfig.password = '***REDACTED***';
  if (redactedConfig.ssh_password) redactedConfig.ssh_password = '***REDACTED***';
  if (redactedConfig.ssh_private_key) redactedConfig.ssh_private_key = '***REDACTED***';
  if (redactedConfig.ssh_passphrase) redactedConfig.ssh_passphrase = '***REDACTED***';

  // Do NOT disclose the redaction ruleset to the client: it is an exact map of which
  // columns are protected, which an untrusted model could use to alias around them
  // (see FIND-104/FIND-105). Report only whether redaction is enabled and a rule count.
  if (redactedConfig.redaction && typeof redactedConfig.redaction === 'object') {
    const r = redactedConfig.redaction as { enabled?: boolean; rules?: unknown[] };
    const ruleCount = Array.isArray(r.rules) ? r.rules.length : 0;
    redactedConfig.redaction = `${r.enabled ? 'enabled' : 'disabled'} (${ruleCount} rule(s) — details hidden)`;
  }

  for (const key of Object.keys(redactedConfig)) {
    if (redactedConfig[key] === undefined) delete redactedConfig[key];
  }

  let responseText = ` Configuration for '${database}':\n\n`;
  for (const [key, value] of Object.entries(redactedConfig)) {
    responseText += ` ${key}: ${value}\n`;
  }
  responseText += `\n MCP configurable: ${dbConfig.mcp_configurable ? 'yes' : 'no'}`;

  return createToolResponse(responseText);
}

/**
 *
 */
export async function handleSetMcpConfigurable(
  ctx: ToolHandlerContext,
  database: string,
  enabled: boolean
): Promise<MCPToolResponse> {
  const dbConfig = requireDbConfig(ctx.config, database);

  if (enabled === true) {
    return createToolResponse(
      ` Cannot enable MCP configurability via MCP tools.\n` +
        `For security, setting mcp_configurable=true must be done by manually editing config.ini.\n` +
        `This prevents an AI from re-enabling its own configuration access after a human locks it.\n\n` +
        `To unlock, add this to config.ini under [database.${database}]:\n` +
        `mcp_configurable=true`,
      true
    );
  }

  dbConfig.mcp_configurable = false;

  saveConfigFile(ctx.config, ctx.configPath);
  ctx.logger.info(`Database '${database}' locked from MCP configuration`);

  return createToolResponse(
    ` Database '${database}' is now locked from MCP configuration changes.\n` +
      `To re-enable MCP configuration, manually set mcp_configurable=true in config.ini.`
  );
}

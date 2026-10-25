/**
 * Shared wiring for the read-only pane commands: the same managers the MCP server builds,
 * opened from the same config.ini, with nothing allowed to write to stdout.
 */

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConnectionManager } from '../classes/ConnectionManager.js';
import { EnhancedSSHTunnelManager } from '../classes/EnhancedSSHTunnelManager.js';
import { MetricsManager } from '../classes/MetricsManager.js';
import { QueryCache } from '../classes/QueryCache.js';
import { SchemaManager } from '../classes/SchemaManager.js';
import { SecurityManager } from '../classes/SecurityManager.js';
import { resolveConfigPathFromArgv } from '../classes/SQLMCPServer.js';
import { PaneStore, dataDirFor } from '../pane/store.js';
import { SchemaWatch } from '../schema/watch.js';
import type { ParsedServerConfig } from '../types/index.js';
import { loadConfiguration } from '../utils/config.js';
import { getLogger } from '../utils/logger.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface Core {
  config: ParsedServerConfig;
  configPath: string;
  connectionManager: ConnectionManager;
  securityManager: SecurityManager;
  schemaManager: SchemaManager;
  schemaWatch: SchemaWatch;
  store: PaneStore;
  close(): Promise<void>;
}

/**
 * Open the managers for one CLI invocation. `--config <path>` wins, then ./config.ini,
 * then the one beside the install, exactly as the server searches.
 * @param args - arguments after the subcommand
 * @param schemaPath - schema cache directory (defaults to the server's)
 */
export async function openCore(args: string[], schemaPath?: string): Promise<Core> {
  // stdout is the JSON contract: the global logger must never print to it
  getLogger({ enableConsole: false, enableFile: false, component: 'argos-cli' });

  const explicit = resolveConfigPathFromArgv(['', '', ...args]);
  const cwdConfig = join(process.cwd(), 'config.ini');
  const projectConfig = join(PROJECT_ROOT, 'config.ini');
  const configPath =
    explicit ?? (existsSync(cwdConfig) || !existsSync(projectConfig) ? cwdConfig : projectConfig);
  if (!existsSync(configPath)) {
    throw new Error(`No config.ini found at ${configPath}. Run setup to configure databases.`);
  }
  const config = loadConfiguration(configPath);

  const sshTunnelManager = new EnhancedSSHTunnelManager();
  const securityManager = new SecurityManager();
  const connectionManager = new ConnectionManager(
    sshTunnelManager,
    new MetricsManager(),
    new QueryCache()
  );
  const schemaManager = new SchemaManager(
    connectionManager,
    schemaPath ?? join(PROJECT_ROOT, 'schemas')
  );
  const schemaWatch = new SchemaWatch(connectionManager, schemaManager);

  securityManager.initialize(config);
  await schemaManager.initialize();
  const globalTimeout = config.extension?.query_timeout ?? 30000;
  // The CLI never writes, so every connection it opens is read-only below the lexical
  // gate too: select_only makes SQLite open OPEN_READONLY, read_only_session makes
  // PostgreSQL and MySQL refuse writes for the session. These are copies — core.config
  // keeps the real settings, which is what `connections` reports.
  const databases: ParsedServerConfig['databases'] = {};
  for (const [name, db] of Object.entries(config.databases)) {
    databases[name] = {
      ...db,
      query_timeout: db.query_timeout ?? globalTimeout,
      select_only: true,
      read_only_session: true,
    };
  }
  connectionManager.initialize(databases);
  await sshTunnelManager.initialize();

  const dir = dataDirFor(configPath);
  await mkdir(join(dir, 'spool'), { recursive: true, mode: 0o700 });

  return {
    config,
    configPath,
    connectionManager,
    securityManager,
    schemaManager,
    schemaWatch,
    store: new PaneStore(dir),
    async close() {
      await connectionManager.closeAllConnections().catch(() => undefined);
      await sshTunnelManager.closeAllTunnels().catch(() => undefined);
    },
  };
}

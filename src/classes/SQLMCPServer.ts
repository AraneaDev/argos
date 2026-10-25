/**
 * Main Argos Class
 * Slim lifecycle coordinator - tool definitions, handlers, and formatting
 * are extracted into src/tools/ and src/utils/response-formatter.ts
 */

import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const _currentFile = fileURLToPath(import.meta.url);
const _currentDir = dirname(_currentFile);
const PROJECT_ROOT = resolve(_currentDir, '..', '..');
import { loadConfiguration } from '../utils/config.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import type {
  ParsedServerConfig,
  TestConnectionResult,
  MCPRequest,
  MCPResponse,
} from '../types/index.js';

import { SERVER_VERSION, SERVER_NAME } from '../types/index.js';

import { MetricsManager } from './MetricsManager.js';
import { QueryCache } from './QueryCache.js';
import { ConnectionManager } from './ConnectionManager.js';
import { SecurityManager } from './SecurityManager.js';
import { SchemaWatch } from '../schema/watch.js';
import { SchemaManager } from './SchemaManager.js';
import { EnhancedSSHTunnelManager } from './EnhancedSSHTunnelManager.js';
import { Logger } from '../utils/logger.js';
import { getErrorMessage, sanitizeError, sanitizeMessage } from '../utils/error-handler.js';
import { getToolDefinitions } from '../tools/tool-definitions.js';
import { createToolDispatcher, type ToolDispatchFn } from '../tools/dispatcher.js';
import { PaneStore, dataDirFor } from '../pane/store.js';
import type { ToolHandlerContext } from '../tools/handlers/types.js';

/**
 * Build a log-safe copy of tool-call arguments (FIND-116). Secret-named keys (password,
 * ssh_*) are already redacted by the logger, but `query`/`queries`/`params` are not — they
 * can carry inline PII or literal secrets. Scrub the SQL through the error sanitizer and
 * replace bound params with a count so nothing sensitive is written to the log file.
 * @param args - raw tool-call arguments
 * @returns a shallow copy safe to log
 */
function safeToolArgs(args: unknown): unknown {
  if (!args || typeof args !== 'object') return args;
  const copy: Record<string, unknown> = { ...(args as Record<string, unknown>) };
  if (typeof copy.query === 'string') copy.query = sanitizeMessage(copy.query);
  if ('params' in copy) {
    copy.params = Array.isArray(copy.params) ? `[${copy.params.length} param(s)]` : '[params]';
  }
  if (Array.isArray(copy.queries)) copy.queries = `[${copy.queries.length} query/queries]`;
  return copy;
}

/**
 * Main Argos class that coordinates all operations
 */
/**
 * Read the configuration path from the command line.
 *
 * The registration command in the README passes `--config`, and the setup wizard
 * writes to `~/.config/argos/config.ini` rather than to the working directory.
 * An MCP client starts this process from wherever it happens to be, so without
 * reading the flag the search fell through to `./config.ini` and the server
 * reported no configuration while the operator was looking at the file they had
 * pointed it at.
 *
 * Returning undefined leaves loadConfig's existing search (working directory,
 * then the directory the server was installed in) exactly as it was.
 * @param argv - process arguments, including the node and script entries
 */
export function resolveConfigPathFromArgv(
  argv: readonly string[] = process.argv
): string | undefined {
  const args = argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--config') {
      return args[i + 1];
    }
    if (arg.startsWith('--config=')) {
      return arg.slice('--config='.length) || undefined;
    }
  }

  return undefined;
}

/**
 *
 */
export class SQLMCPServer extends EventEmitter {
  private metricsManager!: MetricsManager;
  private queryCache!: QueryCache;
  private readonly connectionManager: ConnectionManager;
  private readonly securityManager: SecurityManager;
  private readonly schemaManager: SchemaManager;
  private readonly schemaWatch: SchemaWatch;
  private readonly sshTunnelManager: EnhancedSSHTunnelManager;
  private readonly logger: Logger;
  private mcpServer: Server;
  private dispatchToolCall: ToolDispatchFn | null = null;

  private config: ParsedServerConfig | null = null;
  private configPath: string = '';
  private paneStore: PaneStore | null = null;
  private initialized = false;

  constructor() {
    super();

    this.logger = new Logger({
      logFile: join(PROJECT_ROOT, 'argos.log'),
      logLevel: 'INFO',
      component: 'SQLMCPServer',
      enableConsole: false,
    });

    this.mcpServer = new Server(
      { name: SERVER_NAME, version: SERVER_VERSION },
      { capabilities: { tools: {}, logging: {} } }
    );

    this.sshTunnelManager = new EnhancedSSHTunnelManager();
    this.securityManager = new SecurityManager();
    this.metricsManager = new MetricsManager();
    this.queryCache = new QueryCache();
    this.connectionManager = new ConnectionManager(
      this.sshTunnelManager,
      this.metricsManager,
      this.queryCache
    );
    this.schemaManager = new SchemaManager(this.connectionManager, join(PROJECT_ROOT, 'schemas'));
    this.schemaWatch = new SchemaWatch(
      this.connectionManager,
      this.schemaManager,
      Date.now,
      60_000,
      () => this.paneStore
    );

    this.setupEventListeners();
    this.registerMCPHandlers();
  }

  /**
   * Initialize the MCP server
   */
  public async initialize(configPath?: string): Promise<void> {
    this.logger.info('Initializing Argos...');

    try {
      this.loadConfig(configPath);
      this.paneStore = await this.createPaneStore();
      await this.initializeManagers();

      // Create the tool dispatcher with a late-binding context
      // (property access is deferred so test mocks applied after init still work)
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const server = this;
      const ctx: ToolHandlerContext = {
        get connectionManager() {
          return server.connectionManager;
        },
        get securityManager() {
          return server.securityManager;
        },
        get schemaManager() {
          return server.schemaManager;
        },
        get schemaWatch() {
          return server.schemaWatch;
        },
        get paneStore() {
          return server.paneStore;
        },
        get sshTunnelManager() {
          return server.sshTunnelManager;
        },
        get metricsManager() {
          return server.metricsManager;
        },
        get config() {
          return server.config!;
        },
        get configPath() {
          return server.configPath;
        },
        get logger() {
          return server.logger;
        },
      };
      this.dispatchToolCall = createToolDispatcher(ctx);

      this.initialized = true;
      this.logger.info('Argos initialization complete');
      this.emit('initialized');
    } catch (error) {
      this.logger.error('Failed to initialize server', error as Error);
      throw error;
    }
  }

  /** Journal store beside the config in use; null (journaling off) if its directory is unusable. */
  private async createPaneStore(): Promise<PaneStore | null> {
    try {
      const store = new PaneStore(dataDirFor(this.configPath));
      await store.ensure();
      return store;
    } catch (error) {
      this.logger.warning('Pane journal disabled: data directory unavailable', {
        error: getErrorMessage(error),
      });
      return null;
    }
  }

  /**
   * Cleanup and shutdown the server
   */
  public async cleanup(): Promise<void> {
    this.logger.info('Starting server cleanup...');

    try {
      await this.connectionManager.closeAllConnections();
      await this.sshTunnelManager.closeAllTunnels();

      this.initialized = false;
      this.logger.info('Server cleanup complete');
      this.emit('cleanup');
    } catch (error) {
      this.logger.error('Error during cleanup', error as Error);
      throw error;
    }
  }

  /**
   * Run the MCP server using SDK stdio transport
   */
  public async run(): Promise<void> {
    try {
      await this.initialize(resolveConfigPathFromArgv());
      const transport = new StdioServerTransport();
      await this.mcpServer.connect(transport);
      this.logger.info('Argos running on stdio (MCP SDK transport)');
    } catch (error) {
      this.logger.error('Server initialization failed', error as Error);
      // Write to stderr so the MCP client can see why startup failed
      try {
        process.stderr.write(
          `MCP server startup failed: ${error instanceof Error ? error.message : error}\n`
        );
      } catch {
        /* ignore */
      }
      process.exit(1);
    }
  }

  /**
   * Handle a raw JSON-RPC request (used for testing)
   */
  public async handleRequest(request: MCPRequest): Promise<MCPResponse | null> {
    const { method, params, id } = request;

    try {
      if (method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id: id || 0,
          result: { tools: getToolDefinitions() },
        };
      }

      if (method === 'tools/call') {
        const { name, arguments: args } = params as {
          name: string;
          arguments: Record<string, unknown>;
        };

        if (!this.dispatchToolCall) {
          throw new Error('Server not initialized');
        }

        try {
          const result = await this.dispatchToolCall(name, args || {});
          return {
            jsonrpc: '2.0',
            id: id || 0,
            result: {
              content: result.content.map((c) => ({ type: 'text' as const, text: c.text || '' })),
              isError: result.isError || false,
            },
          };
        } catch (error) {
          const errorMessage = sanitizeError(error);
          return {
            jsonrpc: '2.0',
            id: id || 0,
            result: {
              content: [{ type: 'text' as const, text: ` Error in ${name}: ${errorMessage}` }],
              isError: true,
            },
          };
        }
      }

      return null;
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: id || 0,
        error: { code: -32603, message: error instanceof Error ? error.message : 'Internal error' },
      };
    }
  }

  /**
   * Test database connection (public API used by index.ts testConnection path)
   */
  public async testConnection(database: string): Promise<TestConnectionResult> {
    try {
      const dbConfig = this.config?.databases[database];
      if (!dbConfig) {
        throw new Error(`Database configuration '${database}' not found`);
      }

      if (dbConfig.ssh_host) {
        this.logger.info(`SSH tunnel will be managed by ConnectionManager for '${database}'`);
      }

      if (!this.schemaManager.hasSchema(database)) {
        try {
          const connection = await this.connectionManager.getConnection(database);
          if (connection) {
            await this.schemaManager.captureSchema(database, dbConfig);
          }
        } catch (error) {
          this.logger.warning('Failed to capture schema', {
            database,
            error: getErrorMessage(error),
          });
        }
      }

      const schema = this.schemaManager.getSchema(database);

      return {
        success: true,
        database,
        message: 'Connection successful',
        ssh_tunnel: this.sshTunnelManager.hasTunnel(database),
        select_only_mode: !!dbConfig.select_only,
        schema_captured: !!schema,
        schema_info: schema
          ? {
              table_count: schema.summary.table_count,
              view_count: schema.summary.view_count,
              total_columns: schema.summary.total_columns,
            }
          : undefined,
      };
    } catch (error) {
      return {
        success: false,
        database,
        error: getErrorMessage(error),
        ssh_tunnel: false,
        select_only_mode: false,
        schema_captured: false,
      };
    }
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  private setupEventListeners(): void {
    this.connectionManager.on('connected', (dbName: string) => {
      this.logger.info(`Database connection established: ${dbName}`);
    });
    this.connectionManager.on('disconnected', (dbName: string) => {
      this.logger.info(`Database connection closed: ${dbName}`);
    });
    this.connectionManager.on('error', (error: Error, dbName?: string) => {
      this.logger.error(`Database connection error${dbName ? ` (${dbName})` : ''}`, error);
    });

    this.sshTunnelManager.on('tunnel-connected', (dbName: string) => {
      this.logger.info(`SSH tunnel established: ${dbName}`);
    });
    this.sshTunnelManager.on('tunnel-disconnected', (dbName: string) => {
      this.logger.info(`SSH tunnel closed: ${dbName}`);
    });
    this.sshTunnelManager.on('tunnel-error', (error: Error, dbName?: string) => {
      this.logger.error(`SSH tunnel error${dbName ? ` (${dbName})` : ''}`, error);
    });

    this.schemaManager.on('schema-cached', (dbName: string) => {
      this.logger.info(`Schema cached: ${dbName}`);
    });
    this.schemaManager.on('schema-refreshed', (dbName: string) => {
      this.logger.info(`Schema refreshed: ${dbName}`);
    });

    this.securityManager.on('query-blocked', (dbName: string, reason: string) => {
      this.logger.warning(`Query blocked in ${dbName}: ${reason}`);
    });
    this.securityManager.on('query-approved', (dbName: string) => {
      this.logger.info(`Query approved for ${dbName}`);
    });
  }

  private registerMCPHandlers(): void {
    this.mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
      this.logger.info('Handling tools/list request');
      return { tools: getToolDefinitions() };
    });

    this.mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      this.logger.info(`Handling tool call: ${name}`, { args: safeToolArgs(args) });

      try {
        if (!args || typeof args !== 'object') {
          throw new Error(
            `Invalid arguments provided for tool '${name}'. Expected object, got ${typeof args}`
          );
        }

        if (!this.dispatchToolCall) {
          throw new Error('Server not initialized');
        }

        const result = await this.dispatchToolCall(name, args as Record<string, unknown>);
        return {
          content: result.content.map((c) => ({ type: 'text' as const, text: c.text || '' })),
          isError: result.isError || false,
        };
      } catch (error) {
        this.logger.error(`Error in tool call ${name}`, { error, args: safeToolArgs(args) });
        const errorMessage = sanitizeError(error);
        const troubleshooting = [
          '**Troubleshooting:**',
          '- Ensure all required arguments are provided',
          '- Check that the database name exists in your configuration',
          '- Verify your database connection is working',
          '- Review the server logs for more details',
        ].join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: ` Error in ${name}: ${errorMessage}\n\n${troubleshooting}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private loadConfig(configPath?: string): void {
    const cwdConfigPath = join(process.cwd(), 'config.ini');
    // Fallback: resolve config.ini relative to the project root (two levels up from dist/classes/)
    // This handles MCP clients that launch the server from a different working directory
    const scriptDir = _currentDir;
    const projectConfigPath = join(scriptDir, '..', '..', 'config.ini');

    let finalConfigPath: string;
    if (configPath) {
      finalConfigPath = configPath;
    } else if (existsSync(cwdConfigPath)) {
      finalConfigPath = cwdConfigPath;
    } else if (existsSync(projectConfigPath)) {
      finalConfigPath = projectConfigPath;
    } else {
      finalConfigPath = cwdConfigPath; // Will fail below with a clear error
    }
    this.configPath = finalConfigPath;

    if (!existsSync(finalConfigPath)) {
      throw new Error(
        `No config.ini found at ${finalConfigPath}. Run setup to configure databases.`
      );
    }

    try {
      this.config = loadConfiguration(finalConfigPath);

      this.logger.info(
        `Configuration loaded: ${Object.keys(this.config.databases).length} databases configured`
      );

      if (this.config.security) {
        this.logger.info('Security configuration loaded', {
          maxJoins: this.config.security.max_joins,
          maxComplexity: this.config.security.max_complexity_score,
        });
      }
    } catch (error) {
      this.logger.error('Failed to load configuration', { error, configPath: finalConfigPath });
      throw new Error(`Failed to load config.ini: ${getErrorMessage(error)}`, { cause: error });
    }
  }

  private async initializeManagers(): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }

    this.securityManager.initialize(this.config);
    await this.schemaManager.initialize();
    // Propagate extension-level query_timeout to each database config
    const globalTimeout = this.config.extension?.query_timeout ?? 30000;
    const databases = { ...this.config.databases };
    for (const dbName of Object.keys(databases)) {
      if (databases[dbName].query_timeout === undefined) {
        databases[dbName] = { ...databases[dbName], query_timeout: globalTimeout };
      }
    }
    this.connectionManager.initialize(databases);
    this.sshTunnelManager.initialize();

    this.logger.info('All managers initialized successfully');
  }
}

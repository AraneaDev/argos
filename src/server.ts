/**
 * Argos - MCP server entry
 * Started by `argos serve`. TypeScript implementation of the Argos SQL Model Context Protocol Server
 *
 * This server provides secure database connectivity through MCP protocol,
 * enabling AI assistants to interact with SQL databases with built-in
 * security controls and schema awareness.
 */

import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { SQLMCPServer } from './classes/SQLMCPServer.js';
import { cleanupLogger, initializeLogger } from './utils/logger.js';

const _currentFile = fileURLToPath(import.meta.url);
const _currentDir = dirname(_currentFile);
const PROJECT_ROOT = resolve(_currentDir, '..');

/**
 * Exit once the log file has its last lines: `process.exit` drops writes still queued on the stream
 */
async function exitAfterFlush(code: number): Promise<never> {
  await cleanupLogger();
  process.exit(code);
}

/**
 * Start the MCP server on stdio
 */
export async function runServer(): Promise<void> {
  // Initialize global logger for all components BEFORE creating any other components
  const logger = await initializeLogger({
    enableConsole: false, // Critical: Disable console output to prevent JSON-RPC interference
    logFile: join(PROJECT_ROOT, 'argos.log'),
    logLevel: 'INFO',
  });

  // Initialize and run server
  const server = new SQLMCPServer();

  const SHUTDOWN_TIMEOUT = 10000; // 10 seconds

  // Handle graceful shutdown with timeout
  let shuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (shuttingDown) return; // Prevent re-entrance
    shuttingDown = true;
    logger.info(`Received ${signal}, initiating graceful shutdown...`);

    try {
      await Promise.race([
        server.cleanup(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Shutdown timed out')), SHUTDOWN_TIMEOUT)
        ),
      ]);
      logger.info('Server shutdown complete');
      await exitAfterFlush(0);
    } catch (error) {
      logger.error('Error during shutdown (forcing exit)', error as Error);
      await exitAfterFlush(1);
    }
  };

  // Register shutdown handlers
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  // Handle uncaught exceptions gracefully - route through gracefulShutdown
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
    gracefulShutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled promise rejection', { reason, promise });
    gracefulShutdown('unhandledRejection');
  });

  // Start the server
  try {
    await server.run();
  } catch (error) {
    logger.error('Failed to start server', error as Error);
    await exitAfterFlush(1);
  }
}

/**
 * Run the server, turning a fatal error into an exit without touching stdout
 */
export function startServer(): void {
  runServer().catch((error) => {
    // CRITICAL: Never use console.error here — it writes to stdout/stderr
    // and corrupts the MCP JSON-RPC stream, causing random connection failures
    try {
      process.stderr.write(`Fatal error in main process: ${error}\n`);
    } catch {
      // If stderr is broken, exit silently
    }
    process.exit(1);
  });
}

/**
 * The server's own lines reach the log file `initializeLogger` opens.
 */
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { SQLMCPServer } from '../../src/classes/SQLMCPServer.js';
import { cleanupLogger, initializeLogger } from '../../src/utils/logger.js';

describe('SQLMCPServer logging', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), 'argos-log-'));
  });

  afterEach(async () => {
    await cleanupLogger();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('writes its lines to the initialized log file', async () => {
    const logFile = path.join(dir, 'argos.log');
    await initializeLogger({ enableConsole: false, logFile });

    const configPath = path.join(dir, 'config.ini');
    fs.writeFileSync(
      configPath,
      `[database.demo]\ntype = sqlite\nfile = ${path.join(dir, 'demo.db')}\n`,
      {
        mode: 0o600,
      }
    );

    const server = new SQLMCPServer();
    await server.initialize(configPath);
    await server.cleanup();
    await cleanupLogger();

    const log = fs.readFileSync(logFile, 'utf8');
    expect(log).toContain('Initializing Argos...');
    expect(log).toContain('Server cleanup complete');
  });
});

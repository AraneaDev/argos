#!/usr/bin/env node

/**
 * Argos - the `argos` command
 * Dispatches to the MCP server (`argos serve`) or the setup wizard (`argos setup`).
 */

import { resolveCommand, usage } from './cli/commands.js';
import { SERVER_VERSION } from './types/index.js';

const command = resolveCommand(process.argv.slice(2));

switch (command.kind) {
  case 'serve': {
    // stdout belongs to the MCP JSON-RPC stream from here on
    const { startServer } = await import('./server.js');
    startServer();
    break;
  }
  case 'setup': {
    const { startSetup } = await import('./setup/cli.js');
    startSetup(command.args);
    break;
  }
  case 'version':
    process.stdout.write(`Argos v${SERVER_VERSION}\n`);
    break;
  case 'help':
    process.stdout.write(usage());
    break;
  case 'connections':
  case 'schema':
  case 'query':
  case 'history':
  case 'result':
  case 'pin':
  case 'unpin':
  case 'pins': {
    const { runPaneCommand } = await import('./cli/pane-commands.js');
    const { json, code } = await runPaneCommand(command.kind, command.args);
    process.stdout.write(JSON.stringify(json) + '\n');
    process.exitCode = code;
    break;
  }
  case 'install-plugin': {
    const { runInstallPlugin } = await import('./cli/install-plugin.js');
    process.exitCode = await runInstallPlugin(command.args);
    break;
  }
  case 'unknown':
    process.stderr.write(`argos: unknown command '${command.name}'\n\n${usage()}`);
    process.exitCode = 1;
    break;
}

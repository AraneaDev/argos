#!/usr/bin/env node

/**
 * Deprecated `argos-mcp` entry: runs `argos serve`
 * Kept for one release so existing MCP client configs keep working.
 */

import { startServer } from './server.js';

// stderr only: stdout is the MCP JSON-RPC stream
process.stderr.write("argos-mcp is deprecated and will be removed; run 'argos serve' instead.\n");
startServer();

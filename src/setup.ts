#!/usr/bin/env node

/**
 * Deprecated `argos-setup` entry: runs `argos setup`
 * Kept for one release.
 */

import { startSetup } from './setup/cli.js';

process.stderr.write("argos-setup is deprecated and will be removed; run 'argos setup' instead.\n");
startSetup(process.argv.slice(2));

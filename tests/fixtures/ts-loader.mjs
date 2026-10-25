// Test-only ESM loader: lets a child `node` process import src/**/*.ts directly.
// Resolves the sources' `.js` import suffixes to their `.ts` files and compiles
// each with @swc/core. Used by tests that must run real code in a plain, idle
// process (jest's own event loop activity would hide what they check).
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(import.meta.url.replace(/ts-loader\.mjs$/, 'ts-loader-hooks.mjs'), pathToFileURL('./'));

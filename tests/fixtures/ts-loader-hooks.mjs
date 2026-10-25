// Hooks for tests/fixtures/ts-loader.mjs (see there).
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformSync } from '@swc/core';

export async function resolve(specifier, context, next) {
  if (specifier.endsWith('.js') && context.parentURL?.endsWith('.ts')) {
    const ts = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
    if (existsSync(fileURLToPath(ts))) return { url: ts.href, shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (!url.endsWith('.ts')) return next(url, context);
  const source = await readFile(fileURLToPath(url), 'utf8');
  const { code } = transformSync(source, {
    filename: fileURLToPath(url),
    jsc: { parser: { syntax: 'typescript', decorators: true }, target: 'es2022' },
    module: { type: 'es6' },
  });
  return { format: 'module', source: code, shortCircuit: true };
}

/**
 * `argos install-plugin`: package the Claude Code plugin into a local marketplace and install it.
 * Hooks cannot see the MCP server's environment, so the paths they need are written to
 * hooks/argos.env.json inside the installed copy.
 */

import { spawn } from 'child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getConfigurationPath } from '../utils/config.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export type Scope = 'user' | 'project' | 'local';

export interface InstallOptions {
  repoRoot: string;
  configPath: string;
  scope: Scope;
  execute: boolean;
  run?: (argv: string[]) => Promise<number>;
}

export interface InstallResult {
  commands: string[][];
  outDir: string;
}

function defaultRun(argv: string[]): Promise<number> {
  return new Promise((done, fail) => {
    const child = spawn(argv[0]!, argv.slice(1), { stdio: 'inherit' });
    child.on('error', fail);
    child.on('close', (code) => done(code ?? 1));
  });
}

/** Package and (with `execute`) install the plugin; otherwise only report what would happen. */
export async function installPlugin(opts: InstallOptions): Promise<InstallResult> {
  const { repoRoot, scope } = opts;
  const configPath = resolve(opts.configPath);
  if (!isAbsolute(configPath) || !existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const outDir = join(repoRoot, '.plugin');
  const commands = [
    ['claude', 'plugin', 'marketplace', 'add', outDir, '--scope', scope],
    ['claude', 'plugin', 'install', 'argos@argos', '--scope', scope, '--yes'],
  ];
  if (!opts.execute) return { commands, outDir };

  const source = join(repoRoot, 'plugin');
  if (!existsSync(source)) throw new Error(`Plugin directory not found: ${source}`);

  const dest = join(outDir, 'plugins', 'argos');
  rmSync(dest, { recursive: true, force: true });
  cpSync(source, dest, { recursive: true });
  mkdirSync(join(outDir, '.claude-plugin'), { recursive: true });
  writeFileSync(
    join(outDir, '.claude-plugin', 'marketplace.json'),
    JSON.stringify(
      {
        name: 'argos',
        owner: { name: 'AraneaDev', url: 'https://github.com/AraneaDev' },
        plugins: [{ name: 'argos', source: './plugins/argos' }],
      },
      null,
      2
    )
  );
  mkdirSync(join(dest, 'hooks'), { recursive: true });
  writeFileSync(
    join(dest, 'hooks', 'argos.env.json'),
    JSON.stringify(
      { node: process.execPath, cli: join(repoRoot, 'dist', 'cli.js'), config: configPath },
      null,
      2
    )
  );

  const run = opts.run ?? defaultRun;
  for (const argv of commands) {
    const code = await run(argv);
    if (code !== 0) throw new Error(`'${argv.join(' ')}' failed (exit ${code})`);
  }
  return { commands, outDir };
}

/** Parse `install-plugin` flags. */
export function parseInstallArgs(args: string[]): {
  execute: boolean;
  scope: Scope;
  config: string | undefined;
} {
  let scope = 'user';
  let config: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith('--scope=')) scope = a.slice(8);
    else if (a === '--scope') scope = args[++i] ?? '';
    else if (a.startsWith('--config=')) config = a.slice(9);
    else if (a === '--config') config = args[++i];
  }
  if (scope !== 'user' && scope !== 'project' && scope !== 'local') {
    throw new Error(`Invalid --scope '${scope}' (use user, project or local)`);
  }
  return { execute: args.includes('--execute'), scope, config };
}

/** CLI entry: human-readable output; returns the exit code. */
export async function runInstallPlugin(args: string[]): Promise<number> {
  try {
    const parsed = parseInstallArgs(args);
    const configPath = resolve(parsed.config ?? getConfigurationPath());
    const { commands, outDir } = await installPlugin({
      repoRoot: REPO_ROOT,
      configPath,
      scope: parsed.scope,
      execute: parsed.execute,
    });
    if (parsed.execute) {
      process.stdout.write(`Argos pane installed from ${outDir} (scope: ${parsed.scope}).\n`);
    } else {
      const lines = commands.map((c) => `  ${c.join(' ')}`).join('\n');
      process.stdout.write(
        `Dry run. Would write ${join(outDir, 'plugins', 'argos', 'hooks', 'argos.env.json')} ` +
          `(config: ${configPath}) and run:\n${lines}\nRe-run with --execute to install.\n`
      );
    }
    return 0;
  } catch (error) {
    process.stderr.write(`argos: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

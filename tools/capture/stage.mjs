/**
 * Dev-only. The capture's stage: a copy of the demo dir (config.ini, the
 * SQLite files it names) with a history of its own, made once a run, and
 * the per-session pieces built from it: the plugin's staged copy and the
 * argos MCP server's registration.
 *
 * The user's own `.argos` history is never copied: the stage starts empty
 * and is seeded with the queries in shots.mjs (SEED), run through the argos
 * MCP server (so they read as Claude's) and the argos CLI (as yours), both
 * against the stage's config only.
 */
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The Argos checkout this tool lives in. */
export const REPO = path.resolve(HERE, '..', '..');
/** The config file's name in the demo dir, the stage and every session's copy. */
export const CONFIG_NAME = 'config.ini';
/** The built CLI the pane and the MCP server run. */
export const CLI = path.join(REPO, 'dist', 'cli.js');
/** The plugin's source in this checkout. */
export const PLUGIN = path.join(REPO, 'plugin');

const under = (p, root) => {
  const r = path.relative(path.resolve(root), path.resolve(p));
  return r === '' || (r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r));
};

const LINE = /^(\s*)([A-Za-z0-9_.-]+)(\s*=\s*)(.*?)(\s*)$/;

/**
 * config.ini with every value that is a path at or under `from` moved to the
 * same place under `to`. Then every SQLite `file=` must lie under `to`: a
 * capture never opens the demo's own database, so a relative path, or an
 * absolute one elsewhere, is refused (`:memory:` is fine).
 */
export function retargetConfig(text, from, to) {
  const out = text.split('\n').map((line) => {
    const m = line.match(LINE);
    if (m === null || line.trimStart().startsWith(';')) return line;
    const [, lead, key, eq, raw, tail] = m;
    const quote = /^(["']).*\1$/.test(raw) ? raw[0] : '';
    const value = quote ? raw.slice(1, -1) : raw;
    if (!path.isAbsolute(value) || !under(value, from)) return line;
    const moved = path.join(to, path.relative(path.resolve(from), value));
    return `${lead}${key}${eq}${quote}${moved}${quote}${tail}`;
  });
  for (const line of out) {
    const m = line.match(LINE);
    if (m === null || m[2] !== 'file') continue;
    const value = m[4].replace(/^(["'])(.*)\1$/, '$2');
    if (value === ':memory:') continue;
    if (!path.isAbsolute(value) || !under(value, to))
      throw new Error(`config.ini names a SQLite file outside the capture's copy: ${value}`);
  }
  return out.join('\n');
}

/** argos.env.json as `argos install-plugin` writes it: the paths the pane's hooks run the CLI with. */
export const pluginEnv = ({ node, cli, config }) =>
  `${JSON.stringify({ node, cli, config }, null, 2)}\n`;

/** What the staged plugin leaves out: the specs and their fixtures, which the pane never loads. */
export const pluginFilter = (from) =>
  !/(?:^|\/)__tests__(?:\/|$)|\.(?:spec|test)\.tsx?$/.test(from);

/**
 * Copies the plugin to `to` and records the session's paths in its
 * hooks/argos.env.json, as the install does for an installed copy; Claude
 * Code loads it with --plugin-dir, so nothing is installed anywhere.
 */
export async function stagePlugin(from, to, paths) {
  await cp(from, to, { recursive: true, filter: pluginFilter });
  await writeFile(path.join(to, 'hooks', 'argos.env.json'), pluginEnv(paths));
}

/** The --mcp-config that registers the argos MCP server on the session's copy of the config. */
export const mcpConfig = ({ node, cli, config, dataCopy, home }) => ({
  mcpServers: {
    argos: {
      type: 'stdio',
      command: node,
      args: [cli, 'serve', '--config', config],
      env: { ARGOS_CAPTURE_DATA: dataCopy, HOME: home },
    },
  },
});

/**
 * Copies the demo dir into a fresh stage under `tmpRoot`, without its
 * `.argos` history, and retargets the copy's config.ini onto the stage.
 * Refuses a stage inside the demo dir before it makes anything.
 */
export async function stageDemo({ source, tmpRoot, copyData, inside }) {
  if (inside(tmpRoot, source))
    throw new Error(`refusing a stage inside the real data dir: ${tmpRoot}`);
  const stage = await mkdtemp(path.join(tmpRoot, 'argos-capture-stage-'));
  try {
    await copyData(source, stage, { skip: ['.argos'] });
    const config = path.join(stage, CONFIG_NAME);
    await writeFile(config, retargetConfig(await readFile(config, 'utf8'), source, stage));
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
  return stage;
}

/** Runs the argos CLI with `args` against the stage's config. */
const defaultCli = (args, env) =>
  run(process.execPath, [CLI, ...args], { env, maxBuffer: 64 * 1024 * 1024 });

/** Calls sql_query once per entry through one argos MCP server, as Claude would. */
async function defaultMcp(calls, { config, env }) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI, 'serve', '--config', config],
    env,
    stderr: 'ignore',
  });
  const client = new Client({ name: 'argos-capture', version: '0.0.0' });
  await client.connect(transport);
  try {
    for (const { db, sql } of calls) {
      const result = await client.callTool({
        name: 'sql_query',
        arguments: { database: db, query: sql },
      });
      if (result.isError)
        throw new Error(`seed query on ${db} failed: ${JSON.stringify(result.content)}`);
    }
  } finally {
    await client.close();
  }
}

/** The journal's entries, oldest first. */
const journal = async (stage) =>
  (await readFile(path.join(stage, '.argos', 'journal.jsonl'), 'utf8'))
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));

/**
 * Seeds the stage's history with `seed`, in order: each `{ via, db, sql }`
 * runs as Claude's query (`via: "claude"`, through the MCP server) or as
 * yours (`via: "you"`, through the CLI), and one with `pin` is pinned after.
 * Every process runs on the stage's config with HOME and ARGOS_CAPTURE_DATA
 * set to the capture's own, never the user's.
 */
export async function seedHistory(
  stage,
  seed,
  { home, callMcp = defaultMcp, runCli = defaultCli }
) {
  const config = path.join(stage, CONFIG_NAME);
  const env = { ...process.env, HOME: home, ARGOS_CAPTURE_DATA: stage };
  let batch = [];
  const flush = async () => {
    if (batch.length > 0) await callMcp(batch, { config, env });
    batch = [];
  };
  for (const entry of seed) {
    if (entry.via === 'claude') {
      batch.push(entry);
      continue;
    }
    if (entry.via !== 'you') throw new Error(`unknown seed source: ${entry.via}`);
    await flush();
    await runCli(['query', entry.db, '--sql', entry.sql, '--config', config], env);
  }
  await flush();
  for (const entry of seed.filter((e) => e.pin === true)) {
    const hit = (await journal(stage))
      .filter((j) => j.database === entry.db && j.sql === entry.sql)
      .at(-1);
    if (hit === undefined) throw new Error(`seed: no journal entry to pin for ${entry.sql}`);
    await runCli(['pin', hit.id, '--config', config], env);
  }
}

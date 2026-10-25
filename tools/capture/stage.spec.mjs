import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyData, inside } from './session.mjs';
import {
  CONFIG_NAME,
  mcpConfig,
  pluginEnv,
  pluginFilter,
  retargetConfig,
  seedHistory,
  stageDemo,
  stagePlugin,
} from './stage.mjs';

const CONFIG = [
  '; a comment naming /home/me/argos-demo/shop.db stays',
  '[database.shop]',
  'type=sqlite',
  'file=/home/me/argos-demo/shop.db',
  '',
  '[database.notes]',
  'type=sqlite',
  'file = "/home/me/argos-demo/data/notes.db"',
  '',
  '[database.analytics]',
  'type=postgresql',
  'host=127.0.0.1',
  'database=analytics',
].join('\n');

describe('retargetConfig', () => {
  it('moves every path under the demo dir to the same place under the copy, quoted or not', () => {
    const out = retargetConfig(CONFIG, '/home/me/argos-demo', '/tmp/c');
    expect(out).toContain('file=/tmp/c/shop.db');
    expect(out).toContain('file = "/tmp/c/data/notes.db"');
    expect(out).toContain('host=127.0.0.1');
    expect(out).toContain('database=analytics');
    expect(out.split('\n')[0]).toBe(CONFIG.split('\n')[0]);
  });
  it("leaves a path that only starts with the demo dir's name alone, and then refuses it", () => {
    expect(() =>
      retargetConfig('file=/home/me/argos-demo-old/shop.db', '/home/me/argos-demo', '/tmp/c')
    ).toThrow(/outside the capture's copy: \/home\/me\/argos-demo-old/);
  });
  it('refuses a SQLite file elsewhere, or a relative one, and lets :memory: be', () => {
    expect(() => retargetConfig('file=/srv/prod.db', '/home/me/argos-demo', '/tmp/c')).toThrow(
      /outside the capture's copy/
    );
    expect(() => retargetConfig('file=shop.db', '/home/me/argos-demo', '/tmp/c')).toThrow(
      /outside the capture's copy/
    );
    expect(retargetConfig('file=:memory:', '/home/me/argos-demo', '/tmp/c')).toBe('file=:memory:');
  });
});

describe("the plugin's staged copy", () => {
  it("records the session's paths as the install writes them", () => {
    expect(JSON.parse(pluginEnv({ node: '/n', cli: '/c.js', config: '/x.ini' }))).toEqual({
      node: '/n',
      cli: '/c.js',
      config: '/x.ini',
    });
  });
  it('leaves the specs and their fixtures out', () => {
    expect(pluginFilter('/p/hooks/register.tsx')).toBe(true);
    expect(pluginFilter('/p/hooks/lib/grid.ts')).toBe(true);
    expect(pluginFilter('/p/hooks/lib/grid.spec.ts')).toBe(false);
    expect(pluginFilter('/p/hooks/register.test.ts')).toBe(false);
    expect(pluginFilter('/p/hooks/mod/__tests__')).toBe(false);
    expect(pluginFilter('/p/hooks/mod/__tests__/fake-port.ts')).toBe(false);
  });
  it('copies the plugin and writes hooks/argos.env.json into the copy only', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'plugin-'));
    const from = path.join(root, 'plugin');
    try {
      await mkdir(path.join(from, 'hooks', 'lib'), { recursive: true });
      await mkdir(path.join(from, '.claude-plugin'));
      await writeFile(path.join(from, '.claude-plugin', 'plugin.json'), '{}');
      await writeFile(path.join(from, 'hooks', 'register.tsx'), 'x');
      await writeFile(path.join(from, 'hooks', 'lib', 'a.spec.ts'), 'x');
      const to = path.join(root, 'staged');
      await stagePlugin(from, to, { node: '/n', cli: '/c', config: '/k' });
      expect(JSON.parse(await readFile(path.join(to, 'hooks', 'argos.env.json'), 'utf8'))).toEqual({
        node: '/n',
        cli: '/c',
        config: '/k',
      });
      expect(await readdir(path.join(to, 'hooks', 'lib'))).toEqual([]);
      await expect(stat(path.join(from, 'hooks', 'argos.env.json'))).rejects.toThrow(/ENOENT/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('mcpConfig', () => {
  it('registers argos as `node dist/cli.js serve --config <copy>`, marked with the copy', () => {
    expect(
      mcpConfig({
        node: '/usr/bin/node',
        cli: '/r/dist/cli.js',
        config: '/tmp/s/argos-demo/config.ini',
        dataCopy: '/tmp/s/argos-demo',
        home: '/tmp/s',
      })
    ).toEqual({
      mcpServers: {
        argos: {
          type: 'stdio',
          command: '/usr/bin/node',
          args: ['/r/dist/cli.js', 'serve', '--config', '/tmp/s/argos-demo/config.ini'],
          env: { ARGOS_CAPTURE_DATA: '/tmp/s/argos-demo', HOME: '/tmp/s' },
        },
      },
    });
  });
});

/** A demo dir: a config naming its SQLite file, the file, and a history of the user's own. */
async function demoFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'demo-'));
  const source = path.join(root, 'argos-demo');
  await mkdir(path.join(source, '.argos'), { recursive: true });
  await writeFile(
    path.join(source, CONFIG_NAME),
    `[database.shop]\ntype=sqlite\nfile=${path.join(source, 'shop.db')}\n`
  );
  await writeFile(path.join(source, 'shop.db'), 'not a database, copied as is');
  await writeFile(path.join(source, '.argos', 'journal.jsonl'), '{}\n');
  return { root, source };
}

describe('stageDemo', () => {
  it("copies the demo dir without its history and retargets the copy's config onto it", async () => {
    const { root, source } = await demoFixture();
    const tmpRoot = path.join(root, 'run');
    await mkdir(tmpRoot);
    try {
      const stage = await stageDemo({ source, tmpRoot, copyData, inside });
      expect(path.dirname(stage)).toBe(tmpRoot);
      expect((await readdir(stage)).sort()).toEqual([CONFIG_NAME, 'shop.db']);
      expect(await readFile(path.join(stage, CONFIG_NAME), 'utf8')).toContain(
        `file=${path.join(stage, 'shop.db')}`
      );
      expect(await readFile(path.join(source, CONFIG_NAME), 'utf8')).toContain(
        `file=${path.join(source, 'shop.db')}`
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('refuses a stage inside the demo dir before it makes anything', async () => {
    const { root, source } = await demoFixture();
    try {
      await expect(stageDemo({ source, tmpRoot: source, copyData, inside })).rejects.toThrow(
        /real data dir/
      );
      expect((await readdir(source)).sort()).toEqual(['.argos', CONFIG_NAME, 'shop.db']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('removes the stage when the config names a database outside it', async () => {
    const { root, source } = await demoFixture();
    const tmpRoot = path.join(root, 'run');
    await mkdir(tmpRoot);
    await writeFile(
      path.join(source, CONFIG_NAME),
      '[database.prod]\ntype=sqlite\nfile=/srv/prod.db\n'
    );
    try {
      await expect(stageDemo({ source, tmpRoot, copyData, inside })).rejects.toThrow(
        /outside the capture's copy/
      );
      expect(await readdir(tmpRoot)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('seedHistory', () => {
  it("runs Claude's queries through one MCP server per batch, yours through the CLI, in order, then pins", async () => {
    const stage = await mkdtemp(path.join(os.tmpdir(), 'stage-'));
    const calls = [];
    await mkdir(path.join(stage, '.argos'));
    await writeFile(
      path.join(stage, '.argos', 'journal.jsonl'),
      [
        { id: 'a1', database: 'shop', sql: 'SELECT 1' },
        { id: 'a2', database: 'shop', sql: 'SELECT 2' },
        { id: 'a3', database: 'shop', sql: 'SELECT 1' },
      ]
        .map((e) => JSON.stringify(e))
        .join('\n') + '\n'
    );
    try {
      await seedHistory(
        stage,
        [
          { via: 'claude', db: 'shop', sql: 'SELECT 1', pin: true },
          { via: 'claude', db: 'analytics', sql: 'SELECT 9' },
          { via: 'you', db: 'shop', sql: 'SELECT 2' },
          { via: 'claude', db: 'shop', sql: 'SELECT 3' },
        ],
        {
          home: '/tmp/capture-home',
          callMcp: async (batch, { config, env }) =>
            calls.push(['mcp', batch.map((b) => b.sql), config, env]),
          runCli: async (args, env) => calls.push(['cli', args, env]),
        }
      );
      const config = path.join(stage, CONFIG_NAME);
      expect(calls.map((c) => [c[0], c[1]])).toEqual([
        ['mcp', ['SELECT 1', 'SELECT 9']],
        ['cli', ['query', 'shop', '--sql', 'SELECT 2', '--config', config]],
        ['mcp', ['SELECT 3']],
        // The newest entry with that SQL on that connection.
        ['cli', ['pin', 'a3', '--config', config]],
      ]);
      for (const call of calls) {
        const env = call.at(-1);
        expect(env.HOME).toBe('/tmp/capture-home');
        expect(env.ARGOS_CAPTURE_DATA).toBe(stage);
      }
      expect(calls[0][2]).toBe(config);
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  });
  it('refuses an unknown source, and a pin with no entry to pin', async () => {
    const stage = await mkdtemp(path.join(os.tmpdir(), 'stage-'));
    await mkdir(path.join(stage, '.argos'));
    await writeFile(path.join(stage, '.argos', 'journal.jsonl'), '');
    const fakes = { home: '/h', callMcp: async () => {}, runCli: async () => {} };
    try {
      await expect(
        seedHistory(stage, [{ via: 'bob', db: 'shop', sql: 'x' }], fakes)
      ).rejects.toThrow(/unknown seed source: bob/);
      await expect(
        seedHistory(stage, [{ via: 'claude', db: 'shop', sql: 'SELECT 1', pin: true }], fakes)
      ).rejects.toThrow(/no journal entry to pin/);
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  });
});

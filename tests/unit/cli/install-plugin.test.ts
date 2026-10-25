import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { installPlugin, parseInstallArgs } from '../../../src/cli/install-plugin.js';

describe('installPlugin', () => {
  let root: string;
  let configPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'argos-install-'));
    mkdirSync(join(root, 'plugin', '.claude-plugin'), { recursive: true });
    mkdirSync(join(root, 'plugin', 'hooks'), { recursive: true });
    writeFileSync(join(root, 'plugin', '.claude-plugin', 'plugin.json'), '{"name":"argos"}');
    writeFileSync(join(root, 'plugin', 'hooks', 'hooks.json'), '{}');
    configPath = join(root, 'config.ini');
    writeFileSync(configPath, '[database.x]\n');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('previews without writing or running anything', async () => {
    const run = jest.fn(async () => 0);
    const out = await installPlugin({
      repoRoot: root,
      configPath,
      scope: 'user',
      execute: false,
      run,
    });
    expect(run).not.toHaveBeenCalled();
    expect(existsSync(join(root, '.plugin'))).toBe(false);
    expect(out.outDir).toBe(join(root, '.plugin'));
    expect(out.commands).toEqual([
      ['claude', 'plugin', 'marketplace', 'add', join(root, '.plugin'), '--scope', 'user'],
      ['claude', 'plugin', 'install', 'argos@argos', '--scope', 'user', '--yes'],
    ]);
  });

  it('executes: copies the plugin, writes marketplace and env, runs both commands in order', async () => {
    const calls: string[][] = [];
    const run = async (argv: string[]) => {
      calls.push(argv);
      return 0;
    };
    const out = await installPlugin({
      repoRoot: root,
      configPath,
      scope: 'project',
      execute: true,
      run,
    });
    const dest = join(root, '.plugin', 'plugins', 'argos');
    expect(existsSync(join(dest, '.claude-plugin', 'plugin.json'))).toBe(true);
    expect(
      JSON.parse(readFileSync(join(root, '.plugin', '.claude-plugin', 'marketplace.json'), 'utf8'))
    ).toEqual({
      name: 'argos',
      plugins: [{ name: 'argos', source: './plugins/argos' }],
    });
    expect(JSON.parse(readFileSync(join(dest, 'hooks', 'argos.env.json'), 'utf8'))).toEqual({
      node: process.execPath,
      cli: join(root, 'dist', 'cli.js'),
      config: configPath,
    });
    expect(calls).toEqual(out.commands);
    expect(calls[0]).toContain('project');
  });

  it('fails when the config is missing, naming the path', async () => {
    const missing = join(root, 'nope.ini');
    await expect(
      installPlugin({ repoRoot: root, configPath: missing, scope: 'user', execute: false })
    ).rejects.toThrow(missing);
  });

  it('fails when plugin/ is missing on execute', async () => {
    rmSync(join(root, 'plugin'), { recursive: true });
    await expect(
      installPlugin({
        repoRoot: root,
        configPath,
        scope: 'user',
        execute: true,
        run: async () => 0,
      })
    ).rejects.toThrow(/plugin/);
  });

  it('fails when a claude command exits non-zero', async () => {
    await expect(
      installPlugin({
        repoRoot: root,
        configPath,
        scope: 'user',
        execute: true,
        run: async () => 2,
      })
    ).rejects.toThrow(/exit/);
  });
});

describe('parseInstallArgs', () => {
  it('parses flags with defaults', () => {
    expect(parseInstallArgs([])).toEqual({ execute: false, scope: 'user', config: undefined });
    expect(parseInstallArgs(['--execute', '--scope=local', '--config', 'a.ini'])).toEqual({
      execute: true,
      scope: 'local',
      config: 'a.ini',
    });
    expect(parseInstallArgs(['--config=b.ini']).config).toBe('b.ini');
  });
  it('rejects a bad scope', () => {
    expect(() => parseInstallArgs(['--scope=world'])).toThrow(/scope/);
  });
});

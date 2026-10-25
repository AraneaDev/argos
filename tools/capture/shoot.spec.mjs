import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cursor, plain, send, snap, type } from './driver.mjs';
import { launchArgv, socketPath, stopSession } from './session.mjs';
import {
  checkBuilt,
  checkLength,
  maskFrame,
  parseArgs,
  playShot,
  promptReady,
  submit,
} from './shoot.mjs';
import { COMMAND_LIST, PROMPT } from './shots.mjs';

/** A session whose tmux calls are recorded and answered by `answer`. */
const fakeSession = (answer = () => '') => {
  const calls = [];
  return {
    calls,
    session: {
      name: 'argos-capture-1-abcd',
      socket: 'argos-capture-1-abcd',
      cols: 160,
      dataCopy: '/nonexistent/argos-capture-copy',
      runTmux: async (argv) => {
        calls.push(argv);
        return { stdout: answer(argv) };
      },
    },
  };
};

describe('tmux server', () => {
  it("runs every tmux call on the session's own server", async () => {
    const { calls, session } = fakeSession((argv) => (argv.includes('display-message') ? '3' : ''));
    await send(session, 'Enter');
    await type(session, 'x');
    await snap(session);
    await cursor(session);
    await stopSession(session);
    const launch = launchArgv(session, {
      env: {},
      project: '/p',
      pluginDir: '/q',
      mcpFile: '/m.json',
      claudeArgs: [],
    });
    for (const argv of [...calls, launch]) {
      expect(argv.slice(0, 2)).toEqual(['-L', session.socket]);
    }
    expect(calls.at(-1)).toEqual(['-L', session.socket, 'kill-server']);
    expect(socketPath('argos-capture-x')).toMatch(/\/tmux-\d+\/argos-capture-x$/);
    // Focus events are set on that private server, in the same command that starts it.
    expect(launch.join(' ')).toContain(
      'start-server ; set-option -s focus-events on ; new-session'
    );
  });
  it("starts Claude Code with the staged plugin and only the capture's MCP servers", () => {
    const { session } = fakeSession();
    const launch = launchArgv(session, {
      env: {},
      project: '/p',
      pluginDir: '/q',
      mcpFile: '/m.json',
      claudeArgs: ['--tools', ''],
    });
    const at = launch.indexOf('claude');
    expect(launch.slice(at)).toEqual([
      'claude',
      '--plugin-dir',
      '/q',
      '--strict-mcp-config',
      '--mcp-config',
      '/m.json',
      '--tools',
      '',
    ]);
    expect(launch[launch.indexOf('-c') + 1]).toBe('/p');
  });
});

const screen = (prompt, extra = '') => `header\n${extra}────\n❯ ${prompt}\n────\n  footer`;

describe('stopSession', () => {
  it('removes the socket a killed server leaves behind', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sock-'));
    const { session } = fakeSession();
    session.socketPath = path.join(dir, session.socket);
    await writeFile(session.socketPath, '');
    try {
      await stopSession(session);
      await expect(stat(session.socketPath)).rejects.toThrow(/ENOENT/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('promptReady', () => {
  it("lets the hero's prompt go only when the prompt line reads it exactly", () => {
    expect(promptReady(screen(PROMPT), 2, PROMPT)).toBeNull();
    expect(promptReady(screen(PROMPT.slice(0, -1)), 2, PROMPT)).toMatch(/prompt reads/);
    // Text elsewhere on screen is not the prompt.
    expect(promptReady(screen('', `${PROMPT}\n`), 2, PROMPT)).toMatch(/prompt reads ""/);
  });
  it('reads a prompt that wraps onto more lines as one text', () => {
    const half = PROMPT.indexOf(' spent');
    const wrapped = `────\n❯ ${PROMPT.slice(0, half)}\n  ${PROMPT.slice(half + 1)}\n────`;
    expect(promptReady(wrapped, 2, PROMPT)).toBeNull();
  });
  it("reads the chat's side only: the pane beside a ❯ line is not the prompt", () => {
    const beside = `❯ ${PROMPT}        │ argos  ~/argos-demo/config.ini\n`;
    expect(promptReady(beside, 2, PROMPT)).toBeNull();
  });
  it('lets /argos go only with its space typed and the command list shut', () => {
    const open =
      '  ❯ /argos                      Toggle the Argos pane: connections, schema and every query Claude runs\n';
    expect(promptReady(screen('/argos'), 9, '/argos ', COMMAND_LIST)).toBeNull();
    expect(promptReady(screen('/argos'), 8, '/argos ', COMMAND_LIST)).toMatch(/cursor/);
    expect(promptReady(screen('/argos', open), 9, '/argos ', COMMAND_LIST)).toMatch(/still shows/);
    expect(promptReady(screen('/argoss'), 10, '/argos ', COMMAND_LIST)).toMatch(/prompt reads/);
  });
});

describe('submit', () => {
  const step = { expect: '/argos ', absent: COMMAND_LIST, steps: [{}] };
  it('clears and retypes a wrong prompt twice, then fails without Enter, showing the screen that failed', async () => {
    let cleared = false;
    const { calls, session } = fakeSession((argv) => {
      if (argv.includes('send-keys')) cleared = argv.at(-1) === 'C-u';
      if (argv.includes('display-message')) return '9';
      return screen(cleared ? '' : '/agros');
    });
    let typed = 0;
    const failed = submit(session, step, async () => {
      typed += 1;
      cleared = false;
    });
    await expect(failed).rejects.toThrow(/Enter not sent/);
    expect((await failed.catch((e) => e)).lastFrame).toContain('/agros');
    expect(typed).toBe(3);
    const keys = calls.filter((a) => a.includes('send-keys')).map((a) => a.at(-1));
    expect(keys).toEqual(['C-u', 'C-u', 'C-u']);
  });
  it('sends Enter once the prompt is right', async () => {
    const { calls, session } = fakeSession((argv) =>
      argv.includes('display-message') ? '9' : screen('/argos')
    );
    await submit(session, step, async () => {});
    expect(calls.filter((a) => a.includes('send-keys')).map((a) => a.at(-1))).toEqual(['Enter']);
  });
});

describe('wait on a fixture', () => {
  it('names the FIXTURE entry on a timeout', async () => {
    const session = { name: 's', snap: async () => 'nothing here' };
    await expect(
      playShot(session, {
        steps: [
          {
            do: 'wait',
            step: 'orders',
            match: 'zzz',
            timeoutMs: 30,
            fixture: 'table',
          },
        ],
      })
    ).rejects.toThrow(/FIXTURE\.table = "orders"/);
  });
  it('refuses a step kind it does not know', async () => {
    const session = { name: 's', snap: async () => '' };
    await expect(playShot(session, { steps: [{ do: 'edit' }] })).rejects.toThrow(
      /unknown step: edit/
    );
  });
});

describe('checkLength', () => {
  it("counts the frames built and refuses a GIF past the shot's limit", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'frames-'));
    try {
      for (let i = 0; i < 9; i += 1)
        await writeFile(path.join(dir, `${String(i).padStart(5, '0')}.png`), '');
      await writeFile(path.join(dir, 'palette.png'), '');
      expect(await checkLength(dir, { maxMs: 2000 })).toBe(1125);
      await expect(checkLength(dir, { maxMs: 1000 })).rejects.toThrow(/past 1 s/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('maskFrame', () => {
  const copy = '/tmp/argos-capture-Ab12Cd/argos-demo';
  const dim = (s) => `\u001b[2m${s}\u001b[22m`;
  it("shows the copy's path as the demo's, keeping what stands past the next gap in its column", () => {
    const line = `│  argos${dim(`  ${copy}/config.ini`)}   shop      read-only pane`;
    const masked = maskFrame(line, copy);
    expect(plain(masked)).toBe(
      `│  argos  ~/argos-demo/config.ini   shop${' '.repeat(6 + copy.length - '~/argos-demo'.length)}read-only pane`
    );
    expect(plain(masked).length).toBe(plain(line).length);
    expect(plain(masked).indexOf('read-only pane')).toBe(plain(line).indexOf('read-only pane'));
    // The dim around the path is kept.
    expect(masked).toContain(dim('  ~/argos-demo/config.ini'));
  });
  it('puts the spaces right after the path when no gap follows, and masks every line', () => {
    const frame = `a ${copy}/x\nb ${copy}/y z`;
    const masked = maskFrame(frame, copy).split('\n');
    const spare = ' '.repeat(copy.length - '~/argos-demo'.length);
    expect(masked).toEqual([`a ~/argos-demo${spare}/x`, `b ~/argos-demo${spare}/y z`]);
  });
  it('never counts the spaces of an escape sequence as a gap', () => {
    const line = `${copy}\u001b[38;2;1;2;3m|\u001b[0m end    pill`;
    const masked = maskFrame(line, copy);
    expect(plain(masked).indexOf('pill')).toBe(plain(line).indexOf('pill'));
    expect(masked).toContain('\u001b[38;2;1;2;3m|\u001b[0m end ');
  });
  it('takes the columns back out of the gap when the shown path is longer', () => {
    const line = `/t/a${' '.repeat(11)}pill`;
    expect(maskFrame(line, '/t/a', '~/argos-demo')).toBe('~/argos-demo   pill');
    // A gap too short to give the columns back is left as it is.
    expect(maskFrame('/t/a   pill', '/t/a', '~/argos-demo')).toBe('~/argos-demo   pill');
  });
  it('leaves a frame without the path, or with no path to mask, as it is', () => {
    expect(maskFrame('nothing here', copy)).toBe('nothing here');
    expect(maskFrame(`a ${copy}`, undefined)).toBe(`a ${copy}`);
  });
});

describe('parseArgs', () => {
  it('reads --only, --out and --source, expanding ~, and refuses an unknown shot or option', () => {
    const shots = { hero: {}, queries: {} };
    const { only, out, source } = parseArgs(
      ['--only=hero,queries', '--out=x/y', '--source=~/demo'],
      shots,
      '/home/me'
    );
    expect(only).toEqual(['hero', 'queries']);
    expect(out.endsWith('x/y')).toBe(true);
    expect(source).toBe('/home/me/demo');
    const defaults = parseArgs([], shots, '/home/me');
    expect(defaults.only).toEqual(['hero', 'queries']);
    expect(defaults.source).toBe('/home/me/argos-demo');
    expect(defaults.out).toMatch(/docs\/images\/claude-code$/);
    expect(() => parseArgs(['--only=nope'], shots)).toThrow(/unknown shot/);
    expect(() => parseArgs(['--fast'], shots)).toThrow(/unknown option/);
  });
});

describe('checkBuilt', () => {
  it('asks for a build when the CLI is missing', async () => {
    await expect(
      checkBuilt('/r/dist/cli.js', async () => {
        throw new Error('ENOENT');
      })
    ).rejects.toThrow(/run npm run build first/);
    await expect(checkBuilt('/r/dist/cli.js', async () => {})).resolves.toBeUndefined();
  });
});

describe('shoot.mjs as a command', () => {
  const self = new URL('./shoot.mjs', import.meta.url);
  it('starts with a node shebang', async () => {
    const [first] = (await readFile(self, 'utf8')).split('\n', 1);
    expect(first).toBe('#!/usr/bin/env node');
  });
  it('is executable', async () => {
    expect((await stat(self)).mode & 0o111).not.toBe(0);
  });
});

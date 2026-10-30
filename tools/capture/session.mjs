/**
 * Dev-only. Runs Claude Code in an isolated tmux session for the README captures.
 *
 * Isolated means: its own CLAUDE_CONFIG_DIR (a temp dir holding a copy of the
 * credentials and pre-seeded first-run answers, so none of the user's
 * settings, status line, plugins or MCP servers load), its own HOME, and its
 * own copy of the demo data (config.ini, the SQLite files it names and the
 * pane's .argos history), which the plugin and the argos MCP server are both
 * pointed at. Nothing is ever written to the user's real config or demo dir;
 * guardEnv refuses a session that would.
 */
import { execFile } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import {
  access,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { tmuxArgv, tmux } from './driver.mjs';
import { CONFIG_NAME, mcpConfig, retargetConfig, stagePlugin } from './stage.mjs';

const run = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cleanups = [];

/** Adds a step for runCleanups; the function it returns takes the step back out, for work that cleaned up after itself. */
export function registerCleanup(fn) {
  cleanups.push(fn);
  return () => {
    const at = cleanups.lastIndexOf(fn);
    if (at !== -1) cleanups.splice(at, 1);
  };
}

/** Runs every registered step once, last registered first; a step that throws does not stop the rest. */
export async function runCleanups() {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    try {
      await fn();
    } catch (error) {
      process.stderr.write(`cleanup: ${error.message}\n`);
    }
  }
}

/**
 * One way out for the whole process: the first handler to fire runs the
 * cleanups and then exits with its own code; every later one, of any kind (a
 * repeated Ctrl-C, a SIGTERM during a SIGINT's cleanup, an error thrown from a
 * cleanup step), joins that same run instead of exiting while it is still
 * stopping the session or removing its files.
 */
export function exitGroup({
  exit = (c) => process.exit(c),
  log = (m) => process.stderr.write(m),
} = {}) {
  let leaving = null;
  return (code) => (reason) => {
    if (reason instanceof Error) log(`${reason.stack ?? reason.message}\n`);
    leaving ??= runCleanups().then(() => exit(code));
    return leaving;
  };
}

const leave = exitGroup();
let installed = false;

/** Makes sure a signal, an uncaught exception or an unhandled rejection still leaves nothing behind. */
export function installExitHandlers() {
  if (installed) return;
  installed = true;
  process.on('SIGINT', leave(130));
  process.on('SIGTERM', leave(143));
  process.on('uncaughtException', leave(1));
  process.on('unhandledRejection', leave(1));
}

/**
 * The real path of `p`: its deepest existing ancestor resolved through any
 * links, plus the rest. A dangling link on the way is followed to where it
 * points, so a link to a dir that does not exist yet is judged by its target.
 */
export function real(p, depth = 0) {
  const absolute = path.resolve(p);
  if (depth > 40) throw new Error(`too many links resolving ${p}`);
  const rest = [];
  let probe = absolute;
  for (;;) {
    try {
      return path.join(realpathSync.native(probe), ...rest);
    } catch {
      let target = null;
      try {
        if (lstatSync(probe).isSymbolicLink()) target = readlinkSync(probe);
      } catch {
        // Not there at all: go up a level.
      }
      if (target !== null) {
        return real(path.resolve(path.dirname(probe), target, ...rest), depth + 1);
      }
      const parent = path.dirname(probe);
      if (parent === probe) return absolute;
      rest.unshift(path.basename(probe));
      probe = parent;
    }
  }
}

/** Whether `p` is `root` or lies under it, compared by real path. */
export const inside = (p, root) => {
  const r = path.relative(real(root), real(p));
  return r === '' || (r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r));
};

/**
 * Throws unless both the data copy and the config dir are set and lie
 * outside the real ones, compared by real path, so a link into either is
 * refused too. The real data dir is the demo dir the copy was taken from.
 * With `tempBase`, HOME must be set and lie inside it: a session never runs
 * with the user's own HOME (nor reads their ~/.claude.json).
 */
export function guardEnv(env, { realDataDir, realConfigDir, tempBase }) {
  if (!env.ARGOS_CAPTURE_DATA || inside(env.ARGOS_CAPTURE_DATA, realDataDir)) {
    throw new Error(`refusing the real data dir: ${env.ARGOS_CAPTURE_DATA}`);
  }
  if (!env.CLAUDE_CONFIG_DIR) throw new Error('CLAUDE_CONFIG_DIR must be set to a temp dir');
  if (inside(env.CLAUDE_CONFIG_DIR, realConfigDir)) {
    throw new Error(`refusing the real config dir: ${env.CLAUDE_CONFIG_DIR}`);
  }
  if (tempBase !== undefined && (!env.HOME || !inside(env.HOME, tempBase))) {
    throw new Error(`refusing a HOME outside the capture's temp dir ${tempBase}: ${env.HOME}`);
  }
}

const DATABASE = /\.(sqlite|sqlite3|db)$/;
const SIDECAR = /-(wal|shm|journal)$/;
const MAGIC = Buffer.from('SQLite format 3\0', 'latin1');

/** True for a regular file that starts with SQLite's header; any other `.db` is just a file. */
async function isSqlite(file) {
  const info = await stat(file).catch(() => null);
  if (info === null || !info.isFile()) return false;
  const handle = await open(file, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(16), 0, 16, 0);
    return bytesRead === 16 && buffer.equals(MAGIC);
  } finally {
    await handle.close();
  }
}

const exists = (file) =>
  access(file).then(
    () => true,
    () => false
  );

/**
 * Size and mtime of a database file and its rollback journal. The WAL is left
 * out on purpose: appends to it come with every write and never make a copy
 * wrong (SQLite reads a WAL only up to its last whole, checksummed commit).
 * What would is the database file changing under the copy, which a
 * checkpoint does, and that shows here.
 */
const fingerprint = async (db) =>
  (
    await Promise.all(
      ['', '-journal'].map((side) =>
        stat(db + side).then(
          (i) => `${i.size}:${i.mtimeMs}`,
          () => '-'
        )
      )
    )
  ).join(' ');

/**
 * Copies a database and its -wal or -journal as plain files, the database
 * first, again until the database file stood still through the whole copy,
 * so the files belong together. The -shm is never copied: SQLite rebuilds it
 * from the WAL.
 */
async function quietCopy(from, to, { copy, attempts }) {
  for (let n = 0; n < attempts; n += 1) {
    const before = await fingerprint(from);
    for (const side of ['', '-wal', '-journal']) {
      await rm(to + side, { force: true });
      if (await exists(from + side)) await copy(from + side, to + side);
    }
    if ((await fingerprint(from)) === before) return;
  }
  throw new Error(`${from} kept changing while it was copied`);
}

/**
 * Backs one database up into `to` as one consistent snapshot. SQLite never
 * opens the original, not even read only: a read-only open of a WAL database
 * whose writer has just closed would create its -wal and -shm again in the
 * user's demo dir. The files are copied to a temp dir first, and the backup
 * is taken from there. That dir is registered for cleanup as soon as it
 * exists, so a signal during the copy removes it too.
 */
export async function snapshot(from, to, { copy = copyFile, attempts = 5 } = {}) {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'argos-capture-db-'));
  const drop = () => rm(scratch, { recursive: true, force: true });
  const forget = registerCleanup(drop);
  try {
    const origin = path.join(scratch, path.basename(from));
    await quietCopy(from, origin, { copy, attempts });
    const db = new DatabaseSync(origin);
    try {
      // One step: a multi-step backup restarts whenever another connection writes in between.
      await backup(db, to, { rate: 2 ** 31 - 1 });
    } finally {
      db.close();
    }
  } finally {
    forget();
    await drop();
  }
}

/**
 * Copies a demo dir for a capture. Each SQLite database is taken as one
 * consistent snapshot (see snapshot); its -wal, -shm and -journal files
 * never land in the copy. The rest is copied as is, except the logs and the
 * top-level entries named in `skip` (the user's own `.argos` history, when
 * the stage is taken from the demo dir).
 */
export async function copyData(source, dest, { skip = [], ...options } = {}) {
  const databases = [];
  await cp(source, dest, {
    recursive: true,
    filter: async (from) => {
      const rel = path.relative(source, from);
      if (rel === '') return true;
      if (skip.includes(rel.split(path.sep)[0])) return false;
      if (rel.endsWith('.log')) return false;
      const base = from.replace(SIDECAR, '');
      if (base !== from && DATABASE.test(base) && (await isSqlite(base))) return false;
      if (DATABASE.test(rel) && (await isSqlite(from))) {
        databases.push(rel);
        return false;
      }
      return true;
    },
  });
  for (const rel of databases) {
    await mkdir(path.dirname(path.join(dest, rel)), { recursive: true });
    await snapshot(path.join(source, rel), path.join(dest, rel), options);
  }
}

/**
 * The PIDs of processes (the argos MCP server, the CLI the pane runs)
 * started against this data copy, known by the exact ARGOS_CAPTURE_DATA in
 * their own environment. Their command lines name only a config path, and a
 * user's own argos could share the CLI path, so they are never matched on that.
 */
export async function ownProcesses(dataCopy, { procRoot = '/proc', self = process.pid } = {}) {
  const mark = `ARGOS_CAPTURE_DATA=${dataCopy}`;
  const pids = [];
  for (const entry of await readdir(procRoot).catch(() => [])) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid <= 1 || pid === self) continue;
    const environ = await readFile(path.join(procRoot, entry, 'environ'), 'utf8').catch(() => '');
    if (environ.split('\0').includes(mark)) pids.push(pid);
  }
  return pids;
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const signal = (pid, name) => {
  try {
    process.kill(pid, name);
  } catch {
    // Gone already.
  }
};

/** SIGTERM to every process started against the copy, then SIGKILL to any of them still there after `graceMs`. */
export async function stopProcesses(dataCopy, graceMs = 3000) {
  const pids = await ownProcesses(dataCopy);
  for (const pid of pids) signal(pid, 'SIGTERM');
  const end = Date.now() + graceMs;
  while (pids.some(alive) && Date.now() < end) await sleep(100);
  // Matched again, so a PID reused in the meantime is never hit.
  const left = new Set(await ownProcesses(dataCopy));
  for (const pid of pids.filter((p) => left.has(p))) signal(pid, 'SIGKILL');
}

/** A tmux session name no leftover session can share: this PID plus a random suffix. */
export const sessionName = (pid = process.pid) =>
  `argos-capture-${pid}-${randomBytes(4).toString('hex')}`;

/**
 * The command that starts the session on its own tmux server (`-L`, so the
 * user's server and its options are never touched): focus events on there,
 * or Claude Code prints a tmux hint at the bottom of the first frames. Only
 * the MCP servers in `mcpFile` load (`--strict-mcp-config`).
 */
export function launchArgv(session, { env, project, pluginDir, mcpFile, claudeArgs }) {
  const envArgs = SESSION_ENV.flatMap((k) => ['-e', `${k}=${env[k]}`]);
  return tmuxArgv(session, [
    'start-server',
    ';',
    'set-option',
    '-s',
    'focus-events',
    'on',
    ';',
    'new-session',
    '-d',
    '-s',
    session.name,
    '-x',
    String(session.cols),
    '-y',
    String(session.rows),
    ...envArgs,
    '-c',
    project,
    'claude',
    '--plugin-dir',
    pluginDir,
    '--strict-mcp-config',
    '--mcp-config',
    mcpFile,
    ...claudeArgs,
  ]);
}

/** Where tmux keeps a server's socket: its own dir per user, under TMUX_TMPDIR or /tmp. */
export const socketPath = (socket) =>
  path.join(process.env.TMUX_TMPDIR ?? '/tmp', `tmux-${process.getuid()}`, socket);

/** Ends the session's whole tmux server and removes its socket, then whatever is left on its data copy. */
export async function stopSession(session) {
  // Tolerates a server that never started or is gone already.
  await tmux(session, ['kill-server']).catch(() => {});
  // A killed server leaves its socket file behind.
  await rm(session.socketPath ?? socketPath(session.socket), {
    force: true,
  });
  // The MCP server leaves with the session as a rule; what is left is stopped by its data copy.
  await stopProcesses(session.dataCopy);
}

const SESSION_ENV = [
  'CLAUDE_CONFIG_DIR',
  'ARGOS_CAPTURE_DATA',
  'COLORTERM',
  'CLAUDE_CODE_TMUX_TRUECOLOR',
  'ENABLE_CLAUDEAI_MCP_SERVERS',
  'DISABLE_AUTOUPDATER',
  'IS_DEMO',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'HOME',
];

/** The environment a session runs with: the capture's own dirs, never the user's. */
export function sessionEnv({ configDir, dataCopy, home, base = process.env }) {
  return {
    ...base,
    CLAUDE_CONFIG_DIR: configDir,
    ARGOS_CAPTURE_DATA: dataCopy,
    COLORTERM: 'truecolor',
    // Inside tmux Claude Code drops to 256 colours unless told the multiplexer passes truecolor on.
    CLAUDE_CODE_TMUX_TRUECOLOR: '1',
    // The account's claude.ai connectors are not the capture's business, and an update must not run mid-capture.
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    DISABLE_AUTOUPDATER: '1',
    // Claude Code's demo mode: no account email or organisation on screen.
    IS_DEMO: '1',
    // Essential traffic only, which also keeps promotional notices out of the startup header.
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    // HOME is a temp dir, never the user's: Claude Code names the project
    // `~/<name>` in its header when the project lies in HOME (so the shot
    // reads ~/argos-demo, not a temp path), and with the user's HOME it
    // would also find their ~/.claude.json, rules and memory. Argos's
    // audit log goes under HOME too.
    HOME: home,
  };
}

/** The name of the session's copy of the demo dir, which is also its project: Claude Code's header reads `~/argos-demo`. */
export const DATA_NAME = 'argos-demo';

/**
 * `dataDir` is the run's stage (see stage.mjs): it is copied for this
 * session alone, the copy's config.ini retargeted onto it, and both the
 * plugin (a staged copy whose argos.env.json names that config) and the
 * argos MCP server are pointed at the copy. The session's temp dir goes in
 * `tmpRoot` (the system's by default) and is its HOME, so the copy, which
 * is also the project Claude Code runs in, reads as `~/argos-demo`.
 */
export async function createSession({
  dataDir,
  realDataDir,
  pluginSource,
  cli,
  cols,
  rows,
  theme,
  tmpRoot = os.tmpdir(),
  claudeArgs = ['--permission-mode', 'default'],
}) {
  installExitHandlers();
  // A short name: the pane's header drops its chips when the config's path is long (see maskFrame).
  const base = await mkdtemp(path.join(tmpRoot, 'argos-'));
  const removeBase = () => rm(base, { recursive: true, force: true });
  const forgetBase = registerCleanup(removeBase);
  const homeDir = base;
  const configDir = path.join(base, '.claude-capture');
  const dataCopy = path.join(base, DATA_NAME);
  const project = dataCopy;
  const pluginDir = path.join(base, '.plugin');
  const mcpFile = path.join(base, '.mcp-capture.json');
  const env = sessionEnv({ configDir, dataCopy, home: homeDir });
  guardEnv(env, {
    realDataDir,
    realConfigDir: path.join(os.homedir(), '.claude'),
    tempBase: base,
  });
  await mkdir(configDir, { recursive: true });
  await copyData(dataDir, dataCopy);
  const config = path.join(dataCopy, CONFIG_NAME);
  await writeFile(config, retargetConfig(await readFile(config, 'utf8'), dataDir, dataCopy));
  const paths = { node: process.execPath, cli, config };
  await stagePlugin(pluginSource, pluginDir, paths);
  await writeFile(mcpFile, JSON.stringify(mcpConfig({ ...paths, dataCopy, home: homeDir })));
  await cp(
    path.join(os.homedir(), '.claude', '.credentials.json'),
    path.join(configDir, '.credentials.json')
  );
  // Pre-seed what a first run would ask for, so no dialog waits on a key press,
  // and the one-time auto mode notice, so it never shows in a shot.
  await writeFile(
    path.join(configDir, '.claude.json'),
    JSON.stringify({
      hasCompletedOnboarding: true,
      hasSeenAutoDefaultNotice: true,
      theme,
      projects: { [project]: { hasTrustDialogAccepted: true } },
    })
  );
  // No tips under the spinner: a tip is Claude Code's advice, not the session's work.
  // The theme goes here too: newer Claude Code builds read it from settings.json.
  await writeFile(
    path.join(configDir, 'settings.json'),
    JSON.stringify({ spinnerTipsEnabled: false, theme })
  );
  const name = sessionName();
  const session = {
    name,
    // Its own tmux server, named like the session.
    socket: name,
    env,
    configDir,
    dataCopy,
    config,
    cols,
    rows,
    stop: () => stopSession(session),
    /** Stops the session and removes its temp dir now, for a run that shoots several sessions in turn. */
    async close() {
      forgetStop();
      forgetBase();
      await session.stop();
      await removeBase();
    },
  };
  // Before the session starts, so a signal while it starts still ends it.
  const forgetStop = registerCleanup(() => session.stop());
  const [cmd, ...argv] = [
    'tmux',
    ...launchArgv(session, {
      env,
      project,
      pluginDir,
      mcpFile,
      claudeArgs,
    }),
  ];
  await run(cmd, argv);
  return session;
}

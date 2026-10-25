#!/usr/bin/env node
/**
 * Dev-only. Shoots the README and docs captures of the Argos pane: the hero
 * GIF and one still per tab, each in its own isolated Claude Code session
 * (see session.mjs).
 *
 *     npm run build
 *     node tools/capture/shoot.mjs [--only=hero,queries] [--out=docs/images/claude-code] [--source=~/argos-demo]
 *
 * The sessions never touch the demo dir: it is staged once a run (a copy of
 * its config.ini and SQLite files, without its .argos history), the stage is
 * seeded with SEED, and every session gets a copy of the stage of its own.
 * The stage and every session are removed however the run ends.
 * CAPTURE_TRACE=1 prints each step with the frame count reached, for timing
 * the GIF.
 */
import { access, copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { clearInterval, setInterval } from 'node:timers';
import { cursor, plain, resize, send, snap, type, waitFor } from './driver.mjs';
import { framePage } from './frame.mjs';
import { buildGif } from './gif.mjs';
import { renderPng } from './render.mjs';
import {
  copyData,
  createSession,
  inside,
  installExitHandlers,
  registerCleanup,
  runCleanups,
} from './session.mjs';
import {
  FIXTURE,
  FRAME_MS,
  GIF_WIDTH,
  NEVER_SHOWN,
  SEED,
  SHOTS,
  SHOWN_DATA_DIR,
  WAIT_MS,
} from './shots.mjs';
import { CLI, PLUGIN, REPO, seedHistory, stageDemo } from './stage.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');

/** `--only=a,b`, `--out=dir` and `--source=dir`; every shot, docs/images/claude-code and ~/argos-demo when left out. */
export function parseArgs(argv, shots = SHOTS, home = os.homedir()) {
  let only = Object.keys(shots);
  let out = path.join(REPO, 'docs', 'images', 'claude-code');
  let source = path.join(home, 'argos-demo');
  const expand = (p) => path.resolve(p.replace(/^~(?=\/|$)/, home));
  for (const arg of argv) {
    const [key, value = ''] = arg.split(/=(.*)/s);
    if (key === '--only') {
      only = value.split(',').filter((s) => s !== '');
      const unknown = only.filter((s) => !Object.hasOwn(shots, s));
      if (unknown.length > 0) throw new Error(`unknown shot: ${unknown.join(', ')}`);
    } else if (key === '--out') {
      out = expand(value);
    } else if (key === '--source') {
      source = expand(value);
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return { only, out, source };
}

const pad = (n) => String(n).padStart(5, '0');

// eslint-disable-next-line no-control-regex -- matching escape sequences is the point
const SGR = /\u001b\[([0-9;]*)m/gy;

/**
 * Whether the pane has the keyboard: Claude Code draws a plugin pane's left
 * border dim while the prompt has it, and in the accent colour when the pane
 * does. Read from the first row, at the first `│`.
 */
export function paneFocused(ansi) {
  const row = ansi.split('\n')[0] ?? '';
  let dim = false;
  for (let i = 0; i < row.length; ) {
    SGR.lastIndex = i;
    const m = SGR.exec(row);
    if (m !== null) {
      const codes = m[1] === '' ? ['0'] : m[1].split(';');
      for (let c = 0; c < codes.length; c += 1) {
        const code = codes[c];
        // 38, 48 and 58 carry a colour: `5;n` or `2;r;g;b`, never a dim.
        if (['38', '48', '58'].includes(code)) c += codes[c + 1] === '5' ? 2 : 4;
        else if (code === '0' || code === '22') dim = false;
        else if (code === '2') dim = true;
      }
      i = SGR.lastIndex;
      continue;
    }
    if (row[i] === '│') return !dim;
    i += 1;
  }
  return false;
}

/** The pane's left border column, from the first row's plain text. */
export const borderColumn = (ansi) => [...plain(ansi).split('\n')[0]].indexOf('│');

// An escape sequence (kept whole, never searched inside), or a run of three spaces or more.
const TOKENS =
  // eslint-disable-next-line no-control-regex -- matching escape sequences is the point
  /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)| {3,}/g;

/**
 * One line with each `from` replaced by `to`, the columns it gains (or
 * loses) given back in the widest run of spaces after it (the first of
 * equals): the gap a spread row stretches, so what stands past it (the
 * header's gauge and pill, a card's border) keeps its column, and what
 * follows the path closely (the header's chips) stays close. With no such
 * run the spaces go right after the replacement.
 */
function maskLine(line, from, to) {
  let at = line.indexOf(from);
  while (at !== -1) {
    const end = at + to.length;
    let next = line.slice(0, at) + to + line.slice(at + from.length);
    const spare = [...from].length - [...to].length;
    TOKENS.lastIndex = end;
    let gap = null;
    for (let m = TOKENS.exec(next); m !== null; m = TOKENS.exec(next)) {
      if (!m[0].startsWith(' ') || m[0].length <= -spare) continue;
      if (gap === null || m[0].length > gap[0].length) gap = m;
    }
    if (spare > 0) {
      const put = gap === null ? end : gap.index;
      next = next.slice(0, put) + ' '.repeat(spare) + next.slice(put);
    } else if (spare < 0 && gap !== null) {
      next = next.slice(0, gap.index) + next.slice(gap.index - spare);
    }
    line = next;
    at = line.indexOf(from, end);
  }
  return line;
}

/**
 * A frame with the session's temp copy of the demo dir shown at `to` (the
 * demo's own place) wherever its path is drawn, line by line (see maskLine).
 * The pane draws the config.ini it reads in its header; a random temp path
 * there would date every capture.
 */
export function maskFrame(ansi, from, to = SHOWN_DATA_DIR) {
  if (!from) return ansi;
  return ansi
    .split('\n')
    .map((line) => maskLine(line, from, to))
    .join('\n');
}

/**
 * Gives the pane the keyboard with ctrl+x tab, which Claude Code toggles: it
 * is sent only while the pane (or, with `field`, a field in it, where the
 * terminal cursor then stands) does not have it, and checked again after.
 */
async function focusPane(session, { field = false, prompt = false } = {}) {
  const has = async () => {
    const frame = await snap(session);
    if (prompt) return !paneFocused(frame);
    if (!field) return paneFocused(frame);
    return (await cursor(session)) > borderColumn(frame);
  };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await has()) return;
    if (prompt) {
      // Escape is the one key a pane cannot keep: it hands the keyboard back.
      await send(session, 'Escape');
    } else {
      await send(session, 'C-x');
      await sleep(100);
      await send(session, 'Tab');
    }
    const end = Date.now() + 1500;
    while (Date.now() < end) {
      await sleep(150);
      if (await has()) return;
    }
  }
  const error = new Error(
    prompt
      ? 'the prompt never got the keyboard back'
      : `the pane never got the keyboard${field ? ' in its field' : ''}`
  );
  error.lastFrame = plain(await snap(session));
  throw error;
}

/**
 * The text in Claude Code's prompt: the last line that starts with its `❯`,
 * and the lines a long text wraps onto, up to the box's lower rule. Only
 * the chat's side of a line counts: the pane beside it starts at its border.
 */
export function promptText(screen) {
  const lines = plain(screen)
    .split('\n')
    .map((l) => l.split('│')[0].trimEnd());
  const at = lines.findLastIndex((l) => l.startsWith('❯'));
  if (at === -1) return '';
  const parts = [lines[at].slice(1).trim()];
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith('─') || line.trim() === '') break;
    parts.push(line.trim());
  }
  return parts.filter((p) => p !== '').join(' ');
}

/**
 * Why the prompt is not ready to send `expect`, or null when it is: the
 * prompt line must read exactly `expect`; a trailing space, which no line
 * shows, is read from the cursor, which then stands one past it (the text
 * starts two columns in, after `❯ `); and nothing on screen may match `absent`.
 */
export function promptReady(screen, cursorX, expect, absent) {
  const text = promptText(screen);
  if (text !== expect.trim()) return `the prompt reads "${text}", not "${expect.trim()}"`;
  if (expect.endsWith(' ') && cursorX !== 2 + [...expect].length)
    return `the cursor is at column ${cursorX}, not past "${expect}"`;
  if (absent !== undefined && new RegExp(absent, 'm').test(plain(screen)))
    return `the screen still shows ${absent}`;
  return null;
}

/**
 * Sends a key to the pane. Should the pane lose the keyboard between the
 * check and the key, a printable key that turns up in the prompt instead is
 * taken back out, so it can never be sent as a turn. With `done`, a regex
 * the key must bring on screen, a key that changed nothing is sent again
 * after the keyboard went back to the prompt (Escape) and into the pane afresh.
 */
async function pressKey(session, keys, done) {
  const printable = keys.length === 1 && [...keys[0]].length === 1;
  const reached = done === undefined ? null : new RegExp(done, 'm');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0 && reached !== null) {
      await focusPane(session, { prompt: true });
      await sleep(250);
    }
    await focusPane(session);
    const before = promptText(await snap(session));
    await send(session, ...keys);
    await sleep(250);
    if (printable && promptText(await snap(session)) !== before) {
      await send(session, 'BSpace');
      await sleep(250);
      continue;
    }
    if (reached === null) return;
    const end = Date.now() + 3000;
    while (Date.now() < end) {
      if (reached.test(plain(await snap(session)))) return;
      await sleep(200);
    }
  }
  const error = new Error(`the pane never took the key ${keys.join(' ')}`);
  error.lastFrame = plain(await snap(session));
  throw error;
}

/**
 * Presses `key` in the pane one press at a time, a beat after each, until
 * `until` is on screen; at most `max` presses. A press that lands in the
 * prompt instead is taken back out (see pressKey).
 */
async function seek(session, { key, until, max = 10, fixture }) {
  const re = new RegExp(until, 'm');
  for (let n = 0; n <= max; n += 1) {
    await sleep(n === 0 ? 0 : 200);
    if (re.test(plain(await snap(session)))) return;
    if (n === max) break;
    await pressKey(session, [key]);
  }
  const error = fixtureError(
    new Error(`seek: ${max} presses of ${key} never brought ${until}`),
    fixture
  );
  error.lastFrame = plain(await snap(session));
  throw error;
}

/**
 * Widens the pane four columns a press until it is at least `columns` wide
 * (border included). Claude Code caps a side pane's share of the terminal:
 * when three presses in a row change nothing, the step fails, naming the
 * width it stopped at, rather than pressing on.
 */
async function widen(session, columns) {
  let last = -1;
  let still = 0;
  for (let n = 0; n < 60; n += 1) {
    const frame = await snap(session);
    const width = session.cols - borderColumn(frame);
    if (width >= columns) return;
    still = width === last ? still + 1 : 0;
    last = width;
    if (still >= 3) break;
    await focusPane(session);
    await send(session, 'C-x', 'Left');
    await sleep(300);
  }
  const error = new Error(
    `the pane never got ${columns} columns wide: Claude Code stopped it at ${last} in a ${session.cols}-column terminal`
  );
  error.lastFrame = plain(await snap(session));
  throw error;
}

/** Waits until two snaps 600 ms apart are the same: nothing on screen is still moving. */
async function settle(session, { timeoutMs = 15000 } = {}) {
  const end = Date.now() + timeoutMs;
  let before = await snap(session);
  while (Date.now() < end) {
    await sleep(600);
    const now = await snap(session);
    if (plain(now) === plain(before)) return now;
    before = now;
  }
  return before;
}

/** At most `n` of `frames`, evenly spread and keeping the last. */
export function lapse(frames, n) {
  if (frames.length <= n) return frames;
  return Array.from(
    { length: n },
    (_, i) => frames[Math.round(((i + 1) * (frames.length - 1)) / n)]
  );
}

/**
 * Records a frame every FRAME_MS while it runs: a GIF plays in real time.
 * A hold pauses it and adds copies of the screen, and a wait keeps only a
 * time-lapse of how long it took.
 */
function recorder(session, on) {
  const frames = [];
  let timer = null;
  const start = () => {
    if (!on || timer !== null) return;
    timer = setInterval(() => {
      void snap(session)
        .then((f) => frames.push(f))
        .catch(() => {});
    }, FRAME_MS);
  };
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  start();
  return {
    frames,
    get on() {
      return on;
    },
    stop() {
      stop();
      on = false;
    },
    async hold(ms) {
      if (!on) return sleep(ms);
      stop();
      const last = await snap(session);
      for (let t = 0; t < ms; t += FRAME_MS) frames.push(last);
      start();
    },
    mark: () => frames.length,
    squeeze(from, n) {
      frames.splice(from, frames.length - from, ...lapse(frames.slice(from), n));
    },
  };
}

const until = (session, step, re) =>
  waitFor(session, (s) => new RegExp(re, 'm').test(s), {
    timeoutMs: 20000,
    step: `${step} until ${re}`,
  });

/** Steps a GIF shows only the outcome of. */
const QUICK = ['send', 'press', 'focus', 'widen', 'resize'];

/** A wait's timeout, naming the FIXTURE entry its match depends on. */
function fixtureError(error, key) {
  if (key === undefined) return error;
  error.message += ` (it waits on FIXTURE.${key} = ${JSON.stringify(FIXTURE[key])}, which the demo data may no longer have)`;
  return error;
}

/**
 * What each step kind does (see shots.mjs), by `step.do`. Each gets the step
 * and the shot's context: its session, shot, recorder (`tape`), the stills
 * taken so far, `from` (the frame count the step started at) and `runStep`
 * for a step that runs steps of its own.
 */
export const STEP_HANDLERS = {
  async type(step, { session }) {
    if (step.delayMs) {
      // By words for a long text, as a fast typist's bursts; by keys for a short one.
      const parts = step.words === true ? step.text.split(/(?<= )/) : [...step.text];
      for (const part of parts) {
        await type(session, part);
        await sleep(step.delayMs);
      }
    } else {
      await type(session, step.text);
    }
  },
  async send(step, { session }) {
    await send(session, ...step.keys);
  },
  async submit(step, { session, runStep }) {
    await submit(session, step, runStep);
  },
  async press(step, { session }) {
    await pressKey(session, Array.isArray(step.key) ? step.key : [step.key], step.until);
  },
  async seek(step, { session }) {
    await seek(session, step);
  },
  async focus(step, { session }) {
    await focusPane(session, {
      field: step.field === true,
      prompt: step.prompt === true,
    });
  },
  async widen(step, { session }) {
    await widen(session, step.columns);
  },
  async wait(step, { session, tape, from }) {
    const re = new RegExp(step.match, 'm');
    const test = step.absent === true ? (s) => !re.test(s) : (s) => re.test(s);
    await waitFor(session, test, {
      timeoutMs: step.timeoutMs ?? 30000,
      step: step.step,
    }).catch((error) => {
      throw fixtureError(error, step.fixture);
    });
    tape.squeeze(from, step.lapse ?? 4);
    await sleep(WAIT_MS);
  },
  async hold(step, { tape }) {
    await tape.hold(step.ms);
  },
  async resize(step, { session }) {
    await resize(session, ...step.size);
    // Until Claude Code has drawn at the new size: its prompt's rule spans the width.
    await waitFor(session, (s) => new RegExp(`^─{${session.cols}}$`, 'm').test(s), {
      timeoutMs: 20000,
      step: `resize to ${step.size.join('x')}`,
    });
    await settle(session);
  },
  async roll(step, { session, tape }) {
    // The GIF starts here, on a screen that has stopped drawing.
    await settle(session);
    tape.frames.splice(0);
  },
  async cut(step, { tape }) {
    tape.stop();
  },
  async still(step, { session, shot, stills }) {
    // With the size it was taken at: a `resize` can change it within a shot.
    stills[step.name] = {
      frame: checkStill(await settle(session), step.name),
      view: {
        cols: session.cols,
        rows: session.rows,
        theme: shot.theme,
      },
    };
  },
};

/**
 * Runs one shot's steps in its session (see shots.mjs for what each does).
 * Returns the GIF's frames (ANSI), when the shot records, and the stills by name.
 */
export async function playShot(session, shot, { record = false } = {}) {
  const tape = recorder(session, record);
  const stills = {};
  const runStep = async (step) => {
    const from = tape.mark();
    if (!Object.hasOwn(STEP_HANDLERS, step.do)) throw new Error(`unknown step: ${step.do}`);
    await STEP_HANDLERS[step.do](step, {
      session,
      shot,
      tape,
      stills,
      from,
      runStep,
    });
    if (step.until !== undefined && !['press', 'seek'].includes(step.do))
      await until(session, step.do, step.until);
    // A key and its checks show as their outcome, not as the time the checks took.
    if (QUICK.includes(step.do)) tape.squeeze(from, 3);
    if (process.env.CAPTURE_TRACE)
      process.stderr.write(
        `${step.do} ${step.step ?? step.key ?? step.text ?? step.expect ?? ''}: ${tape.mark()} frames\n`
      );
  };
  try {
    for (const step of shot.steps) await runStep(step);
  } catch (error) {
    // What was taken before the failure, so a GIF cut before it (and its model turn) is not lost.
    error.partial = {
      frames: tape.frames,
      stills,
      cut: record && !tape.on,
    };
    throw error;
  } finally {
    tape.stop();
  }
  return { frames: tape.frames, stills };
}

/**
 * Types into the prompt with the step's own steps, and sends Enter only once
 * the prompt reads exactly what it should (see promptReady). Otherwise the
 * prompt is cleared and typed again, twice at most, and the step fails with
 * nothing sent, showing the screen that failed the check.
 */
export async function submit(session, step, runStep, { attempts = 3 } = {}) {
  let why = null;
  let seen = '';
  for (let n = 0; n < attempts; n += 1) {
    for (const sub of step.steps) await runStep(sub);
    await sleep(300);
    seen = await snap(session);
    why = promptReady(seen, await cursor(session), step.expect, step.absent);
    if (why === null) {
      await send(session, 'Enter');
      return;
    }
    await send(session, 'C-u');
    await sleep(300);
  }
  const error = new Error(`submit "${step.expect.trim()}": ${why}; Enter not sent`);
  // The screen that failed the check, not the cleared prompt after it.
  error.lastFrame = plain(seen);
  throw error;
}

/** The GIF's length from the frames it was built from, refused past the shot's `maxMs`. */
export async function checkLength(dir, shot) {
  const count = (await readdir(dir)).filter((f) => /^\d{5}\.png$/.test(f)).length;
  const ms = count * FRAME_MS;
  if (shot.maxMs !== undefined && ms > shot.maxMs)
    throw new Error(
      `the GIF plays ${(ms / 1000).toFixed(1)} s, past ${(shot.maxMs / 1000).toFixed(0)} s: shorten the holds in shots.mjs`
    );
  return ms;
}

/** The frames a GIF may show: none with what NEVER_SHOWN matches. */
export const shown = (frames) => frames.filter((f) => !new RegExp(NEVER_SHOWN).test(plain(f)));

/** A still's frame, or an error when it shows what NEVER_SHOWN matches: a still is never dropped silently. */
export function checkStill(frame, name) {
  const hit = plain(frame).match(new RegExp(NEVER_SHOWN));
  if (hit === null) return frame;
  const error = new Error(`still ${name} shows "${hit[0]}", which no capture may show`);
  error.lastFrame = plain(frame);
  throw error;
}

/**
 * Keeps what a failed shot took once its GIF was cut, in the shot's own
 * dir under tools/capture/out (never `--out`, which only gets a whole
 * shot), and says where. Should that fail too, it says so and returns
 * null, so the caller still throws the shot's own error.
 */
export async function keepPartial(
  name,
  shot,
  error,
  { view, mask, write = writeShot, log = (line) => process.stderr.write(`${line}\n`) }
) {
  if (error.partial?.cut !== true) return null;
  const dir = path.join(OUT, name);
  try {
    await write(name, shot, error.partial, { out: null, view, mask });
  } catch (writeError) {
    log(`partial ${name} not kept: ${writeError.message}`);
    return null;
  }
  log(`partial ${name} kept in ${dir} (not copied to --out)`);
  return dir;
}

/**
 * Writes a shot's GIF (from its frames, when it records) and its stills
 * into its own dir under tools/capture/out, and copies them to `out`
 * unless `out` is null. Every frame is masked first (see maskFrame).
 */
async function writeShot(name, shot, taken, { out, view, mask }) {
  const masked = (f) => maskFrame(f, mask);
  const frames = shown(taken.frames).map(masked);
  const dir = path.join(OUT, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  if (out !== null) await mkdir(out, { recursive: true });
  // The stills first: a GIF refused for its length must not take them with it.
  for (const [still, { frame: raw, view: at }] of Object.entries(taken.stills)) {
    const frame = masked(raw);
    const png = path.join(dir, `${still}.png`);
    await renderPng([framePage(frame, at)], [png], at);
    await writeFile(path.join(dir, `${still}.ansi`), frame);
    if (out === null) continue;
    await copyFile(png, path.join(out, `${still}.png`));
    process.stdout.write(`${still}: ${path.join(out, `${still}.png`)}\n`);
  }
  if (shot.gif === true && frames.length > 0) {
    const pngs = frames.map((_, i) => path.join(dir, `${pad(i)}.png`));
    // The frames as text too, to look at or rebuild without shooting again.
    for (const [i, f] of frames.entries()) await writeFile(path.join(dir, `${pad(i)}.ansi`), f);
    await renderPng(
      frames.map((f) => framePage(f, view)),
      pngs,
      view
    );
    const ms = await checkLength(dir, shot);
    const built = await buildGif(dir, path.join(out ?? dir, `${name}.gif`), {
      ...(GIF_WIDTH[view.cols] ? { width: GIF_WIDTH[view.cols] } : {}),
    });
    process.stdout.write(
      `${name}: ${frames.length} frames (${(ms / 1000).toFixed(1)} s), ${built.bytes} bytes${built.mp4 ? `, ${built.mp4}` : ''}\n`
    );
  }
}

async function shootOne(name, shot, { stage, source, out }) {
  const [cols, rows] = shot.size;
  const view = { cols, rows, theme: shot.theme };
  const session = await createSession({
    dataDir: stage,
    realDataDir: source,
    pluginSource: PLUGIN,
    cli: CLI,
    ...view,
    ...(shot.claude ? { claudeArgs: shot.claude } : {}),
  });
  const mask = session.dataCopy;
  try {
    let taken;
    try {
      taken = await playShot(session, shot, { record: shot.gif === true });
    } catch (error) {
      // A GIF already cut is kept, with the stills taken so far: shooting it again costs a model turn.
      await keepPartial(name, shot, error, { view, mask });
      if (error.lastFrame !== undefined) error.lastFrame = maskFrame(error.lastFrame, mask);
      throw error;
    }
    await writeShot(name, shot, taken, { out, view, mask });
  } finally {
    await session.close();
  }
}

/** Refuses to run without the built CLI the pane and the MCP server both run. */
export async function checkBuilt(cli = CLI, exists = (f) => access(f)) {
  try {
    await exists(cli);
  } catch {
    throw new Error(`${cli} is missing: run npm run build first`);
  }
}

export async function main(argv = process.argv.slice(2), shots = SHOTS) {
  const { only, out, source } = parseArgs(argv, shots);
  installExitHandlers();
  let current = null;
  try {
    await checkBuilt();
    // One temp dir holds the stage and the HOME its seeding runs with.
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'argos-capture-run-'));
    registerCleanup(() => rm(runDir, { recursive: true, force: true }));
    const home = path.join(runDir, 'home');
    await mkdir(home);
    const stage = await stageDemo({
      source,
      tmpRoot: runDir,
      copyData,
      inside,
    });
    await seedHistory(stage, SEED, { home });
    for (const name of only) {
      current = name;
      await shootOne(name, shots[name], { stage, source, out });
    }
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    if (error.lastFrame !== undefined && current !== null) {
      await mkdir(OUT, { recursive: true });
      const file = path.join(OUT, `${current}-failed.txt`);
      await writeFile(file, error.lastFrame);
      process.stderr.write(`last frame: ${file}\n`);
    }
    return 1;
  } finally {
    await runCleanups();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}

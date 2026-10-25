import { describe, expect, it } from 'vitest';
import { TABS } from '../../plugin/hooks/lib/chrome.ts';
import { MEDIUM_MAX, MEDIUM_MIN } from '../../plugin/hooks/lib/table.ts';
import {
  checkStill,
  keepPartial,
  lapse,
  paneFocused,
  promptText,
  shown,
  STEP_HANDLERS,
} from './shoot.mjs';
import {
  columnsOf,
  COMMAND_LIST,
  COMMAND_LISTED,
  FIXTURE,
  GIF_WIDTH,
  HERO_SYSTEM,
  marked,
  NEVER_SHOWN,
  NEWEST_MARKED,
  PANE,
  PROMPT,
  REFUSED,
  SEED,
  SEEK_MS,
  SHOTS,
  SIZES,
  STEP_KINDS,
  TAB_BAR,
  WAIT_BUDGET_MS,
} from './shots.mjs';

const entries = Object.entries(SHOTS);
const stepsOf = (shot) => shot.steps.flatMap((s) => (s.do === 'submit' ? [s, ...s.steps] : [s]));

describe('SHOTS', () => {
  it('takes a still of every tab, pressing the key chrome.ts gives it', () => {
    for (const tab of TABS) {
      const shot = SHOTS[tab.id];
      expect(shot, tab.id).toBeDefined();
      expect(
        shot.steps.some((s) => s.do === 'press' && s.key === tab.hotkey),
        tab.id
      ).toBe(true);
      expect(shot.steps.at(-1)).toEqual({ do: 'still', name: tab.id });
    }
  });
  it('gives every shot a terminal size and a theme Claude Code has', () => {
    for (const [, shot] of entries) {
      expect(shot.size).toHaveLength(2);
      const [cols, rows] = shot.size;
      expect(Number.isInteger(cols) && cols >= 80 && cols <= 320).toBe(true);
      expect(Number.isInteger(rows) && rows >= 24 && rows <= 100).toBe(true);
      expect(['dark', 'light']).toContain(shot.theme);
    }
  });
  it('draws the stills wide (two columns) and the hero at least medium, within the share Claude Code gives a side pane', () => {
    // The pane's own width is the drawn width less its border.
    expect(PANE[SIZES.doc[0]] - 1).toBeGreaterThan(MEDIUM_MAX);
    expect(PANE[SIZES.hero[0]] - 1).toBeGreaterThanOrEqual(MEDIUM_MIN);
    for (const [cols, width] of Object.entries(PANE))
      expect(width).toBeLessThanOrEqual(Math.floor(Number(cols) * 0.45));
    for (const [name, shot] of entries.filter(([, s]) => s.gif !== true))
      expect(shot.size, name).toEqual(SIZES.doc);
  });
  it("builds the hero's GIF at eight pixels a column", () => {
    expect(GIF_WIDTH[SIZES.hero[0]]).toBe(SIZES.hero[0] * 8);
  });
  it('has a handler in shoot.mjs for every step kind, and no other', () => {
    expect(Object.keys(STEP_HANDLERS).sort()).toEqual([...STEP_KINDS].sort());
  });
  it('uses only the step kinds shoot.mjs knows, and patterns that compile', () => {
    for (const [, shot] of entries) {
      for (const step of stepsOf(shot)) {
        expect(STEP_KINDS).toContain(step.do);
        for (const re of [step.until, step.match, step.absent])
          if (typeof re === 'string') expect(() => new RegExp(re, 'm')).not.toThrow();
      }
    }
  });
  it('names every wait and gives it a pattern', () => {
    for (const [, shot] of entries) {
      for (const step of shot.steps.filter((s) => s.do === 'wait')) {
        expect(typeof step.step).toBe('string');
        expect(step.step).not.toBe('');
        expect(typeof step.match).toBe('string');
      }
    }
  });
  it('bounds every seek and gives it a target', () => {
    for (const [, shot] of entries) {
      for (const step of shot.steps.filter((s) => s.do === 'seek')) {
        expect(Number.isInteger(step.max) && step.max > 0).toBe(true);
        expect(typeof step.until).toBe('string');
      }
    }
  });
  it('ends every still shot on a still, and names each still once', () => {
    const names = entries.flatMap(([, shot]) =>
      shot.steps.filter((s) => s.do === 'still').map((s) => s.name)
    );
    expect(new Set(names).size).toBe(names.length);
    for (const [, shot] of entries.filter(([, s]) => s.gif !== true)) {
      expect(shot.steps.at(-1).do).toBe('still');
    }
  });
  it("keeps the hero's recorded part, with no still in it, between 20 and 32 seconds", () => {
    const { steps } = SHOTS.hero;
    const end = steps.findIndex((s) => s.do === 'cut' || s.do === 'still');
    const run = end === -1 ? steps : steps.slice(0, end);
    expect(run.some((s) => s.do === 'still')).toBe(false);
    const ms = run.reduce(
      (sum, s) =>
        sum +
        (s.do === 'hold' ? s.ms : 0) +
        (s.do === 'wait' ? WAIT_BUDGET_MS : 0) +
        (s.do === 'seek' ? SEEK_MS : 0),
      0
    );
    expect(ms).toBeGreaterThanOrEqual(20000);
    expect(ms).toBeLessThanOrEqual(SHOTS.hero.maxMs);
  });
  it("plays the hero's story in order: Connections, the prompt, its query live, Schema on orders, the Editor's refusal", () => {
    const steps = SHOTS.hero.steps;
    const at = (pred) => steps.findIndex(pred);
    const connections = at((s) => s.do === 'press' && s.key === '4');
    const prompt = at((s) => s.do === 'submit' && s.expect === PROMPT);
    const live = at((s) => s.do === 'wait' && s.step === 'query live');
    const schema = at((s) => s.do === 'press' && s.key === '2');
    const orders = at((s) => s.do === 'seek' && s.fixture === 'table');
    const editor = at((s) => s.do === 'press' && s.key === '3');
    const deleted = at((s) => s.do === 'type' && s.text === 'DELETE FROM orders');
    const refused = at((s) => s.do === 'wait' && s.match === REFUSED);
    const order = [connections, prompt, live, schema, orders, editor, deleted, refused];
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The prompt is typed with the keyboard back in the prompt, never into the pane.
    expect(steps[prompt - 1]).toEqual({ do: 'focus', prompt: true });
    // The DELETE goes into the Editor's field, not the pane's keys.
    expect(steps[deleted - 1]).toEqual({ do: 'focus', field: true });
  });
  it("keeps the hero's model turn to Argos's sql_query, with no built-in tools", () => {
    const args = SHOTS.hero.claude;
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('mcp__argos__sql_query');
    expect(args[args.indexOf('--append-system-prompt') + 1]).toBe(HERO_SYSTEM);
    expect(PROMPT).toMatch(/\bshop\b/);
  });
  it('shoots the light theme for Queries and Schema', () => {
    expect(SHOTS['queries-light'].theme).toBe('light');
    expect(SHOTS['schema-light'].theme).toBe('light');
  });
});

describe('SEED', () => {
  it("has Claude's queries and yours, on both connections, and one pin", () => {
    expect(new Set(SEED.map((s) => s.via))).toEqual(new Set(['claude', 'you']));
    expect(new Set(SEED.map((s) => s.db))).toEqual(new Set(FIXTURE.connections));
    expect(SEED.filter((s) => s.pin === true)).toHaveLength(1);
  });
  it("ends on a ten-row query of Claude's, the one the Queries still opens on", () => {
    const newest = SEED.at(-1);
    expect(newest.via).toBe('claude');
    expect(newest.sql).toMatch(/LIMIT 10$/);
    const wait = SHOTS.queries.steps.find((s) => s.step === 'result');
    expect(wait.match).toContain('1–10 of 10');
  });
});

describe('paneFocused', () => {
  it("reads the pane's border: dim while the prompt has the keyboard, coloured when the pane has it", () => {
    const dim = '   \u001b[2m\u001b[48;2;38;38;38m│\u001b[0m  ✕';
    const lit = '   \u001b[38;2;177;185;249m\u001b[48;2;38;38;38m│\u001b[39m  ✕';
    expect(paneFocused(`${dim}\nrest`)).toBe(false);
    expect(paneFocused(`${lit}\nrest`)).toBe(true);
    expect(paneFocused('\u001b[2mdim\u001b[22m │')).toBe(true);
    expect(paneFocused('no pane here')).toBe(false);
  });
});

describe('lapse', () => {
  it('keeps at most n frames, evenly spread, ending on the last', () => {
    const frames = Array.from({ length: 40 }, (_, i) => i);
    const kept = lapse(frames, 4);
    expect(kept).toHaveLength(4);
    expect(kept.at(-1)).toBe(39);
    expect(lapse([1, 2], 4)).toEqual([1, 2]);
  });
});

describe('promptText', () => {
  it('reads the last prompt line, without its marker', () => {
    const screen =
      '❯ /argos      │ argos\n  ⎿  argos: Argos pane opened.\n────\n❯ 6\n────\n  footer';
    expect(promptText(screen)).toBe('6');
    expect(promptText('no prompt')).toBe('');
  });
});

describe('shown', () => {
  it("leaves out a frame with the spinner's token count, and keeps the rest", () => {
    const frames = [
      '✶ Churning… (2s · \u001b[2m↓ 82 tokens)\u001b[0m',
      '· Sock-hopping… (24s · ↓ 1.4k tokens · thinking)',
      '✻ Sautéed for 28s · done',
      '10 queries · +1 session',
    ];
    expect(shown(frames)).toEqual(frames.slice(2));
  });
});

describe('NEVER_SHOWN', () => {
  const re = new RegExp(NEVER_SHOWN);
  it("matches the spinner's token counts", () => {
    for (const text of [
      '· Wibbling… (2s · ↓ 82 tokens)',
      '✶ Churning… (12s · ↑ 1,204 tokens)',
      '(40s · ↓1.2k tokens)',
      '(1m 3s · 2.4k tokens)',
    ])
      expect(re.test(text), text).toBe(true);
  });
  it('leaves a plain count alone', () => {
    for (const text of ['budget: 12 tokens left', '8,000 tokens per brief', 'tokens: 12'])
      expect(re.test(text), text).toBe(false);
  });
});

describe('checkStill', () => {
  it('returns a clean still as it is', () => {
    const frame = 'argos · 7 queries';
    expect(checkStill(frame, 'queries')).toBe(frame);
  });
  it("fails a still with the spinner's token count, naming it and keeping the frame", () => {
    const frame = '\u001b[2m· Wibbling… (2s · ↓ 82 tokens)\u001b[0m';
    let error = null;
    try {
      checkStill(frame, 'queries');
    } catch (e) {
      error = e;
    }
    expect(error?.message).toMatch(/still queries shows "↓ 82 tokens"/);
    expect(error?.lastFrame).toBe('· Wibbling… (2s · ↓ 82 tokens)');
  });
});

describe('keepPartial', () => {
  const shot = { gif: true };
  const view = { cols: 192, rows: 52, theme: 'dark' };
  const failed = (partial) =>
    Object.assign(new Error('step "refused" timed out'), {
      lastFrame: 'the last frame',
      partial,
    });
  it("writes a cut shot's partial to its own dir only, never to --out, and says where", async () => {
    const writes = [];
    const lines = [];
    const error = failed({ frames: ['a'], stills: {}, cut: true });
    const dir = await keepPartial('hero', shot, error, {
      view,
      mask: '/tmp/x/argos-demo',
      write: async (...args) => writes.push(args),
      log: (line) => lines.push(line),
    });
    expect(writes).toHaveLength(1);
    expect(writes[0][3]).toEqual({ out: null, view, mask: '/tmp/x/argos-demo' });
    expect(dir).toMatch(/tools\/capture\/out\/hero$/);
    expect(lines).toEqual([`partial hero kept in ${dir} (not copied to --out)`]);
  });
  it('writes nothing for a shot that failed before its cut', async () => {
    const writes = [];
    const error = failed({ frames: ['a'], stills: {}, cut: false });
    expect(
      await keepPartial('hero', shot, error, {
        view,
        write: async (...args) => writes.push(args),
        log: () => {},
      })
    ).toBeNull();
    expect(writes).toEqual([]);
  });
  it("leaves the shot's own error as it was when keeping the partial fails too", async () => {
    const lines = [];
    const error = failed({ frames: ['a'], stills: {}, cut: true });
    await expect(
      keepPartial('hero', shot, error, {
        view,
        write: async () => {
          throw new Error('disk full');
        },
        log: (line) => lines.push(line),
      })
    ).resolves.toBeNull();
    expect(error.message).toBe('step "refused" timed out');
    expect(error.lastFrame).toBe('the last frame');
    expect(lines).toEqual(['partial hero not kept: disk full']);
  });
});

describe('the slash command list', () => {
  const open =
    '  ❯ /argos                      Toggle the Argos pane: connections, schema and every query Claude runs\n';
  it('is read with its selected row marked or not, and never from the prompt', () => {
    const rows = (text) => text.split('\n').filter((l) => new RegExp(COMMAND_LIST).test(l));
    expect(rows(open)).toHaveLength(1);
    expect(rows(open.replace('❯', ' '))).toHaveLength(1);
    expect(rows('❯ /argos \n')).toEqual([]);
    const prompt = '❯ /argos  \n────────\n  ⏵⏵ auto mode on\n';
    expect(new RegExp(COMMAND_LIST, 'm').test(prompt)).toBe(false);
    expect(new RegExp(COMMAND_LISTED, 'm').test(prompt)).toBe(false);
    expect(new RegExp(COMMAND_LISTED, 'm').test(open)).toBe(true);
  });
});

describe('what the shots read off the pane', () => {
  it('finds the marker on the newest history row, and not on a later one', () => {
    const re = new RegExp(NEWEST_MARKED, 'm');
    const top =
      'chat    │── ≡ History ──── all sessions · newest first ──\nchat    │\nchat    │› ✓  ✻ claude  shop  SELECT c.id… 10 rows\n';
    const second =
      'chat    │── ≡ History ──── all sessions · newest first ──\nchat    │\nchat    │  ✓  ✻ claude  shop  SELECT c.id…\nchat    │› ✓  ✻ claude  shop  SELECT p.name…\n';
    const wide = '│── ≡ History ─── newest first ──   ── ›_ Query ──\n│\n│  › ✓★ ✻ claude  shop\n';
    expect(re.test(top)).toBe(true);
    expect(re.test(second)).toBe(false);
    expect(re.test(wide)).toBe(true);
  });
  it('matches a marked table by its whole name, and its columns card', () => {
    const re = new RegExp(marked(FIXTURE.table), 'm');
    expect(re.test('│  ›orders              PK  id')).toBe(true);
    expect(re.test('│  ›order_items         PK  order_id')).toBe(false);
    expect(re.test('│   orders              PK  id')).toBe(false);
    expect(new RegExp(columnsOf('orders')).test('── ≡ orders · columns ──── 5 columns ──')).toBe(
      true
    );
  });
  it('reads the tab bar only when every tab is named', () => {
    const re = new RegExp(TAB_BAR);
    expect(re.test('│   Queries    Schema    Editor    Connections')).toBe(true);
    expect(re.test('│  Queries    2    3    4')).toBe(false);
    expect(TABS.map((t) => t.full)).toEqual(['Queries', 'Schema', 'Editor', 'Connections']);
  });
  it("reads the Editor's refusal of a write", () => {
    expect(
      new RegExp(REFUSED).test(
        "⊘ refused: Command 'DELETE' is not allowed in SELECT-only mode. Allowed commands: SELECT"
      )
    ).toBe(true);
  });
});

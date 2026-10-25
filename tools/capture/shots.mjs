/**
 * Dev-only. The captures as data: one entry a shot, each a terminal size, a
 * theme and the steps shoot.mjs plays in an isolated Claude Code session.
 *
 * Steps:
 * - `type`: text typed into whatever has the keyboard (`delayMs` between keys,
 *   or between words with `words`).
 * - `send`: tmux key names, sent as they are.
 * - `submit`: runs its `steps` (typing into the prompt), then sends Enter only
 *   once the prompt line reads exactly `expect` and nothing matches `absent`;
 *   otherwise the prompt is cleared (ctrl+u) and typed again, twice at most,
 *   and the step fails without Enter.
 * - `press`: a key for the pane; the pane is given the keyboard first if it lost it.
 * - `seek`: presses `key` in the pane, one press at a time, until `until` is
 *   on screen (at most `max` presses): walking a list to a row.
 * - `focus`: gives the pane the keyboard (ctrl+x tab) unless it has it; with
 *   `field`, its open field; with `prompt`, hands it back to the prompt (Escape).
 * - `widen`: widens the pane (ctrl+x left) until it is `columns` wide; fails
 *   when Claude Code stops widening it short of that.
 * - `resize`: resizes the terminal to `size` ([columns, rows]); the stills
 *   after it are taken at that size.
 * - `wait`: a visible beat: until `match` (a regex source, multiline) is on
 *   screen, or gone with `absent`, then a moment to read it. `fixture` names
 *   the FIXTURE entry the match depends on, for the error on a timeout.
 * - `hold`: keeps the screen as it is for `ms` (in a GIF, copies of the last frame).
 * - `roll`: starts the GIF here, once the screen has stopped drawing.
 * - `cut`: ends the GIF's recording; the steps after it only take stills.
 * - `still`: once nothing on screen moves, keeps the screen as `name`.png.
 *
 * `type`, `send` and `press` take `until`, a regex that must be on screen
 * before the next step: a quick sync, not a beat the viewer sees. A `press`
 * whose `until` does not come is sent again.
 *
 * Tab digits come from plugin/hooks/lib/chrome.ts (TABS); the pane's width
 * tiers from plugin/hooks/lib/table.ts (medium from 80 columns, wide past
 * 130); the keys that move and widen a pane are Claude Code's own (ctrl+x
 * tab, ctrl+x left). Claude Code lets a side pane take at most about 45% of
 * the terminal, so a wide pane needs a terminal 300 columns across.
 */

/**
 * What the shots expect of the demo data (~/argos-demo: shop and analytics).
 * Each comes from somewhere the data can change; change it here, once, when it does.
 */
export const FIXTURE = {
  // The table the Schema shots walk to: it has a PK, an FK to customers and
  // a relation in from order_items. Tables are listed by name, so it is the
  // third, after customers and order_items.
  table: 'orders',
  // The connection whose tables the Schema tab opens on: the first in config.ini.
  firstConnection: 'shop',
  // The connections the Connections tab draws a card for.
  connections: ['shop', 'analytics'],
};

/** A FIXTURE value inside a regex, matched as written. */
export const lit = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The history every session starts with, seeded into the stage once a run
 * (see stage.mjs): Claude's queries through the argos MCP server, yours
 * through the CLI, oldest first. The last is the newest, the one the
 * Queries tab opens on.
 */
export const SEED = [
  {
    via: 'claude',
    db: 'analytics',
    sql: 'SELECT plan, COUNT(*) AS users FROM users GROUP BY plan ORDER BY users DESC',
  },
  {
    via: 'claude',
    db: 'analytics',
    sql: 'SELECT id, email, plan, signed_up_at FROM users ORDER BY signed_up_at DESC LIMIT 20',
  },
  {
    via: 'claude',
    db: 'analytics',
    sql: 'SELECT wk, users FROM weekly_active ORDER BY wk DESC',
    pin: true,
  },
  {
    via: 'you',
    db: 'shop',
    sql: 'SELECT * FROM open_orders ORDER BY total DESC LIMIT 25',
  },
  {
    via: 'you',
    db: 'shop',
    sql: "DELETE FROM orders WHERE status = 'cancelled'",
  },
  {
    via: 'claude',
    db: 'shop',
    sql: 'SELECT status, COUNT(*) AS orders, ROUND(SUM(total), 2) AS revenue FROM orders GROUP BY status',
  },
  {
    via: 'claude',
    db: 'shop',
    sql: 'SELECT p.name, SUM(oi.qty) AS units, ROUND(SUM(oi.qty * oi.unit_price), 2) AS revenue FROM order_items oi JOIN products p ON p.id = oi.product_id GROUP BY p.id ORDER BY revenue DESC LIMIT 10',
  },
];

/**
 * What no capture may show: the token count Claude Code's spinner gives
 * mid-turn (`↓ 82 tokens`, `↑ 1,204 tokens`, `1.2k tokens`). A GIF frame
 * that shows it is left out; a still that shows it fails. A plain count is
 * not the spinner's and stays.
 */
export const NEVER_SHOWN = String.raw`(?:[↓↑]\s*\d[\d,]*(?:\.\d+)?k?|\b\d+(?:\.\d+)?k) tokens\b`;

/**
 * Where the session's copy of the demo dir is shown as lying: the demo's
 * own place. The copy lives in a temp dir whose random path would otherwise
 * stand in the pane's header and cards (see maskFrame in shoot.mjs).
 */
export const SHOWN_DATA_DIR = '~/argos-demo';

/** The GIF's frame interval: 8 frames a second. */
export const FRAME_MS = 125;
/** How long a `wait` lets the screen stand once its text is there. */
export const WAIT_MS = 1000;
/** What a `wait` costs in the GIF, on average: the time-lapsed wait itself plus WAIT_MS. */
export const WAIT_BUDGET_MS = 1500;
/** What one `seek` press costs in the GIF: the press and the beat after it. */
export const SEEK_MS = 450;
/** The longest the hero may play. */
export const HERO_MAX_MS = 32000;

/**
 * The terminal sizes: the hero's, where the pane is medium (two columns of
 * text would not fit in a GIF a README can carry), and the stills', where it
 * is wide and the Queries, Schema and Connections tabs draw two columns.
 */
export const SIZES = { hero: [192, 52], doc: [300, 60] };
/** How wide the pane is drawn at each size, border included: as far as Claude Code lets it go. */
export const PANE = { 192: 86, 300: 135 };
/** The GIF's width in pixels for each terminal width: 8 a column, as Knossos's 160-column hero. */
export const GIF_WIDTH = { 192: 1536 };

export const STEP_KINDS = [
  'type',
  'send',
  'submit',
  'press',
  'seek',
  'focus',
  'widen',
  'resize',
  'wait',
  'hold',
  'roll',
  'cut',
  'still',
];

const wait = (step, match, more = {}) => ({ do: 'wait', step, match, ...more });
const press = (key, until) => ({
  do: 'press',
  key,
  ...(until ? { until } : {}),
});
const hold = (ms) => ({ do: 'hold', ms });
const still = (name) => ({ do: 'still', name });

/** Claude Code is up: its prompt, not a dialog's numbered choice. */
const ready = [wait('prompt', String.raw`^❯(?! *\d\.)`, { timeoutMs: 90000 })];

/**
 * A row of the slash command list: the command, two spaces or more, its
 * description. The selected row starts with `❯`; the prompt's own `❯ /argos`
 * has no description after it.
 */
export const COMMAND_LIST = String.raw`^ *(?:❯ *)?/argos(:\S+)? {2,}\S`;

/** The command list's row for `/argos` itself, selected or not. */
export const COMMAND_LISTED = String.raw`^ *(?:❯ *)?/argos +Toggle`;

/**
 * `/argos`, then a space once the command is listed: the space closes the
 * list, so Enter runs exactly `/argos` and nothing the list highlights.
 * Enter goes only once the prompt reads `/argos ` and the list is gone.
 */
export const argosCommand = {
  do: 'submit',
  expect: '/argos ',
  absent: COMMAND_LIST,
  steps: [
    { do: 'type', text: '/argos', until: COMMAND_LISTED },
    { do: 'type', text: ' ' },
  ],
};

/** The tab bar with every tab named, as the medium and wide panes draw it. */
export const TAB_BAR = String.raw`Queries\s+Schema\s+Editor\s+Connections`;

/** Opens the pane, gives it the keyboard and widens it to `columns`, so the tabs are named. */
const openPane = (columns, beat = true) => [
  { ...argosCommand, until: String.raw`argos\b.*read-only pane` },
  { do: 'focus' },
  { do: 'widen', columns },
  beat ? wait('pane widened', TAB_BAR) : { do: 'focus', until: TAB_BAR },
];

/** The marker on the first row of the Queries tab's history: the newest entry. */
export const NEWEST_MARKED = String.raw`History[^\n]*\n[^\n]*\n[^\n]*│ *›`;

/** A row the marker stands on, by its name (a table, a column). */
export const marked = (name) => String.raw`›\s*${lit(name)}\s`;

/** The Schema tab's columns card for `table`, which names it in its rule. */
export const columnsOf = (table) => String.raw`≡ ${lit(table)} · columns`;

/** Walks the Schema tab's table list down to FIXTURE.table. */
const toTable = [
  press('2', columnsOf('customers')),
  {
    do: 'seek',
    key: 'j',
    max: 6,
    until: String.raw`${marked(FIXTURE.table)}[\s\S]*${columnsOf(FIXTURE.table)}|${columnsOf(FIXTURE.table)}[\s\S]*${marked(FIXTURE.table)}`,
    fixture: 'table',
  },
  wait('relations', String.raw`⇄ Relations`),
];

/** The refusal the Editor shows for a write. */
export const REFUSED = String.raw`⊘ refused: Command 'DELETE' is not allowed`;

/** The hero's one prompt. */
export const PROMPT = 'Which 10 customers spent the most in shop? Use argos.';

/**
 * What the hero's model is told beyond Claude Code's own prompt, so its turn
 * is one query and a short answer: the tables it needs, and no detours.
 */
export const HERO_SYSTEM = [
  'This session is a short product demo of the argos MCP server.',
  'The shop database (SQLite) has customers(id, name, email, region) and orders(id, customer_id, status, total, created_at); orders.total is what a customer paid for an order, and cancelled orders do not count.',
  "Answer with exactly one sql_query call and no other tool calls, then give the ten customers as a short table and one sentence. Do not check the data's quality or run follow-up queries.",
].join(' ');

/** The Editor's still: a read-only query of yours and its result. */
export const EDITOR_SQL =
  'SELECT region, COUNT(*) AS customers FROM customers GROUP BY region ORDER BY customers DESC';

/** A still of one view: open the pane, do `steps`, keep the screen as `name`. */
const pane = (name, steps, { theme = 'dark', size = SIZES.doc } = {}) => ({
  size,
  theme,
  steps: [...ready, ...openPane(PANE[size[0]], false), ...steps, still(name)],
});

const queries = (theme) =>
  pane(
    theme === 'light' ? 'queries-light' : 'queries',
    [
      press('1'),
      wait('newest entry', NEWEST_MARKED),
      wait('result', String.raw`◇ Result.*1–10 of 10`),
    ],
    { theme }
  );

const schema = (theme) => pane(theme === 'light' ? 'schema-light' : 'schema', toTable, { theme });

export const SHOTS = {
  hero: {
    size: SIZES.hero,
    theme: 'dark',
    gif: true,
    maxMs: HERO_MAX_MS,
    // One model turn, kept to Argos: no built-in tools, and sql_query runs without a prompt.
    claude: [
      '--permission-mode',
      'default',
      '--tools',
      '',
      '--allowedTools',
      'mcp__argos__sql_query',
      '--append-system-prompt',
      HERO_SYSTEM,
    ],
    steps: [
      ...ready,
      { do: 'roll' },
      hold(250),
      ...openPane(PANE[192]),
      press('4', String.raw`▣ analytics`),
      wait('connections', String.raw`schema\s+(?:never|captured)`),
      hold(1500),
      press('1', NEWEST_MARKED),
      hold(800),
      // The prompt gets the keyboard back for the model turn: typed into the pane, its letters would be keys.
      { do: 'focus', prompt: true },
      {
        do: 'submit',
        expect: PROMPT,
        steps: [{ do: 'type', text: PROMPT, delayMs: 70, words: true }],
      },
      // Claude's query lands in the history the moment it finishes.
      wait('query live', String.raw`queries · \+[1-9]\d* session`, {
        timeoutMs: 180000,
        lapse: 6,
      }),
      wait('turn over', String.raw`esc to interrupt`, {
        absent: true,
        timeoutMs: 180000,
        lapse: 8,
      }),
      { do: 'seek', key: 'k', max: 12, until: NEWEST_MARKED },
      wait('its result', String.raw`◇ Result.*1–10 of 10`),
      hold(1500),
      press('j'),
      hold(700),
      press('j'),
      hold(700),
      { do: 'seek', key: 'k', max: 12, until: NEWEST_MARKED },
      hold(1000),
      ...toTable,
      hold(1500),
      press('3', String.raw`›_ Editor`),
      { do: 'focus', field: true },
      { do: 'type', text: 'DELETE FROM orders', delayMs: 70 },
      hold(500),
      { do: 'send', keys: ['Enter'] },
      wait('refused', REFUSED),
      hold(2500),
      { do: 'cut' },
    ],
  },
  queries: queries('dark'),
  'queries-light': queries('light'),
  schema: schema('dark'),
  'schema-light': schema('light'),
  editor: pane('editor', [
    press('3', String.raw`›_ Editor`),
    { do: 'focus', field: true },
    { do: 'type', text: EDITOR_SQL },
    { do: 'send', keys: ['Enter'] },
    wait('editor result', String.raw`◇ Result.*1–\d+ of \d+`),
  ]),
  connections: pane('connections', [
    press('4', String.raw`▣ analytics`),
    wait(
      'cards',
      FIXTURE.connections.map((c) => String.raw`(?=[\s\S]*▣ ${lit(c)}\b)`).join('') +
        String.raw`[\s\S]*schema\s+(?:never|captured)`
    ),
  ]),
};

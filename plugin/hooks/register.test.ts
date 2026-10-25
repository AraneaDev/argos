import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

const ENV = { node: '/usr/bin/node', cli: '/opt/argos/dist/cli.js', config: '/home/tim/work/config.ini' }

const CONNECTIONS = [
  { name: 'demo', type: 'sqlite', host: null, ssh: false, ssl: false, selectOnly: true, mcpConfigurable: false, schemaCapturedAt: null },
  { name: 'shop', type: 'postgresql', host: 'db.internal', ssh: true, ssl: true, selectOnly: false, mcpConfigurable: true, schemaCapturedAt: '2000-01-01T00:00:00.000Z' },
]

type Fixed = { exitCode: number; stdout: string; stderr?: string } | { throws: string }
type Answer = Fixed | (() => Fixed)

/**
 * Stands in for the engine beneath the mod: the install's argos.env.json
 * (or none), the argos CLI by subcommand, the panes the engine holds open,
 * and the commands registered. A process that is not the CLI fails the test
 * where the mod runs it.
 */
function world(on: On, options: { env?: string | null; answers?: Record<string, Answer> } = {}) {
  const clock = mock.clock(on)
  const runs: string[][] = []
  const opened: string[] = []
  const closed: string[] = []
  const registered: string[] = []
  const panes = new Set<string>()
  const env = options.env === undefined ? JSON.stringify(ENV) : options.env
  const answers: Record<string, Answer> = { connections: { exitCode: 0, stdout: JSON.stringify(CONNECTIONS) }, history: { exitCode: 0, stdout: '[]' }, pins: { exitCode: 0, stdout: '[]' }, ...options.answers }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('command.register', (_$, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('fs.read', (_$, e) => {
    // A file that is not there: the engine refuses the read, and `$.fs.read` rejects.
    if (env === null || !String(e.path).endsWith('/hooks/argos.env.json')) return { deny: `ENOENT: ${e.path}` }
    return { value: env }
  })
  on('process.run', (_$, e) => {
    runs.push([...e.argv])
    expect(e.argv[0], `a process the test world does not stand in for: ${e.argv.join(' ')}`).toBe(ENV.node)
    expect(e.argv[1]).toBe(ENV.cli)
    expect(e.argv.slice(-2)).toEqual(['--config', ENV.config])
    const given = answers[String(e.argv[2])]
    const answer = typeof given === 'function' ? given() : given
    expect(answer, `a subcommand the world does not answer: ${e.argv[2]}`).toBeDefined()
    // A command that cannot start: the engine refuses the call, and `$.process.run` rejects.
    if (answer === undefined || 'throws' in answer) return { deny: answer?.throws ?? 'no answer' }
    return { value: { stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...answer } }
  })
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    panes.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    closed.push(e.id)
    panes.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [...panes].map(id => ({ id, title: 'Argos', isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.focus', () => ({}))
  on('tool.call', () => ({ result: { text: 'ok' } }))
  const toasts: string[] = []
  const copied: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(String(e.text))
    return { value: undefined }
  })
  on('ui.copy', (_$, e) => {
    copied.push(String(e.text))
    return { value: { isCopied: true } }
  })
  return { clock, toasts, copied, runs, opened, closed, registered }
}

const column = (name: string, type: string, key = '') => ({ name, type, nullable: true, default: null, key })
const SCHEMA = JSON.stringify({
  database: 'demo',
  type: 'sqlite',
  capturedAt: '2000-01-01T00:00:00.000Z',
  tables: [
    { name: 'posts', type: 'table', columns: [column('id', 'INTEGER', 'PRI'), column('user_id', 'INTEGER')], primary_key: ['id'], foreign_keys: [{ column: 'user_id', references: { table: 'users', column: 'id' } }], row_estimate: null },
    { name: 'users', type: 'table', columns: [column('id', 'INTEGER', 'PRI')], primary_key: ['id'], foreign_keys: [], row_estimate: null },
  ],
  views: [],
  lastChange: null,
})

const START = { cwd: '/work', surface: 'terminal', isInteractive: true } as const

const PANE_PROPS = {
  title: 'Argos',
  isFocused: false,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as RenderPropsOf['Pane']

async function mountPane($: Engine, surface: 'terminal' | 'desktop' = 'terminal', bodyColumns = 100) {
  return $.ui.mount({ plugin: 'argos', surface, component: 'Pane', requestId: 'argos', props: { ...PANE_PROPS, bodyColumns } })
}

/** The person typing `/argos <args>`. */
async function slash($: Engine, args = '') {
  return $.command.run({ command: 'argos', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
}

/** Every Text the pane drew, joined. */
async function paneText(ui: Awaited<ReturnType<typeof mountPane>>): Promise<string> {
  return (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
}

describe('/argos', () => {
  test('registers itself at session start', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.registered).toContain('argos')
  })

  test('opens the pane, which draws the four tabs and a card per connection', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await w.clock.settle()
    const said = await slash($)
    expect(said.text).toBe('Argos pane opened.')
    expect(w.opened).toEqual(['argos'])
    await w.clock.settle()
    expect(w.runs.filter(r => r[2] === 'connections')).toHaveLength(1)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await mountPane($, surface)
      for (const [id, label] of [['queries', 'Queries'], ['schema', 'Schema'], ['editor', 'Editor'], ['connections', 'Connections']] as const) {
        const tab = await ui.find({ type: 'Button', key: `tab:${id}` })
        expect(String(tab?.props.label), `${surface} ${id}`).toContain(label)
      }
      await ui.press({ key: 'tab:connections' })
      await w.clock.settle()
      const text = await paneText(ui)
      expect(text).toContain('demo')
      expect(text).toContain('select-only')
      expect(text).toContain('full access')
      expect(text).toContain('~/work/config.ini')
      await ui.unmount()
    }
  })

  test('closes the pane when it is open, and reads the connections again on the next open', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await slash($)
    await w.clock.settle()
    expect((await slash($)).text).toBe('Argos pane closed.')
    expect(w.closed).toEqual(['argos'])
    await slash($)
    await w.clock.settle()
    expect(w.runs.filter(r => r[2] === 'connections')).toHaveLength(2)
  })

  test('answers anything else with its usage', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await slash($, 'inspect x')).text).toContain('Usage: /argos')
  })
})

describe('openPaneOnStart', () => {
  test('opens the pane when the session starts', { options: { openPaneOnStart: true } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await w.clock.settle()
    expect(w.opened).toEqual(['argos'])
    expect(w.runs.filter(r => r[2] === 'connections')).toHaveLength(1)
  })

  test('leaves it shut otherwise', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await w.clock.settle()
    expect(w.opened).toEqual([])
    expect(w.runs).toHaveLength(0)
  })
})

describe('a pane that cannot reach the CLI', () => {
  const failing = async ($: Engine, w: ReturnType<typeof world>) => {
    await $.session.start(START)
    await slash($)
    await w.clock.settle()
    const ui = await mountPane($)
    await ui.press({ key: 'tab:connections' })
    await w.clock.settle()
    return ui
  }

  test('says the plugin was not installed by the CLI when argos.env.json is missing, and runs nothing', async ($, on) => {
    const w = world(on, { env: null })
    const ui = await failing($, w)
    const lines = (await ui.findAll({ type: 'Box' })).filter(b => b.key === 'failure')
    expect(lines).toHaveLength(1)
    expect(lines[0]?.text.trim()).toBe('argos: plugin not installed by argos install-plugin')
    expect(w.runs).toHaveLength(0)
    expect(await ui.find({ type: 'Button', key: 'tab:queries' })).toBeDefined()
  })

  test('says it could not run the CLI when the binary is missing', async ($, on) => {
    const w = world(on, { answers: { connections: { throws: 'spawn /usr/bin/node ENOENT' } } })
    const ui = await failing($, w)
    expect(await paneText(ui)).toContain('argos: could not run the argos CLI (spawn /usr/bin/node ENOENT)')
  })

  test("shows the CLI's own error as it said it", async ($, on) => {
    const w = world(on, { answers: { connections: { exitCode: 1, stdout: '{"error":"No config.ini found at /home/tim/work/config.ini"}' } } })
    const ui = await failing($, w)
    expect(await paneText(ui)).toContain('No config.ini found at /home/tim/work/config.ini')
  })
})

describe('the pane', () => {
  test('switches tabs by press and by hotkey twin', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await slash($)
    await w.clock.settle()
    const ui = await mountPane($)
    await ui.press({ key: 'tab:schema' })
    expect((await ui.find({ key: 'tab:schema-bg' })) !== undefined).toBe(true)
    await ui.press({ key: 'tabkey:connections' })
    expect((await ui.find({ key: 'tab:connections-bg' })) !== undefined).toBe(true)
    expect(await ui.find({ key: 'tab:schema-bg' })).toBeUndefined()
  })

  test('stays within its width at every size', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await slash($)
    await w.clock.settle()
    for (const bodyColumns of [40, 60, 100, 160]) {
      const ui = await mountPane($, 'terminal', bodyColumns)
      await ui.press({ key: 'tab:connections' })
      for (const row of await ui.findAll({ type: 'Box' })) if (row.props.flexDirection === 'row') expect(Number(row.props.width), `${bodyColumns} ${String(row.key)}`).toBeLessThanOrEqual(bodyColumns)
      await ui.unmount()
    }
  })
})

describe('the Schema tab', () => {
  test('reads the schema of the first connection and draws its tables, columns and relations', async ($, on) => {
    const w = world(on, { answers: { schema: { exitCode: 0, stdout: SCHEMA } } })
    await $.session.start(START)
    await slash($)
    await w.clock.settle()
    const ui = await mountPane($)
    await ui.press({ key: 'tab:schema' })
    await w.clock.settle()
    expect(w.runs.filter(r => r[2] === 'schema').map(r => r[3])).toEqual(['demo'])
    const text = await paneText(ui)
    expect(text).toContain('posts')
    expect(text).toContain('users')
    expect(text).toContain('→ users.id')
    expect(text).toContain('Relations')
    await ui.press({ key: 'tab:connections' })
    await ui.press({ key: 'tab:schema' })
    await w.clock.settle()
    expect(w.runs.filter(r => r[2] === 'schema')).toHaveLength(1)
  })

  test('stays within its width at every size', async ($, on) => {
    const w = world(on, { answers: { schema: { exitCode: 0, stdout: SCHEMA } } })
    await $.session.start(START)
    await slash($)
    await w.clock.settle()
    for (const bodyColumns of [40, 60, 100, 160]) {
      const ui = await mountPane($, 'terminal', bodyColumns)
      await ui.press({ key: 'tab:schema' })
      await w.clock.settle()
      expect(await paneText(ui), String(bodyColumns)).toContain('posts')
      for (const row of await ui.findAll({ type: 'Box' })) if (row.props.flexDirection === 'row') expect(Number(row.props.width), `${bodyColumns} ${String(row.key)}`).toBeLessThanOrEqual(bodyColumns)
      await ui.unmount()
    }
  })

  test('says why when the CLI fails, and keeps the pane up', async ($, on) => {
    const w = world(on, { answers: { schema: { exitCode: 1, stdout: '{"error":"no such connection: demo"}' } } })
    await $.session.start(START)
    await slash($)
    await w.clock.settle()
    const ui = await mountPane($)
    await ui.press({ key: 'tab:schema' })
    await w.clock.settle()
    expect(await paneText(ui)).toContain('no such connection: demo')
  })
})

const entry = (id: string, over: Record<string, unknown> = {}) => ({ id, at: '2000-01-01T00:00:00.000Z', source: 'claude', database: 'demo', tool: 'sql_query', sql: `SELECT ${id} FROM users`, durationMs: 4, rowCount: 2, outcome: 'ok', spool: id, ...over })
const PAGE = JSON.stringify({ id: 'e1', fields: ['id', 'name'], rows: [[1, 'ada'], [2, null]], total: 2, offset: 0, truncated: false })

describe('the Queries tab', () => {
  test('draws the journal and the selected entry\'s result, and a query of Claude\'s refreshes it at once', async ($, on) => {
    let journal = [entry('e1'), entry('e2', { source: 'pane', tool: 'pane_query' })]
    const w = world(on, { answers: { history: () => ({ exitCode: 0, stdout: JSON.stringify(journal) }), result: { exitCode: 0, stdout: PAGE } } })
    await $.session.start(START)
    await slash($)
    await w.clock.settle()
    const ui = await mountPane($, 'terminal', 140)
    await w.clock.settle()
    let text = await paneText(ui)
    expect(text).toContain('SELECT e1 FROM users')
    expect(text).toContain('✻')
    expect(text).toContain('❯')
    expect(text).toContain('ada')
    expect(text).toContain('NULL')
    expect(w.runs.filter(r => r[2] === 'history')).toHaveLength(1)
    journal = [entry('e3'), ...journal]
    await $.tool.call({ tool: 'mcp__argos__sql_query', database: 'demo', query: 'SELECT 1' })
    await w.clock.settle()
    expect(w.runs.filter(r => r[2] === 'history')).toHaveLength(2)
    text = await paneText(ui)
    expect(text).toContain('SELECT e3 FROM users')
    // Another tool, even of the same server, reads nothing.
    await $.tool.call({ tool: 'mcp__argos__sql_list_databases' })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await w.clock.settle()
    expect(w.runs.filter(r => r[2] === 'history')).toHaveLength(2)
  })

  test('a query before the pane was ever opened reads nothing', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await $.tool.call({ tool: 'mcp__argos__sql_query', database: 'demo', query: 'SELECT 1' })
    await w.clock.settle()
    expect(w.runs).toHaveLength(0)
  })

  test('stays within its width at every size', async ($, on) => {
    const journal = [entry('e1'), entry('e2', { outcome: 'blocked', reason: 'Multiple SQL statements', spool: null })]
    const w = world(on, { answers: { history: { exitCode: 0, stdout: JSON.stringify(journal) }, result: { exitCode: 0, stdout: PAGE } } })
    await $.session.start(START)
    await slash($)
    await w.clock.settle()
    for (const bodyColumns of [40, 60, 100, 160]) {
      const ui = await mountPane($, 'terminal', bodyColumns)
      await w.clock.settle()
      expect(await paneText(ui), String(bodyColumns)).toContain('SELECT e1')
      for (const row of await ui.findAll({ type: 'Box' })) if (row.props.flexDirection === 'row') expect(Number(row.props.width), `${bodyColumns} ${String(row.key)}`).toBeLessThanOrEqual(bodyColumns)
      await ui.unmount()
    }
  })
})

describe('typing in a field', () => {
  test('letters that are hotkeys go into the Schema filter and fire nothing', async ($, on) => {
    const w = world(on, { answers: { schema: { exitCode: 0, stdout: SCHEMA }, history: { exitCode: 0, stdout: '[]' }, pins: { exitCode: 0, stdout: '[]' } } })
    await $.session.start(START)
    await slash($)
    await w.clock.settle()
    const ui = await mountPane($)
    await ui.press({ key: 'tab:schema' })
    await w.clock.settle()
    await ui.press({ key: 'filter' })
    await w.clock.settle()
    const runs = w.runs.length
    await ui.input({ key: 'field:filter', text: 'nqrcf', kind: 'change' })
    await w.clock.settle()
    expect(w.runs).toHaveLength(runs)
    expect(w.copied).toHaveLength(0)
    expect(w.toasts).toHaveLength(0)
    const field = await ui.find({ type: 'Input', key: 'field:filter' })
    expect(field?.props.value).toBe('nqrcf')
    expect((await ui.find({ key: 'tab:schema-bg' })) !== undefined).toBe(true)
  })
})

type DrawnNode = { props?: Record<string, unknown>; children?: unknown[] }

/** How big a drawn tree is: its nodes, its depth and the text it draws (strings, labels, texts, sources, alts), which is what the engine bounds a pane by. */
function treeSize(tree: unknown): { nodes: number; depth: number; text: number } {
  let nodes = 0
  const deepest = (node: unknown, depth: number): number => {
    if (typeof node !== 'object' || node === null) return depth - 1
    nodes++
    return Math.max(depth, ...((node as DrawnNode).children ?? []).map(c => deepest(c, depth + 1)))
  }
  const depth = deepest(tree, 1)
  const texts = (node: unknown): number => {
    if (typeof node === 'string') return node.length
    if (typeof node !== 'object' || node === null) return 0
    const n = node as DrawnNode
    const own = ['label', 'text', 'source', 'alt'].reduce((sum, k) => sum + (typeof n.props?.[k] === 'string' ? (n.props[k] as string).length : 0), 0)
    return own + (n.children ?? []).reduce((sum: number, c) => sum + texts(c), 0)
  }
  return { nodes, depth, text: texts(tree) }
}

describe('the engine limits', () => {
  test('every tab stays under the text budget, 10,000 nodes and 16 deep, with 5,000 history entries, 300 tables and a 200x60 result', { timeoutMs: 120_000 }, async ($, on) => {
    const long = 'a_rather_long_identifier_name_that_goes_on_'
    const journal = Array.from({ length: 5000 }, (_, i) => entry(`e${i}`, { sql: `SELECT ${long}${i}, ${long}2 FROM ${long}table WHERE id = ${i} AND name LIKE '%${long}%'` }))
    const tables = Array.from({ length: 300 }, (_, i) => ({
      name: `${long}table_${i}`,
      type: 'table',
      columns: Array.from({ length: 12 }, (_, c) => column(`${long}col_${c}`, 'VARCHAR(255)', c === 0 ? 'PRI' : '')),
      primary_key: [`${long}col_0`],
      foreign_keys: i === 0 ? [] : [{ column: `${long}col_1`, references: { table: `${long}table_${i - 1}`, column: `${long}col_0` } }],
      row_estimate: null,
    }))
    const schema = JSON.stringify({ database: 'demo', type: 'sqlite', capturedAt: '2000-01-01T00:00:00.000Z', tables, views: [], lastChange: null })
    const wide = JSON.stringify({ id: 'e1', fields: Array.from({ length: 60 }, (_, c) => `${long}f${c}`), rows: Array.from({ length: 200 }, (_, r) => Array.from({ length: 60 }, (_, c) => `${long}value_${r}_${c}`)), total: 200, offset: 0, truncated: false })
    const ran = JSON.stringify(entry('e9000'))
    const w = world(on, { answers: { history: { exitCode: 0, stdout: JSON.stringify(journal) }, schema: { exitCode: 0, stdout: schema }, result: { exitCode: 0, stdout: wide }, query: { exitCode: 0, stdout: ran } } })
    await $.session.start(START)
    await slash($)
    await w.clock.settle()
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const bodyColumns of [60, 100, 160]) {
        for (const bodyRows of [20, 50]) {
          const ui = await $.ui.mount({ plugin: 'argos', surface, component: 'Pane', requestId: 'argos', props: { ...PANE_PROPS, bodyColumns, scroll: { offset: 0, bodyRows } } })
          for (const tab of ['queries', 'schema', 'editor', 'connections']) {
            await ui.press({ key: `tab:${tab}` })
            await w.clock.settle()
            if (tab === 'editor' && (await ui.find({ type: 'Button', key: 'run' })) !== undefined) {
              await ui.press({ key: 'run' })
              await w.clock.settle()
            }
            const size = treeSize(await ui.drawn())
            const at = `${surface} ${bodyColumns}x${bodyRows} ${tab}: ${JSON.stringify(size)}`
            expect(size.nodes, at).toBeGreaterThan(5)
            expect(size.nodes, at).toBeLessThan(10_000)
            expect(size.depth, at).toBeLessThan(16)
            expect(size.text, at).toBeLessThanOrEqual(90_000)
          }
          await ui.unmount()
        }
      }
    }
  })
})

import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

const ENV = { node: '/usr/bin/node', cli: '/opt/argos/dist/cli.js', config: '/home/tim/work/config.ini' }

const CONNECTIONS = [
  { name: 'demo', type: 'sqlite', host: null, ssh: false, ssl: false, selectOnly: true, mcpConfigurable: false, schemaCapturedAt: null },
  { name: 'shop', type: 'postgresql', host: 'db.internal', ssh: true, ssl: true, selectOnly: false, mcpConfigurable: true, schemaCapturedAt: '2000-01-01T00:00:00.000Z' },
]

type Answer = { exitCode: number; stdout: string; stderr?: string } | { throws: string }

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
  const answers: Record<string, Answer> = { connections: { exitCode: 0, stdout: JSON.stringify(CONNECTIONS) }, ...options.answers }
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
    const answer = answers[String(e.argv[2])]
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
  return { clock, runs, opened, closed, registered }
}

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
      expect(text).toContain('SELECT_ONLY')
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

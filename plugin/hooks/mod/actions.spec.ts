import { beforeEach, describe, expect, it } from 'vitest'

import { readFileSync } from 'node:fs'

import type { HistoryState, SchemaState, View } from '../../types'
import type { JournalEntry, SchemaView } from '../lib/contract'
import { focusMoved, handlersOf, pressOf, wheelScrolled } from './actions'
import { mod, reset } from './state'
import { fakePort } from './__tests__/fake-port'

const conn = (name: string) => ({ name, type: 'sqlite', host: null, ssh: false, ssl: false, selectOnly: true, mcpConfigurable: false, schemaCapturedAt: null })
const LISTED = { ask: 1, phase: 'done' as const, answer: [conn('a'), conn('b'), conn('c')], failure: null }

const SCHEMA = JSON.parse(readFileSync(new URL('../../../tests/fixtures/pane-contract/schema.json', import.meta.url), 'utf8')) as SchemaView
const LOADED: SchemaState = { db: 'a', ask: 0, phase: 'done', answer: SCHEMA, failure: null }

beforeEach(() => reset({}))

/** Presses `id` on the pane and lets what it does settle. */
async function press(port: ReturnType<typeof fakePort>, id: string) {
  handlersOf(port.io).press(id)
  await port.advance()
  await port.advance()
}

const viewOf = (port: ReturnType<typeof fakePort>) => port.values.get('view') as View

describe('the press table', () => {
  it('keys an id up to its first colon, and a twin to what it does', () => {
    expect(pressOf('tab:schema')).toEqual({ key: 'tab:', rest: 'schema' })
    expect(pressOf('tabkey:editor')).toEqual({ key: 'tab:', rest: 'editor' })
    expect(pressOf('row:3')).toEqual({ key: 'row:', rest: '3' })
    expect(pressOf('down')).toEqual({ key: 'down', rest: '' })
    expect(pressOf('nothing')).toBeNull()
    expect(pressOf('nothing:1')).toBeNull()
  })

  it('opens a tab, and ignores one that does not exist', async () => {
    const port = fakePort()
    await press(port, 'tab:schema')
    expect(viewOf(port).tab).toBe('schema')
    await press(port, 'tabkey:connections')
    expect(viewOf(port).tab).toBe('connections')
    await press(port, 'tab:nowhere')
    expect(viewOf(port).tab).toBe('connections')
  })

  it('marks a connection on Connections, and makes it the one the other tabs use', async () => {
    const port = fakePort({ cells: { connections: LISTED } })
    await press(port, 'tab:connections')
    await press(port, 'row:1')
    expect(viewOf(port).marker.connections).toBe(1)
    expect(viewOf(port).db).toBe('b')
  })

  it('moves the marker within the list, never past either end', async () => {
    const port = fakePort({ cells: { connections: LISTED } })
    await press(port, 'tab:connections')
    await press(port, 'down')
    await press(port, 'down')
    await press(port, 'down')
    expect(viewOf(port).marker.connections).toBe(2)
    expect(viewOf(port).db).toBe('c')
    for (let i = 0; i < 5; i++) await press(port, 'up')
    expect(viewOf(port).marker.connections).toBe(0)
  })

  it('does nothing for an id it does not know', async () => {
    const port = fakePort()
    const before = viewOf(port)
    await press(port, 'whatever')
    expect(viewOf(port)).toEqual(before)
  })

  it('swallows the failure of a press', async () => {
    const port = fakePort()
    ;(port.io.state.view as { update: unknown }).update = () => Promise.reject(new Error('torn down'))
    await expect(press(port, 'tab:schema')).resolves.toBeUndefined()
  })
})

describe('the focus ring', () => {
  it("moves off a tab's hidden twin onto the tab", async () => {
    const port = fakePort()
    expect(await focusMoved(port.io, 'tabkey:schema')).toEqual({ to: 'tab:schema' })
    expect(await focusMoved(port.io, 'row:2')).toBeNull()
    expect(await focusMoved(port.io, 42)).toBeNull()
  })
})

describe('the Schema tab', () => {
  const onSchema = (extra: Partial<View> = {}) => fakePort({ cells: { connections: LISTED, schema: LOADED, view: { ...(fakePort().values.get('view') as View), tab: 'schema', db: 'a', ...extra } } })

  it('opens by reading the schema of the connection in use', async () => {
    const port = fakePort({ cells: { connections: LISTED, view: { ...(fakePort().values.get('view') as View), db: 'a' } }, run: () => ({ exitCode: 0, stdout: JSON.stringify(SCHEMA) }) })
    await press(port, 'tab:schema')
    await port.advance()
    expect(port.runs.map(r => r.argv.slice(2, 4))).toEqual([['schema', 'a']])
    expect((port.values.get('schema') as SchemaState).answer?.database).toBe('demo')
  })

  it('walks the tables, and the line under the list moves the marker onto the item it counts', async () => {
    const port = onSchema()
    await press(port, 'down')
    expect(viewOf(port).marker.schema).toBe(1)
    await press(port, 'down')
    await press(port, 'down')
    expect(viewOf(port).marker.schema).toBe(2)
    await press(port, 'more:0')
    expect(viewOf(port).marker.schema).toBe(0)
  })

  it('cycles the connections round the list and reads the next one', async () => {
    const port = onSchema()
    port.values.set('schema', null)
    await press(port, 'next')
    expect(viewOf(port).db).toBe('b')
    expect(viewOf(port).marker.connections).toBe(1)
    await press(port, 'next')
    await press(port, 'next')
    expect(viewOf(port).db).toBe('a')
    expect(port.runs.some(r => r.argv.slice(2, 4).join(' ') === 'schema b')).toBe(true)
  })

  it('q puts a SELECT of the marked table in the Editor, and TOP for mssql', async () => {
    const port = onSchema({ marker: { queries: 0, schema: 1, editor: 0, connections: 0 } })
    await press(port, 'query')
    expect(port.values.get('draft')).toBe('SELECT * FROM users LIMIT 100')
    expect(viewOf(port).tab).toBe('editor')
    const sql = onSchema()
    sql.values.set('schema', { ...LOADED, answer: { ...SCHEMA, type: 'mssql' } })
    await press(sql, 'query')
    expect(sql.values.get('draft')).toBe('SELECT TOP 100 * FROM posts')
  })

  it('c copies a CREATE TABLE sketch of the marked table', async () => {
    const port = onSchema()
    const copied: string[] = []
    ;(port.io.ui as { copy: unknown }).copy = async (args: { text: string }) => (copied.push(args.text), { isCopied: true })
    await press(port, 'copy-create')
    expect(copied).toHaveLength(1)
    expect(copied[0]).toContain('CREATE TABLE posts (')
  })

  it('f opens the filter, typing narrows and sends the marker to the top, Enter keeps it; f again clears', async () => {
    const port = onSchema({ marker: { queries: 0, schema: 2, editor: 0, connections: 0 } })
    await press(port, 'filter')
    expect(viewOf(port).filtering).toBe(true)
    handlersOf(port.io).type('filter', 'us')
    await port.advance()
    expect(viewOf(port)).toMatchObject({ filter: 'us', filtering: true })
    expect(viewOf(port).marker.schema).toBe(0)
    handlersOf(port.io).submit('filter', 'us')
    await port.advance()
    expect(viewOf(port)).toMatchObject({ filter: 'us', filtering: false })
    await press(port, 'filter')
    await press(port, 'filter')
    expect(viewOf(port)).toMatchObject({ filter: '', filtering: false })
  })

  it('r reads the schema again from the database, once', async () => {
    const port = onSchema()
    port.values.set('schema', null)
    await press(port, 'refresh')
    await port.advance()
    expect(port.runs[0]!.argv).toContain('--refresh')
    await press(port, 'tab:schema')
    await port.advance()
    expect(port.runs).toHaveLength(1)
  })
})

describe('the wheel', () => {
  it('moves the window of the list under the pointer and leaves the marker', async () => {
    const port = fakePort()
    const rows = [{ key: 'r', segments: [{ text: 'x' }], lists: [{ key: 'tables', from: 0, to: 40, start: 0, shown: 5, length: 20 }] }]
    expect(await wheelScrolled(port.io, rows, 0, { row: 0, column: 3 }, 3)).toBe(true)
    expect(viewOf(port).scroll).toEqual({ tables: 3 })
    expect(viewOf(port).marker).toEqual(fakePort().values.get('view') && (fakePort().values.get('view') as View).marker)
  })

  it('hands the tick on over no list, or at the end of one', async () => {
    const port = fakePort()
    const rows = [{ key: 'r', segments: [{ text: 'x' }], lists: [{ key: 'tables', from: 0, to: 40, start: 15, shown: 5, length: 20 }] }]
    expect(await wheelScrolled(port.io, rows, 0, { row: 0, column: 3 }, 3)).toBe(false)
    expect(await wheelScrolled(port.io, rows, 0, { row: 4, column: 3 }, -3)).toBe(false)
    expect(viewOf(port).scroll).toEqual({})
  })
})

const entry = (id: string, over: Partial<JournalEntry> = {}): JournalEntry => ({ id, at: '2000-01-01T00:00:00.000Z', source: 'claude', database: 'a', tool: 'sql_query', sql: `SELECT ${id}`, durationMs: 1, rowCount: 2, outcome: 'ok', spool: id, ...over })
const JOURNAL: HistoryState = { ask: 0, phase: 'done', answer: [entry('e1'), entry('e2', { source: 'pane', tool: 'pane_query' }), entry('e3')], more: false, failure: null }
const PAGE = { id: 'e1', fields: ['id', 'name'], rows: [[1, 'ada'], [2, null]], total: 450, offset: 0, truncated: false }
const onQueries = (run?: Parameters<typeof fakePort>[0] extends infer O ? (O extends { run?: infer R } ? R : never) : never, extra: Record<string, unknown> = {}) =>
  fakePort({ ...(run === undefined ? {} : { run }), cells: { connections: LISTED, history: JOURNAL, pins: { ask: 0, phase: 'done', answer: [], failure: null }, ...extra } })

describe('the Queries tab', () => {
  it('walks the journal and reads the result of the entry it lands on', async () => {
    const port = onQueries(() => ({ exitCode: 0, stdout: JSON.stringify(PAGE) }))
    await press(port, 'down')
    expect(viewOf(port).marker.queries).toBe(1)
    expect(mod.loads.selectedId).toBe('e2')
    await press(port, 'down')
    await press(port, 'down')
    expect(viewOf(port).marker.queries).toBe(2)
    expect(port.runs.map(r => r.argv[3])).toEqual(['e2', 'e3'])
  })

  it('r runs the selected SQL again on its connection through the CLI, and selects the newest entry that lands', async () => {
    const ran = entry('e9', { source: 'pane', tool: 'pane_query' })
    const port = onQueries(argv => (argv[2] === 'query' ? { exitCode: 0, stdout: JSON.stringify(ran) } : { exitCode: 0, stdout: argv[2] === 'history' ? JSON.stringify([ran, entry('e1')]) : '[]' }))
    port.values.set('view', { ...viewOf(port), marker: { ...viewOf(port).marker, queries: 2 } })
    await press(port, 'rerun')
    await port.advance()
    expect(port.runs[0]!.argv.slice(2, 6)).toEqual(['query', 'a', '--sql', 'SELECT e3'])
    expect(viewOf(port).marker.queries).toBe(0)
  })

  it('r on a refused rerun says why and reads nothing more', async () => {
    const toasts: string[] = []
    const port = onQueries(() => ({ exitCode: 1, stdout: '{"error":"no such connection: a"}' }))
    ;(port.io.ui as { toast: unknown }).toast = async (t: string) => void toasts.push(t)
    await press(port, 'rerun')
    expect(toasts).toEqual(['no such connection: a'])
    expect(port.runs).toHaveLength(1)
  })

  it('e puts the SQL in the Editor, on its connection', async () => {
    const port = onQueries()
    await press(port, 'down')
    await press(port, 'edit')
    expect(port.values.get('draft')).toBe('SELECT e2')
    expect(viewOf(port)).toMatchObject({ tab: 'editor', db: 'a' })
  })

  it('p pins an entry through the CLI and reads the pins again; on a pinned one it unpins', async () => {
    const pinned = { id: 'p1', name: null, database: 'a', sql: 'SELECT e1', createdAt: '2000-01-01T00:00:00.000Z', lastJournalId: 'e1' }
    const port = onQueries(argv => (argv[2] === 'pin' ? { exitCode: 0, stdout: JSON.stringify(pinned) } : argv[2] === 'unpin' ? { exitCode: 0, stdout: '{"removed":true}' } : { exitCode: 0, stdout: argv[2] === 'pins' ? JSON.stringify([pinned]) : JSON.stringify(PAGE) }))
    await press(port, 'pin')
    expect(port.runs.find(r => r.argv[2] === 'pin')!.argv.slice(2, 4)).toEqual(['pin', 'e1'])
    expect((port.values.get('pins') as { answer: unknown[] }).answer).toHaveLength(1)
    await press(port, 'pin')
    expect(port.runs.find(r => r.argv[2] === 'unpin')!.argv.slice(2, 4)).toEqual(['unpin', 'p1'])
  })

  it('c copies the result as markdown, then CSV, then JSON on repeats within 2 s, and starts over after a pause', async () => {
    const port = onQueries(undefined, { result: { id: 'e1', offset: 0, phase: 'done', page: PAGE, failure: null } })
    const copied: string[] = []
    const toasts: string[] = []
    ;(port.io.ui as { copy: unknown }).copy = async (args: { text: string }) => (copied.push(args.text), { isCopied: true })
    ;(port.io.ui as { toast: unknown }).toast = async (t: string) => void toasts.push(t)
    let now = 0
    ;(port.io.clock as { now: unknown }).now = async () => now
    for (const at of [0, 500, 1000, 1500]) {
      now = at
      await press(port, 'copy')
    }
    expect(copied[0]).toContain('| id | name |')
    expect(copied[1]).toBe('id,name\n1,ada\n2,')
    expect(JSON.parse(copied[2]!)).toEqual([{ id: 1, name: 'ada' }, { id: 2, name: null }])
    expect(copied[3]).toContain('| id | name |')
    expect(toasts.map(t => t.replace(/^Copied 2 rows as /, ''))).toEqual(['markdown', 'CSV', 'JSON', 'markdown'])
    now = 10_000
    await press(port, 'copy')
    now = 20_000
    await press(port, 'copy')
    expect(toasts.slice(-2)).toEqual(['Copied 2 rows as markdown', 'Copied 2 rows as markdown'])
  })

  it('c with no result copies the SQL', async () => {
    const port = onQueries(undefined, { history: { ...JOURNAL, answer: [entry('e1', { spool: null })] } })
    const copied: string[] = []
    ;(port.io.ui as { copy: unknown }).copy = async (args: { text: string }) => (copied.push(args.text), { isCopied: true })
    await press(port, 'copy')
    expect(copied).toEqual(['SELECT e1'])
  })

  it('s is a stub for now: it does nothing', async () => {
    const port = onQueries()
    const before = structuredClone(Object.fromEntries(port.values))
    await press(port, 'send')
    expect(Object.fromEntries(port.values)).toEqual(before)
    expect(port.runs).toHaveLength(0)
  })

  it('m reads the next page of rows, b the earlier one, and neither goes past either end', async () => {
    const port = onQueries(argv => ({ exitCode: 0, stdout: JSON.stringify({ ...PAGE, offset: Number(argv[argv.indexOf('--offset') + 1]) }) }), { result: { id: 'e1', offset: 0, phase: 'done', page: { ...PAGE, rows: Array.from({ length: 200 }, (_, i) => [i, 'x']) }, failure: null } })
    port.values.set('view', { ...viewOf(port), scroll: { result: 40 } })
    await press(port, 'more-rows')
    expect(port.runs[0]!.argv.slice(2, 8)).toEqual(['result', 'e1', '--offset', '200', '--limit', '200'])
    expect(viewOf(port).scroll).toEqual({})
    port.values.set('result', { id: 'e1', offset: 400, phase: 'done', page: { ...PAGE, offset: 400, rows: Array.from({ length: 50 }, () => [0, 'x']) }, failure: null })
    await press(port, 'more-rows')
    expect(port.runs).toHaveLength(1)
    await press(port, 'back-rows')
    expect(port.runs[1]!.argv.slice(4, 6)).toEqual(['--offset', '200'])
  })

  it('a press on a pin selects the entry it was last run as', async () => {
    const pins = { ask: 0, phase: 'done', answer: [{ id: 'p1', name: 'n', database: 'a', sql: 'SELECT e3', createdAt: '', lastJournalId: 'e3' }], failure: null }
    const port = onQueries(undefined, { pins })
    await press(port, 'pinned:0')
    expect(viewOf(port).marker.queries).toBe(2)
  })

  it('reads the older page when the marker comes within five entries of the end of a list that has more', async () => {
    const port = onQueries(() => ({ exitCode: 0, stdout: '[]' }), { history: { ...JOURNAL, more: true } })
    await press(port, 'down')
    expect(port.runs.some(r => r.argv.includes('--before') && r.argv.includes('e3'))).toBe(true)
  })

  it('the wheel to the end of the history reads the older page', async () => {
    const port = onQueries(() => ({ exitCode: 0, stdout: '[]' }), { history: { ...JOURNAL, more: true } })
    const rows = [{ key: 'r', segments: [{ text: 'x' }], lists: [{ key: 'history', from: 0, to: 40, start: 0, shown: 2, length: 3 }] }]
    expect(await wheelScrolled(port.io, rows, 0, { row: 0, column: 3 }, 1)).toBe(true)
    await port.advance()
    expect(port.runs.some(r => r.argv.includes('--before'))).toBe(true)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'

import { readFileSync } from 'node:fs'

import type { SchemaState, View } from '../../types'
import type { SchemaView } from '../lib/contract'
import { focusMoved, handlersOf, pressOf, wheelScrolled } from './actions'
import { reset } from './state'
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

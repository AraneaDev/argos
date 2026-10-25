import { beforeEach, describe, expect, it } from 'vitest'

import { readFileSync } from 'node:fs'

import type { ConnectionsState, SchemaState, View } from '../../types'
import { refreshSchema, reloadConnections, request } from './loaders'
import { mod, reset } from './state'
import { ENV, fakePort } from './__tests__/fake-port'

const conn = (name: string) => ({ name, type: 'sqlite', host: null, ssh: false, ssl: false, selectOnly: true, mcpConfigurable: false, schemaCapturedAt: null })

/** A process answer the spec settles by hand. */
function deferred() {
  let settle!: (stdout: string) => void
  const promise = new Promise<{ exitCode: number; stdout: string }>(resolve => (settle = stdout => resolve({ exitCode: 0, stdout })))
  return { promise, settle }
}

beforeEach(() => reset({}))

describe('the connections loader', () => {
  it('marks the cell loading at once and reads on a timer, never inside the request', async () => {
    const port = fakePort({ run: () => ({ exitCode: 0, stdout: JSON.stringify([conn('demo')]) }) })
    await reloadConnections(port.io)
    expect((port.values.get('connections') as ConnectionsState).phase).toBe('loading')
    expect(port.runs).toHaveLength(0)
    await port.advance()
    expect(port.runs).toHaveLength(1)
    expect(port.values.get('connections')).toEqual({ ask: 1, phase: 'done', answer: [conn('demo')], failure: null })
    expect(port.values.get('config')).toBe(ENV.config)
  })

  it('starts no second read for what the cell already holds or is reading', async () => {
    const port = fakePort()
    await reloadConnections(port.io)
    await request(port.io, 'connections')
    await request(port.io, 'connections')
    await port.advance()
    await request(port.io, 'connections')
    await port.advance()
    expect(port.runs).toHaveLength(1)
  })

  it('reads again on every reload, and drops an answer that lands after the next reload began', async () => {
    const answers = [deferred(), deferred()]
    let n = 0
    const port = fakePort({ run: () => answers[n++]!.promise })
    await reloadConnections(port.io)
    await port.advance()
    await reloadConnections(port.io)
    await port.advance()
    expect(port.runs).toHaveLength(2)
    answers[1]!.settle(JSON.stringify([conn('new')]))
    await port.advance()
    answers[0]!.settle(JSON.stringify([conn('old')]))
    await port.advance()
    expect((port.values.get('connections') as ConnectionsState).answer).toEqual([conn('new')])
    expect(mod.loads.fetching.size).toBe(0)
  })

  it('keeps the last list and stores why when a read fails', async () => {
    let fail = false
    const port = fakePort({ run: () => (fail ? { exitCode: 1, stdout: '{"error":"config.ini is unreadable"}' } : { exitCode: 0, stdout: JSON.stringify([conn('demo')]) }) })
    await reloadConnections(port.io)
    await port.advance()
    fail = true
    await reloadConnections(port.io)
    await port.advance()
    expect(port.values.get('connections')).toEqual({ ask: 2, phase: 'done', answer: [conn('demo')], failure: 'config.ini is unreadable' })
  })

  it('reads nothing once the mod is off', async () => {
    const port = fakePort()
    mod.session.disabled = true
    await reloadConnections(port.io)
    await port.advance()
    expect(port.runs).toHaveLength(0)
  })
})

const SCHEMA_TEXT = readFileSync(new URL('../../../tests/fixtures/pane-contract/schema.json', import.meta.url), 'utf8')
const withDb = (db: string | null) => ({ ...(fakePort().values.get('view') as View), db })

describe('the schema loader', () => {
  it('reads the schema of the connection in use, keyed by it, on a timer', async () => {
    const port = fakePort({ cells: { view: withDb('demo') }, run: () => ({ exitCode: 0, stdout: SCHEMA_TEXT }) })
    await request(port.io, 'schema')
    expect((port.values.get('schema') as SchemaState).phase).toBe('loading')
    expect(port.runs).toHaveLength(0)
    await port.advance()
    expect(port.runs[0]!.argv.slice(2, 4)).toEqual(['schema', 'demo'])
    expect(port.runs[0]!.argv).not.toContain('--refresh')
    expect(port.values.get('schema')).toMatchObject({ db: 'demo', phase: 'done', failure: null })
    await request(port.io, 'schema')
    await port.advance()
    expect(port.runs).toHaveLength(1)
  })

  it('reads nothing until a connection is in use', async () => {
    const port = fakePort({ run: () => ({ exitCode: 0, stdout: SCHEMA_TEXT }) })
    await request(port.io, 'schema')
    await port.advance()
    expect(port.runs).toHaveLength(0)
  })

  it("never shows one connection's schema while another reads, and drops an answer that lands late", async () => {
    const answers = [deferred(), deferred()]
    let n = 0
    const port = fakePort({ cells: { view: withDb('a') }, run: () => answers[n++]!.promise })
    await request(port.io, 'schema')
    await port.advance()
    answers[0]!.settle(SCHEMA_TEXT)
    await port.advance()
    await port.io.state.view.update(v => ({ ...v, db: 'b' }))
    await request(port.io, 'schema')
    expect((port.values.get('schema') as SchemaState).answer).toBeNull()
    await port.advance()
    answers[1]!.settle(SCHEMA_TEXT.replace('"demo"', '"other"'))
    await port.advance()
    expect(port.values.get('schema')).toMatchObject({ db: 'b' })
    expect((port.values.get('schema') as SchemaState).answer?.database).toBe('other')
  })

  it('keeps the schema on show and stores why when a read fails', async () => {
    let fail = false
    const port = fakePort({ cells: { view: withDb('demo') }, run: () => (fail ? { exitCode: 1, stdout: '{"error":"database is locked"}' } : { exitCode: 0, stdout: SCHEMA_TEXT }) })
    await request(port.io, 'schema')
    await port.advance()
    fail = true
    await refreshSchema(port.io)
    await port.advance()
    const s = port.values.get('schema') as SchemaState
    expect(s.failure).toBe('database is locked')
    expect(s.answer?.database).toBe('demo')
    expect(port.runs[1]!.argv).toContain('--refresh')
  })

  it('names the first connection as the one in use when none is, and reads it if the Schema tab is open', async () => {
    const port = fakePort({ cells: { view: { ...withDb(null), tab: 'schema' } }, run: argv => ({ exitCode: 0, stdout: argv[2] === 'connections' ? JSON.stringify([conn('first'), conn('second')]) : SCHEMA_TEXT }) })
    await reloadConnections(port.io)
    await port.advance()
    await port.advance()
    expect((port.values.get('view') as View).db).toBe('first')
    expect(port.runs.map(r => r.argv.slice(2, 4))).toEqual([['connections', '--config'], ['schema', 'first']])
  })
})

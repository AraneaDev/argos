import { beforeEach, describe, expect, it } from 'vitest'

import { readFileSync } from 'node:fs'

import type { ConnectionsState, HistoryState, ResultState, SchemaState, View } from '../../types'
import type { JournalEntry } from '../lib/contract'
import { isQueryTool, liveFeed, moreHistory, refreshSchema, reloadConnections, reloadQueries, request } from './loaders'
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

const entry = (id: string, over: Partial<JournalEntry> = {}): JournalEntry => ({ id, at: `2000-01-01T00:00:${id.slice(1).padStart(2, '0')}.000Z`, source: 'claude', database: 'a', tool: 'sql_query', sql: `SELECT ${id}`, durationMs: 1, rowCount: 1, outcome: 'ok', spool: id, ...over })
const historyOf = (port: ReturnType<typeof fakePort>) => port.values.get('history') as HistoryState
const queriesView = (port: ReturnType<typeof fakePort>, tab: View['tab'] = 'queries') => port.values.set('view', { ...(port.values.get('view') as View), tab })

describe('the tool filter', () => {
  it('names the Argos server\'s query tools under whatever name it is registered', () => {
    for (const tool of ['sql_query', 'sql_batch_query', 'sql_analyze_performance']) {
      expect(isQueryTool(`mcp__argos__${tool}`, 'argos')).toBe(true)
      expect(isQueryTool(`mcp__db__${tool}`, 'db')).toBe(true)
      expect(isQueryTool(`mcp__db__${tool}`, 'argos')).toBe(false)
    }
    expect(isQueryTool('mcp__argos__sql_list_databases', 'argos')).toBe(false)
    expect(isQueryTool('Bash', 'argos')).toBe(false)
    expect(isQueryTool(undefined, 'argos')).toBe(false)
  })
})

describe('the history loader', () => {
  const answer = (...ids: string[]) => ({ exitCode: 0, stdout: JSON.stringify(ids.map(id => entry(id))) })

  it('reads the newest page on an open, with the page size', async () => {
    const port = fakePort({ run: () => answer('e9', 'e8') })
    await reloadQueries(port.io)
    expect(port.runs).toHaveLength(0)
    await port.advance()
    expect(port.runs.filter(r => r.argv[2] !== 'result').map(r => r.argv.slice(2, 5))).toEqual([['history', '--limit', '50'], ['pins', '--config', ENV.config]])
    expect(historyOf(port)).toMatchObject({ phase: 'done', more: false, failure: null })
    expect(historyOf(port).answer!.map(e => e.id)).toEqual(['e9', 'e8'])
  })

  it('reads once for a query of Claude\'s, after the pane was opened, and selects the newest when on Queries', async () => {
    const port = fakePort({ run: argv => (argv[2] === 'history' ? answer('e5', 'e4') : { exitCode: 0, stdout: '[]' }) })
    await liveFeed(port.io)
    await port.advance()
    expect(port.runs).toHaveLength(0)
    await reloadConnections(port.io)
    await reloadQueries(port.io)
    await port.advance()
    port.runs.length = 0
    queriesView(port)
    port.values.set('view', { ...(port.values.get('view') as View), marker: { ...(port.values.get('view') as View).marker, queries: 1 } })
    port.values.set('history', { ...historyOf(port) })
    await liveFeed(port.io)
    await port.advance()
    expect(port.runs.filter(r => r.argv[2] === 'history')).toHaveLength(1)
    expect((port.values.get('view') as View).marker.queries).toBe(0)
  })

  it('keeps the selected entry selected when newer ones arrive while another tab is open', async () => {
    let page = ['e5', 'e4', 'e3']
    const port = fakePort({ run: () => answer(...page) })
    await reloadConnections(port.io)
    await reloadQueries(port.io)
    await port.advance()
    port.values.set('view', { ...(port.values.get('view') as View), tab: 'schema', marker: { queries: 1, schema: 0, editor: 0, connections: 0 } })
    const { mod } = await import('./state')
    mod.loads.selectedId = 'e4'
    page = ['e7', 'e6', 'e5', 'e4', 'e3']
    await liveFeed(port.io)
    await port.advance()
    expect((port.values.get('view') as View).marker.queries).toBe(3)
    expect(historyOf(port).answer!.map(e => e.id)).toEqual(['e7', 'e6', 'e5', 'e4', 'e3'])
  })

  it('pages older entries in after the last one read, by 50, and stops when a page is short', async () => {
    const full = Array.from({ length: 50 }, (_, i) => `e${99 - i}`)
    const port = fakePort({ run: argv => (argv.includes('--before') ? answer('e49', 'e48') : answer(...full)) })
    await reloadConnections(port.io)
    await reloadQueries(port.io)
    await port.advance()
    expect(historyOf(port).more).toBe(true)
    await moreHistory(port.io)
    await port.advance()
    const paged = port.runs.find(r => r.argv.includes('--before'))!
    expect(paged.argv.slice(paged.argv.indexOf('--before'), paged.argv.indexOf('--before') + 2)).toEqual(['--before', 'e50'])
    expect(historyOf(port).answer).toHaveLength(52)
    expect(historyOf(port).more).toBe(false)
    const before = port.runs.length
    await moreHistory(port.io)
    await port.advance()
    expect(port.runs).toHaveLength(before)
  })

  it('keeps the older pages already read when the newest page is read again', async () => {
    const full = Array.from({ length: 50 }, (_, i) => `e${99 - i}`)
    let live = true
    const port = fakePort({ run: argv => (argv.includes('--before') ? answer('e49') : live ? answer(...full) : answer('e00', ...full.slice(0, 49))) })
    await reloadConnections(port.io)
    await reloadQueries(port.io)
    await port.advance()
    await moreHistory(port.io)
    await port.advance()
    live = false
    await liveFeed(port.io)
    await port.advance()
    expect(historyOf(port).answer!.map(e => e.id)).toEqual(['e00', ...full.slice(0, 49), 'e50', 'e49'])
  })

  it('keeps the last list and stores why when a read fails', async () => {
    let fail = false
    const port = fakePort({ run: () => (fail ? { exitCode: 1, stdout: '{"error":"journal unreadable"}' } : answer('e1')) })
    await reloadQueries(port.io)
    await port.advance()
    fail = true
    await reloadQueries(port.io)
    await port.advance()
    expect(historyOf(port)).toMatchObject({ failure: 'journal unreadable' })
    expect(historyOf(port).answer).toHaveLength(1)
  })
})

describe('the result loader', () => {
  const PAGE = { id: 'e1', fields: ['n'], rows: [[1]], total: 1, offset: 0, truncated: false }
  const seeded = (run: Parameters<typeof fakePort>[0] extends infer O ? (O extends { run?: infer R } ? R : never) : never) =>
    fakePort({ run, cells: { history: { ask: 1, phase: 'done', answer: [entry('e1'), entry('e2', { spool: null }), entry('e3', { outcome: 'blocked', spool: null })], more: false, failure: null } } })

  it('reads page 0 of the selected entry, 200 rows, only on Queries and only for an entry that kept a spool', async () => {
    const port = seeded(() => ({ exitCode: 0, stdout: JSON.stringify(PAGE) }))
    queriesView(port, 'schema')
    await request(port.io, 'result')
    await port.advance()
    expect(port.runs).toHaveLength(0)
    queriesView(port)
    await request(port.io, 'result')
    await port.advance()
    expect(port.runs.map(r => r.argv.slice(2, 8))).toEqual([['result', 'e1', '--offset', '0', '--limit', '200']])
    expect(port.values.get('result') as ResultState).toMatchObject({ id: 'e1', offset: 0, phase: 'done', page: PAGE })
    for (const queries of [1, 2]) {
      port.values.set('view', { ...(port.values.get('view') as View), marker: { queries, schema: 0, editor: 0, connections: 0 } })
      await request(port.io, 'result')
      await port.advance()
    }
    expect(port.runs).toHaveLength(1)
  })

  it('reads again with 20 rows when the output of 200 was cut short, and lands the smaller page', async () => {
    const small = { ...PAGE, rows: [[1]], total: 90 }
    const port = seeded(argv => (argv.includes('200') ? { exitCode: 0, stdout: '{"id":"e1","rows":[["x', isStdoutTruncated: true } : { exitCode: 0, stdout: JSON.stringify(small) }))
    await request(port.io, 'result')
    await port.advance()
    await port.advance()
    expect(port.runs.map(r => r.argv[r.argv.indexOf('--limit') + 1])).toEqual(['200', '20'])
    expect(port.values.get('result') as ResultState).toMatchObject({ id: 'e1', offset: 0, phase: 'done', page: small, failure: null })
  })

  it('stops at 20 rows: when even that is cut short the card says the result is too wide', async () => {
    const port = seeded(() => ({ exitCode: 0, stdout: '{"id', isStdoutTruncated: true }))
    await request(port.io, 'result')
    await port.advance()
    await port.advance()
    await port.advance()
    expect(port.runs).toHaveLength(2)
    expect(port.values.get('result')).toMatchObject({ page: null, failure: 'output too large' })
  })

  it('stores why when the spool is gone', async () => {
    const port = seeded(() => ({ exitCode: 1, stdout: "{\"error\":\"No spooled result for 'e1'\"}" }))
    await request(port.io, 'result')
    await port.advance()
    expect(port.values.get('result')).toMatchObject({ id: 'e1', page: null, failure: "No spooled result for 'e1'" })
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import type { View } from '../../types'
import type { ConnectionView, JournalEntry, SchemaView } from './contract'
import { INITIAL_VIEW, paneLayout, paneRows, withScrollsKept } from './layout'
import type { PaneModel } from './layout'
import { rowWidth } from './rows'
import type { Row } from './types'

const CONNECTIONS = JSON.parse(readFileSync(new URL('../../../tests/fixtures/pane-contract/connections.json', import.meta.url), 'utf8')) as ConnectionView[]
const NOW = Date.parse('2000-01-01T03:00:00.000Z')

const model = (over: Partial<PaneModel> = {}, view: Partial<View> = {}): PaneModel => ({
  config: '/home/tim/work/config.ini',
  connections: { ask: 1, phase: 'done', answer: CONNECTIONS, failure: null },
  schema: null,
  history: null,
  pins: null,
  result: null,
  view: { ...INITIAL_VIEW, tab: 'connections', ...view },
  since: null,
  now: NOW,
  terminal: true,
  ...over,
})

const lines = (rows: Row[]): string[] => rows.map(r => r.segments.filter(s => s.hidden !== true).map(s => s.text).join(''))
const all = (rows: Row[]): string => lines(rows).join('\n')

describe('the Connections tab', () => {
  it('shows one card per connection, SELECT_ONLY for a select-only one and full access for the other', () => {
    const text = all(paneRows(model(), 100, 40))
    expect(text).toContain('demo')
    expect(text).toContain('writable')
    expect(text).toContain('SELECT_ONLY')
    expect(text).toContain('full access')
    expect(text.match(/SELECT_ONLY/g)).toHaveLength(1)
  })

  it('says the engine, the host, the tunnel, MCP configuration and when the schema was captured', () => {
    const captured = { ...CONNECTIONS[0]!, type: 'postgresql', host: 'db.internal', ssh: true, ssl: true, mcpConfigurable: true, schemaCapturedAt: '2000-01-01T00:00:00.000Z' }
    const text = all(paneRows(model({ connections: { ask: 1, phase: 'done', answer: [captured], failure: null } }), 100, 40))
    expect(text).toContain('postgresql')
    expect(text).toContain('db.internal')
    expect(text).toContain('SSH')
    expect(text).toContain('SSL')
    expect(text).toMatch(/MCP.*yes/)
    expect(text).toContain('3h ago')
    const fresh = all(paneRows(model(), 100, 40))
    expect(fresh).toContain('never')
  })

  it('stays within the width at every tier, and stands the cards side by side only when wide', () => {
    for (const columns of [40, 60, 79, 80, 100, 130, 131, 160, 200]) {
      const rows = paneRows(model(), columns, 40)
      for (const row of rows) expect(rowWidth(row), `${columns}: ${row.key}`).toBeLessThanOrEqual(columns)
    }
    const wide = lines(paneRows(model(), 160, 40))
    const besides = (l: string) => l.includes('▣ demo') && l.includes('▣ writable')
    expect(wide.some(besides)).toBe(true)
    const medium = lines(paneRows(model(), 100, 40))
    expect(medium.some(l => l.includes('▣ demo'))).toBe(true)
    expect(medium.some(besides)).toBe(false)
  })

  it('fills the height, the footer at the foot', () => {
    const { body, footer, pinned } = paneLayout(model(), 100, 40)
    expect(pinned).toBe(false)
    expect(body.length + footer.length).toBe(40)
  })

  it('pins the footer when the pane is too short', () => {
    expect(paneLayout(model(), 100, 12).pinned).toBe(true)
  })

  it('marks the connection the marker is on', () => {
    const rows = paneRows(model({}, { marker: { ...INITIAL_VIEW.marker, connections: 1 } }), 100, 40)
    const marked = rows.filter(r => r.tint !== undefined).map(r => lines([r])[0])
    expect(marked.length).toBeGreaterThan(0)
    expect(rows.find(r => r.segments.some(s => s.press?.id === 'row:1'))?.tint).toBeDefined()
    expect(rows.find(r => r.segments.some(s => s.press?.id === 'row:0'))?.tint).toBeUndefined()
  })

  it('says a read is on its way, and that no connection is configured', () => {
    expect(all(paneRows(model({ connections: { ask: 1, phase: 'loading', answer: null, failure: null } }), 100, 40))).toContain('reading connections')
    expect(all(paneRows(model({ connections: { ask: 1, phase: 'done', answer: [], failure: null } }), 100, 40))).toContain('no connections')
  })
})

describe('the chrome on every tab', () => {
  it('draws the title, the four tabs, the rule and the footer', () => {
    for (const tab of ['queries', 'schema', 'editor', 'connections'] as const) {
      const text = all(paneRows(model({}, { tab }), 100, 40))
      for (const name of ['Queries', 'Schema', 'Editor', 'Connections']) expect(text, tab).toContain(name)
      expect(text).toContain('argos')
      expect(text).toContain('~/work/config.ini')
    }
  })

  it('shows a failure as one dim line under the header', () => {
    const failure = 'argos: plugin not installed by argos install-plugin'
    const rows = paneRows(model({ connections: { ask: 1, phase: 'done', answer: null, failure } }), 100, 40)
    const at = rows.findIndex(r => lines([r])[0]!.includes(failure))
    expect(at).toBeGreaterThan(rows.findIndex(r => r.key === 'tabs'))
    expect(rows[at]!.segments.every(s => s.dim === true || s.text.trim() === '')).toBe(true)
    expect(rows.filter(r => lines([r])[0]!.includes(failure))).toHaveLength(1)
  })
})

describe('the windows the wheel scrolled', () => {
  it('are kept while the view stands, and let go once the tab or the marker moves', () => {
    const before: View = { ...INITIAL_VIEW, scroll: { history: 4 } }
    expect(withScrollsKept(before, { ...before }).scroll).toEqual({ history: 4 })
    expect(withScrollsKept(before, { ...before, db: 'x' }).scroll).toEqual({})
    expect(withScrollsKept(before, { ...before, tab: 'schema' }).scroll).toEqual({})
    expect(withScrollsKept(before, { ...before, marker: { ...before.marker, queries: 2 } }).scroll).toEqual({})
  })
})

const SCHEMA = JSON.parse(readFileSync(new URL('../../../tests/fixtures/pane-contract/schema.json', import.meta.url), 'utf8')) as SchemaView
const schemaModel = (over: Partial<PaneModel> = {}, view: Partial<View> = {}): PaneModel =>
  model({ schema: { db: 'demo', ask: 0, phase: 'done', answer: SCHEMA, failure: null }, ...over }, { tab: 'schema', db: 'demo', ...view })

describe('the Schema tab', () => {
  it('draws the tables, the selected table and its relations, with the keys for them', () => {
    const text = all(paneRows(schemaModel(), 100, 40))
    expect(text).toContain('Tables')
    expect(text).toContain('posts')
    expect(text).toContain('→ users.id')
    expect(text).toContain('Relations')
    for (const key of ['q: query', 'c: copy CREATE', 'f: filter', 'r: refresh', 'n: next connection']) expect(text, key).toContain(key)
  })

  it('follows the marker to the next table', () => {
    const text = all(paneRows(schemaModel({}, { marker: { ...INITIAL_VIEW.marker, schema: 1 } }), 100, 40))
    expect(text).toMatch(/── ≡ users/)
    expect(text).toContain('1 in · 0 out')
  })

  it('says the schema is being read, and the pill follows', () => {
    const loading = schemaModel({ schema: { db: 'demo', ask: 0, phase: 'loading', answer: null, failure: null } })
    const text = all(paneRows(loading, 100, 40))
    expect(text).toContain('reading the schema of demo…')
    expect(text).toContain('reading…')
    expect(text).not.toContain('q: query')
  })

  it('shows the age of the capture in the pill, warning when more than a day old', () => {
    expect(all(paneRows(schemaModel({ now: Date.parse('2000-01-01T03:00:00.000Z') }), 100, 40))).toContain('captured 3h ago')
    const old = paneLayout(schemaModel({ now: Date.parse('2000-01-03T03:00:00.000Z') }), 100, 40)
    const pill = old.body.flatMap(r => r.segments).find(sg => sg.text.includes('captured 2d ago'))
    expect(pill?.bg).toBe('warning')
  })

  it("puts a failure under the header, keeping the last schema", () => {
    const failed = schemaModel({ schema: { db: 'demo', ask: 1, phase: 'done', answer: SCHEMA, failure: 'database is locked' } })
    const text = all(paneRows(failed, 100, 40))
    expect(text).toContain('database is locked')
    expect(text).toContain('posts')
  })

  it('has nothing to read without a connection', () => {
    const none = schemaModel({ connections: { ask: 1, phase: 'done', answer: [], failure: null }, schema: null }, { db: null })
    expect(all(paneRows(none, 100, 40))).toContain('no connections to read a schema from')
  })

  it('stays within the width at every tier', () => {
    for (const columns of [40, 60, 79, 80, 100, 130, 131, 160]) for (const r of paneRows(schemaModel(), columns, 40)) expect(rowWidth(r), `${columns} ${r.key}`).toBeLessThanOrEqual(columns)
  })
})

const E = (id: string, over: Partial<JournalEntry> = {}): JournalEntry => ({ id, at: '2000-01-01T02:59:00.000Z', source: 'claude', database: 'demo', tool: 'sql_query', sql: `SELECT ${id}`, durationMs: 3, rowCount: 1, outcome: 'ok', spool: id, ...over })
const queriesModel = (marker: number, over: Partial<PaneModel> = {}): PaneModel =>
  model({ history: { ask: 1, phase: 'done', answer: [E('e1'), E('e2', { source: 'pane', tool: 'pane_query' })], more: false, failure: null }, pins: { ask: 1, phase: 'done', answer: [], failure: null }, ...over }, { tab: 'queries', marker: { ...INITIAL_VIEW.marker, queries: marker } })
const keysOf = (m: PaneModel) => lines(paneLayout(m, 120, 40).footer).join('\n')

describe('the Queries tab', () => {
  it('offers rerun, edit, pin and copy on any entry, and send only on the person\'s own', () => {
    const claude = keysOf(queriesModel(0))
    for (const key of ['r: rerun', 'e: open in Editor', 'p: pin', 'c: copy']) expect(claude).toContain(key)
    expect(claude).not.toContain('s: send')
    expect(keysOf(queriesModel(1))).toContain('s: send')
  })

  it('offers unpin on a pinned entry, and the result\'s pages when there are more rows', () => {
    const pins = { ask: 1, phase: 'done' as const, answer: [{ id: 'p1', name: null, database: 'demo', sql: 'SELECT e1', createdAt: '', lastJournalId: 'e1' }], failure: null }
    expect(keysOf(queriesModel(0, { pins }))).toContain('p: unpin')
    const page = { id: 'e1', fields: ['n'], rows: [[1]], total: 5, offset: 0, truncated: false }
    const paged = queriesModel(0, { result: { id: 'e1', offset: 0, phase: 'done', page, failure: null } })
    expect(keysOf(paged)).toContain('m: more rows')
    expect(keysOf(paged)).not.toContain('earlier rows')
  })

  it('draws the journal, the pill says reading until it lands, and a read that failed says why', () => {
    expect(all(paneRows(queriesModel(0), 120, 40))).toContain('SELECT e1')
    expect(all(paneRows(model({ history: null }, { tab: 'queries' }), 120, 40))).toContain('reading…')
    const failed = model({ history: { ask: 1, phase: 'done', answer: null, more: false, failure: 'journal unreadable' } }, { tab: 'queries' })
    expect(all(paneRows(failed, 120, 40))).toContain('journal unreadable')
    expect(all(paneRows(failed, 120, 40))).toContain('unavailable')
  })

  it('draws the result of the selected entry only', () => {
    const page = { id: 'e2', fields: ['n'], rows: [[7]], total: 1, offset: 0, truncated: false }
    const stale = queriesModel(0, { result: { id: 'e2', offset: 0, phase: 'done', page, failure: null } })
    expect(all(paneRows(stale, 120, 40))).toContain('reading the result…')
    expect(all(paneRows(queriesModel(1, { result: { id: 'e2', offset: 0, phase: 'done', page, failure: null } }), 120, 40))).toContain('1–1 of 1')
  })

  it('says the result is no longer kept when the spool was evicted', () => {
    const gone = queriesModel(0, { result: { id: 'e1', offset: 0, phase: 'done', page: null, failure: "No spooled result for 'e1'" } })
    expect(all(paneRows(gone, 120, 40))).toContain('result no longer kept — r to rerun')
  })
})

describe('a schema read for another connection', () => {
  it('is no answer for the connection now picked', () => {
    const stale = schemaModel({}, { db: 'shop' })
    const text = all(paneRows(stale, 120, 40))
    expect(text).not.toContain('posts')
    expect(text).toContain('reading the schema of shop…')
    expect(all(paneRows(schemaModel(), 120, 40))).toContain('captured')
    expect(all(paneRows(stale, 120, 40))).toContain('reading…')
  })
})

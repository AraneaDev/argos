import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import type { View } from '../../types'
import type { ConnectionView } from './contract'
import { INITIAL_VIEW, paneLayout, paneRows, withScrollsKept } from './layout'
import type { PaneModel } from './layout'
import { rowWidth } from './rows'
import type { Row } from './types'

const CONNECTIONS = JSON.parse(readFileSync(new URL('../../../tests/fixtures/pane-contract/connections.json', import.meta.url), 'utf8')) as ConnectionView[]
const NOW = Date.parse('2000-01-01T03:00:00.000Z')

const model = (over: Partial<PaneModel> = {}, view: Partial<View> = {}): PaneModel => ({
  config: '/home/tim/work/config.ini',
  connections: { ask: 1, phase: 'done', answer: CONNECTIONS, failure: null },
  view: { ...INITIAL_VIEW, tab: 'connections', ...view },
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
    expect(withScrollsKept(before, { ...before, db: 'x' }).scroll).toEqual({ history: 4 })
    expect(withScrollsKept(before, { ...before, tab: 'schema' }).scroll).toEqual({})
    expect(withScrollsKept(before, { ...before, marker: { ...before.marker, queries: 2 } }).scroll).toEqual({})
  })
})

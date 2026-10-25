import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import type { JournalEntry, Pin, SpoolPage } from './contract'
import { pinOf, queriesRows, RESULT_GONE } from './queries-view'
import type { QueriesModel } from './queries-view'
import { rowWidth } from './rows'
import { tierOf } from './table'
import type { Row } from './types'

const FIXTURE = JSON.parse(readFileSync(new URL('../../../tests/fixtures/pane-contract/history.json', import.meta.url), 'utf8')) as JournalEntry[]
const NOW = Date.parse('2000-01-01T00:05:00.000Z')

const lines = (rows: Row[]): string[] => rows.map(r => r.segments.filter(s => s.hidden !== true).map(s => s.text).join(''))
const all = (rows: Row[]): string => lines(rows).join('\n')

const claude = (id: string, over: Partial<JournalEntry> = {}): JournalEntry => ({ id, at: '2000-01-01T00:02:00.000Z', source: 'claude', database: 'shop', tool: 'sql_query', sql: 'SELECT id, email FROM customers', durationMs: 34, rowCount: 12, outcome: 'ok', spool: id, ...over })
const PAGE: SpoolPage = { id: 'c1', fields: ['id', 'email'], rows: [[1, 'a@x.io'], [2, null]], total: 2, offset: 0, truncated: false }
const PIN: Pin = { id: 'p1', name: 'customers', database: 'shop', sql: 'SELECT id, email FROM customers', createdAt: '2000-01-01T00:00:00.000Z', lastJournalId: 'c1' }

const model = (over: Partial<QueriesModel> = {}): QueriesModel => ({ pins: [], history: [claude('c1'), ...FIXTURE], selected: 0, result: PAGE, now: NOW, connections: 2, ...over })
const drawn = (m: QueriesModel, columns = 120, room = 40, scroll = {}) => queriesRows(m, columns, tierOf(columns), room, scroll)

describe('the history', () => {
  it('tags each row claude or you, with its outcome, connection and figures', () => {
    const text = all(drawn(model()))
    expect(text).toMatch(/✓\s+✻ claude\s+shop\s+SELECT id, email FROM customers\s+12 rows · 34ms · 3m/)
    expect(text).toMatch(/✗\s+❯ you\s+full/)
    expect(text).toContain('all sessions')
    expect(text).toContain('newest first')
  })

  it('draws a blocked row in the alert tone with its reason', () => {
    const rows = drawn(model({ selected: 2 }))
    const blocked = rows.find(r => r.key === 'history-2')!
    expect(lines([blocked])[0]).toContain('⊘')
    expect(lines([blocked])[0]).toContain('blocked: Multiple SQL statements are not allowed')
    expect(blocked.segments.some(s => s.color === 'error' && s.text.includes('blocked:'))).toBe(true)
  })

  it('marks the selected row, tints it, and makes its tag the press that selects it', () => {
    const rows = drawn(model({ selected: 1 }))
    const marked = rows.find(r => r.key === 'history-1')!
    expect(marked.tint).toBeDefined()
    expect(lines([marked])[0]).toContain('›')
    expect(marked.segments.find(s => s.press !== undefined)!.press!.id).toBe('row:1')
  })

  it('stars a pinned entry', () => {
    const text = lines(drawn(model({ pins: [PIN] }))).find(l => l.includes('claude'))!
    expect(text).toContain('★')
  })

  it('windows a long journal round the marker and counts the rest', () => {
    const many = Array.from({ length: 80 }, (_, i) => claude(`e${i}`))
    const text = all(drawn(model({ history: many, selected: 60 }), 120, 24))
    expect(text).toMatch(/\d+ more ↓/)
    expect(text).toMatch(/\d+ above ↑/)
  })
})

describe('the cards', () => {
  it('count the queries (and this session), pins, blocked entries and schema changes', () => {
    const changed = claude('c2', { schemaChange: [{ kind: 'column-added', table: 'orders', column: 'note', type: 'text' }] })
    const text = all(drawn(model({ history: [changed, claude('c1'), ...FIXTURE], pins: [PIN], since: Date.parse('2000-01-01T00:01:00.000Z') })))
    expect(text).toMatch(/queries · \+2 session/)
    expect(text).toContain('pinned')
    expect(text).toContain('blocked')
    expect(text).toContain('schema changes')
    expect(text).toContain('connections')
  })

  it('list the pins above the history', () => {
    const rows = lines(drawn(model({ pins: [PIN] })))
    const text = rows.join('\n')
    expect(text.indexOf('Pinned')).toBeGreaterThan(-1)
    expect(text.indexOf('Pinned')).toBeLessThan(text.indexOf('History'))
    expect(text).toContain('★ customers')
  })

  it('show the SQL wrapped, the schema change in the warn tone, and the grid', () => {
    const sql = `SELECT ${Array.from({ length: 40 }, (_, i) => `column_${i}`).join(', ')} FROM wide`
    const entry = claude('c1', { sql, schemaChange: [{ kind: 'table-added', table: 'audit' }, { kind: 'column-added', table: 'orders', column: 'note', type: 'text' }] })
    const rows = drawn(model({ history: [entry], result: PAGE }), 140)
    const text = all(rows)
    expect(text).toContain('Query')
    expect(text.match(/column_\d+/g)!.length).toBeGreaterThan(20)
    const change = rows.flatMap(r => r.segments).find(s => s.text.includes('schema changed:'))!
    expect(change.color).toBe('warning')
    expect(change.text).toContain('audit added, orders.note added')
    expect(text).toContain('a@x.io')
    expect(text).toMatch(/NULL/)
    expect(text).toContain('1–2 of 2')
  })

  it('say the result is no longer kept when the entry ran but its spool is gone', () => {
    const text = all(drawn(model({ history: [claude('c1', { spool: null })], result: null })))
    expect(text).toContain(RESULT_GONE)
  })

  it('say there is no result for an entry that was refused, and show why in the query card', () => {
    const text = all(drawn(model({ history: FIXTURE, selected: 1, result: null, resultNote: 'no result' })))
    expect(text).toContain('no result')
    expect(text).toContain('Multiple SQL statements')
  })

  it('draw an empty journal as one line', () => {
    expect(all(drawn(model({ history: [], result: null })))).toContain('no queries yet')
  })

  it('stay within the width at every size', () => {
    for (const columns of [40, 60, 80, 100, 130, 160]) for (const row of drawn(model({ pins: [PIN] }), columns)) expect(rowWidth(row), `${columns} ${row.key}`).toBeLessThanOrEqual(columns)
  })
})

describe('pinOf', () => {
  it('finds the pin of the entry by its last run or by its SQL on the same connection', () => {
    expect(pinOf([PIN], claude('c1'))?.id).toBe('p1')
    expect(pinOf([{ ...PIN, lastJournalId: null }], claude('other'))?.id).toBe('p1')
    expect(pinOf([{ ...PIN, lastJournalId: null, database: 'other' }], claude('other'))).toBeUndefined()
    expect(pinOf([PIN], undefined)).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'

import { pageAs, sendText, toCsv, toJson, toMarkdown } from './clip'
import type { JournalEntry, SpoolPage } from './contract'

const page = (fields: string[], rows: unknown[][], over: Partial<SpoolPage> = {}): SpoolPage => ({ id: 'x', fields, rows, total: rows.length, offset: 0, truncated: false, ...over })
const entry = (over: Partial<JournalEntry> = {}): JournalEntry => ({ id: 'e1', at: '2026-01-01T00:00:00Z', source: 'pane', database: 'shop', tool: 'pane_query', sql: 'select 1', durationMs: 1, rowCount: 1, outcome: 'ok', spool: 'e1', ...over })

describe('a page as text to copy', () => {
  const p = page(['id', 'note'], [[1, 'a|b'], [2, null], [3, 'say "hi", ok'], [4, 'two\nlines']])
  it('markdown: a table with the pipes escaped and null as NULL', () => {
    expect(toMarkdown(p, Infinity, Infinity)).toBe(['| id | note |', '| --- | --- |', '| 1 | a\\|b |', '| 2 | NULL |', '| 3 | say "hi", ok |', '| 4 | two lines |'].join('\n'))
  })
  it('CSV: quoted where a value holds a comma, a quote or a newline, null empty', () => {
    expect(toCsv(p)).toBe(['id,note', '1,a|b', '2,', '3,"say ""hi"", ok"', '4,"two\nlines"'].join('\n'))
  })
  it('JSON: an array of objects, whole values', () => {
    expect(JSON.parse(toJson(p))).toEqual([{ id: 1, note: 'a|b' }, { id: 2, note: null }, { id: 3, note: 'say "hi", ok' }, { id: 4, note: 'two\nlines' }])
    expect(toJson(page(['n'], [['x'.repeat(10_000)]]))).toContain('x'.repeat(10_000))
  })
  it('pageAs picks the format', () => {
    expect(pageAs(p, 'CSV')).toBe(toCsv(p))
  })
  it('markdown cut by rows or characters says how many rows are left out', () => {
    expect(toMarkdown(p, 2, Infinity).split('\n').slice(-2)).toEqual(['| 2 | NULL |', '… 2 more rows'])
    const wide = page(['t'], Array.from({ length: 20 }, () => ['x'.repeat(100)]))
    const cut = toMarkdown(wide, 50, 500)
    expect(cut.length).toBeLessThanOrEqual(520)
    expect(cut).toMatch(/… \d+ more rows$/)
  })
})

describe('what is sent to Claude', () => {
  it('fences the SQL, names the connection, and ends a 120-row table with the rows left out', () => {
    const rows = Array.from({ length: 120 }, (_, i) => [i])
    const text = sendText(entry({ sql: 'select n from t' }), page(['n'], rows))
    expect(text.startsWith('```sql\nselect n from t\n```\nConnection: shop\n')).toBe(true)
    expect(text.endsWith('… 70 more rows')).toBe(true)
    expect(text.split('\n').filter(l => /^\| \d+ \|$/.test(l))).toHaveLength(50)
  })
  it('counts rows the page did not load', () => {
    expect(sendText(entry(), page(['n'], [[1], [2]], { total: 10 })).endsWith('… 8 more rows')).toBe(true)
  })
  it('says why a refused query has no rows', () => {
    expect(sendText(entry({ outcome: 'blocked', reason: 'not a SELECT', sql: 'drop table t' }), null)).toContain('Result: blocked — not a SELECT')
  })
})

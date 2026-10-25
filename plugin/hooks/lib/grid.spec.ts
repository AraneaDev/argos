import { describe, expect, it } from 'vitest'

import type { SpoolPage } from './contract'
import { gridRows, gridWindow } from './grid'
import { rowWidth } from './rows'
import type { Row } from './types'

const lines = (rows: Row[]): string[] => rows.map(r => r.segments.map(s => s.text).join(''))
const page = (fields: string[], rows: unknown[][], over: Partial<SpoolPage> = {}): SpoolPage => ({ id: 'x', fields, rows, total: rows.length, offset: 0, truncated: false, ...over })

describe('the grid', () => {
  it('keeps a row of 40 columns within a width of 100 cells', () => {
    const fields = Array.from({ length: 40 }, (_, i) => `column_${i}`)
    const rows = gridRows(page(fields, [fields.map((_, i) => `value number ${i}`), fields.map(() => 12345)]), 100, 10)
    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows) expect(rowWidth(row), row.key).toBeLessThanOrEqual(100)
  })

  it('clips a 10,000-character cell with an ellipsis', () => {
    const rows = gridRows(page(['note'], [['x'.repeat(10_000)]]), 100, 10)
    const cell = lines(rows)[1]!
    expect(cell.endsWith('…')).toBe(true)
    expect(rowWidth(rows[1]!)).toBeLessThanOrEqual(100)
  })

  it('sizes a column to its header and values, draws null as dim NULL, and right-aligns numbers', () => {
    const rows = gridRows(page(['id', 'name'], [[1, 'ada'], [22, null]]), 60, 10)
    expect(lines(rows)).toEqual(['id name', ' 1 ada ', '22 NULL'])
    const nulls = rows[2]!.segments.filter(s => s.text.startsWith('NULL'))
    expect(nulls.every(s => s.dim === true)).toBe(true)
  })

  it('shows a redacted value as the adapter wrote it, and an object as JSON on one line', () => {
    const text = lines(gridRows(page(['pw', 'doc'], [['[REDACTED]', { a: 1, b: 'x\ny' }]]), 80, 5)).join('\n')
    expect(text).toContain('[REDACTED]')
    expect(text).toContain('{"a":1,"b":"x\\ny"}')
  })

  it('windows the rows from the scroll and counts the rest, in the room it has', () => {
    const rows = Array.from({ length: 30 }, (_, i) => [i])
    const p = page(['n'], rows)
    expect(gridWindow(p, 6, 0)).toEqual({ start: 0, shown: 4, length: 30 })
    expect(gridWindow(p, 6, 99)).toEqual({ start: 26, shown: 4, length: 30 })
    const drawn = lines(gridRows(p, 40, 6, 10))
    expect(drawn).toHaveLength(6)
    expect(drawn[1]).toBe('10')
    expect(drawn[5]).toContain('10 above ↑')
    expect(drawn[5]).toContain('16 more ↓')
    expect(lines(gridRows(page(['n'], [[1], [2]]), 20, 6))).toHaveLength(3)
  })

  it('leaves off the columns that cannot keep a few cells, and says so', () => {
    const fields = Array.from({ length: 30 }, (_, i) => `c${i}`)
    const rows = gridRows(page(fields, [fields.map(() => 1)]), 30, 5)
    for (const row of rows) expect(rowWidth(row)).toBeLessThanOrEqual(30)
    expect(lines(rows).join('\n')).toMatch(/\+\d+ more columns/)
  })
})

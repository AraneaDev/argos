import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import type { SchemaView, TableInfo } from './contract'
import { tierOf } from './table'
import { filteredList, schemaRows, sketchOf, sqlOf } from './schema-view'
import type { Row } from './types'

const FIXTURE = JSON.parse(readFileSync(new URL('../../../tests/fixtures/pane-contract/schema.json', import.meta.url), 'utf8')) as SchemaView

const lines = (rows: Row[]): string[] => rows.map(r => r.segments.filter(s => s.hidden !== true).map(s => s.text).join(''))
const all = (rows: Row[]): string => lines(rows).join('\n')

const column = (name: string, type: string, over: Partial<TableInfo['columns'][number]> = {}): TableInfo['columns'][number] => ({ name, type, nullable: false, default: null, key: '', ...over })

/** orders -> customers; customers has 18,402 rows; both changed by the last check. */
const SHOP: SchemaView = {
  database: 'shop',
  type: 'postgresql',
  capturedAt: '2000-01-01T00:00:00.000Z',
  tables: [
    { name: 'customers', type: 'table', columns: [column('id', 'bigint', { key: 'PRI' }), column('email', 'text', { nullable: true, default: "''" })], primary_key: ['id'], foreign_keys: [], row_estimate: 18402 },
    {
      name: 'orders',
      type: 'table',
      columns: [column('id', 'bigint', { key: 'PRI' }), column('customer_id', 'bigint'), column('note', 'text', { nullable: true })],
      primary_key: ['id'],
      foreign_keys: [{ column: 'customer_id', references: { table: 'customers', column: 'id' } }],
      row_estimate: 120,
    },
    { name: 'audit', type: 'table', columns: [column('id', 'bigint', { key: 'PRI' }), column('customer_id', 'bigint')], primary_key: ['id'], foreign_keys: [{ column: 'customer_id', references: { table: 'customers', column: 'id' } }], row_estimate: null },
  ],
  views: [{ name: 'recent', type: 'view', columns: [column('id', 'bigint')] }],
  lastChange: [
    { kind: 'column-added', table: 'orders', column: 'note', type: 'text' },
    { kind: 'table-added', table: 'audit' },
  ],
}

const drawn = (view: SchemaView, selected: number, columns = 120, room = 40, options = {}) => schemaRows(view, selected, columns, tierOf(columns), room, {}, options)

describe('the tables list', () => {
  it('lists each table with its estimate in groups of three and marks the changed ones', () => {
    const text = all(drawn(SHOP, 0))
    expect(text).toContain('Tables')
    expect(text).toContain('rows est.')
    expect(text).toMatch(/customers\s+18,402/)
    expect(text).toMatch(/orders\s+120/)
    expect(text).toMatch(/audit\s+● changed/)
    expect(text.match(/● changed/g)).toHaveLength(2)
  })

  it('marks the selected table and shows its columns', () => {
    const rows = lines(drawn(SHOP, 1))
    expect(rows.some(r => r.includes('›') && r.includes('orders'))).toBe(true)
    expect(all(drawn(SHOP, 1))).toMatch(/customer_id/)
  })

  it('shows PK on the key column and the reference on a foreign key', () => {
    const text = lines(drawn(SHOP, 1))
    expect(text.find(r => /\bid\b/.test(r) && r.includes('PK'))).toBeDefined()
    const fk = text.find(r => r.includes('customer_id') && r.includes('FK'))
    expect(fk).toContain('bigint → customers.id')
  })

  it('marks a column the last check added with + and shows null and default', () => {
    const text = lines(drawn(SHOP, 1))
    expect(text.find(r => r.includes('note') && r.includes('+'))).toBeDefined()
    expect(text.find(r => /\bid\b/.test(r) && r.includes('PK'))).toContain('not null')
    const customers = lines(drawn(SHOP, 0))
    expect(customers.find(r => r.includes('email'))).toMatch(/null.*''/)
  })

  it('reads the real fixture: PK on id, → users.id on posts.user_id', () => {
    const posts = lines(drawn(FIXTURE, 0))
    expect(posts.find(r => /\bid\b/.test(r) && r.includes('PK'))).toBeDefined()
    expect(posts.find(r => r.includes('user_id'))).toContain('→ users.id')
  })
})

describe('relations', () => {
  it('counts those in and out and lists both directions', () => {
    const customers = all(drawn(SHOP, 0))
    expect(customers).toContain('Relations')
    expect(customers).toContain('2 in · 0 out')
    expect(customers).toMatch(/orders\.customer_id/)
    expect(customers).toMatch(/audit\.customer_id/)
    const orders = all(drawn(SHOP, 1))
    expect(orders).toContain('0 in · 1 out')
    expect(orders).toMatch(/customer_id\s+→\s+customers\.id/)
  })

  it('collapses to one line when the table has none', () => {
    const text = all(drawn(SHOP, 3))
    expect(text).toContain('0 in · 0 out')
  })
})

describe('cards', () => {
  it('shows the engine with its tunnel, tables, views, columns and changed tables', () => {
    const text = all(drawn(SHOP, 0, 120, 40, { tunnel: 'SSH' }))
    const rows = text.split('\n')
    const figures = rows.findIndex(r => r.includes('postgresql'))
    expect(figures).toBeGreaterThan(-1)
    expect(rows[figures]!.split('│').map(c => c.trim()).filter(c => c !== '')).toEqual(['postgresql', '3', '1', '8', '2'])
    expect(rows[figures + 1]!.split('│').map(c => c.trim()).filter(c => c !== '')).toEqual(['SSH', 'tables', 'view', 'columns', 'changed'])
  })
})

describe('long lists', () => {
  const many: SchemaView = { ...SHOP, tables: Array.from({ length: 60 }, (_, i) => ({ name: `t${String(i).padStart(2, '0')}`, type: 'table', columns: [column('id', 'int', { key: 'PRI' })], row_estimate: i })), views: [], lastChange: null }

  it('windows the list at 30 rows and says how many more', () => {
    const text = all(drawn(many, 0, 120, 30))
    expect(text).toMatch(/\d+ more ↓/)
    expect(text).toContain('t00')
    expect(text).not.toContain('t59')
  })

  it('follows the marker down, and the wheel (scroll) moves the window', () => {
    expect(all(drawn(many, 59, 120, 30))).toContain('t59')
    const scrolled = schemaRows(many, 0, 120, tierOf(120), 30, { tables: 40 }, {})
    expect(all(scrolled)).toContain('t40')
    expect(all(scrolled)).not.toContain('t01')
    expect(scrolled.some(r => r.lists?.some(l => l.key === 'tables'))).toBe(true)
  })

  it('stays within the width and the room', () => {
    for (const columns of [40, 60, 80, 100, 160]) {
      const rows = drawn(many, 5, columns, 30)
      for (const r of rows) expect(r.segments.reduce((n, s) => n + [...s.text].length, 0)).toBeLessThanOrEqual(columns)
    }
  })
})

describe('tiers', () => {
  const widthOf = (r: Row) => r.segments.reduce((n, s) => n + [...s.text].length, 0)

  it('narrow stacks the blocks in one column', () => {
    const rows = lines(drawn(SHOP, 1, 40, 60))
    const at = (word: string) => rows.findIndex(r => r.includes(word))
    expect(at('Tables')).toBeGreaterThanOrEqual(0)
    expect(at('orders')).toBeGreaterThan(-1)
    expect(at('Relations')).toBeGreaterThan(at('Tables'))
    for (const r of drawn(SHOP, 1, 40, 60)) expect(widthOf(r)).toBeLessThanOrEqual(40)
  })

  it('wide puts the table list beside the columns', () => {
    const rows = lines(drawn(SHOP, 1, 160, 40))
    expect(rows.some(r => r.includes('Tables') && r.includes('orders'))).toBe(true)
  })
})

describe('the filter', () => {
  it('narrows the list to names that contain the text and says how many', () => {
    expect(filteredList(SHOP, 'CUST').map(t => t.name)).toEqual(['customers'])
    const text = all(drawn(SHOP, 0, 120, 40, { filter: 'order' }))
    expect(text).toContain('filter "order"')
    expect(text).toContain('1 of 4')
    expect(text).not.toMatch(/customers\s+18,402/)
  })

  it('draws the filter field while it is open', () => {
    const rows = drawn(SHOP, 0, 120, 40, { filter: '', filtering: true })
    expect(rows.flatMap(r => r.segments).some(s => s.field?.id === 'filter')).toBe(true)
  })

  it('lists tables then views', () => {
    expect(filteredList(SHOP, '').map(t => t.name)).toEqual(['customers', 'orders', 'audit', 'recent'])
  })
})

describe('the Editor and clipboard texts', () => {
  it('selects 100 rows, with TOP for mssql', () => {
    expect(sqlOf('orders', 'postgresql')).toBe('SELECT * FROM orders LIMIT 100')
    expect(sqlOf('orders', 'mssql')).toBe('SELECT TOP 100 * FROM orders')
  })

  it('sketches a CREATE TABLE from the captured columns', () => {
    const sketch = sketchOf(SHOP.tables[1]!)
    expect(sketch).toContain('CREATE TABLE orders (')
    expect(sketch).toContain('id bigint NOT NULL')
    expect(sketch).toContain('note text')
    expect(sketch).toContain('PRIMARY KEY (id)')
    expect(sketch).toContain('FOREIGN KEY (customer_id) REFERENCES customers (id)')
  })
})

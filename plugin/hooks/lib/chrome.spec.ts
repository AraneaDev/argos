import { describe, expect, it } from 'vitest'

import { footerRows, homeShort, TAB_BG, TABS, tabRows, titleRow } from './chrome'
import type { ConnectionView } from './contract'
import { CHIP_BG, ENGINE_COLOURS } from './palette'
import { rowWidth } from './rows'
import { tierOf } from './table'
import type { Row } from './types'

const conn = (name: string, type: string): ConnectionView => ({ name, type, host: null, ssh: false, ssl: false, selectOnly: true, mcpConfigurable: false, schemaCapturedAt: null })
const CONNECTIONS = [conn('shop', 'postgresql'), conn('crm', 'mysql'), conn('local', 'sqlite')]
const PILL = { text: 'read-only pane', tone: 'ok' } as const

const text = (row: Row): string => row.segments.map(s => s.text).join('')
const title = (columns: number, config: string | null = '~/work/config.ini', tier = tierOf(columns)) => titleRow({ connections: CONNECTIONS, pill: PILL, config }, columns, tier)

describe('the title row', () => {
  it('names argos in bold, the config dim, a chip per connection in its engine colour, the gauge and the pill', () => {
    const row = title(160)
    expect(row.segments[0]).toMatchObject({ text: 'argos', bold: true })
    expect(row.segments.find(s => s.text.includes('~/work/config.ini'))?.dim).toBe(true)
    const shop = row.segments.find(s => s.text === ' shop ')
    expect(shop).toMatchObject({ color: ENGINE_COLOURS.postgresql, bg: CHIP_BG })
    expect(row.segments.find(s => s.text === ' crm ')?.color).toBe(ENGINE_COLOURS.mysql)
    expect(text(row)).toContain('wide')
    expect(text(row)).toContain(' read-only pane ')
    expect(rowWidth(row)).toBe(160)
  })

  it('gives up the gauge first, then the chips, then the config, as the room shrinks', () => {
    const widths = Array.from({ length: 140 }, (_, i) => 160 - i)
    const has = (columns: number) => {
      const t = text(title(columns, '~/work/config.ini', 'medium'))
      return { gauge: /▮|\d+ · (narrow|medium|wide)/.test(t), chips: t.includes(' shop '), config: t.includes('config.ini') }
    }
    const lostGauge = widths.find(w => !has(w).gauge)!
    const lostChips = widths.find(w => !has(w).chips)!
    const lostConfig = widths.find(w => !has(w).config)!
    expect(lostGauge).toBeGreaterThan(lostChips)
    expect(lostChips).toBeGreaterThanOrEqual(lostConfig)
    expect(has(lostGauge).chips).toBe(true)
    for (const w of widths) expect(rowWidth(title(w)), `${w}`).toBeLessThanOrEqual(w)
  })

  it('leaves the chips and the config out on a narrow pane, keeping the gauge while it fits', () => {
    const t = text(title(70))
    expect(t).not.toContain(' shop ')
    expect(t).not.toContain('config.ini')
    expect(t).toContain('narrow')
  })

  it('keeps argos and the pill on a narrow pane', () => {
    const t = text(title(40))
    expect(t).toContain('argos')
    expect(t).toContain('read-only pane')
  })

  it('colours the pill by its tone', () => {
    const pill = (tone: 'ok' | 'warn' | 'accent') => titleRow({ connections: [], pill: { text: 'x', tone } }, 100, 'medium').segments.find(s => s.text === ' x ')
    expect(pill('ok')?.bg).toBe('success')
    expect(pill('warn')?.bg).toBe('warning')
    expect(pill('accent')?.bg).toBe('suggestion')
  })
})

describe('the home directory, shortened', () => {
  it('writes ~ for a home directory', () => {
    expect(homeShort('/home/tim/work/config.ini')).toBe('~/work/config.ini')
    expect(homeShort('/Users/ann/config.ini')).toBe('~/config.ini')
    expect(homeShort('/root/config.ini')).toBe('~/config.ini')
    expect(homeShort('/etc/argos/config.ini')).toBe('/etc/argos/config.ini')
    expect(homeShort('/homeless/config.ini')).toBe('/homeless/config.ini')
  })
})

describe('the tab bar', () => {
  it('lists Queries, Schema, Editor and Connections on 1 to 4', () => {
    expect(TABS.map(t => [t.full, t.hotkey])).toEqual([
      ['Queries', '1'],
      ['Schema', '2'],
      ['Editor', '3'],
      ['Connections', '4'],
    ])
  })

  it('marks the active tab with TAB_BG and dims the rest', () => {
    const [row] = tabRows('connections', 100, true)
    const on = row!.segments.find(s => s.press?.id === 'tab:connections')
    expect(on?.bg).toBe(TAB_BG)
    const off = row!.segments.find(s => s.press?.id === 'tab:queries')
    expect(off?.bg).toBeUndefined()
    expect(off?.dim).toBe(true)
  })

  it('carries each hotkey on a hidden twin', () => {
    const [row] = tabRows('queries', 100, true)
    const twins = row!.segments.filter(s => s.hidden === true).map(s => [s.press?.id, s.press?.hotkey])
    expect(twins).toEqual([
      ['tabkey:queries', '1'],
      ['tabkey:schema', '2'],
      ['tabkey:editor', '3'],
      ['tabkey:connections', '4'],
    ])
  })

  it('names only the active tab when the names do not fit', () => {
    const [row] = tabRows('schema', 30, true)
    const t = text(row!)
    expect(t).toContain('Schema')
    expect(t).not.toContain('Queries')
    expect(rowWidth(row!)).toBeLessThanOrEqual(30)
  })
})

describe('the footer bar', () => {
  it('draws each key as a button across the pane, on the bar ground', () => {
    const rows = footerRows([{ id: 'down', hotkey: 'j', label: '↓', move: true }, { id: 'up', hotkey: 'k', label: '↑', move: true }, { id: 'copy', hotkey: 'c', label: 'copy' }], 80)
    expect(rows).toHaveLength(1)
    const presses = rows[0]!.segments.filter(s => s.press !== undefined).map(s => [s.press!.id, s.press!.hotkey])
    expect(presses).toEqual([
      ['down', 'j'],
      ['up', 'k'],
      ['copy', 'c'],
    ])
    expect(rowWidth(rows[0]!)).toBe(80)
    expect(rows[0]!.segments.every(s => s.bg !== undefined || s.hidden === true)).toBe(true)
  })

  it('wraps rather than drop a key on a narrow pane', () => {
    const keys = Array.from({ length: 8 }, (_, i) => ({ id: `k${i}`, hotkey: String(i), label: `action ${i}` }))
    const rows = footerRows(keys, 30)
    expect(rows.length).toBeGreaterThan(1)
    expect(rows.flatMap(r => r.segments).filter(s => s.press !== undefined)).toHaveLength(8)
    for (const r of rows) expect(rowWidth(r)).toBeLessThanOrEqual(30)
  })
})

describe('the gauge in the title row', () => {
  it('is drawn whole on a wide pane, short on a narrower one before it goes', () => {
    expect(text(title(160))).toContain('▮')
    const widths = Array.from({ length: 120 }, (_, i) => 160 - i)
    expect(widths.some(w => /\d+ · (medium|wide)/.test(text(title(w))))).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { ACCENT, ENGINE_COLOURS, ENGINE_HUES, FAINT, HEADING, SECONDARY, STAT_HUES, STATUS_COLOURS, TITLE, boundaryColour, boundaryLabel, engineColour, heat } from './palette'
import { THEMES } from './themes'

describe('engineColour', () => {
  it('gives each of the four engines a chip hue of its own, none a status colour', () => {
    expect(Object.keys(ENGINE_COLOURS).sort()).toEqual(['mssql', 'mysql', 'postgresql', 'sqlite'])
    const hues = Object.keys(ENGINE_COLOURS).map(engine => engineColour(engine))
    expect(hues.every(h => h !== undefined)).toBe(true)
    expect(new Set(hues).size).toBe(4)
    for (const status of Object.values(STATUS_COLOURS)) expect(hues).not.toContain(status)
    expect(hues).not.toContain(ACCENT)
  })
  it('leaves a name that is no engine uncoloured, even one named like an Object.prototype member', () => {
    for (const odd of [null, undefined, '', 'oracle', 'constructor', 'toString', '__proto__']) expect(engineColour(odd), String(odd)).toBeUndefined()
  })
  it('is the colour a chip is drawn with when given the engine hues', () => {
    expect(boundaryColour('mysql', ENGINE_HUES)).toBe(ENGINE_COLOURS.mysql)
    expect(boundaryColour('mysql')).toBeUndefined()
    expect(boundaryColour(null, ENGINE_HUES)).toBeUndefined()
    expect(boundaryColour('', ENGINE_HUES)).toBeUndefined()
  })
  it('prints a chip name as written, and nothing for none', () => {
    expect(boundaryLabel('postgresql')).toBe('postgresql')
    expect(boundaryLabel(null)).toBe('')
    expect(boundaryLabel(undefined)).toBe('')
  })
})

describe('theme keys', () => {
  it('draws every colour as a Claude Code theme key, never a raw colour', () => {
    const keys = [ACCENT, HEADING, SECONDARY, FAINT, ...Object.values(STATUS_COLOURS), ...Object.values(ENGINE_COLOURS)]
    for (const key of keys) expect(key).toMatch(/^[a-zA-Z_]+$/)
    expect(STATUS_COLOURS).toEqual({ ok: 'success', warn: 'warning', alert: 'error' })
  })
})

describe('the livelier look', () => {
  it('titles cards in the orange Claude Code marks itself with', () => {
    expect(TITLE).toBe('claude')
  })

  it('shades buckets cool to hot: the first in the suggestion blue, the last in the error colour, never cooler further on', () => {
    expect(heat(0, 5)).toBe(ACCENT)
    expect(heat(4, 5)).toBe(STATUS_COLOURS.alert)
    const order = [ACCENT, STATUS_COLOURS.ok, STATUS_COLOURS.warn, STATUS_COLOURS.alert]
    for (let i = 1; i < 9; i++) expect(order.indexOf(heat(i, 9))).toBeGreaterThanOrEqual(order.indexOf(heat(i - 1, 9)))
    expect(heat(0, 1)).toBe(ACCENT)
  })
})

describe('STAT_HUES', () => {
  it('colours no tile in an engine hue, the accent or a warning colour', () => {
    const hues: string[] = Object.values(STAT_HUES)
    for (const engine of Object.values(ENGINE_COLOURS)) expect(hues).not.toContain(engine)
    expect(hues).not.toContain(ACCENT)
    expect(hues).not.toContain(STATUS_COLOURS.warn)
    expect(hues).not.toContain(STATUS_COLOURS.alert)
  })
})

describe('STAT_HUES in the themes', () => {
  it('names only theme keys both themes define', () => {
    for (const hue of Object.values(STAT_HUES)) {
      expect(THEMES.dark[hue], hue).toBeDefined()
      expect(THEMES.light[hue], hue).toBeDefined()
    }
  })
})

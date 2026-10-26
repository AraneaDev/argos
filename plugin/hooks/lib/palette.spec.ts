import { describe, expect, it } from 'vitest'
import { ACCENT, ENGINE_COLOURS, FAINT, HEADING, SECONDARY, STAT_HUES, STATUS_COLOURS, TITLE, engineColour } from './palette'
import { THEMES } from './__tests__/themes'

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

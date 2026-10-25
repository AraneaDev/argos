import { describe, expect, it } from 'vitest'
import * as palette from './palette'
import { THEMES, themeColour } from './themes'

/** Every theme key the pane can colour a segment with: palette.ts's constants and tables, each engine chip (from palette.ts's own table, so an engine added there needs a web colour), and the diff and page grounds. */
function paneKeys(): string[] {
  const keys = new Set<string>()
  for (const value of Object.values(palette)) {
    if (typeof value === 'string') keys.add(value)
    else if (Array.isArray(value)) value.forEach(v => keys.add(v as string))
    else if (value !== null && typeof value === 'object' && !(value instanceof Map)) Object.values(value).forEach(v => keys.add(v as string))
  }
  for (const engine of Object.keys(palette.ENGINE_COLOURS)) keys.add(palette.engineColour(engine)!)
  for (const key of ['diffAdded', 'diffRemoved', 'diffAddedWord', 'diffRemovedWord', 'selectionBg', 'background']) keys.add(key)
  return [...keys]
}

describe('THEMES', () => {
  it('gives every key the pane emits a colour in both themes', () => {
    const keys = paneKeys()
    expect(keys).toContain('claude')
    expect(keys).toContain('permission')
    for (const theme of ['dark', 'light'] as const) {
      for (const key of keys) expect(themeColour(key, theme), `${theme}.${key}`).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
  it('holds Claude Code values as #rrggbb', () => {
    expect(THEMES.dark.text).toBe('#ffffff')
    expect(THEMES.light.error).toBe('#ab2b3f')
    for (const theme of Object.values(THEMES)) for (const value of Object.values(theme)) expect(value).toMatch(/^#[0-9a-f]{6}$/)
  })
  it('passes a raw colour through and knows no other', () => {
    expect(themeColour('#7aa2f7', 'light')).toBe('#7aa2f7')
    expect(themeColour('nonsense', 'dark')).toBeUndefined()
    expect(themeColour(undefined, 'dark')).toBeUndefined()
  })
  it("gives each theme the ground the pane is drawn on: the terminal's, which the raster's heat steps start from", () => {
    expect(THEMES.dark.ground).toBe('#1e1e1e')
    expect(THEMES.light.ground).toBe('#ffffff')
  })
})

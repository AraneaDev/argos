import { describe, expect, it } from 'vitest'
import { CARD_ICON, KEY, OUTCOME, PLACE, SEVERITY, SHARED, SOURCE, mark, signed } from './marks'
import { ACCENT, STATUS_COLOURS } from './palette'

const families = { SEVERITY, PLACE, SOURCE, OUTCOME, KEY }

describe('the mark registry', () => {
  it('gives each glyph one meaning, apart from the overlaps that mean the same', () => {
    const byGlyph = new Map<string, Set<string>>()
    for (const family of Object.values(families)) for (const m of Object.values(family)) byGlyph.set(m.glyph, new Set([...(byGlyph.get(m.glyph) ?? []), m.meaning]))
    for (const [glyph, meanings] of byGlyph) if (!SHARED.includes(glyph)) expect([...meanings], glyph).toHaveLength(1)
  })

  it('never uses a card icon as a row mark, apart from the overlaps', () => {
    const marks = new Set(Object.values(families).flatMap(f => Object.values(f).map(m => m.glyph)))
    for (const [card, icon] of Object.entries(CARD_ICON)) if (!SHARED.includes(icon)) expect(marks.has(icon), `${card} ${icon}`).toBe(false)
  })

  it('colours a mark by its tone and never by colour alone', () => {
    expect(mark(SEVERITY.error)).toEqual({ text: '✗', color: STATUS_COLOURS.alert })
    expect(mark(SEVERITY.warn, ' ')).toEqual({ text: '▲ ', color: STATUS_COLOURS.warn })
    expect(mark(SEVERITY.note)).toEqual({ text: '◦', dim: true })
    expect(mark(SOURCE.you)).toEqual({ text: '❯' })
    expect(mark(PLACE.centre)).toEqual({ text: '◉', color: ACCENT })
  })

  it('writes a delta as a signed number', () => {
    expect(signed(3)).toBe('+3')
    expect(signed(-2)).toBe('−2')
    expect(signed(0)).toBe('±0')
    expect(signed(1234)).toBe('+1,234')
  })
})

describe('the Argos marks', () => {
  it('tells who ran a query', () => {
    expect(mark(SOURCE.claude)).toEqual({ text: '✻', color: ACCENT })
    expect(mark(SOURCE.you).text).toBe('❯')
    expect(Object.keys(SOURCE)).toEqual(['claude', 'you'])
  })
  it('tells how a query ended, each in its own tone', () => {
    expect(mark(OUTCOME.ok)).toEqual({ text: '✓', color: STATUS_COLOURS.ok })
    expect(mark(OUTCOME.blocked)).toEqual({ text: '⊘', color: STATUS_COLOURS.warn })
    expect(mark(OUTCOME.error)).toEqual({ text: '✗', color: STATUS_COLOURS.alert })
  })
  it('marks keys and a new column', () => {
    expect(mark(KEY.primary).text).toBe('PK')
    expect(mark(KEY.foreign).text).toBe('FK')
    expect(mark(KEY.added)).toEqual({ text: '+', color: STATUS_COLOURS.ok })
  })
  it('gives the new cards their icons', () => {
    expect(CARD_ICON).toMatchObject({ pinned: '★', history: '≡', result: '◇', tables: '▦', relations: '⇄', query: '›_' })
  })
})

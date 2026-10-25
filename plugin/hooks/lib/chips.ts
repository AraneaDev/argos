/**
 * A chip drawn beside a name (an engine, in Argos): as a chip (a swatch in its colour, then
 * its label in a text tone) or as the style its things are drawn in. Pure;
 * nothing here reads state.
 */
import { boundaryColour, boundaryLabel, FAINT, NO_HUES } from './palette'
import type { Hues } from './palette'
import { PLACE } from './marks'
import { fit } from './text'
import type { Segment } from './types'

/** The swatch a boundary chip starts with: one cell in the boundary's colour. */
export const SWATCH = PLACE.swatch.glyph

/**
 * A boundary as a chip: a swatch in its colour (the faint ink for a boundary
 * without one), then its label in a text tone, never in the colour itself.
 * `width` cuts the label so the chip takes at most that many cells; `tone`
 * is the label's (dim by default).
 */
export function chip(boundary: string | null, hues: Hues = NO_HUES, width = Number.POSITIVE_INFINITY, tone: Pick<Segment, 'color' | 'dim'> = { dim: true }): Segment[] {
  if (boundary === null) return []
  const colour = boundaryColour(boundary, hues)
  const label = boundaryLabel(boundary, hues)
  return [{ text: SWATCH, color: colour ?? FAINT }, { text: ` ${fit(label, Math.max(0, width - 2))}`, ...tone }]
}

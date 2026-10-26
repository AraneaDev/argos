/**
 * The pane's tiers: the layout it takes at the width it has. Pure; nothing
 * here reads state.
 */

/**
 * The pane's three layouts, by the columns its body has: `narrow` (below 80)
 * one column with light cards, `medium` (80 to 130) one column of framed
 * cards whose tables add columns, `wide` (above 130) a two-column grid.
 */
export type Tier = 'narrow' | 'medium' | 'wide'
/** The first width of the medium tier, and the last. */
export const MEDIUM_MIN = 80
export const MEDIUM_MAX = 130
export const tierOf = (columns: number): Tier => (columns < MEDIUM_MIN ? 'narrow' : columns <= MEDIUM_MAX ? 'medium' : 'wide')

/**
 * The pane's colours, as Claude Code theme keys. A theme key follows the
 * person's theme (dark, light, daltonized, ANSI), so the pane matches the
 * rest of the screen instead of carrying a palette of its own.
 *
 * Colour marks what matters first: an engine, a status, the selection. It
 * also gives the pane its life within the theme: card titles in Claude's own
 * orange, each connection's engine chip in its hue, histograms shaded
 * cool to hot. Secondary text stays `inactive`, tracks, rules and empty cells
 * `subtle`; `suggestion` marks the selection and the active tab.
 *
 * Kept apart from the layout so every view colours an engine the same way.
 */
/** Headings and numbers. */
export const HEADING = 'text'
/** Secondary text: notes, column titles, labels before a value. */
export const SECONDARY = 'inactive'
/** The faintest ink: bar tracks, rules, an empty heat cell. */
export const FAINT = 'subtle'
/** The selection marker, the active tab and the heat map's hue. */
export const ACCENT = 'suggestion'

/**
 * The few backgrounds the pane lays: the marked row's faint tint and the
 * language chips (`userMessageBackground`, the grey Claude Code lays under
 * the person's own prompts), the hover card's ground (the same), and the
 * text set on a solid fill (the active tab, the status pill): `inverseText`.
 */
export const SELECTED_BG = 'userMessageBackground'
/** The ground a row changed by the latest scan is lit on for a moment: a cool tint, apart from the marked row's and the footer bar's. */
export const FLASH_BG = 'memoryBackgroundColor'
export const CHIP_BG = 'userMessageBackground'
export const CARD_BG = 'userMessageBackground'
export const ON_FILL = 'inverseText'

export const STATUS_COLOURS = { ok: 'success', warn: 'warning', alert: 'error' } as const
export type Tone = keyof typeof STATUS_COLOURS

/** A card's title: the orange Claude Code marks itself with, so the cards read as part of the screen around them. */
export const TITLE = 'claude'

/**
 * Each engine's chip colour, by the name its connection is configured with:
 * four theme keys apart from one another and from the status colours, so a
 * chip never reads as an outcome.
 */
export const ENGINE_COLOURS = {
  postgresql: 'permission',
  mysql: 'ide',
  sqlite: 'planMode',
  mssql: 'merged',
} as const
export type Engine = keyof typeof ENGINE_COLOURS

/** An engine's chip colour, or undefined for a name that is no engine (the chip is then drawn neutral). */
export function engineColour(engine: string | null | undefined): string | undefined {
  return typeof engine === 'string' && Object.hasOwn(ENGINE_COLOURS, engine) ? ENGINE_COLOURS[engine as Engine] : undefined
}

/** Cool to hot, the order {@link heat} steps through. */
const HEAT = [ACCENT, STATUS_COLOURS.ok, STATUS_COLOURS.warn, STATUS_COLOURS.alert] as const

/** Bucket `bucket` of `of`, shaded cool to hot: the first in the accent, the last in the error colour. */
export function heat(bucket: number, of: number): string {
  if (of <= 1) return HEAT[0]
  return HEAT[Math.round((Math.max(0, Math.min(bucket, of - 1)) * (HEAT.length - 1)) / (of - 1))]!
}

/**
 * Each chip's colour by its full name. A table or a chip given none draws
 * its names neutral. {@link ENGINE_HUES} is the map for engines.
 */
export type Hues = ReadonlyMap<string, string>
export const NO_HUES: Hues = new Map()
/** The engines' chip colours as {@link Hues}. */
export const ENGINE_HUES: Hues = new Map(Object.entries(ENGINE_COLOURS))

/** A chip's colour, by its full name: its hue in `hues`, or undefined for none (drawn neutral). */
export function boundaryColour(name: string | null | undefined, hues: Hues = NO_HUES): string | undefined {
  if (name === null || name === undefined || name === '') return undefined
  return hues.get(name)
}

/** A chip's name as the pane prints it: as written. */
export function boundaryLabel(name: string | null | undefined, _hues: Hues = NO_HUES): string {
  return name ?? ''
}

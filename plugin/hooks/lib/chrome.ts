/**
 * The pane's chrome: the header's title row and tab bar, and the footer bar
 * of keys. Pure, like the rest of the layout; ported from the Knossos pane's
 * chrome so the two read as one family.
 */
import type { PaneTab } from '../../types'
import type { ConnectionView } from './contract'
import { widthGauge } from './gauge'
import { ACCENT, CHIP_BG, engineColour, HEADING, ON_FILL, STATUS_COLOURS } from './palette'
import { button, clip, rowWidth, segmentsWidth, spread, tinted, wrapGroups } from './rows'
import type { Tier } from './table'
import { tierOf } from './table'
import { cells, fit, spaces } from './text'
import type { Row, Segment } from './types'

/** The tabs in hotkey order. */
export const TABS: { id: PaneTab; full: string; hotkey: string }[] = [
  { id: 'queries', full: 'Queries', hotkey: '1' },
  { id: 'schema', full: 'Schema', hotkey: '2' },
  { id: 'editor', full: 'Editor', hotkey: '3' },
  { id: 'connections', full: 'Connections', hotkey: '4' },
]

/** The active tab's ground: the theme's selection colour, under which a plain Button's own text stays legible in every theme. */
export const TAB_BG = 'selectionBg'

/** The header's status pill: its words and its tone. */
export type Pill = { text: string; tone: 'ok' | 'warn' | 'accent' }

const PILL_COLOURS: Record<Pill['tone'], string> = { ok: STATUS_COLOURS.ok, warn: STATUS_COLOURS.warn, accent: ACCENT }

/** The status as a pill: the words on the tone's colour, in the text set on a fill. */
function pill(status: Pill): Segment {
  return { text: ` ${status.text} `, bg: PILL_COLOURS[status.tone], color: ON_FILL, bold: true }
}

/**
 * `path` with a home directory written `~`: the person's own directory,
 * as a shell prints it. Read off the path itself (`/home/<user>`,
 * `/Users/<user>`, `/root`), since the mod is told no home directory.
 */
export function homeShort(path: string): string {
  return path.replace(/^(?:\/home\/[^/]+|\/Users\/[^/]+|\/root)(?=\/|$)/, '~')
}

/**
 * The header's first row: `argos` in bold, the config.ini the CLI reads
 * (dim, `~`-shortened), one chip per connection in its engine's colour,
 * then against the right edge the width gauge (see `gauge.ts`) and the
 * status pill. As the width shrinks the gauge goes first, from its slider to
 * its short form to nothing; then the chips; then the config; then the
 * pill's words are cut. Narrow, the name and the pill.
 */
export function titleRow(input: { connections: ConnectionView[]; pill: Pill; config?: string | null }, columns: number, tier: Tier, paneColumns = columns): Row {
  const name: Segment = { text: 'argos', bold: true, color: HEADING }
  const where: Segment[] = input.config === undefined || input.config === null || tier === 'narrow' ? [] : [{ text: `  ${homeShort(input.config)}`, dim: true }]
  const chips: Segment[] = tier === 'narrow' ? [] : input.connections.flatMap((c): Segment[] => [{ text: ' ' }, { text: ` ${c.name} `, ...colourOf(c.type), bg: CHIP_BG }])
  const chipsLead: Segment[] = chips.length === 0 ? [] : [{ text: ' ' }, ...chips]
  // How wide the pane is against the layouts' bounds, full or short: the first thing the header gives up.
  const gauge = (room: number): Segment[] => {
    const drawn = widthGauge(paneColumns, room)
    return drawn.length === 0 ? [] : [...drawn, { text: '   ' }]
  }
  const status = pill(input.pill)
  // Each layout from the fullest down; the first that fits wins.
  const variants: [Segment[], Segment[]][] = [
    [[name, ...where, ...chipsLead], [...gauge(Infinity), status]],
    [[name, ...where, ...chipsLead], [...gauge(14), status]],
    [[name, ...where, ...chipsLead], [status]],
    [[name, ...where], [status]],
    [[name], [status]],
  ]
  for (const [left, right] of variants) {
    if (segmentsWidth(left) + 1 + segmentsWidth(right) <= columns) return spread('title', left, right, columns)
  }
  // Nothing fits whole: the pill's words are cut, keeping the name.
  const keep = Math.max(0, columns - 1 - cells(name.text))
  const short: Segment = { ...status, text: fit(status.text, keep) }
  return keep >= 4 ? spread('title', [name], [short], columns) : { key: 'title', segments: clip([name], columns) }
}

/** A chip's ink: its engine's colour, or dim for an engine the palette does not know. */
const colourOf = (engine: string): Pick<Segment, 'color' | 'dim'> => {
  const colour = engineColour(engine)
  return colour === undefined ? { dim: true } : { color: colour }
}

/**
 * The tab bar: every tab by its name, the open one on {@link TAB_BG}, a cell
 * of room either side of each; where the names do not fit, and always when
 * `narrow`, the others by their digit (the open one keeps its name), then
 * with no room between.
 *
 * Every tab's hotkey rides on a hidden twin (`tabkey:<id>`, no text) just
 * before it: a Button with a hotkey always draws `N: label`. The pane's focus
 * hook moves a ring landing on a twin onto its visible tab.
 */
export function tabRows(active: PaneTab, columns: number, terminal: boolean, narrow = false): Row[] {
  type Tab = (typeof TABS)[number]
  const variants: [(t: Tab) => boolean, number][] = [
    ...(narrow ? [] : [[() => true, 2] as [(t: Tab) => boolean, number], [() => true, 1] as [(t: Tab) => boolean, number]]),
    [t => t.id === active, 2],
    [t => t.id === active, 1],
    [t => t.id === active, 0],
    [() => false, 0],
  ]
  const label = (t: Tab, named: (t: Tab) => boolean) => ` ${named(t) ? t.full : t.hotkey} `
  const width = (named: (t: Tab) => boolean, gap: number) => TABS.reduce((n, t) => n + cells(label(t, named)), 0) + gap * (TABS.length - 1)
  const [named, gap] = variants.find(([l, g]) => width(l, g) <= columns) ?? variants[variants.length - 1]!
  const segments: Segment[] = []
  TABS.forEach((t, i) => {
    if (i > 0 && gap > 0) segments.push({ text: spaces(gap) })
    const on = t.id === active
    segments.push({ text: '', hidden: true, press: { id: `tabkey:${t.id}`, label: t.full, hotkey: t.hotkey } }, button(`tab:${t.id}`, label(t, named), undefined, on ? { bg: TAB_BG } : { dim: true }))
  })
  // Elsewhere tabs are native buttons whose widths the pane cannot know: the bar is the same row.
  void terminal
  return [{ key: 'tabs', segments: clip(segments, columns) }]
}

/** The footer bar's ground: a faint fill across the pane, under the keys. */
export const BAR_BG = 'composerSidebarBackground'

/** The cells of room inside the header and the footer bar, either side, per tier. */
export const padOf = (tier: Tier): number => (tier === 'narrow' ? 1 : 2)

/** `row` set `pad` cells in from the left; with `bg`, that ground laid across the whole of `columns`, padding included. */
export function padded(row: Row, pad: number, columns: number, bg?: string): Row {
  const used = pad + rowWidth(row)
  const segments: Segment[] = [{ text: spaces(pad) }, ...row.segments, ...(bg !== undefined && used < columns ? [{ text: spaces(columns - used) }] : [])]
  return { ...row, segments: bg === undefined ? segments.filter(s => s.text !== '' || s.hidden === true) : tinted(segments, bg) }
}

/** One key the footer offers: what it presses (its label when no id is given), its hotkey, and whether it moves about (drawn on the left). */
export type FooterKey = { id?: string; hotkey: string; label: string; move?: true }

/** Groups of segments on one line, two cells apart. */
function joinGroups(groups: Segment[][]): Segment[] {
  return groups.flatMap((g, i) => (i === 0 ? g : [{ text: '  ' }, ...g]))
}

/**
 * The footer bar: the keys, dim, on a faint ground across the pane, padded
 * in from either edge; the moves (the marker) on the left, what can be done
 * against the right edge. Each key stays whole; past the width the actions
 * wrap under the moves, and a key is never dropped, since it would stop
 * working.
 */
export function footerRows(keys: FooterKey[], columns: number): Row[] {
  const pad = padOf(tierOf(columns))
  const inner = Math.max(1, columns - 2 * pad)
  const group = (k: FooterKey): Segment[] => [button(k.id ?? k.label, k.label, k.hotkey, { dim: true })]
  const moves = keys.filter(k => k.move === true).map(group)
  const actions = keys.filter(k => k.move !== true).map(group)
  const left = joinGroups(moves)
  const right = joinGroups(actions)
  const lines: Row[] =
    segmentsWidth(left) + 2 + segmentsWidth(right) <= inner
      ? [spread('keys', left, right, inner)]
      : [...(moves.length > 0 ? wrapGroups('keys', moves, inner) : []), ...(actions.length > 0 ? wrapGroups(moves.length > 0 ? 'keys-actions' : 'keys', actions, inner) : [])]
  return (lines.length > 0 ? lines : [{ key: 'keys', segments: [] }]).map(row => padded(row, pad, columns, BAR_BG))
}

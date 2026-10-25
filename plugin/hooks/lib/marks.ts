/**
 * Every glyph the pane uses to mean something, in one place: what it means,
 * the tone it is drawn in, and the word a card's legend gives it. A glyph has
 * one meaning across every tab; the few in {@link SHARED} appear in two
 * families because there they say the same thing. Colour only ever reinforces
 * a glyph. Box drawing, bars, sparklines, arrows between two names and the
 * scroll hints are drawing, not marks, and stay where they are drawn.
 */
import { ACCENT, STATUS_COLOURS } from './palette'
import { grouped } from './text'
import type { Segment } from './types'

export type MarkTone = 'ok' | 'warn' | 'alert' | 'accent' | 'dim' | 'text'
export type Mark = { glyph: string; meaning: string; tone: MarkTone; legend: string; plural?: string }

const m = (glyph: string, meaning: string, tone: MarkTone, legend: string = meaning, plural?: string): Mark => ({ glyph, meaning, tone, legend, ...(plural === undefined ? {} : { plural }) })

/** How something stands. */
export const SEVERITY = {
  ok: m('✓', 'ok', 'ok'),
  warn: m('▲', 'warning', 'warn', 'warning', 'warnings'),
  error: m('✗', 'error', 'alert', 'error', 'errors'),
  note: m('◦', 'note', 'dim', 'note', 'notes'),
} as const

/** What a note on the Notes tab needs from the person: its component gone, its files changed, the model asked to look. */
export const NOTE = {
  missing: m('▲', 'on a name the graph no longer holds', 'warn', 'missing'),
  stale: m('≈', 'its files changed since it was written', 'warn', 'stale'),
  flagged: m('?', 'flagged for the model to check', 'accent', 'flagged'),
} as const

/** How a file moved, and a scan on the session's timeline. */
export const CHANGE = {
  added: m('+', 'added', 'ok'),
  changed: m('~', 'changed', 'warn'),
  removed: m('−', 'removed', 'alert'),
  scan: m('•', 'a scan', 'accent', 'scan', 'scans'),
} as const

/** Where something is. */
export const PLACE = {
  swatch: m('■', 'boundary', 'text'),
  centre: m('◉', 'the centre of the graph', 'accent', 'centre'),
  hub: m('◆', 'the bucket holding the hubs', 'accent', 'hubs'),
} as const

/** How a component ranks. */
export const RANKING = {
  hotspotOnly: m('✦', 'ranked a hotspot but not a hub', 'dim', 'hotspot only'),
} as const

/** Who ran a query: Claude, or the person from the pane. */
export const SOURCE = {
  claude: m('✻', 'run by Claude', 'accent', 'claude'),
  you: m('❯', 'run by you', 'text', 'you'),
} as const

/** How a query ended: it ran, the read-only check refused it, or the database failed it. */
export const OUTCOME = {
  ok: m('✓', 'ok', 'ok'),
  blocked: m('⊘', 'blocked by the read-only check', 'warn', 'blocked'),
  error: m('✗', 'error', 'alert', 'error', 'errors'),
} as const

/** What a column is in its table; `+` marks a column the latest schema check found new. */
export const KEY = {
  primary: m('PK', 'primary key', 'accent'),
  foreign: m('FK', 'foreign key', 'dim'),
  added: m('+', 'added', 'ok', 'new column'),
} as const

/** The glyph in each card's title. A card icon is never a row mark, apart from {@link SHARED}. */
export const CARD_ICON = {
  look: '◬', turn: '▤', top: '◎', hubs: '◎', files: '≡', map: '▦', bounds: '▦', 'bounds-list': '▥', focus: '◈',
  coupling: '⇄', cycles: '↻', 'cycle-members': '↻', 'cycle-diagram': '↻', hood: '⇄', policy: '!', diag: '!', dead: '!',
  hotspots: '!', branch: '⎇', crossing: '⇄', 'branch-cycles': '↻', grown: '◎', 'branch-dead': '!', 'branch-policy': '!',
  'branch-files': '≡', find: '⌕', budget: '!', churn: '≡', 'churn-plot': '∴', 'churn-list': '≡', rings: '◎', route: '⇢',
  'route-others': '⇢', flows: '⇄', changes: '±', tests: '✓', trend: '∿', detail: '◇', used: '←', uses: '→', deps: '←', comps: '→',
  notes: '✎', diff: '±', drift: 'Δ', session: '±', composition: '▥', concentration: '◎', health: '∿',
  pinned: '★', history: '≡', result: '◇', tables: '▦', relations: '⇄', query: '›_',
} as const satisfies Readonly<Record<string, string>>

/** Glyphs in two families on purpose, because there they say the same thing: ok and tested, a warning and untested, a change, a cycle. */
export const SHARED: ReadonlyArray<string> = ['✓', '▲', '±', '↻', '✗']

const toned = (tone: MarkTone): Omit<Segment, 'text'> =>
  tone === 'dim' ? { dim: true } : tone === 'text' ? {} : tone === 'accent' ? { color: ACCENT } : { color: STATUS_COLOURS[tone] }

/** A mark as a segment in its tone, `trailing` after the glyph (a space when a column follows). */
export function mark(entry: Mark, trailing = ''): Segment {
  return { text: entry.glyph + trailing, ...toned(entry.tone) }
}

/**
 * A card's legend: each mark it shows with its count and word, in the order
 * given, those counted zero left out. A count given as `''` names the mark
 * alone (`✦ hotspot only`). Empty when nothing is left.
 */
export function legend(entries: ReadonlyArray<readonly [Mark, number | string]>): string {
  return entries
    .filter(([, count]) => count !== 0)
    .map(([entry, count]) => {
      if (count === '') return `${entry.glyph} ${entry.legend}`
      const word = count !== 1 && entry.plural !== undefined ? entry.plural : entry.legend
      return `${entry.glyph} ${typeof count === 'number' ? grouped(count) : count} ${word}`
    })
    .join(' · ')
}

/** A delta as a signed number: `+3`, `−2`, `±0`. */
export function signed(n: number): string {
  return n === 0 ? '±0' : `${n > 0 ? '+' : '−'}${grouped(Math.abs(n))}`
}

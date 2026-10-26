/**
 * Text as the pane prints it: measured in display columns, cut, padded and
 * wrapped to a width, counts written short, and paths cut in their directory. Pure; nothing here reads state.
 *
 * Widths are display columns, measured per grapheme: East Asian wide and
 * emoji graphemes take two, a grapheme of only combining marks none, the
 * rest one. Text is cut only between graphemes, so a cut never splits an
 * emoji sequence or strips a mark from its base.
 */
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const WIDE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]|\p{Extended_Pictographic}/u
const MARKS_ONLY = /^\p{M}+$/u

/** Display columns a grapheme takes in a terminal. */
const graphemeCells = (g: string): number => (MARKS_ONLY.test(g) ? 0 : WIDE.test(g) ? 2 : 1)

/** The graphemes of a string, in order. */
const split = (text: string): string[] => Array.from(graphemes.segment(text), s => s.segment)

/** Text of printable ASCII only: one cell a code unit, no grapheme to split. */
const ASCII = /^[\x20-\x7e]*$/

export const cells = (text: string): number => (ASCII.test(text) ? text.length : cellsOf(text))
const cellsOf = (text: string): number => split(text).reduce((n, g) => n + graphemeCells(g), 0)

/** The leading graphemes that fit in `room` cells, joined. */
function head(chars: string[], room: number): string {
  let used = 0
  let out = ''
  for (const g of chars) {
    used += graphemeCells(g)
    if (used > room) break
    out += g
  }
  return out
}

/** `text` cut to `width` cells, the last one an ellipsis when anything was cut. */
export function fit(text: string, width: number): string {
  if (width <= 0) return ''
  return cells(text) <= width ? text : `${head(split(text), width - 1)}…`
}

export const spaces = (n: number): string => ' '.repeat(Math.max(0, n))
export const padEnd = (text: string, width: number): string => text + spaces(width - cells(text))
export const padStart = (text: string, width: number): string => spaces(width - cells(text)) + text
/** A count with thousands separated: 7,878. */
export const grouped = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** How long ago, in its largest whole unit, cut down and never rounded up (so never `60m` or `24h`): `12s`, `5m`, `3h`, `2d`. */
export function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86_400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86_400)}d`
}

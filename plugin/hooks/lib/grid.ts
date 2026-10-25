/**
 * A page of a result as a grid: a header, then the rows, each column as wide
 * as its header and the rows shown want, capped so every row fits the width.
 * Shared by the Queries tab and the Editor. Pure: a `SpoolPage` in, rows out.
 *
 * Cells are clipped with `…`, `null` is drawn dim as `NULL`, and a value is
 * drawn exactly as the adapter wrote it (redacted values included).
 */
import type { SpoolPage } from './contract'
import { dimRow } from './rows'
import { cells, fit, padEnd, padStart, spaces } from './text'
import type { Row, Segment } from './types'

/** The widest a column grows, whatever its values. */
export const CELL_MAX = 40
/** The narrowest a column is squeezed to, and so the fewest cells a column may take with its gap. */
const CELL_MIN = 4
/** The cells between two columns. */
const GAP = 1
/** The rows of a cell's text read for measuring: a huge value is cut before it is measured. */
const SAMPLE_CHARS = CELL_MAX * 4

/** A cell as the text drawn, and whether it is a number (aligned right) or null (drawn dim). */
function textOf(value: unknown): { text: string; kind: 'null' | 'number' | 'text' } {
  if (value === null || value === undefined) return { text: 'NULL', kind: 'null' }
  const raw = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value)
  // One line, whatever the value holds, and never measured at its full length.
  const text = raw.slice(0, SAMPLE_CHARS).replace(/[\r\n\t\u0000-\u001f]+/g, ' ')
  return { text, kind: typeof value === 'number' || typeof value === 'bigint' ? 'number' : 'text' }
}

/**
 * Which rows of the page show: `start` (the first, held inside the page),
 * `shown` and `length`, in `room` rows of which the header takes one and, when
 * the rest does not all show, the `N more ↓` line another.
 */
export function gridWindow(page: SpoolPage, room: number, scroll = 0): { start: number; shown: number; length: number } {
  const length = page.rows.length
  const capacity = Math.max(1, room - 1)
  if (length <= capacity) return { start: 0, shown: length, length }
  const shown = Math.max(1, capacity - 1)
  return { start: Math.min(Math.max(0, scroll), length - shown), shown, length }
}

/** The widths the columns take in `columns` cells: natural widths, the widest squeezed until the row fits. */
function widthsOf(natural: number[], columns: number): number[] {
  const widths = natural.map(w => Math.min(CELL_MAX, Math.max(1, w)))
  const total = () => widths.reduce((n, w) => n + w, 0) + GAP * (widths.length - 1)
  while (total() > columns) {
    const widest = Math.max(...widths)
    if (widest <= CELL_MIN) break
    widths[widths.indexOf(widest)] = widest - 1
  }
  return widths
}

/**
 * The grid in `room` rows (header, rows, `N more ↓`) and `columns` cells,
 * the rows shown from `scroll`. Columns that cannot keep {@link CELL_MIN}
 * cells are left off, and said in a line under the grid.
 */
export function gridRows(page: SpoolPage, columns: number, room: number, scroll = 0): Row[] {
  const width = Math.max(1, columns)
  const window = gridWindow(page, room, scroll)
  const shown = page.rows.slice(window.start, window.start + window.shown)
  const fits = Math.max(1, Math.floor((width + GAP) / (CELL_MIN + GAP)))
  const fields = page.fields.slice(0, fits)
  const natural = fields.map((f, c) => Math.max(cells(f), ...shown.map(row => cells(textOf(row[c]).text))))
  const widths = widthsOf(natural, width)
  const rows: Row[] = [
    { key: 'grid-head', segments: fields.flatMap((f, c): Segment[] => [{ text: padEnd(fit(f, widths[c]!), widths[c]!), bold: true }, ...(c < fields.length - 1 ? [{ text: spaces(GAP) }] : [])]) },
    ...shown.map((row, n): Row => ({
      key: `grid-row-${window.start + n}`,
      segments: fields.flatMap((_, c): Segment[] => {
        const { text, kind } = textOf(row[c])
        const w = widths[c]!
        const clipped = fit(text, w)
        const cell: Segment = kind === 'null' ? { text: padEnd(clipped, w), dim: true } : { text: kind === 'number' ? padStart(clipped, w) : padEnd(clipped, w) }
        return [cell, ...(c < fields.length - 1 ? [{ text: spaces(GAP) }] : [])]
      }),
    })),
  ]
  const hidden = page.fields.length - fields.length
  const below = window.length - window.start - window.shown
  const notes = [...(window.start > 0 ? [`${window.start} above ↑`] : []), ...(below > 0 ? [`${below} more ↓`] : []), ...(hidden > 0 ? [`+${hidden} more columns`] : [])]
  // The columns left off are said where the row for it is free: with the `more` line, or in a spare row.
  if (notes.length > 0 && (below > 0 || window.start > 0 || rows.length < room)) rows.push(dimRow('grid-more', notes.join(' · '), width))
  return rows
}

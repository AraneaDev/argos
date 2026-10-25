/**
 * A result page as text for the clipboard and for Claude: a markdown table,
 * CSV, JSON, and the message `s` sends. Pure: a `SpoolPage` in, text out.
 * Shared by the Queries tab and the Editor.
 */
import type { JournalEntry, SpoolPage } from './contract'

/** The formats a page is copied in, in the order a repeat press cycles through them. */
export const PAGE_FORMATS = ['markdown', 'CSV', 'JSON'] as const
export type PageFormat = (typeof PAGE_FORMATS)[number]

/** The most rows, and characters of table, `sendText` puts in a message. */
export const SEND_MAX_ROWS = 50
export const SEND_MAX_CHARS = 8000

const plainCell = (value: unknown): string => (value === null || value === undefined ? '' : typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value))

/** A page as CSV, a value quoted where it holds a comma, a quote or a line break. Whole values, nothing clipped. */
export function toCsv(page: SpoolPage): string {
  const quote = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return [page.fields.map(quote), ...page.rows.map(row => page.fields.map((_, c) => quote(plainCell(row[c]))))].map(line => line.join(',')).join('\n')
}

/** A page as JSON: an array of objects, one per row. */
export function toJson(page: SpoolPage): string {
  return JSON.stringify(page.rows.map(row => Object.fromEntries(page.fields.map((f, c) => [f, row[c] ?? null]))), null, 2)
}

/**
 * A page as a markdown table (`|` escaped, line breaks flattened, null as
 * NULL) of at most `maxRows` rows and about `maxChars` characters. When rows
 * are left out the last line says `… N more rows`, counting those the page
 * itself does not hold (`total`) as well. With no limit (Infinity) every row
 * of the page is in and no such line is added.
 */
export function toMarkdown(page: SpoolPage, maxRows: number, maxChars: number): string {
  const cell = (v: string): string => v.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
  const line = (cells: string[]): string => `| ${cells.map(cell).join(' | ')} |`
  const head = [line(page.fields), line(page.fields.map(() => '---'))]
  const body = page.rows.map(row => line(page.fields.map((_, c) => (row[c] === null || row[c] === undefined ? 'NULL' : plainCell(row[c])))))
  let used = head.join('\n').length
  let shown = 0
  while (shown < body.length && shown < maxRows && used + 1 + body[shown]!.length <= maxChars) used += 1 + body[shown++]!.length
  const limited = Number.isFinite(maxRows) || Number.isFinite(maxChars)
  const more = limited ? Math.max(body.length, page.total - page.offset) - shown : 0
  return [...head, ...body.slice(0, shown), ...(more > 0 ? [`… ${more} more ${more === 1 ? 'row' : 'rows'}`] : [])].join('\n')
}

/** A page as text to copy in `format`: every row of the page. */
export function pageAs(page: SpoolPage, format: PageFormat): string {
  return format === 'JSON' ? toJson(page) : format === 'CSV' ? toCsv(page) : toMarkdown(page, Infinity, Infinity)
}

/**
 * What `s` sends Claude: the SQL fenced, the connection, then how it ended —
 * the refusal or error, or the rows as a markdown table capped at 50 rows
 * and 8,000 characters.
 */
export function sendText(entry: JournalEntry, page: SpoolPage | null): string {
  const out = ['```sql', entry.sql.trim(), '```', `Connection: ${entry.database}`]
  if (entry.outcome !== 'ok') out.push(`Result: ${entry.outcome}${entry.reason === undefined ? '' : ` — ${entry.reason}`}`)
  else if (page !== null) out.push('', toMarkdown(page, SEND_MAX_ROWS, SEND_MAX_CHARS))
  else out.push('Result: no longer kept')
  return out.join('\n')
}

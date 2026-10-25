/**
 * The Editor tab's run: the SQL in the field goes to the CLI's `query` (the
 * read-only check applies there, as for Claude), the journal entry it prints
 * is kept, and the first page of its rows is read. Never throws.
 */
import type { SpoolPage } from '../lib/contract'
import { parseJournalEntry, parseSpoolPage } from '../lib/parse'
import { dbOf } from '../lib/layout'
import { OUTPUT_TOO_LARGE, QUERY_TIMEOUT_MS, runCli } from './cli'
import type { CliAnswer } from './cli'
import { reloadQueries, RESULT_PAGE, RESULT_PAGE_SMALL } from './loaders'
import type { Port } from './port'

/** The first page of entry `id`'s rows; a page the engine cut short is read again with fewer rows. */
async function firstPage(io: Port, id: string): Promise<CliAnswer<SpoolPage>> {
  const read = (limit: number) => runCli(io, ['result', id, '--offset', '0', '--limit', String(limit)], parseSpoolPage)
  const page = await read(RESULT_PAGE)
  return !page.ok && page.reason === OUTPUT_TOO_LARGE ? read(RESULT_PAGE_SMALL) : page
}

/** Enter in the field, or `r`: runs the draft on the connection picked. A second run waits for the first. */
export async function runEditor(io: Port): Promise<void> {
  if ((await io.state.editor.read()).running) return
  const sql = (await io.state.draft.read()).trim()
  if (sql === '') {
    await io.ui.toast('Type a query first')
    return
  }
  const view = await io.state.view.read()
  const db = dbOf(await io.state.connections.read(), view.db)?.name ?? view.db
  if (db === null) {
    await io.ui.toast('No connection to run on')
    return
  }
  await io.state.editor.update(e => ({ ...e, running: true, runs: (e.runs ?? 0) + 1 }))
  try {
    const ran = await runCli(io, ['query', db, '--sql', sql], parseJournalEntry, QUERY_TIMEOUT_MS)
    if (!ran.ok) {
      await io.state.editor.update(e => ({ running: false, entry: null, page: null, failure: ran.reason, ...(e.runs === undefined ? {} : { runs: e.runs }) }))
      return
    }
    const entry = ran.value
    const rows = entry.outcome === 'ok' && entry.spool !== null ? await firstPage(io, entry.id) : null
    await io.state.editor.update(e => ({ running: false, entry, page: rows?.ok === true ? rows.value : null, failure: rows !== null && !rows.ok ? rows.reason : null, ...(e.runs === undefined ? {} : { runs: e.runs }) }))
    // The journal has a new entry: the Queries tab reads it again.
    if ((await io.state.history.read()) !== null) await reloadQueries(io)
  } finally {
    await io.state.editor.update(e => (e.running ? { ...e, running: false } : e))
  }
}

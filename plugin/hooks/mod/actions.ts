/**
 * What the person's presses and keystrokes on the pane do: the press table
 * ({@link PRESSES}), the fields' keystrokes, and where the focus ring goes.
 * Each handler swallows its own failure, as one that outlives the session (a
 * teardown under it) must.
 */
import type { RenderSurface } from 'claude-code'

import type { PaneTab, View } from '../../types'
import { wheelMove, wheelTarget } from '../lib/cards'
import { TABS } from '../lib/chrome'
import { pageAs, PAGE_FORMATS, sendText } from '../lib/clip'
import { resultOf, schemaFor, walkable } from '../lib/layout'
import { pinOf } from '../lib/queries-view'
import { filteredList, sketchOf, sqlOf } from '../lib/schema-view'
import type { JournalEntry, SpoolPage, TableInfo } from '../lib/contract'
import { parseJournalEntry, parsePin, parseUnpinned } from '../lib/parse'
import type { Row } from '../lib/types'
import { QUERY_TIMEOUT_MS, runCli } from './cli'
import { runEditor } from './editor'
import { moreHistory, refreshSchema, reloadPins, reloadQueries, request, requestQueries, requestSchema, selectedEntry, showResultPage } from './loaders'
import type { Port } from './port'
import { focusField, mod } from './state'

/**
 * What the pane's elements do: a press (a Button, by its id, from the surface
 * it came from), and a keystroke or Enter in a field (by the field's id).
 * Handed in by the hooks module, so drawing imports none of the actions.
 */
export type Handlers = {
  press: (id: string, surface?: RenderSurface) => void
  type: (field: string, value: string) => void
  submit: (field: string, value: string) => void
}

/** What one press does: `rest` is what follows the colon of a prefixed id (`row:3` gives `3`), `id` the whole id. */
type Press = (io: Port, rest: string, surface: RenderSurface | undefined, id: string) => unknown

/** The open tab's marker moved to `to` (kept within its list); on Connections the marked connection is the one the other tabs use. */
async function mark(io: Port, to: (v: View, length: number) => number): Promise<void> {
  const connections = await io.state.connections.read()
  const history = await io.state.history.read()
  const before = await io.state.view.read()
  const schema = schemaFor(await io.state.schema.read(), before.db)
  const moved = await io.state.view.update(v => {
    const length = walkable(v.tab, connections, schema, v.filter, history)
    if (length === 0) return v
    const at = Math.min(Math.max(0, to(v, length)), length - 1)
    const db = v.tab === 'connections' ? (connections?.answer?.[at]?.name ?? v.db) : v.db
    return { ...v, marker: { ...v.marker, [v.tab]: at }, db }
  })
  if (moved.tab !== 'queries') return
  // The Queries marker walks the journal: its entry's result is read, and the list pages in as the marker nears its end.
  const list = history?.answer ?? []
  mod.loads.selectedId = list[moved.marker.queries]?.id ?? null
  await request(io, 'result')
  if (moved.marker.queries >= list.length - 5) await moreHistory(io)
}

/** The schema table the marker is on, with the engine it is in; null when none shows. */
async function markedTable(io: Port): Promise<{ table: TableInfo; engine: string } | null> {
  const view = await io.state.view.read()
  const schema = schemaFor(await io.state.schema.read(), view.db)?.answer
  if (schema === null || schema === undefined) return null
  const table = filteredList(schema, view.filter)[view.marker.schema]
  return table === undefined ? null : { table, engine: schema.type }
}

/** `n`: the next connection, round the list; on the Schema tab its schema is read. */
async function nextConnection(io: Port): Promise<void> {
  const list = (await io.state.connections.read())?.answer ?? []
  if (list.length === 0) return
  const editing = (await io.state.view.read()).tab === 'editor'
  await io.state.view.update(v => {
    const at = list.findIndex(c => c.name === v.db)
    const to = (at + 1) % list.length
    // In the Editor the connection changes and nothing else does: the SQL typed stays.
    return editing ? { ...v, db: list[to]!.name, marker: { ...v.marker, connections: to } } : { ...v, db: list[to]!.name, filter: '', filtering: false, marker: { ...v.marker, schema: 0, connections: to } }
  })
  if (editing) focusField(io, 'sql')
  else await requestSchema(io)
}

/** `q`: a hundred rows of the marked table, in the Editor, which opens. */
async function putQuery(io: Port): Promise<void> {
  const marked = await markedTable(io)
  if (marked === null) return
  await io.state.draft.update(() => sqlOf(marked.table.name, marked.engine))
  await io.state.view.update(v => ({ ...v, tab: 'editor', filtering: false }))
  focusField(io, 'sql')
}

/** `c`: a CREATE TABLE sketch of the marked table, to the clipboard. */
async function copyCreate(io: Port, _rest: string, surface: RenderSurface | undefined): Promise<void> {
  const marked = await markedTable(io)
  if (marked === null) return
  const copied = await io.ui.copy({ text: sketchOf(marked.table), ...(surface === undefined ? {} : { surface }) })
  await io.ui.toast(copied.isCopied ? `Copied CREATE TABLE ${marked.table.name}` : `Could not copy: ${copied.reason ?? 'the surface refused'}`)
}

/** `f`: opens the table filter's field and focuses it; again, closes it and clears the filter. */
async function toggleFilter(io: Port): Promise<void> {
  const open = (await io.state.view.read()).filtering
  await io.state.view.update(v => (open ? { ...v, filter: '', filtering: false, marker: { ...v.marker, schema: 0 } } : { ...v, filtering: true }))
  if (!open) focusField(io, 'filter')
}

/** How long a repeat press of `c` still counts as asking for the next format, in milliseconds. */
const COPY_CYCLE_MS = 2000

/** What `r` says on an entry whose SQL used bound parameters. */
const RERUN_PARAMS = "can't rerun: this query used parameters"

/** `r`: the selected entry's SQL, run again on its connection as the person (the CLI's `query`); the journal then lists it as the newest. */
async function rerun(io: Port): Promise<void> {
  const entry = await selectedEntry(io)
  if (entry === null || mod.queries.rerunning) return
  if (entry.hasParams === true) {
    // the journal keeps the SQL, not the values Claude bound to it
    await io.ui.toast(RERUN_PARAMS)
    return
  }
  mod.queries.rerunning = true
  try {
    const ran = await runCli(io, ['query', entry.database, '--sql', entry.sql], parseJournalEntry, QUERY_TIMEOUT_MS)
    if (!ran.ok) {
      await io.ui.toast(ran.reason)
      return
    }
    mod.loads.selectNewest = true
    await reloadQueries(io)
    await io.ui.toast(rerunSaid(ran.value))
  } finally {
    mod.queries.rerunning = false
  }
}

/** What a rerun's toast says: how it ended. */
function rerunSaid(entry: JournalEntry): string {
  if (entry.outcome === 'blocked') return `Blocked by the read-only check: ${entry.reason ?? 'not a SELECT'}`
  if (entry.outcome === 'error') return `Query failed: ${entry.reason ?? 'unknown error'}`
  return `Ran on ${entry.database}${entry.rowCount === null ? '' : `: ${entry.rowCount} ${entry.rowCount === 1 ? 'row' : 'rows'}`}`
}

/** `e`: the selected entry's SQL in the Editor, on its connection. */
async function editEntry(io: Port): Promise<void> {
  const entry = await selectedEntry(io)
  if (entry === null) return
  await io.state.draft.update(() => entry.sql)
  await io.state.view.update(v => ({ ...v, tab: 'editor', db: entry.database, filtering: false }))
  focusField(io, 'sql')
}

/** What `c`, `p` and `s` act on: the Queries tab's selected entry and its result page, or the Editor's last run (and the SQL typed, when none ran). */
async function subject(io: Port): Promise<{ entry: JournalEntry | null; page: SpoolPage | null; sql: string }> {
  if ((await io.state.view.read()).tab === 'editor') {
    const { entry, page } = await io.state.editor.read()
    return { entry, page, sql: entry?.sql ?? (await io.state.draft.read()) }
  }
  const entry = await selectedEntry(io)
  return { entry, page: entry === null ? null : resultOf(await io.state.result.read(), entry).page, sql: entry?.sql ?? '' }
}

/** `p`: pins the query on show, or unpins it when it is pinned. */
async function togglePin(io: Port): Promise<void> {
  const { entry } = await subject(io)
  if (entry === null) {
    await io.ui.toast('Run the query first')
    return
  }
  const pinned = pinOf((await io.state.pins.read())?.answer ?? [], entry)
  const done = pinned === undefined ? await runCli(io, ['pin', entry.id], parsePin) : await runCli(io, ['unpin', pinned.id], parseUnpinned)
  if (!done.ok) {
    await io.ui.toast(done.reason)
    return
  }
  await reloadPins(io)
  await io.ui.toast(pinned === undefined ? 'Pinned' : 'Unpinned')
}

/** `c`: the result page on show to the clipboard as markdown; again within two seconds, CSV, then JSON. With no result, the SQL. */
async function copyResult(io: Port, _rest: string, surface: RenderSurface | undefined): Promise<void> {
  const { entry, page, sql } = await subject(io)
  const where = surface === undefined ? {} : { surface }
  if (page === null) {
    if (entry === null && sql.trim() === '') return
    const copied = await io.ui.copy({ text: sql, ...where })
    await io.ui.toast(copied.isCopied ? 'Copied the SQL' : `Could not copy: ${copied.reason ?? 'the surface refused'}`)
    return
  }
  const now = await io.clock.now()
  const last = mod.queries.copy
  const format = last !== null && now - last.at <= COPY_CYCLE_MS ? (last.format + 1) % PAGE_FORMATS.length : 0
  mod.queries.copy = { at: now, format }
  const name = PAGE_FORMATS[format]!
  const copied = await io.ui.copy({ text: pageAs(page, name), ...where })
  await io.ui.toast(copied.isCopied ? `Copied ${page.rows.length} ${page.rows.length === 1 ? 'row' : 'rows'} as ${name}` : `Could not copy: ${copied.reason ?? 'the surface refused'}`)
}

/** What the person is told when send fell back to the clipboard. */
export const SENT_BY_CLIPBOARD = 'copied for Claude — paste into your prompt'

/**
 * `s`: the query on show with its connection and rows (`sendText`) placed in
 * the prompt box as draft text — never submitted; the person reads it, adds
 * their question and sends. Where the engine has no box to put it in (a
 * dialog holds the keys, or the session is headless) it goes to the
 * clipboard instead.
 */
async function sendToClaude(io: Port, _rest: string, surface: RenderSurface | undefined): Promise<void> {
  const { entry, page } = await subject(io)
  if (entry === null) return
  const text = sendText(entry, page)
  const filled = await io.prompt.fill({ text: `${text}\n`, mode: 'insert' }).catch(() => ({ isFilled: false }))
  if (filled.isFilled) {
    await io.ui.toast('Placed in your prompt — add your question and send')
    return
  }
  const copied = await io.ui.copy({ text, ...(surface === undefined ? {} : { surface }) })
  await io.ui.toast(copied.isCopied ? SENT_BY_CLIPBOARD : `Could not copy: ${copied.reason ?? 'the surface refused'}`)
}

/** A press on a pin: the entry it was last run as is selected, when the history holds it. */
async function openPin(io: Port, rest: string): Promise<void> {
  const pin = (await io.state.pins.read())?.answer?.[Number(rest)]
  const list = (await io.state.history.read())?.answer ?? []
  const at = pin?.lastJournalId == null ? -1 : list.findIndex(e => e.id === pin.lastJournalId)
  if (at >= 0) await mark(io, () => at)
}

/** `m` and `b`: the next or the earlier page of the result's rows; the wheel starts again at the top of it. */
async function resultPage(io: Port, direction: 1 | -1): Promise<void> {
  const entry = await selectedEntry(io)
  const page = entry === null ? null : resultOf(await io.state.result.read(), entry).page
  if (page === null) return
  const to = direction === 1 ? page.offset + page.rows.length : page.offset - mod.loads.result.limit
  if (direction === 1 && to >= page.total) return
  await io.state.view.update(v => {
    const { result: _, ...scroll } = v.scroll
    return { ...v, scroll }
  })
  await showResultPage(io, to)
}

/**
 * What a press on the pane does, by the pressed element's id: an id that
 * names an action outright (`down`), or the part of one before its first
 * colon, the colon kept (`row:`), for an id that carries what it acts on.
 * No outright id holds a colon, so the two never meet.
 */
export const PRESSES: ReadonlyMap<string, Press> = new Map<string, Press>([
  [
    'tab:',
    async (io, rest) => {
      const tab = rest as PaneTab
      if (!TABS.some(t => t.id === tab)) return
      await io.state.view.update(v => ({ ...v, tab, filtering: false }))
      if (tab === 'schema') await requestSchema(io)
      if (tab === 'queries') await requestQueries(io)
      if (tab === 'editor') focusField(io, 'sql')
    },
  ],
  ['row:', (io, rest) => (/^\d+$/.test(rest) ? mark(io, () => Number(rest)) : undefined)],
  ['down', io => mark(io, v => v.marker[v.tab] + 1)],
  ['up', io => mark(io, v => v.marker[v.tab] - 1)],
  // The line under a list that counts what is hidden: the marker goes to the nearest item it counts.
  ['more:', (io, rest) => (/^\d+$/.test(rest) ? mark(io, () => Number(rest)) : undefined)],
  ['next', nextConnection],
  ['query', putQuery],
  ['copy-create', copyCreate],
  ['filter', toggleFilter],
  ['refresh', refreshSchema],
  ['rerun', rerun],
  ['edit', editEntry],
  ['pin', togglePin],
  ['pinned:', openPin],
  ['copy', copyResult],
  ['send', sendToClaude],
  ['run', runEditor],
  ['more-rows', io => resultPage(io, 1)],
  ['back-rows', io => resultPage(io, -1)],
])

/** Ids that do what another does: a tab's hidden hotkey twin. */
const SAME_AS: Readonly<Record<string, string>> = { 'tabkey:': 'tab:' }

/** Which entry of {@link PRESSES} a press on `id` runs, and what follows the colon; null for an id that does nothing. */
export function pressOf(id: string): { key: string; rest: string } | null {
  const cut = id.indexOf(':')
  const named = cut < 0 ? id : id.slice(0, cut + 1)
  const key = Object.hasOwn(SAME_AS, named) ? SAME_AS[named]! : named
  return PRESSES.has(key) ? { key, rest: cut < 0 ? '' : id.slice(cut + 1) } : null
}

/** What a press on the pane does, by the pressed element's id; `surface` is where the press came from. An id the table does not know does nothing. */
async function pressAction(io: Port, id: string, surface?: RenderSurface): Promise<unknown> {
  const press = pressOf(id)
  return press === null ? undefined : PRESSES.get(press.key)!(io, press.rest, surface, id)
}

/**
 * Where the focus ring goes instead of the element a move named: off a tab's
 * hidden twin onto its visible tab. Null to let it land where it was asked.
 */
export async function focusMoved(_io: Port, element: unknown): Promise<{ to: string } | null> {
  if (typeof element !== 'string' || !element.startsWith('tabkey:')) return null
  return { to: `tab:${element.slice('tabkey:'.length)}` }
}

/** The focus ring landed on `element`: a listed row moves the marker with it. */
export async function focusLanded(io: Port, element: string): Promise<void> {
  const row = /^row:(\d+)$/.exec(element)
  if (row !== null) await mark(io, () => Number(row[1]))
}

/** The filter as typed, applied at once; the marker goes back to the top of the shorter list. */
async function typeFilter(io: Port, text: string): Promise<void> {
  await io.state.view.update(v => ({ ...v, filter: text, filtering: true, marker: { ...v.marker, schema: 0 } }))
}

/** Enter in the filter field: keep the text, close the field. */
async function submitFilter(io: Port, text: string): Promise<void> {
  await io.state.view.update(v => ({ ...v, filter: text, filtering: false, marker: { ...v.marker, schema: 0 } }))
}

/** The SQL as typed. */
async function typeSql(io: Port, text: string): Promise<void> {
  // Enter empties the field, and says so as an edit: the SQL stays in the draft, as the person left it.
  const emptied = mod.editor.submitted && text === ''
  mod.editor.submitted = false
  if (!emptied) await io.state.draft.update(() => text)
}

/** Enter in the SQL field: the text as it stands is run. */
async function submitSql(io: Port, text: string): Promise<void> {
  mod.editor.submitted = text !== ''
  await io.state.draft.update(() => text)
  await runEditor(io)
}

/** The wheel over a list longer than its window scrolls that list, the marker left where it is; false when the pointer is over none, or at its end. */
export async function wheelScrolled(io: Port, rows: readonly Row[], offset: number, pointer: { row: number; column: number }, by: number): Promise<boolean> {
  const moved = wheelMove(rows, offset, pointer, by)
  if (moved === null) return false
  await io.state.view.update(v => ({ ...v, scroll: { ...v.scroll, [moved.key]: moved.start } }))
  // The history paged to its last entry reads the older page.
  const span = wheelTarget(rows, offset + pointer.row, pointer.column)
  if (span?.key === 'history' && moved.start + span.shown >= span.length) await moreHistory(io)
  return true
}

/** What the pane's elements do, for the pane drawn through `io`: each action's failure (a teardown under it) is swallowed. */
export function handlersOf(io: Port): Handlers {
  return {
    press: (id, surface) => void Promise.resolve()
      .then(() => pressAction(io, id, surface))
      .catch(() => undefined),
    type: (field, value) => void Promise.resolve().then(() => (field === 'filter' ? typeFilter(io, value) : field === 'sql' ? typeSql(io, value) : undefined)).catch(() => undefined),
    submit: (field, value) => void Promise.resolve().then(() => (field === 'filter' ? submitFilter(io, value) : field === 'sql' ? submitSql(io, value) : undefined)).catch(() => undefined),
  }
}

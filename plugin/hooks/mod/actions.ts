/**
 * What the person's presses and keystrokes on the pane do: the press table
 * ({@link PRESSES}), the fields' keystrokes, and where the focus ring goes.
 * Each handler swallows its own failure, as one that outlives the session (a
 * teardown under it) must.
 */
import type { RenderSurface } from 'claude-code'

import type { PaneTab, View } from '../../types'
import { wheelMove } from '../lib/cards'
import { TABS } from '../lib/chrome'
import { walkable } from '../lib/layout'
import { filteredList, sketchOf, sqlOf } from '../lib/schema-view'
import type { TableInfo } from '../lib/contract'
import type { Row } from '../lib/types'
import { refreshSchema, requestSchema } from './loaders'
import type { Port } from './port'
import { focusField } from './state'

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
  const schema = await io.state.schema.read()
  await io.state.view.update(v => {
    const length = walkable(v.tab, connections, schema, v.filter)
    if (length === 0) return v
    const at = Math.min(Math.max(0, to(v, length)), length - 1)
    const db = v.tab === 'connections' ? (connections?.answer?.[at]?.name ?? v.db) : v.db
    return { ...v, marker: { ...v.marker, [v.tab]: at }, db }
  })
}

/** The schema table the marker is on, with the engine it is in; null when none shows. */
async function markedTable(io: Port): Promise<{ table: TableInfo; engine: string } | null> {
  const schema = (await io.state.schema.read())?.answer
  if (schema === null || schema === undefined) return null
  const view = await io.state.view.read()
  const table = filteredList(schema, view.filter)[view.marker.schema]
  return table === undefined ? null : { table, engine: schema.type }
}

/** `tab` on the Schema tab: the next connection's schema, round the list. */
async function nextConnection(io: Port): Promise<void> {
  const list = (await io.state.connections.read())?.answer ?? []
  if (list.length === 0) return
  await io.state.view.update(v => {
    const at = list.findIndex(c => c.name === v.db)
    const to = (at + 1) % list.length
    return { ...v, db: list[to]!.name, filter: '', filtering: false, marker: { ...v.marker, schema: 0, connections: to } }
  })
  await requestSchema(io)
}

/** `q`: a hundred rows of the marked table, in the Editor, which opens. */
async function putQuery(io: Port): Promise<void> {
  const marked = await markedTable(io)
  if (marked === null) return
  await io.state.draft.update(() => sqlOf(marked.table.name, marked.engine))
  await io.state.view.update(v => ({ ...v, tab: 'editor', filtering: false }))
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

/** The wheel over a list longer than its window scrolls that list, the marker left where it is; false when the pointer is over none, or at its end. */
export async function wheelScrolled(io: Port, rows: readonly Row[], offset: number, pointer: { row: number; column: number }, by: number): Promise<boolean> {
  const moved = wheelMove(rows, offset, pointer, by)
  if (moved === null) return false
  await io.state.view.update(v => ({ ...v, scroll: { ...v.scroll, [moved.key]: moved.start } }))
  return true
}

/** What the pane's elements do, for the pane drawn through `io`: each action's failure (a teardown under it) is swallowed. */
export function handlersOf(io: Port): Handlers {
  return {
    press: (id, surface) => void Promise.resolve()
      .then(() => pressAction(io, id, surface))
      .catch(() => undefined),
    // The table filter is the one field so far (the Editor's arrives with the Editor tab).
    type: (field, value) => void Promise.resolve().then(() => (field === 'filter' ? typeFilter(io, value) : undefined)).catch(() => undefined),
    submit: (field, value) => void Promise.resolve().then(() => (field === 'filter' ? submitFilter(io, value) : undefined)).catch(() => undefined),
  }
}

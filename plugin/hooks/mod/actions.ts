/**
 * What the person's presses and keystrokes on the pane do: the press table
 * ({@link PRESSES}), the fields' keystrokes, and where the focus ring goes.
 * Each handler swallows its own failure, as one that outlives the session (a
 * teardown under it) must.
 */
import type { RenderSurface } from 'claude-code'

import type { PaneTab, View } from '../../types'
import { TABS } from '../lib/chrome'
import { walkable } from '../lib/layout'
import type { Port } from './port'

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
  await io.state.view.update(v => {
    const length = walkable(v.tab, connections)
    if (length === 0) return v
    const at = Math.min(Math.max(0, to(v, length)), length - 1)
    const db = v.tab === 'connections' ? (connections?.answer?.[at]?.name ?? v.db) : v.db
    return { ...v, marker: { ...v.marker, [v.tab]: at }, db }
  })
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
      if (TABS.some(t => t.id === tab)) await io.state.view.update(v => ({ ...v, tab }))
    },
  ],
  ['row:', (io, rest) => (/^\d+$/.test(rest) ? mark(io, () => Number(rest)) : undefined)],
  ['down', io => mark(io, v => v.marker[v.tab] + 1)],
  ['up', io => mark(io, v => v.marker[v.tab] - 1)],
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

/** What the pane's elements do, for the pane drawn through `io`: each action's failure (a teardown under it) is swallowed. */
export function handlersOf(io: Port): Handlers {
  return {
    press: (id, surface) => void Promise.resolve()
      .then(() => pressAction(io, id, surface))
      .catch(() => undefined),
    // The fields arrive with the Editor tab.
    type: () => undefined,
    submit: () => undefined,
  }
}

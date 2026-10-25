/**
 * The mod's own state for one load, and what it is reset to: the session
 * state's cells and what each starts as (`INITIAL`, which `register.tsx`
 * declares its atoms from), the module variables every other module reads
 * and writes (`mod`), and the few helpers that touch only that state.
 * Nothing here reaches the engine.
 */
import type { EngineInterface, PluginOptions, PluginState, Timer } from 'claude-code'

import { INITIAL_VIEW, withScrollsKept } from '../lib/layout'
import type { Row } from '../lib/types'
import type { CliAnswer, CliEnv } from './cli'

/** The pane's id, as the engine opens and draws it. */
export const PANE = 'argos'

/** Every cell the pane keeps, by key, as the plugin's state declares it. */
export type CellValues = { [K in keyof PluginState['argos']]-?: PluginState['argos'][K] }

/** What each cell starts as. */
export const INITIAL: CellValues = {
  view: INITIAL_VIEW,
  connections: null,
  config: null,
  schema: null,
  draft: '',
}

/**
 * The change function a cell's update runs through. The view lets the
 * wheel's windows go when the tab or the marker moves (withScrollsKept);
 * every other cell is changed as asked.
 */
export function cellChange<K extends keyof CellValues>(key: K, change: (v: CellValues[K]) => CellValues[K]): (v: CellValues[K]) => CellValues[K] {
  if (key !== 'view') return change
  const view = change as unknown as (v: CellValues['view']) => CellValues['view']
  return ((v: CellValues['view']) => withScrollsKept(v, view(v))) as unknown as (v: CellValues[K]) => CellValues[K]
}

/**
 * The key a field (the editor's SQL) is drawn under, and the one
 * `$.ui.focus` names to move into it. Never the field's own id: the Button
 * that opens a field shares that id, and Claude Code resolves a focus call by
 * key against the drawing it holds when the call arrives, the first element
 * under the key in document order. That can be the Button, still drawn: the
 * ring lands on it, the field never gets the keys, and once the next drawing
 * drops the Button the keyboard goes back to the prompt.
 */
export const fieldKey = (id: string): string => `field:${id}`

/**
 * Scrolls the element `key` into the pane's window, then focuses it, on a
 * timer after the press so the drawing that brings the field has already
 * happened. A scroll the engine refuses still focuses.
 */
export function focusField(io: { ui: Pick<EngineInterface['ui'], 'scroll' | 'focus'>; clock: Pick<EngineInterface['clock'], 'after'> }, id: string): void {
  const key = fieldKey(id)
  io.clock.after(0, () => {
    void io.ui
      .scroll({ in: PANE, to: { key } })
      .catch(() => undefined)
      .then(() => io.ui.focus({ requestId: PANE, key }))
      .catch(() => undefined)
  })
}

/** The `/argos` command's registration (`session.ts`). */
export function initialRegistration() {
  return {
    /** Whether `/argos` is registered; until it is, retries run on a timer and at each turn's end. */
    registered: false,
    /** The pending registration retry, if any. */
    timer: null as Timer | null,
    /** Whether a refused registration was logged this load: once is enough. */
    failureLogged: false,
  }
}

/** The session as the mod knows it. */
export function initialSession() {
  return {
    /** Set when the mod is turned off for the session: nothing reads, nothing registers. */
    disabled: false,
  }
}

/** The pane's reads (`loaders.ts`). */
export function initialLoads() {
  return {
    /**
     * Reads in flight, by the loader's flight key: a request while one runs
     * starts no second. Checked and set with no await between, so two presses
     * in the same tick cannot both start one.
     */
    fetching: new Set<string>(),
    /** The pending reads that wait out a pause, by loader. */
    timers: new Map<string, Timer>(),
    /** Bumped by every open of the pane: the connections are read again for each. */
    connectionsAsk: 0,
    /** Bumped by `r` on the Schema tab: the schema is read again, from the database. */
    schemaAsk: 0,
    /** The connection `r` asked a refresh of: its next read passes `--refresh`, once. */
    schemaFresh: null as string | null,
  }
}

/** The CLI runner's own state (`cli.ts`). */
export function initialCli() {
  return {
    /** argos.env.json as read once this load: what it says, or why it cannot be used. */
    env: null as Promise<CliAnswer<CliEnv>> | null,
  }
}

/** The state of one load, by area: what {@link reset} starts over from the factories above. */
function initialSlices() {
  return {
    session: initialSession(),
    registration: initialRegistration(),
    loads: initialLoads(),
    cli: initialCli(),
  }
}

/**
 * The mod's own state for one load, shared by its modules: what the session
 * state does not hold because nothing draws from it. `register` resets it
 * ({@link reset}), as a reload starts the module's variables over. Each slice
 * keeps its identity across a reset, so a module may hold one.
 */
export const mod = {
  ...initialSlices(),
  /**
   * Not reset: counters that only grow. A retry of an older load compares
   * against them, so starting them over could let it act again.
   */
  generations: {
    /** Bumped by each session start: a retry belongs to the generation it was scheduled in. */
    register: 0,
  },
  /** Not reset: the pane's body rows as last drawn, and the first row its window showed; the next draw replaces them. */
  drawn: {
    rows: [] as readonly Row[],
    offset: 0,
  },
}

/**
 * Starts the module's own state over for a load with `options`: a reload
 * runs `register` again, and nothing of the old load's may carry over. The
 * old load's timers are cancelled; every slice starts over in place.
 */
export function reset(options: PluginOptions): void {
  void options
  mod.generations.register++
  mod.registration.timer?.cancel()
  mod.loads.timers.forEach(timer => timer.cancel())
  const fresh = initialSlices()
  for (const key of Object.keys(fresh) as (keyof typeof fresh)[]) Object.assign(mod[key], fresh[key])
}

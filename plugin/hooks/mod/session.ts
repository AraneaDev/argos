/**
 * The session's life as the mod follows it: registering `/argos`, start-up,
 * the end of a turn, and the `/argos` command with the pane it toggles.
 */
import type { UiPane } from 'claude-code'

import { reloadConnections } from './loaders'
import type { Port } from './port'
import { mod, PANE } from './state'

/** What `/argos` answers to anything it does not take. */
const USAGE = 'Usage: /argos to toggle the Argos pane.'

/** How long to wait before each retry of a refused registration, in milliseconds; after the last, turn ends retry. */
const REGISTER_RETRY_MS = [500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * Registers `/argos`; false when the engine refuses, as it does when no
 * session is bound in the process yet (the moment after a hot reload). The
 * first refusal leaves one debug line.
 */
export async function registerCommand(io: Port): Promise<boolean> {
  if (mod.registration.registered) return true
  try {
    await io.command.register({ name: 'argos', description: 'Toggle the Argos pane: connections, schema and every query Claude runs' })
    mod.registration.registered = true
    return true
  } catch (err) {
    if (!mod.registration.failureLogged) {
      mod.registration.failureLogged = true
      void Promise.resolve(io.ui.log(`argos: could not register /argos yet, retrying (${message(err)})`, { to: 'debug' })).catch(() => undefined)
    }
    return false
  }
}

/** Retries a refused registration after the `attempt`-th delay, then the next; past the last, the end of a turn tries again. */
export function retryRegister(io: Port, attempt: number, gen = mod.generations.register): void {
  const delay = REGISTER_RETRY_MS[attempt]
  if (delay === undefined || mod.registration.registered || mod.session.disabled || gen !== mod.generations.register) return
  try {
    mod.registration.timer = io.clock.after(delay, () => {
      mod.registration.timer = null
      if (gen !== mod.generations.register) return
      void registerCommand(io)
        .then(done => (done ? undefined : retryRegister(io, attempt + 1, gen)))
        .catch(() => undefined)
    })
  } catch {
    mod.registration.timer = null
  }
}

/** Start-up: the pane opens at once when the person asked for that (`openPaneOnStart`). */
export async function startUp(io: Port, openOnStart: boolean): Promise<void> {
  if (openOnStart) await openPane(io)
}

/**
 * Opens the pane and reads the connections again: every open does, so the
 * pane never presents an old list as current. The read runs on a timer. A
 * refused or unplaced pane is the person's layout, not a failure of the mod.
 */
export async function openPane(io: Port): Promise<void> {
  await reloadConnections(io)
  await io.ui.open({ id: PANE, title: 'Argos' }).catch(() => undefined)
}

/** Whether the pane is open now. */
async function paneOpen(io: Port): Promise<boolean> {
  const panes = (await io.ui.panes().catch(() => [])) as UiPane[]
  return panes.some((pane: UiPane) => pane.id === PANE)
}

/** `/argos` toggles the pane. Never throws: a failure is said as the command's answer. */
export async function runCommand(io: Port, args: string): Promise<string> {
  try {
    if (args.trim() !== '') return USAGE
    if (await paneOpen(io)) {
      await io.ui.close({ id: PANE }).catch(() => undefined)
      return 'Argos pane closed.'
    }
    await openPane(io)
    return 'Argos pane opened.'
  } catch (err) {
    return `argos: ${message(err)}`
  }
}

/** A turn of the main loop has ended: a registration still refused once the timed retries ran out is asked for again. */
export async function endTurn(io: Port, agentId: string | undefined): Promise<void> {
  if (agentId !== undefined || mod.session.disabled) return
  if (!mod.registration.registered && mod.registration.timer === null) await registerCommand(io)
}

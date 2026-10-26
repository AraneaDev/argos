/**
 * The read-only `argos` CLI as the pane runs it: the paths the install wrote
 * into `hooks/argos.env.json` (hooks cannot see the MCP server's
 * environment), read once a load, and one run of a command that prints one
 * JSON value. Never throws: every failure comes back as the one line the
 * pane shows under its header.
 */
import { parseCliError } from '../lib/parse'
import { printable, printableDeep } from '../lib/printable'
import type { Port } from './port'
import { mod } from './state'

/** What a run gave: the value printed, parsed, or why there is none, as the pane says it. */
export type CliAnswer<T> = { ok: true; value: T } | { ok: false; reason: string }

/** What `argos install-plugin` writes: the node binary, the CLI's script and the config.ini it reads. */
export type CliEnv = { node: string; cli: string; config: string }

/** How long one command may run: a cold start opening an SSH tunnel takes seconds. */
export const CLI_TIMEOUT_MS = 30_000

/** A query run on the person's behalf may take as long as a query may. */
export const QUERY_TIMEOUT_MS = 120_000

/** Why nothing runs when the install's paths are missing or unreadable. */
export const NOT_INSTALLED = 'argos: plugin not installed by argos install-plugin'

/** Why a run gave nothing when the engine cut its output short. */
export const OUTPUT_TOO_LARGE = 'output too large'

/** Why a command could not be run, or gave nothing the pane can read. */
const couldNotRun = (why: string): string => `argos: could not run the argos CLI (${why})`

/** Why a call failed, without the `<plugin>: $.<noun>.<method>: ` the engine puts before a refusal it passes on. */
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err)).replace(/^[\w-]+: \$\.[\w.]+: /, '')

/** argos.env.json's text as the install writes it, or null for anything else. */
function envOf(text: string): CliEnv | null {
  try {
    const raw = JSON.parse(text) as Record<string, unknown> | null
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
    const { node, cli, config } = raw
    return typeof node === 'string' && typeof cli === 'string' && typeof config === 'string' ? { node, cli, config } : null
  } catch {
    return null
  }
}

/** The paths the install wrote, read once a load; a missing or unreadable file says the plugin was not installed by the CLI. */
export function cliEnv(io: Port): Promise<CliAnswer<CliEnv>> {
  if (mod.cli.env !== null) return mod.cli.env
  const read: Promise<CliAnswer<CliEnv>> = Promise.resolve()
    .then(() => io.fs.read(`${io.plugin.root}/hooks/argos.env.json`))
    .then((text: unknown): CliAnswer<CliEnv> => {
      const env = typeof text === 'string' ? envOf(text) : null
      return env === null ? { ok: false, reason: NOT_INSTALLED } : { ok: true, value: env }
    })
    .catch((): CliAnswer<CliEnv> => ({ ok: false, reason: NOT_INSTALLED }))
  mod.cli.env = read
  return read
}

/**
 * stdout as JSON, or undefined when it is none. Every string in it comes back
 * printable: names, SQL and result cells come from a database, and an escape
 * sequence left in one would reach the terminal.
 */
function jsonOf(stdout: string): unknown {
  try {
    return printableDeep(JSON.parse(stdout) as unknown)
  } catch {
    return undefined
  }
}

/**
 * Runs `argos <args> --config <config>` with the node binary and script the
 * install wrote, and reads the one JSON value it printed with `parse`. The
 * CLI's own `{ error }` is passed on as it said it; a binary that would not
 * start or ran out of time, an exit with nothing to say, or output that is
 * not the shape asked for each come back as a reason. Never throws.
 */
export async function runCli<T>(io: Port, args: string[], parse: (raw: unknown) => T | null, timeoutMs = CLI_TIMEOUT_MS): Promise<CliAnswer<T>> {
  try {
    const env = await cliEnv(io)
    if (!env.ok) return env
    const { node, cli, config } = env.value
    let ran: { exitCode: number; stdout: string; stderr: string }
    try {
      ran = await io.process.run([node, cli, ...args, '--config', config], { timeoutMs })
    } catch (err) {
      return { ok: false, reason: couldNotRun(message(err)) }
    }
    if ((ran as { isStdoutTruncated?: boolean }).isStdoutTruncated === true) return { ok: false, reason: OUTPUT_TOO_LARGE }
    const raw = jsonOf(ran.stdout)
    const error = parseCliError(raw)
    if (error !== null) return { ok: false, reason: error }
    if (ran.exitCode !== 0) {
      const said = (ran.stderr ?? '').split('\n').find(l => l.trim() !== '')?.trim()
      const shown = said === undefined ? undefined : printable(said)
      return { ok: false, reason: couldNotRun(shown === undefined ? `exit ${ran.exitCode}` : `exit ${ran.exitCode}: ${shown}`) }
    }
    if (raw === undefined) return { ok: false, reason: couldNotRun('its answer was not JSON') }
    const value = parse(raw)
    return value === null ? { ok: false, reason: couldNotRun(`its answer to ${args[0] ?? 'the command'} was not the shape the pane reads`) } : { ok: true, value }
  } catch (err) {
    return { ok: false, reason: couldNotRun(message(err)) }
  }
}

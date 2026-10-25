/**
 * The hooks module: the session state's atoms, the engine port the mod's
 * modules reach the engine through (see `mod/port.ts` for why), and the
 * hooks, each wired to what `mod/` does. The engine loads this file and
 * every file it imports from the plugin.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { focusLanded, focusMoved, handlersOf, wheelScrolled } from './mod/actions'
import { isQueryTool, liveFeed } from './mod/loaders'
import type { Port } from './mod/port'
import { drawPane, failurePane } from './mod/render'
import { endTurn, registerCommand, retryRegister, runCommand, startUp } from './mod/session'
import { cellChange, INITIAL, mod, PANE, reset } from './mod/state'

// Each atom starts as ./mod/state says: the engine takes `read` and `update` only on atoms declared in this file.
const view = atom({ plugin: 'argos', key: 'view' } as const, INITIAL.view)
const connections = atom({ plugin: 'argos', key: 'connections' } as const, INITIAL.connections)
const config = atom({ plugin: 'argos', key: 'config' } as const, INITIAL.config)
const schema = atom({ plugin: 'argos', key: 'schema' } as const, INITIAL.schema)
const draft = atom({ plugin: 'argos', key: 'draft' } as const, INITIAL.draft)
const history = atom({ plugin: 'argos', key: 'history' } as const, INITIAL.history)
const pins = atom({ plugin: 'argos', key: 'pins' } as const, INITIAL.pins)
const result = atom({ plugin: 'argos', key: 'result' } as const, INITIAL.result)
const editor = atom({ plugin: 'argos', key: 'editor' } as const, INITIAL.editor)

/**
 * The engine as the mod's modules reach it, from this dispatch's `$`. The
 * engine follows `$` only into functions of this file and takes `read` and
 * `update` only on an atom declared here, so every call the modules make is
 * spelled out once below, and every atom is handed over as a cell.
 */
function portOf($: EngineInterface): Port {
  return {
    clock: { now: () => $.clock.now(), after: (ms, run) => $.clock.after(ms, run), every: (ms, run) => $.clock.every(ms, run) },
    ui: {
      log: (text, options) => $.ui.log(text, options),
      toast: text => $.ui.toast(text),
      copy: args => $.ui.copy(args),
      focus: args => $.ui.focus(args),
      scroll: args => $.ui.scroll(args),
      panes: () => $.ui.panes(),
      invalidate: event => $.ui.invalidate(event),
      open: args => $.ui.open(args),
      close: args => $.ui.close(args),
    },
    session: { root: () => $.session.root(), id: () => $.session.id() },
    process: { run: (argv, options) => $.process.run(argv, options) },
    fs: { read: (path, options) => $.fs.read(path, options) },
    store: { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value) },
    command: { register: args => $.command.register(args) },
    prompt: { fill: args => $.prompt.fill(args) },
    plugin: { root: $.plugin.root },
    state: {
      // A move of the tab or the marker lets the wheel's windows go (withScrollsKept).
      view: { read: () => read($, view), update: change => update($, view, cellChange('view', change)) },
      connections: { read: () => read($, connections), update: change => update($, connections, change) },
      config: { read: () => read($, config), update: change => update($, config, change) },
      schema: { read: () => read($, schema), update: change => update($, schema, change) },
      draft: { read: () => read($, draft), update: change => update($, draft, change) },
      history: { read: () => read($, history), update: change => update($, history, change) },
      pins: { read: () => read($, pins), update: change => update($, pins, change) },
      result: { read: () => read($, result), update: change => update($, result, change) },
      editor: { read: () => read($, editor), update: change => update($, editor, change) },
    },
  }
}

export const register: Register = (on, options) => {
  if (options.enabled === false) return
  reset(options)
  const openOnStart = options.openPaneOnStart === true

  on('session.start', async ($, e, next) => {
    const io = portOf($)
    // A refused registration (no session bound yet, after a hot reload) is retried; start-up goes on regardless.
    const gen = ++mod.generations.register
    mod.registration.timer?.cancel()
    mod.registration.timer = null
    if (!(await registerCommand(io))) retryRegister(io, 0, gen)
    // A start-up that outlives the session (torn down under it) fails quietly, never as a stray rejection.
    $.clock.after(0, () => void startUp(io, openOnStart).catch(() => undefined))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await endTurn(portOf($), e.agentId).catch(() => undefined)
    return result
  })

  // runCommand says its own failures; a hook that fails anyway answers rather than leave /argos unanswered.
  on('command.run', { command: 'argos' }, async ($, e) => ({ text: await runCommand(portOf($), e.args) })).catch(() => ({ text: 'argos: the command failed' }))

  // Claude ran a query: the journal is read again so the pane shows it at once. The one unmatched tool.call handler of the module;
  // it filters at runtime, adds nothing to the model's context and does not depend on `_meta` reaching the hook.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (isQueryTool(e.tool, options.serverName)) await liveFeed(portOf($)).catch(() => undefined)
    return ran
  })

  // Tab or a click landing on a tab's hidden twin moves onto the tab; landing on a listed row moves the marker with it.
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const io = portOf($)
    // A person's move names the element; a `$.ui.focus` call may arrive as its own arguments, naming it `key`.
    const asked = e.element ?? (e as { key?: unknown }).key
    const moved = await focusMoved(io, asked).catch(() => null)
    const redirected = moved === null ? e : e.element === undefined ? ({ ...e, key: moved.to } as typeof e) : { ...e, element: moved.to }
    const landed = await next(redirected)
    const element = moved === null ? asked : moved.to
    if (landed.deny === undefined && typeof element === 'string') await focusLanded(io, element).catch(() => undefined)
    return landed
  }).catch((_$, e, next) => next(e))

  // The wheel over a list longer than its window scrolls that list, the marker left where it is; anywhere else the page scrolls.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.origin.kind !== 'person' || e.pointer === undefined) return next(e)
    // At a list's end, or over none, the page takes the wheel, as a browser hands it on.
    return (await wheelScrolled(portOf($), mod.drawn.rows, mod.drawn.offset, e.pointer, e.by).catch(() => false)) ? {} : next(e)
  })

  // Nothing in drawing throws into the session: a draw that fails anyway is one dim line saying why.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const io = portOf($)
    return drawPane(io, $.ui.resolve(e), e.surface, e.props, handlersOf(io))
  }).catch(($, e) => failurePane(handlersOf(portOf($)), $.ui.resolve(e), e.props?.bodyColumns ?? 40, e.surface === 'terminal', 'the draw failed'))
}

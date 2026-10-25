/**
 * What the pane draws: its model from state, the laid-out rows as elements.
 * Drawing reads state but acts on nothing: what a press does is handed in
 * ({@link Handlers}), and nothing it reads is started from here (the loaders
 * run on timers).
 */
import type { Elements, RenderElement, RenderNode, RenderSurface, UiPressArgument } from 'claude-code'

import { paneHeight } from '../lib/cards'
import { paneLayout } from '../lib/layout'
import type { PaneModel } from '../lib/layout'
import { dimRow, pressLabel, rowsHeight, textStyle } from '../lib/rows'
import { cells } from '../lib/text'
import type { Row, Segment } from '../lib/types'
import type { Handlers } from './actions'
import type { Port } from './port'
import { fieldKey, mod } from './state'

/** A segment no press or field sets apart: plain text. */
const plain = (s: Segment): boolean => s.press === undefined && s.field === undefined

/**
 * The room each field of a row `columns` wide takes, by the field's index: a
 * field takes the blank cells laid out after it (`next` is the first
 * segment past them) and stops where the row's next drawn segment (a card's
 * frame) begins.
 */
export function fieldRooms(segments: readonly Segment[], columns: number): Map<number, { room: number; next: number }> {
  const rooms = new Map<number, { room: number; next: number }>()
  let x = 0
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!
    if (s.field === undefined) {
      x += s.hidden === true ? 0 : cells(s.text)
      continue
    }
    let next = i + 1
    while (next < segments.length && plain(segments[next]!) && segments[next]!.bg === undefined && /^ *$/.test(segments[next]!.text)) next++
    const trailing = segments.slice(next).reduce((n, t) => n + (t.hidden === true ? 0 : cells(t.text)), 0)
    const room = Math.max(1, columns - x - trailing)
    rooms.set(i, { room, next })
    x += room
    i = next - 1
  }
  return rooms
}

/**
 * One segment as an element: a pressable segment is a plain Button, a field
 * an Input, any other a Text. A Button with a background (the open tab, the
 * marked row) stands in a Box of that colour, which it cannot take itself.
 *
 * Nothing a segment draws can wrap or push its row wider: every Text cuts at
 * its edge (`truncate-end`) inside a row exactly as wide as the pane; a
 * Button draws the segment's own text as its label ({@link pressLabel}), so
 * it takes exactly the cells the layout gave it; a field's Box takes the
 * rest of its row (`room`). Off the terminal a Button and a field are the
 * surface's own, whose width the pane cannot know in cells: the row's width
 * and overflow clip them at its edge.
 */
function drawSegment(act: Handlers, ui: Elements[RenderSurface], s: Segment, terminal: boolean, room: number) {
  const { Box, Button, Text } = ui
  // Every surface but mobile has a text field; there a field is shown as text.
  const Input = 'Input' in ui ? ui.Input : undefined
  const native = s.press !== undefined || s.field !== undefined
  const width = s.field !== undefined && Input !== undefined ? Math.max(1, room) : cells(s.text)
  const sized = !native || terminal ? { width } : {}
  const framed = (element: RenderNode, key?: string, bg?: string) => (
    <Box {...(key === undefined ? {} : { key })} {...sized} flexShrink={0} {...(bg === undefined ? {} : { backgroundColor: bg })}>
      {element}
    </Box>
  )
  // A Button draws exactly its segment's cells: only a tint needs a Box under it.
  const ground = (key: string, element: RenderNode) => (s.bg === undefined ? element : framed(element, `${key}-bg`, s.bg))
  if (s.field && Input !== undefined) {
    return framed(
      <Input
        key={fieldKey(s.field.id)}
        value={s.field.value}
        placeholder={s.field.placeholder}
        submitLabel="run"
        autoFocus
        onInput={(value: string) => act.type(s.field!.id, value)}
        onSubmit={(value: string) => act.submit(s.field!.id, value)}
      />,
    )
  }
  if (s.press && s.hidden) {
    // Out of sight, there only for its hotkey (a tab drawn as its digit alone).
    return (
      <Box key={s.press.id} display="none">
        <Button key={s.press.id} plain label={s.press.label} {...(s.press.hotkey === undefined ? {} : { hotkey: s.press.hotkey })} onPress={(pressed: UiPressArgument) => act.press(s.press!.id, pressed.surface)} />
      </Box>
    )
  }
  if (s.press) {
    return ground(
      s.press.id,
      <Button
        key={s.press.id}
        plain
        label={pressLabel(s)}
        {...(s.press.hotkey === undefined ? {} : { hotkey: s.press.hotkey })}
        {...(s.dim ? { dimColor: true } : {})}
        onPress={(pressed: UiPressArgument) => act.press(s.press!.id, pressed.surface)}
      />,
    )
  }
  return (
    <Text wrap="truncate-end" {...textStyle(s)}>
      {s.text}
    </Text>
  )
}

/** A run of segments with neighbours of one style joined, so each style change is one piece; blank cells take any style. */
function mergedRun(run: Segment[]): Segment[] {
  const out: Segment[] = []
  for (const piece of run) {
    const r = piece.bg === undefined && /^ *$/.test(piece.text) ? { text: piece.text } : piece
    const last = out[out.length - 1]
    const same = last !== undefined && JSON.stringify(textStyle(last)) === JSON.stringify(textStyle(r))
    if (same) out[out.length - 1] = { ...last, text: last.text + r.text }
    else out.push(r)
  }
  return out
}

/** A run of plain segments as one Text that cuts at its edge: a lone segment styled itself, else its styled pieces nested in it and the rest bare strings. */
function textRun(Text: Elements[RenderSurface]['Text'], run: Segment[]): RenderNode {
  const pieces = mergedRun(run)
  if (pieces.length === 1) {
    return (
      <Text wrap="truncate-end" {...textStyle(pieces[0]!)}>
        {pieces[0]!.text}
      </Text>
    )
  }
  return <Text wrap="truncate-end">{pieces.map(r => (Object.keys(textStyle(r)).length === 0 ? r.text : <Text {...textStyle(r)}>{r.text}</Text>))}</Text>
}

/**
 * One laid-out row as elements (see {@link drawSegment}): a Box exactly
 * `columns` wide that clips what passes its edge, so a row can neither wrap
 * nor widen the pane. A run of plain text is one Text, its styled pieces
 * nested in it: a tall pane stays far inside the engine's bounds.
 */
function drawRow(act: Handlers, ui: Elements[RenderSurface], row: Row, columns: number, terminal: boolean) {
  const { Box, Text } = ui
  const drawn: RenderNode[] = []
  const rooms = fieldRooms(row.segments, columns)
  let x = 0
  for (let i = 0; i < row.segments.length; i++) {
    const s = row.segments[i]!
    const field = rooms.get(i)
    if (field !== undefined) {
      drawn.push(drawSegment(act, ui, s, terminal, field.room))
      x += field.room
      i = field.next - 1
      continue
    }
    if (!plain(s)) {
      drawn.push(drawSegment(act, ui, s, terminal, columns - x))
      x += s.hidden === true ? 0 : cells(s.text)
      continue
    }
    const run: Segment[] = [s]
    while (i + 1 < row.segments.length && plain(row.segments[i + 1]!)) run.push(row.segments[++i]!)
    x += run.reduce((n, r) => n + cells(r.text), 0)
    drawn.push(textRun(Text, run))
  }
  return (
    <Box key={row.key} flexDirection="row" width={columns} overflow="hidden">
      {drawn}
    </Box>
  )
}

/** The pane's model from state: everything a layout reads, read once per render. */
async function paneModel(io: Port, terminal: boolean): Promise<PaneModel> {
  return {
    config: await io.state.config.read(),
    connections: await io.state.connections.read(),
    schema: await io.state.schema.read(),
    history: await io.state.history.read(),
    pins: await io.state.pins.read(),
    result: await io.state.result.read(),
    draft: await io.state.draft.read(),
    editor: await io.state.editor.read(),
    since: mod.session.startedAt,
    view: await io.state.view.read(),
    now: await io.clock.now(),
    terminal,
  }
}

/** The pane when it could not be drawn: one dim line saying why. */
export function failurePane(act: Handlers, ui: Elements[RenderSurface], columns: number, terminal: boolean, err: unknown): RenderElement {
  const { Box } = ui
  const why = err instanceof Error ? err.message : String(err)
  return (
    <Box key="pane" flexDirection="column">
      {drawRow(act, ui, dimRow('failure', `argos: the pane could not be drawn (${why})`, Math.max(1, columns)), Math.max(1, columns), terminal)}
    </Box>
  )
}

/**
 * The Argos pane, for a pane `bodyColumns` wide scrolled as `scroll` says.
 * When the rows are taller than the window the footer bar is drawn over its
 * last rows wherever it is scrolled to. A failure to draw is one dim line,
 * never a throw into the session.
 */
export async function drawPane(io: Port, ui: Elements[RenderSurface], surface: RenderSurface, props: { bodyColumns: number; scroll?: { offset: number; bodyRows: number } }, act: Handlers): Promise<RenderElement> {
  const { Box } = ui
  const columns = Math.max(1, props.bodyColumns)
  const terminal = surface === 'terminal'
  let laidOut: ReturnType<typeof paneLayout>
  try {
    laidOut = paneLayout(await paneModel(io, terminal), columns, paneHeight(props.scroll))
  } catch (err) {
    return failurePane(act, ui, columns, terminal, err)
  }
  const height = paneHeight(props.scroll)
  const offset = Math.max(0, props.scroll?.offset ?? 0)
  // Kept for the wheel: the last layout drawn is the one on screen.
  mod.drawn.rows = laidOut.body
  mod.drawn.offset = offset
  if (!laidOut.pinned) {
    return (
      <Box key="pane" flexDirection="column">
        {[...laidOut.body, ...laidOut.footer].map(row => drawRow(act, ui, row, columns, terminal))}
      </Box>
    )
  }
  // Taller than the window: the bar is drawn over its last rows wherever it is scrolled to, and the body ends in room for it.
  const reserve: Row[] = laidOut.footer.map((_, i) => ({ key: `bar-room-${i}`, segments: [{ text: ' ' }] }))
  const top = Math.min(offset, rowsHeight(laidOut.body) + reserve.length - height) + height - laidOut.footer.length
  return (
    <Box key="pane" flexDirection="column">
      {[...laidOut.body, ...reserve].map(row => drawRow(act, ui, row, columns, terminal))}
      <Box key="bar" position="absolute" top={Math.max(0, top)} left={0} width={columns} flexDirection="column">
        {laidOut.footer.map(row => drawRow(act, ui, row, columns, terminal))}
      </Box>
    </Box>
  )
}

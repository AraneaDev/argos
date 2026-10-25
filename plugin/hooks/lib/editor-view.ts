/**
 * The Editor tab's cards: the SQL field with the connection it will run on,
 * how the last run ended (a refusal or a failure in the alert tone), and the
 * result grid of that run.
 *
 * Pure: the model in, blocks out.
 */
import type { EditorState } from '../../types'
import type { Arrangement, Block, Section } from './cards'
import type { ConnectionView } from './contract'
import { CARD_ICON, mark, OUTCOME } from './marks'
import { CHIP_BG, engineColour, STATUS_COLOURS } from './palette'
import { metaOf, resultBlock } from './queries-view'
import { clip } from './rows'
import { padEnd } from './text'
import type { Row, Segment } from './types'

/** What the Editor draws. */
export type EditorModel = {
  /** The SQL being typed. */
  draft: string
  /** The connection the SQL runs on; undefined when none is picked. */
  connection: ConnectionView | undefined
  /** How many connections `n` cycles through. */
  connections: number
  editor: EditorState
  now?: number
}

/** The field's id, and so (through `fieldKey`) its key. */
export const SQL_FIELD = 'sql'

const LABEL = 8

/** The card with the connection, the field and how the last run ended. */
function editorBlock(model: EditorModel): Block {
  return {
    key: 'editor',
    make: (inner): Section => {
      const c = model.connection
      const colour = c === undefined ? undefined : engineColour(c.type)
      const connection: Segment[] = [
        { text: padEnd(' connection', LABEL + 3), dim: true },
        ...(c === undefined ? [{ text: 'none picked', dim: true }] : [{ text: c.name, bold: true }, { text: '  ' }, { text: ` ${c.type} `, ...(colour === undefined ? { dim: true } : { color: colour }), bg: CHIP_BG }, { text: '  ' }, c.selectOnly ? { text: 'SELECT_ONLY', color: STATUS_COLOURS.ok } : { text: 'full access', color: STATUS_COLOURS.warn }]),
      ]
      const field: Segment[] = [{ text: padEnd(' sql', LABEL + 3), dim: true }, { text: model.draft, field: { id: SQL_FIELD, value: model.draft, placeholder: 'SELECT … — enter runs it, read-only' } }]
      const body: Row[] = [
        { key: 'editor-connection', segments: clip(connection, inner) },
        { key: 'editor-sql', segments: field },
        { key: 'editor-status', segments: clip([{ text: ' ' }, ...statusOf(model)], inner) },
      ]
      return { key: 'editor', title: 'Editor', glyph: CARD_ICON.query, body }
    },
  }
}

/** How the last run ended: running, refused, failed, ran, or not run yet. */
function statusOf({ editor, now }: EditorModel): Segment[] {
  if (editor.running) return [{ text: 'running…', dim: true }]
  if (editor.failure !== null) return [mark(OUTCOME.error, ' '), { text: editor.failure, color: STATUS_COLOURS.alert }]
  const entry = editor.entry
  if (entry === null) return [{ text: 'not run yet', dim: true }]
  if (entry.outcome === 'ok') return [mark(OUTCOME.ok, ' '), { text: metaOf(entry, now), dim: true }]
  const reason = entry.reason ?? (entry.outcome === 'blocked' ? 'not a SELECT' : 'the query failed')
  return [mark(OUTCOME[entry.outcome], ' '), { text: entry.outcome === 'blocked' ? `refused: ${reason}` : reason, color: STATUS_COLOURS.alert }]
}

/** The Editor tab: the field above the result of its last run. */
export function editorArrangement(model: EditorModel): Arrangement {
  const { entry, page } = model.editor
  const note = entry === null || entry.outcome !== 'ok' || page !== null ? undefined : model.editor.running ? 'running…' : 'reading the result…'
  const result = resultBlock({ result: page, ...(note === undefined ? { resultNote: entry === null ? 'run a query to see rows' : 'no result' } : { resultNote: note }) }, undefined)
  const editor = editorBlock(model)
  return { left: [editor, result], order: [editor, result] }
}

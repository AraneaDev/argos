import { arrange, scrolledTo } from '../cards'
import type { SchemaView } from '../contract'
import { paneLayout } from '../layout'
import type { PaneModel } from '../layout'
import { queriesArrangement } from '../queries-view'
import type { QueriesModel } from '../queries-view'
import { schemaArrangement } from '../schema-view'
import type { SchemaOptions } from '../schema-view'
import { tierOf } from '../table'
import type { Tier } from '../table'
import type { Row } from '../types'

/** Every row the pane draws, the footer last: {@link paneLayout}'s body and footer as one list. */
export function paneRows(state: PaneModel, columns: number, rows: number): Row[] {
  const laid = paneLayout(state, columns, rows)
  return [...laid.body, ...laid.footer]
}

/**
 * The Queries tab's rows in `columns` cells and `room` rows at `tier`: the
 * lists cut to windows round the marker, or where the wheel left them
 * (`scroll`, by card key).
 */
export function queriesRows(model: QueriesModel, columns: number, tier: Tier, room: number, scroll: Record<string, number>): Row[] {
  const at = { ...model, selected: Math.min(Math.max(0, model.selected), Math.max(0, model.history.length - 1)) }
  return arrange(scrolledTo(queriesArrangement(at, tier), scroll), columns, room, true, tier === tierOf(columns) ? undefined : tier)
}

/**
 * The Schema tab's rows in `columns` cells and `room` rows at `tier`: the
 * lists cut to windows round the marker, or where the wheel left them
 * (`scroll`, by card key).
 */
export function schemaRows(view: SchemaView, selected: number, columns: number, tier: Tier, room: number, scroll: Record<string, number>, options: SchemaOptions = {}): Row[] {
  return arrange(scrolledTo(schemaArrangement(view, selected, tier, options), scroll), columns, room, true, tier === tierOf(columns) ? undefined : tier)
}

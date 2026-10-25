import { describe, expect, it } from 'vitest'

import type { Handlers } from './actions'
import { drawPane, failurePane } from './render'
import { fakePort } from './__tests__/fake-port'

// Elements as the JSX stub makes them: { type, props }.
const ui = { Box: 'Box', Text: 'Text', Button: 'Button', Input: 'Input' } as never
const act: Handlers = { press: () => undefined, type: () => undefined, submit: () => undefined }

/** Every string in an element tree, joined. */
function textOf(node: unknown): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node !== null && typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: unknown } }).props.children)
  return ''
}

describe('a pane that cannot be drawn', () => {
  it('draws one dim failure line when the state cannot be read, and does not throw', async () => {
    const port = fakePort()
    const real = port.io.state
    ;(port.io as { state: unknown }).state = { config: real.config, connections: real.connections, schema: real.schema, history: real.history, pins: real.pins, result: real.result, view: { read: () => Promise.reject(new Error('torn down')), update: real.view.update } }
    const drawn = await drawPane(port.io, ui, 'terminal', { bodyColumns: 100 }, act)
    expect(textOf(drawn)).toContain('argos: the pane could not be drawn (torn down)')
  })

  it('draws one dim failure line when the layout fails', async () => {
    const port = fakePort()
    const drawn = await drawPane(port.io, ui, 'terminal', { bodyColumns: 100, scroll: null as never }, act)
    expect(textOf(drawn)).toContain('argos: the pane could not be drawn')
  })

  it('says why, and draws at any width, even a nonsensical one', () => {
    expect(textOf(failurePane(act, ui, 100, true, new Error('x')))).toContain('could not be drawn (x)')
    for (const columns of [0, -5, 20]) expect(() => failurePane(act, ui, columns, true, 'x')).not.toThrow()
  })

  it('draws the pane itself when nothing fails', async () => {
    const drawn = await drawPane(fakePort().io, ui, 'terminal', { bodyColumns: 100 }, act)
    expect(textOf(drawn)).toContain('History')
  })
})

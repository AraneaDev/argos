import { describe, expect, it } from 'vitest'

import { readFileSync } from 'node:fs'

import { handlersOf } from './actions'
import type { Handlers } from './actions'
import { reset } from './state'
import { drawnText, drawPane, failurePane } from './render'
import { fakePort } from './__tests__/fake-port'

const SCHEMA = JSON.parse(readFileSync(new URL('../../../tests/fixtures/pane-contract/schema.json', import.meta.url), 'utf8'))

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
    ;(port.io as { state: unknown }).state = { config: real.config, connections: real.connections, schema: real.schema, history: real.history, pins: real.pins, result: real.result, draft: real.draft, editor: real.editor, view: { read: () => Promise.reject(new Error('torn down')), update: real.view.update } }
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

/** The Input drawn under a key beginning `key`, found in an element tree. */
function inputOf(node: unknown, key: string): { key: string; props: Record<string, unknown> } | undefined {
  if (node === null || typeof node !== 'object') return undefined
  if (Array.isArray(node)) return node.map(n => inputOf(n, key)).find(v => v !== undefined)
  const { type, props = {}, key: own, children } = node as { type?: string; props?: Record<string, unknown>; key?: string; children?: unknown }
  if (type === 'Input' && String(own).startsWith(key)) return { key: String(own), props }
  return inputOf(children, key) ?? inputOf(props.children, key)
}

const drawn = (port: ReturnType<typeof fakePort>) => drawPane(port.io, ui, 'terminal', { bodyColumns: 100 }, act)

describe('fast typing into a field', () => {
  it('draws the SQL field with the text it first had, under one key, while it is typed into, so a late drawing cannot set the text back', async () => {
    reset({})
    const port = fakePort({ cells: { view: { ...(fakePort().values.get('view') as object), tab: 'editor' } as never, draft: 'D' } })
    const first = inputOf(await drawn(port), 'field:sql')
    for (const text of ['DE', 'DEL']) {
      handlersOf(port.io).type('sql', text)
      await port.advance()
      await port.advance()
    }
    const later = inputOf(await drawn(port), 'field:sql')
    expect(first?.props.value).toBe('D')
    expect(later?.props.value).toBe('D')
    expect(later?.key).toBe(first?.key)
    expect(port.values.get('draft')).toBe('DEL')
  })

  it('draws the Schema filter the same way', async () => {
    reset({})
    const base = fakePort().values.get('view') as object
    const port = fakePort({ cells: { view: { ...base, tab: 'schema', filtering: true, db: 'a' } as never, schema: { db: 'a', ask: 0, phase: 'done', answer: SCHEMA, failure: null } as never } })
    const first = inputOf(await drawn(port), 'field:filter')
    handlersOf(port.io).type('filter', 'ord')
    await port.advance()
    await port.advance()
    const later = inputOf(await drawn(port), 'field:filter')
    expect(first).toBeDefined()
    expect(later?.props.value).toBe(first?.props.value)
    expect(later?.key).toBe(first?.key)
  })

  it('draws a field with the text it holds anew after a tab change', async () => {
    reset({})
    const base = fakePort().values.get('view') as object
    const port = fakePort({ cells: { view: { ...base, tab: 'editor' } as never, draft: 'D' } })
    expect(inputOf(await drawn(port), 'field:sql')?.props.value).toBe('D')
    handlersOf(port.io).type('sql', 'DEL')
    await port.advance()
    await port.advance()
    handlersOf(port.io).press('tab:schema')
    await port.advance()
    await port.advance()
    handlersOf(port.io).press('tab:editor')
    await port.advance()
    await port.advance()
    expect(inputOf(await drawn(port), 'field:sql')?.props.value).toBe('DEL')
  })
})

describe('drawnText', () => {
  it('counts the text of every element, whether its children sit beside its props or inside them', () => {
    expect(drawnText({ props: { label: 'abc' }, children: ['de', { props: { children: 'f' } }] })).toBe(6)
    expect(drawnText({ props: { children: ['ab', { props: { text: 'cd' } }] } })).toBe(4)
    expect(drawnText(null)).toBe(0)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'

import type { View } from '../../types'
import { focusMoved, handlersOf, pressOf } from './actions'
import { reset } from './state'
import { fakePort } from './__tests__/fake-port'

const conn = (name: string) => ({ name, type: 'sqlite', host: null, ssh: false, ssl: false, selectOnly: true, mcpConfigurable: false, schemaCapturedAt: null })
const LISTED = { ask: 1, phase: 'done' as const, answer: [conn('a'), conn('b'), conn('c')], failure: null }

beforeEach(() => reset({}))

/** Presses `id` on the pane and lets what it does settle. */
async function press(port: ReturnType<typeof fakePort>, id: string) {
  handlersOf(port.io).press(id)
  await port.advance()
}

const viewOf = (port: ReturnType<typeof fakePort>) => port.values.get('view') as View

describe('the press table', () => {
  it('keys an id up to its first colon, and a twin to what it does', () => {
    expect(pressOf('tab:schema')).toEqual({ key: 'tab:', rest: 'schema' })
    expect(pressOf('tabkey:editor')).toEqual({ key: 'tab:', rest: 'editor' })
    expect(pressOf('row:3')).toEqual({ key: 'row:', rest: '3' })
    expect(pressOf('down')).toEqual({ key: 'down', rest: '' })
    expect(pressOf('nothing')).toBeNull()
    expect(pressOf('nothing:1')).toBeNull()
  })

  it('opens a tab, and ignores one that does not exist', async () => {
    const port = fakePort()
    await press(port, 'tab:schema')
    expect(viewOf(port).tab).toBe('schema')
    await press(port, 'tabkey:connections')
    expect(viewOf(port).tab).toBe('connections')
    await press(port, 'tab:nowhere')
    expect(viewOf(port).tab).toBe('connections')
  })

  it('marks a connection on Connections, and makes it the one the other tabs use', async () => {
    const port = fakePort({ cells: { connections: LISTED } })
    await press(port, 'tab:connections')
    await press(port, 'row:1')
    expect(viewOf(port).marker.connections).toBe(1)
    expect(viewOf(port).db).toBe('b')
  })

  it('moves the marker within the list, never past either end', async () => {
    const port = fakePort({ cells: { connections: LISTED } })
    await press(port, 'tab:connections')
    await press(port, 'down')
    await press(port, 'down')
    await press(port, 'down')
    expect(viewOf(port).marker.connections).toBe(2)
    expect(viewOf(port).db).toBe('c')
    for (let i = 0; i < 5; i++) await press(port, 'up')
    expect(viewOf(port).marker.connections).toBe(0)
  })

  it('does nothing for an id it does not know', async () => {
    const port = fakePort()
    const before = viewOf(port)
    await press(port, 'whatever')
    expect(viewOf(port)).toEqual(before)
  })

  it('swallows the failure of a press', async () => {
    const port = fakePort()
    ;(port.io.state.view as { update: unknown }).update = () => Promise.reject(new Error('torn down'))
    await expect(press(port, 'tab:schema')).resolves.toBeUndefined()
  })
})

describe('the focus ring', () => {
  it("moves off a tab's hidden twin onto the tab", async () => {
    const port = fakePort()
    expect(await focusMoved(port.io, 'tabkey:schema')).toEqual({ to: 'tab:schema' })
    expect(await focusMoved(port.io, 'row:2')).toBeNull()
    expect(await focusMoved(port.io, 42)).toBeNull()
  })
})

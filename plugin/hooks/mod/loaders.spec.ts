import { beforeEach, describe, expect, it } from 'vitest'

import type { ConnectionsState } from '../../types'
import { reloadConnections, request } from './loaders'
import { mod, reset } from './state'
import { ENV, fakePort } from './__tests__/fake-port'

const conn = (name: string) => ({ name, type: 'sqlite', host: null, ssh: false, ssl: false, selectOnly: true, mcpConfigurable: false, schemaCapturedAt: null })

/** A process answer the spec settles by hand. */
function deferred() {
  let settle!: (stdout: string) => void
  const promise = new Promise<{ exitCode: number; stdout: string }>(resolve => (settle = stdout => resolve({ exitCode: 0, stdout })))
  return { promise, settle }
}

beforeEach(() => reset({}))

describe('the connections loader', () => {
  it('marks the cell loading at once and reads on a timer, never inside the request', async () => {
    const port = fakePort({ run: () => ({ exitCode: 0, stdout: JSON.stringify([conn('demo')]) }) })
    await reloadConnections(port.io)
    expect((port.values.get('connections') as ConnectionsState).phase).toBe('loading')
    expect(port.runs).toHaveLength(0)
    await port.advance()
    expect(port.runs).toHaveLength(1)
    expect(port.values.get('connections')).toEqual({ ask: 1, phase: 'done', answer: [conn('demo')], failure: null })
    expect(port.values.get('config')).toBe(ENV.config)
  })

  it('starts no second read for what the cell already holds or is reading', async () => {
    const port = fakePort()
    await reloadConnections(port.io)
    await request(port.io, 'connections')
    await request(port.io, 'connections')
    await port.advance()
    await request(port.io, 'connections')
    await port.advance()
    expect(port.runs).toHaveLength(1)
  })

  it('reads again on every reload, and drops an answer that lands after the next reload began', async () => {
    const answers = [deferred(), deferred()]
    let n = 0
    const port = fakePort({ run: () => answers[n++]!.promise })
    await reloadConnections(port.io)
    await port.advance()
    await reloadConnections(port.io)
    await port.advance()
    expect(port.runs).toHaveLength(2)
    answers[1]!.settle(JSON.stringify([conn('new')]))
    await port.advance()
    answers[0]!.settle(JSON.stringify([conn('old')]))
    await port.advance()
    expect((port.values.get('connections') as ConnectionsState).answer).toEqual([conn('new')])
    expect(mod.loads.fetching.size).toBe(0)
  })

  it('keeps the last list and stores why when a read fails', async () => {
    let fail = false
    const port = fakePort({ run: () => (fail ? { exitCode: 1, stdout: '{"error":"config.ini is unreadable"}' } : { exitCode: 0, stdout: JSON.stringify([conn('demo')]) }) })
    await reloadConnections(port.io)
    await port.advance()
    fail = true
    await reloadConnections(port.io)
    await port.advance()
    expect(port.values.get('connections')).toEqual({ ask: 2, phase: 'done', answer: [conn('demo')], failure: 'config.ini is unreadable' })
  })

  it('reads nothing once the mod is off', async () => {
    const port = fakePort()
    mod.session.disabled = true
    await reloadConnections(port.io)
    await port.advance()
    expect(port.runs).toHaveLength(0)
  })
})

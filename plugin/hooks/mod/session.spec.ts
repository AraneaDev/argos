import { beforeEach, describe, expect, it } from 'vitest'

import { endTurn, registerCommand, retryRegister, runCommand } from './session'
import { mod, reset } from './state'
import { fakePort } from './__tests__/fake-port'

beforeEach(() => reset({}))

describe('registering /argos', () => {
  it('retries a refused registration on a timer until the engine takes it', async () => {
    const port = fakePort()
    port.refuse(true)
    expect(await registerCommand(port.io)).toBe(false)
    retryRegister(port.io, 0)
    await port.advance(500)
    expect(port.registered).toEqual([])
    port.refuse(false)
    await port.advance(1_000)
    expect(port.registered).toEqual(['argos'])
    expect(mod.registration.registered).toBe(true)
  })

  it('stops a retry of an older session start', async () => {
    const port = fakePort()
    port.refuse(true)
    retryRegister(port.io, 0, mod.generations.register)
    mod.generations.register++
    port.refuse(false)
    await port.advance(500)
    expect(port.registered).toEqual([])
  })

  it("asks again at a turn's end once the timed retries ran out", async () => {
    const port = fakePort()
    await endTurn(port.io, 'subagent')
    expect(port.registered).toEqual([])
    await endTurn(port.io, undefined)
    expect(port.registered).toEqual(['argos'])
  })
})

describe('the /argos command', () => {
  it('opens the pane and reads the connections, then closes it', async () => {
    const port = fakePort()
    expect(await runCommand(port.io, '')).toBe('Argos pane opened.')
    expect(port.opened).toEqual(['argos'])
    // The pane lays no ground of its own: the terminal's shows through.
    expect(port.openedWith[0]).toMatchObject({ id: 'argos', backgroundColor: 'transparent' })
    await port.advance()
    expect(port.runs.map(r => r.argv[2]).sort()).toEqual(['connections', 'history', 'pins'])
    expect(await runCommand(port.io, '  ')).toBe('Argos pane closed.')
    expect(port.closed).toEqual(['argos'])
  })

  it('opens without the transparent background on a host that refuses it', async () => {
    const port = fakePort()
    const open = port.io.ui.open
    port.io.ui.open = async (args: { id: string; backgroundColor?: string }) => {
      if (args.backgroundColor !== undefined) throw new Error('unknown key backgroundColor')
      return open(args)
    }
    expect(await runCommand(port.io, '')).toBe('Argos pane opened.')
    expect(port.openedWith).toEqual([{ id: 'argos', title: 'Argos' }])
  })

  it('says so when the pane cannot be opened at all', async () => {
    const port = fakePort()
    port.io.ui.open = async () => {
      throw new Error('no surface')
    }
    expect(await runCommand(port.io, '')).toBe('argos: the pane could not be opened (no surface)')
  })

  it('answers anything else with its usage', async () => {
    const port = fakePort()
    expect(await runCommand(port.io, 'inspect x')).toMatch(/^Usage: \/argos/)
    expect(port.opened).toEqual([])
  })
})

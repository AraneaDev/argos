import { beforeEach, describe, expect, it } from 'vitest'

import { parseConnections } from '../lib/parse'
import { cliEnv, CLI_TIMEOUT_MS, NOT_INSTALLED, runCli } from './cli'
import { reset } from './state'
import { ENV, ENV_PATH, fakePort } from './__tests__/fake-port'

const CONNECTION = { name: 'demo', type: 'sqlite', host: null, ssh: false, ssl: false, selectOnly: true, mcpConfigurable: false, schemaCapturedAt: null }

beforeEach(() => reset({}))

describe('running the argos CLI', () => {
  it('runs node on the CLI with the arguments and the config the install wrote, and parses what it printed', async () => {
    const port = fakePort({ run: () => ({ exitCode: 0, stdout: JSON.stringify([CONNECTION]) }) })
    const answer = await runCli(port.io, ['connections'], parseConnections)
    expect(answer).toEqual({ ok: true, value: [CONNECTION] })
    expect(port.runs).toEqual([{ argv: [ENV.node, ENV.cli, 'connections', '--config', ENV.config], timeoutMs: CLI_TIMEOUT_MS }])
  })

  it('reads argos.env.json once', async () => {
    const port = fakePort()
    await runCli(port.io, ['connections'], parseConnections)
    await runCli(port.io, ['connections'], parseConnections, 5_000)
    expect(port.reads.filter(p => p === ENV_PATH)).toHaveLength(1)
    expect(port.runs[1]!.timeoutMs).toBe(5_000)
  })

  it('says the plugin was not installed when argos.env.json is missing, and runs nothing', async () => {
    const port = fakePort({ files: {} })
    expect(await runCli(port.io, ['connections'], parseConnections)).toEqual({ ok: false, reason: NOT_INSTALLED })
    expect(NOT_INSTALLED).toBe('argos: plugin not installed by argos install-plugin')
    expect(port.runs).toHaveLength(0)
  })

  it('says the same when argos.env.json is not what the install writes', async () => {
    for (const text of ['not json', '{"node":"/usr/bin/node"}', '[]', '{"node":1,"cli":"x","config":"y"}']) {
      reset({})
      const port = fakePort({ files: { [ENV_PATH]: text } })
      expect(await runCli(port.io, ['connections'], parseConnections)).toEqual({ ok: false, reason: NOT_INSTALLED })
    }
  })

  it("passes on the CLI's own error when it exits non-zero with one", async () => {
    const port = fakePort({ run: () => ({ exitCode: 1, stdout: '{"error":"No config.ini found at /x"}' }) })
    expect(await runCli(port.io, ['connections'], parseConnections)).toEqual({ ok: false, reason: 'No config.ini found at /x' })
  })

  it('says it could not run the CLI when the binary is missing or times out', async () => {
    const port = fakePort({
      run: () => {
        throw new Error('spawn /usr/bin/node ENOENT')
      },
    })
    expect(await runCli(port.io, ['connections'], parseConnections)).toEqual({ ok: false, reason: 'argos: could not run the argos CLI (spawn /usr/bin/node ENOENT)' })
  })

  it("leaves out the prefix the engine puts before a refusal it passes on", async () => {
    const port = fakePort({
      run: () => {
        throw new Error('argos: $.process.run: spawn /usr/bin/node ENOENT')
      },
    })
    expect(await runCli(port.io, ['connections'], parseConnections)).toEqual({ ok: false, reason: 'argos: could not run the argos CLI (spawn /usr/bin/node ENOENT)' })
  })

  it('says it could not run the CLI when it exits non-zero without an error of its own', async () => {
    const port = fakePort({ run: () => ({ exitCode: 127, stdout: '', stderr: 'node: not found\nmore' }) })
    expect(await runCli(port.io, ['connections'], parseConnections)).toEqual({ ok: false, reason: 'argos: could not run the argos CLI (exit 127: node: not found)' })
  })

  it('refuses garbage on stdout, and an answer of the wrong shape', async () => {
    const garbage = fakePort({ run: () => ({ exitCode: 0, stdout: 'Segmentation fault' }) })
    const g = await runCli(garbage.io, ['connections'], parseConnections)
    expect(g.ok).toBe(false)
    expect(!g.ok && g.reason).toMatch(/^argos: /)
    reset({})
    const shape = fakePort({ run: () => ({ exitCode: 0, stdout: '{"tables":[]}' }) })
    const s = await runCli(shape.io, ['connections'], parseConnections)
    expect(s.ok).toBe(false)
    expect(!s.ok && s.reason).toMatch(/^argos: /)
  })

  it('hands back the env the install wrote, for the header', async () => {
    const port = fakePort()
    expect(await cliEnv(port.io)).toEqual({ ok: true, value: ENV })
  })
})

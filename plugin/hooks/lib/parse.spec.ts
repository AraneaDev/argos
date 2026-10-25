import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { parseCliError, parseConnections, parseHistory, parseJournalEntry, parsePin, parsePins, parseSchema, parseSpoolPage, parseUnpinned } from './parse'

/** A contract sample the CLI's own tests wrote (tests/fixtures/pane-contract). */
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../../tests/fixtures/pane-contract/${name}.json`, import.meta.url), 'utf8'))

describe('reading what the argos CLI prints', () => {
  it('accepts every contract sample as the shape it is', () => {
    expect(parseConnections(fixture('connections'))).toEqual(fixture('connections'))
    expect(parseSchema(fixture('schema'))).toEqual(fixture('schema'))
    expect(parseJournalEntry(fixture('query'))).toEqual(fixture('query'))
    expect(parseHistory(fixture('history'))).toEqual(fixture('history'))
    expect(parseSpoolPage(fixture('result'))).toEqual(fixture('result'))
    expect(parsePins(fixture('pins'))).toEqual(fixture('pins'))
    expect(parsePin((fixture('pins') as unknown[])[0])).toEqual((fixture('pins') as unknown[])[0])
  })

  it('rejects a sample with one field of the wrong type', () => {
    const connections = fixture('connections') as Record<string, unknown>[]
    expect(parseConnections([{ ...connections[0], selectOnly: 'yes' }])).toBeNull()
    const schema = fixture('schema') as { tables: Record<string, unknown>[] }
    expect(parseSchema({ ...schema, tables: [{ ...schema.tables[0], columns: 'id' }] })).toBeNull()
    expect(parseJournalEntry({ ...(fixture('query') as object), outcome: 'maybe' })).toBeNull()
    expect(parseHistory([...(fixture('history') as unknown[]), 7])).toBeNull()
    expect(parseSpoolPage({ ...(fixture('result') as object), rows: [1, 2] })).toBeNull()
    expect(parsePins([{ ...(fixture('pins') as object[])[0], sql: null }])).toBeNull()
  })

  it('rejects what is not the shape at all', () => {
    for (const raw of [null, undefined, 'text', 3, {}, [{}]]) {
      expect(parseConnections(raw)).toBeNull()
      expect(parseSchema(raw)).toBeNull()
      expect(parseSpoolPage(raw)).toBeNull()
    }
    expect(parseConnections({ error: 'no config' })).toBeNull()
  })

  it('keeps an empty list as a list', () => {
    expect(parseConnections([])).toEqual([])
    expect(parseHistory([])).toEqual([])
    expect(parsePins([])).toEqual([])
  })

  it("reads unpin's answer and a failure's", () => {
    expect(parseUnpinned({ removed: true })).toEqual({ removed: true })
    expect(parseUnpinned({ removed: 'no' })).toBeNull()
    expect(parseCliError({ error: 'No config.ini found' })).toBe('No config.ini found')
    expect(parseCliError({ error: 3 })).toBeNull()
    expect(parseCliError([])).toBeNull()
  })
})

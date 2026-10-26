import { describe, expect, it } from 'vitest'
import { rowHeight, rowsHeight } from './rows'
import { cells } from './text'

const PATH = 'src/Query/Drift/GitDriftOracle.php'

describe('the rows a row takes on screen', () => {
  it('is one for a row of text, and one per changed or context line for a diff element, its @@ header drawn as no row', () => {
    expect(rowHeight({ key: 'a', segments: [{ text: 'x' }] })).toBe(1)
    // As the engine drew it in a live session: a hunk of seven lines took seven rows, the header none.
    const hunk = { key: 'h', segments: [], code: { source: '@@ -5,6 +5,7 @@\n a\n b\n c\n+d\n e\n f\n g', path: 'x.ts' } }
    expect(rowHeight(hunk)).toBe(7)
    expect(rowsHeight([hunk, { key: 'b', segments: [{ text: 'y' }] }])).toBe(8)
  })
})

describe('display width', () => {
  it('counts wide characters as two cells', () => expect(cells('漢字')).toBe(4))
  it('counts an emoji as two cells', () => expect(cells('a😀')).toBe(3))
  it('counts a combining mark as nothing', () => expect(cells('e\u0301')).toBe(1))
})

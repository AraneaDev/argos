import { describe, expect, it } from 'vitest'

import { formatAge } from './text'

describe('formatAge', () => {
  it('names the largest whole unit', () => {
    expect(formatAge(12_000)).toBe('12s')
    expect(formatAge(5 * 60_000)).toBe('5m')
    expect(formatAge(3 * 3_600_000)).toBe('3h')
    expect(formatAge(2 * 86_400_000)).toBe('2d')
    expect(formatAge(-5)).toBe('0s')
  })

  it('never rounds across a unit boundary', () => {
    expect(formatAge(3_570_000)).toBe('59m')
    expect(formatAge(59_600)).toBe('59s')
    expect(formatAge(23.6 * 3_600_000)).toBe('23h')
    expect(formatAge(3_600_000)).toBe('1h')
    expect(formatAge(86_400_000)).toBe('1d')
  })
})

import { describe, expect, it } from 'vitest'
import { isOpenAt, nextStateChange } from './opening-hours'

// Build a UTC-anchored date so test results are deterministic regardless of CI tz.
function utc(y: number, m: number, d: number, hh: number, mm = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, hh, mm))
}

describe('isOpenAt', () => {
  it('returns true for null', () => {
    expect(isOpenAt(null, new Date())).toBe(true)
  })

  it('returns true for undefined', () => {
    expect(isOpenAt(undefined, new Date())).toBe(true)
  })

  it('returns true for empty string', () => {
    expect(isOpenAt('', new Date())).toBe(true)
  })

  it('returns true on Wednesday at noon for "Mo-Fr 09:00-17:00"', () => {
    // 2026-05-06 is a Wednesday.
    expect(isOpenAt('Mo-Fr 09:00-17:00', utc(2026, 5, 6, 12))).toBe(true)
  })

  it('returns false on Wednesday at 20:00 for "Mo-Fr 09:00-17:00"', () => {
    expect(isOpenAt('Mo-Fr 09:00-17:00', utc(2026, 5, 6, 20))).toBe(false)
  })

  it('returns true for invalid syntax (graceful fallback)', () => {
    expect(isOpenAt('garbage syntax', new Date())).toBe(true)
  })
})

describe('nextStateChange', () => {
  it('returns null for null/empty', () => {
    expect(nextStateChange(null, new Date())).toBe(null)
    expect(nextStateChange('', new Date())).toBe(null)
  })

  it('returns the closing time later that same day for "Mo-Fr 09:00-17:00"', () => {
    // 2026-05-04 is a Monday.
    const monday10 = utc(2026, 5, 4, 10)
    const next = nextStateChange('Mo-Fr 09:00-17:00', monday10)
    expect(next).toBeInstanceOf(Date)
    expect(next!.getUTCFullYear()).toBe(2026)
    expect(next!.getUTCMonth()).toBe(4)
    expect(next!.getUTCDate()).toBe(4)
    // Should be later than monday10 and on the same UTC day.
    expect(next!.getTime()).toBeGreaterThan(monday10.getTime())
  })

  it('returns null for invalid syntax', () => {
    expect(nextStateChange('garbage syntax', new Date())).toBe(null)
  })
})

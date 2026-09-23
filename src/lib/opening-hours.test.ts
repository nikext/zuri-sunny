import { describe, expect, it } from 'vitest'
import { isOpenAt, nextStateChange, minutesUntilClose, parseOpeningHoursWeek } from './opening-hours'
import { zhDate } from './zurich-time'

// Opening hours are Zürich wall-clock times, whatever the runtime's timezone
// (tests run under TZ=UTC), so build test instants in Zürich time.
function zh(y: number, m: number, d: number, hh: number, mm = 0): Date {
  return zhDate(y, m, d, hh, mm)
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
    expect(isOpenAt('Mo-Fr 09:00-17:00', zh(2026, 5, 6, 12))).toBe(true)
  })

  it('evaluates in Zürich time, not the runtime timezone (visitor abroad / UTC server)', () => {
    // 08:30 in Zürich is 06:30 UTC; a UTC-local evaluation called this closed.
    expect(isOpenAt('Mo-Fr 08:00-12:00', new Date('2026-09-23T06:30:00Z'))).toBe(true)
    expect(isOpenAt('Mo-Fr 08:00-12:00', new Date('2026-09-23T10:30:00Z'))).toBe(false)
  })

  it('returns false on Wednesday at 20:00 for "Mo-Fr 09:00-17:00"', () => {
    expect(isOpenAt('Mo-Fr 09:00-17:00', zh(2026, 5, 6, 20))).toBe(false)
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
    const monday10 = zh(2026, 5, 4, 10)
    const next = nextStateChange('Mo-Fr 09:00-17:00', monday10)
    expect(next).toBeInstanceOf(Date)
    expect(next!.toISOString()).toBe(zh(2026, 5, 4, 17).toISOString())
  })

  it('returns null for invalid syntax', () => {
    expect(nextStateChange('garbage syntax', new Date())).toBe(null)
  })
})

describe('minutesUntilClose', () => {
  it('returns null for null/undefined/empty hours', () => {
    expect(minutesUntilClose(null, new Date())).toBe(null)
    expect(minutesUntilClose(undefined, new Date())).toBe(null)
    expect(minutesUntilClose('', new Date())).toBe(null)
  })

  it('returns null when closed at t', () => {
    expect(minutesUntilClose('Mo-Fr 09:00-17:00', zh(2026, 5, 6, 20))).toBe(null)
  })

  it('returns minutes until close when open and closing within window', () => {
    expect(minutesUntilClose('Mo-Fr 09:00-17:00', zh(2026, 5, 6, 16, 30))).toBe(30)
  })

  it('returns null for invalid syntax', () => {
    expect(minutesUntilClose('garbage', new Date())).toBe(null)
  })

  it('returns null for 24/7 spec (no upcoming change)', () => {
    expect(minutesUntilClose('24/7', new Date())).toBe(null)
  })
})

describe('parseOpeningHoursWeek', () => {
  // Anchor on Wednesday 2026-05-06 — week should be Mon 2026-05-04 → Sun 2026-05-10.
  const anchor = zh(2026, 5, 6, 12)

  it('returns null for missing hours', () => {
    expect(parseOpeningHoursWeek(null, anchor)).toBe(null)
    expect(parseOpeningHoursWeek('', anchor)).toBe(null)
  })

  it('returns null for invalid syntax', () => {
    expect(parseOpeningHoursWeek('garbage', anchor)).toBe(null)
  })

  it('returns 7 days with Mon-Fri 09-17 intervals and Sat/Sun closed', () => {
    const wk = parseOpeningHoursWeek('Mo-Fr 09:00-17:00', anchor)
    expect(wk).not.toBe(null)
    expect(wk!.length).toBe(7)
    expect(wk![0]!.dayLabel).toBe('Mon')
    expect(wk![0]!.intervals).toEqual([{ from: '09:00', to: '17:00' }])
    expect(wk![4]!.dayLabel).toBe('Fri')
    expect(wk![4]!.intervals).toEqual([{ from: '09:00', to: '17:00' }])
    expect(wk![5]!.dayLabel).toBe('Sat')
    expect(wk![5]!.intervals).toEqual([])
    expect(wk![6]!.dayLabel).toBe('Sun')
    expect(wk![6]!.intervals).toEqual([])
  })

  it('handles split intervals and Saturday-only differences', () => {
    const wk = parseOpeningHoursWeek('Mo-Fr 09:00-12:00,13:00-17:00; Sa 10:00-14:00', anchor)
    expect(wk).not.toBe(null)
    expect(wk![0]!.intervals).toEqual([
      { from: '09:00', to: '12:00' },
      { from: '13:00', to: '17:00' },
    ])
    expect(wk![5]!.intervals).toEqual([{ from: '10:00', to: '14:00' }])
  })
})

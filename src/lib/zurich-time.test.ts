// @vitest-environment node
// Runs under TZ=UTC (vitest config), so the runtime's local time is NOT
// Zürich's — exactly the situation of a visitor abroad.
import { describe, expect, it } from 'vitest'
import { fmtHmZh, fromZhWall, toZhWall, zhDate, zhDayKey, zhParts, zhStartOfDay } from './zurich-time'

describe('zurich-time', () => {
  it('reads Zürich wall-clock fields in summer and winter', () => {
    expect(zhParts(new Date('2026-09-23T11:30:00Z'))).toMatchObject({
      year: 2026,
      month: 9,
      day: 23,
      hour: 13,
      minute: 30,
      weekday: 2, // Wednesday
    })
    expect(fmtHmZh(new Date('2026-01-15T11:00:00Z'))).toBe('12:00')
  })

  it('builds the instant for a Zürich wall-clock time', () => {
    expect(zhDate(2026, 9, 23, 13, 30).toISOString()).toBe('2026-09-23T11:30:00.000Z')
    expect(zhDate(2026, 1, 15, 12).toISOString()).toBe('2026-01-15T11:00:00.000Z')
    // Spring-forward day: 03:30 CEST exists, 1 h after the 02:00 switch.
    expect(zhDate(2026, 3, 29, 3, 30).toISOString()).toBe('2026-03-29T01:30:00.000Z')
    // Day overflow like the Date constructor.
    expect(zhDate(2026, 9, 31).toISOString()).toBe(zhDate(2026, 10, 1).toISOString())
  })

  it('uses the Zürich calendar day, not the UTC one', () => {
    const lateEvening = new Date('2026-09-23T22:30:00Z') // 00:30 on the 24th in Zürich
    expect(zhDayKey(lateEvening)).toBe('2026-09-24')
    expect(zhStartOfDay(lateEvening).toISOString()).toBe('2026-09-23T22:00:00.000Z')
  })

  it('round-trips through the local-wall representation', () => {
    const t = new Date('2026-07-01T16:45:12.345Z')
    const wall = toZhWall(t)
    expect(wall.getHours()).toBe(18)
    expect(fromZhWall(wall).toISOString()).toBe(t.toISOString())
  })
})

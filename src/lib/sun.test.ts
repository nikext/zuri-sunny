import { describe, it, expect } from 'vitest'
import { getSunPosition, getSunTimes } from './sun'

describe('getSunPosition', () => {
  it('summer solstice solar noon in Zürich: south and high', () => {
    // Solar noon at 8.54°E ≈ 11:26 UTC; 13:30 CEST = 11:30 UTC is near solar noon
    const t = new Date('2026-06-21T11:30:00Z')
    const p = getSunPosition(t, 47.3769, 8.5417)
    expect(p.azimuthRad).toBeGreaterThan(Math.PI - 0.4)
    expect(p.azimuthRad).toBeLessThan(Math.PI + 0.4)
    expect(p.altitudeRad).toBeGreaterThan(1.0)
  })

  it('midnight in Zürich has negative altitude', () => {
    // 00:00 local CET (UTC+1) on 2026-01-15 = 23:00 UTC on 2026-01-14
    const t = new Date('2026-01-14T23:00:00Z')
    const p = getSunPosition(t, 47.3769, 8.5417)
    expect(p.altitudeRad).toBeLessThan(0)
  })

  it('azimuth is in [0, 2π)', () => {
    const t = new Date('2026-06-21T11:30:00Z')
    const p = getSunPosition(t, 47.3769, 8.5417)
    expect(p.azimuthRad).toBeGreaterThanOrEqual(0)
    expect(p.azimuthRad).toBeLessThan(2 * Math.PI)
  })
})

describe('getSunTimes', () => {
  it('returns sunrise before sunset', () => {
    const t = new Date('2026-06-21T12:00:00Z')
    const { sunrise, sunset } = getSunTimes(t, 47.3769, 8.5417)
    expect(sunrise.getTime()).toBeLessThan(sunset.getTime())
  })
})

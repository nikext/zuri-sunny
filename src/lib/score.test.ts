// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { dailyRating } from './score'
import { buildSpatialIndex } from './shadows'
import type { Building, Poi } from './types'

const ZURICH: Poi = {
  id: 'test-poi',
  lat: 47.3769,
  lon: 8.5417,
}

describe('dailyRating', () => {
  it('open plaza with no opening hours rates near 99 on the summer solstice', () => {
    // Empty building index = nothing ever blocks the sun. With no opening hours,
    // the rating window is the full daylight day, and the entire window is sunny.
    const index = buildSpatialIndex([])
    const day = new Date('2026-06-21T12:00:00Z')
    const r = dailyRating(ZURICH, index, [], day)
    expect(r).toBeGreaterThanOrEqual(98)
    expect(r).toBeLessThanOrEqual(99)
  })
})

describe('dailyRating — fully shadowed', () => {
  it('returns 0 when a tall building blocks the sun all day from due south', () => {
    // 100m wall ~30m south of the POI, spanning enough longitude that the
    // sun's ray is blocked at every azimuth from sunrise through sunset.
    const dLat = 30 / 111_000
    const south = ZURICH.lat - dLat
    // Long enough wall (E-W) to block from SE through SW.
    const halfLon = 200 / (111_000 * Math.cos((ZURICH.lat * Math.PI) / 180))
    const minLon = ZURICH.lon - halfLon
    const maxLon = ZURICH.lon + halfLon
    const minLat = south - dLat
    const maxLat = south + dLat
    const wall: Building = {
      id: 'wall',
      heightM: 100,
      footprint: [
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat],
      ],
      minLat,
      maxLat,
      minLon,
      maxLon,
    }
    const index = buildSpatialIndex([wall])
    // Winter solstice — sun is always low and due south of Zürich; this wall
    // blocks every ray.
    const day = new Date('2026-12-21T12:00:00Z')
    const r = dailyRating(ZURICH, index, [wall], day)
    expect(r).toBe(0)
  })
})

describe('dailyRating — opening hours window', () => {
  it('rating reflects opening_hours window, not full daylight', () => {
    // No buildings -> always sunny when the sun is up. With 07:00-09:00
    // opening hours and a sunrise around 05:30 in June, the rating window is
    // 2h long and entirely sunny -> 99.
    const index = buildSpatialIndex([])
    const day = new Date('2026-06-21T12:00:00Z')
    const poi: Poi = {
      ...ZURICH,
      id: 'breakfast-cafe',
      openingHours: 'Mo-Su 07:00-09:00',
    }
    const r = dailyRating(poi, index, [], day)
    expect(r).toBeGreaterThanOrEqual(98)
  })

  it('falls back to full daylight when open hours and daylight do not overlap', () => {
    // Open 22:00-23:00 UTC (post-sunset on June 21 in Zürich, sunset ~19:30 UTC),
    // so there is no overlap with daylight regardless of vitest's UTC TZ. The
    // fallback should kick in and rate against the full daylight window; with no
    // buildings, that's near-100% sunny.
    const index = buildSpatialIndex([])
    const day = new Date('2026-06-21T12:00:00Z')
    const poi: Poi = {
      ...ZURICH,
      id: 'night-club',
      openingHours: 'Mo-Su 22:00-23:00',
    }
    const r = dailyRating(poi, index, [], day)
    expect(r).toBeGreaterThanOrEqual(98)
  })

  it('treats unparseable opening_hours as no-window (uses full daylight)', () => {
    const index = buildSpatialIndex([])
    const day = new Date('2026-06-21T12:00:00Z')
    const poi: Poi = {
      ...ZURICH,
      id: 'broken-hours',
      openingHours: 'this is not valid OSM hours',
    }
    const r = dailyRating(poi, index, [], day)
    expect(r).toBeGreaterThanOrEqual(98)
  })
})

// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { dailyTimeline } from './timeline'
import { buildSpatialIndex } from './shadows'
import type { Building, Poi } from './types'

const ZURICH: Poi = {
  id: 'test-poi',
  lat: 47.3769,
  lon: 8.5417,
}

describe('dailyTimeline', () => {
  it('returns at least one all-sunny segment with empty buildings on the summer solstice', () => {
    const index = buildSpatialIndex([])
    const day = new Date('2026-06-21T00:00:00Z')
    const segs = dailyTimeline(ZURICH, index, [], day)
    expect(segs.length).toBeGreaterThan(0)
    for (const s of segs) expect(s.sunny).toBe(true)
    // Total covered duration ≈ sunset - sunrise (i.e. > a few hours on the solstice).
    const total = segs.reduce((a, s) => a + (s.to.getTime() - s.from.getTime()), 0)
    expect(total).toBeGreaterThan(10 * 60 * 60 * 1000) // > 10h on summer solstice in ZRH.
  })

  it('produces at least one shaded segment with a tall building south of the POI', () => {
    // Tiny rectangular building ~30m south of the POI, 100m tall.
    const dLat = 30 / 111_000
    const south = ZURICH.lat - dLat
    const halfLon = 5 / (111_000 * Math.cos((ZURICH.lat * Math.PI) / 180))
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
    const day = new Date('2026-06-21T00:00:00Z')
    const segs = dailyTimeline(ZURICH, index, [wall], day)
    expect(segs.length).toBeGreaterThan(0)
    expect(segs.some((s) => !s.sunny)).toBe(true)
  })
})

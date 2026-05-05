// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildSpatialIndex, isSunnyAt } from './shadows'
import type { Building, Poi } from './types'

const POI: Poi = { id: 'p1', lat: 47.3769, lon: 8.5417 }
const NOON = new Date('2026-06-21T11:30:00Z')
const NIGHT = new Date('2026-06-21T22:00:00Z')

const M_PER_DEG_LAT = 111_000

/** Make a small rectangular footprint roughly `southM` meters south of `poi`,
 *  with given half-width (in meters) along E-W and depth (m) along N-S. */
function southWall(
  poi: Poi,
  southM: number,
  halfWidthM: number,
  depthM: number,
  heightM: number,
  id = 'b1',
): Building {
  const dLat = southM / M_PER_DEG_LAT
  const dLatDepth = depthM / M_PER_DEG_LAT
  const meanLat = poi.lat - dLat
  const dLon = halfWidthM / (M_PER_DEG_LAT * Math.cos((meanLat * Math.PI) / 180))
  const south = poi.lat - dLat - dLatDepth / 2
  const north = poi.lat - dLat + dLatDepth / 2
  const west = poi.lon - dLon
  const east = poi.lon + dLon
  // [lon, lat] pairs, closed ring
  const footprint: [number, number][] = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ]
  return {
    id,
    footprint,
    heightM,
    minLat: south,
    maxLat: north,
    minLon: west,
    maxLon: east,
  }
}

describe('isSunnyAt', () => {
  it('returns false when a tall building south of the POI blocks the noon sun', () => {
    const wall = southWall(POI, 10, 20, 2, 50)
    const idx = buildSpatialIndex([wall])
    expect(isSunnyAt(POI, idx, [wall], NOON)).toBe(false)
  })

  it('returns true when there are no buildings', () => {
    const idx = buildSpatialIndex([])
    expect(isSunnyAt(POI, idx, [], NOON)).toBe(true)
  })

  it('returns false at night regardless of buildings', () => {
    const idx = buildSpatialIndex([])
    expect(isSunnyAt(POI, idx, [], NIGHT)).toBe(false)
    const wall = southWall(POI, 10, 20, 2, 50)
    const idx2 = buildSpatialIndex([wall])
    expect(isSunnyAt(POI, idx2, [wall], NIGHT)).toBe(false)
  })

  it('returns true when the obstructing building is too short to block the ray', () => {
    const shortWall = southWall(POI, 10, 20, 2, 1)
    const idx = buildSpatialIndex([shortWall])
    expect(isSunnyAt(POI, idx, [shortWall], NOON)).toBe(true)
  })
})

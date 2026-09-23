// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildSpatialIndex, isSunnyAt, sunAnchor } from './shadows'
import { haversine } from './geo'
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

/** Axis-aligned box given in metres relative to `poi` (x = east, y = north). */
function box(
  poi: Poi,
  m: { west: number; east: number; south: number; north: number },
  heightM: number,
  id: string,
): Building {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((poi.lat * Math.PI) / 180)
  const west = poi.lon + m.west / mPerDegLon
  const east = poi.lon + m.east / mPerDegLon
  const south = poi.lat + m.south / M_PER_DEG_LAT
  const north = poi.lat + m.north / M_PER_DEG_LAT
  return {
    id,
    footprint: [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
    heightM,
    minLat: south,
    maxLat: north,
    minLon: west,
    maxLon: east,
  }
}

describe('sunAnchor / POIs mapped inside their building', () => {
  it('leaves a POI outside every footprint where it is', () => {
    const wall = southWall(POI, 10, 20, 2, 50)
    const idx = buildSpatialIndex([wall])
    expect(sunAnchor(POI, idx)).toEqual({ lat: POI.lat, lon: POI.lon })
  })

  it('samples outside the nearest facade — a south-facing terrace gets the noon sun', () => {
    // POI 3 m inside the south facade of a 15 m building. Raycasting from the
    // POI itself hits that facade 3 m away and reads as shaded.
    const host = box(POI, { west: -10, east: 10, south: -3, north: 17 }, 15, 'host')
    const idx = buildSpatialIndex([host])
    const anchor = sunAnchor(POI, idx)
    expect(anchor.lat).toBeLessThan(host.minLat)
    expect(haversine(POI, anchor)).toBeCloseTo(5.5, 0)
    expect(isSunnyAt(POI, idx, [host], NOON)).toBe(true)
  })

  it('keeps the host building as a shadow caster — a north-facing terrace stays shaded at noon', () => {
    const host = box(POI, { west: -10, east: 10, south: -17, north: 3 }, 15, 'host')
    const idx = buildSpatialIndex([host])
    expect(sunAnchor(POI, idx).lat).toBeGreaterThan(host.maxLat)
    expect(isSunnyAt(POI, idx, [host], NOON)).toBe(false)
  })

  it('skips a facade that is a party wall with the neighbouring building', () => {
    // Nearest facade (south, 3 m) is shared with a neighbour, so the next
    // nearest open facade (east or west, 10 m) is used instead.
    const host = box(POI, { west: -10, east: 10, south: -3, north: 17 }, 15, 'host')
    const neighbour = box(POI, { west: -10, east: 10, south: -20, north: -3 }, 15, 'nb')
    const idx = buildSpatialIndex([host, neighbour])
    const anchor = sunAnchor(POI, idx)
    expect(haversine(POI, anchor)).toBeCloseTo(12.5, 0)
    expect(anchor.lat).toBeGreaterThan(neighbour.maxLat)
  })
})

describe('courtyard buildings (multipolygon holes)', () => {
  // 60×60 m block, 12 m tall, with a 30×30 m courtyard; POI in the middle of it.
  const outer = box(POI, { west: -30, east: 30, south: -30, north: 30 }, 12, 'block')
  const court = box(POI, { west: -15, east: 15, south: -15, north: 15 }, 0, 'court')
  const block: Building = { ...outer, holes: [court.footprint] }

  it('treats a POI in the courtyard as outside the building', () => {
    const idx = buildSpatialIndex([block])
    expect(sunAnchor(POI, idx)).toEqual({ lat: POI.lat, lon: POI.lon })
  })

  it('lets the high summer sun into the courtyard', () => {
    // Courtyard wall 15 m south, 12 m tall: at ~66° the ray clears it at ~34 m.
    const idx = buildSpatialIndex([block])
    expect(isSunnyAt(POI, idx, [block], NOON)).toBe(true)
  })

  it('shades the courtyard when the sun is low', () => {
    // Winter noon (~19°): the ray is only ~5 m up at the courtyard wall.
    const idx = buildSpatialIndex([block])
    expect(isSunnyAt(POI, idx, [block], new Date('2026-12-21T11:15:00Z'))).toBe(false)
  })
})

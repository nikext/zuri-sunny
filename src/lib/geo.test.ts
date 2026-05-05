import { describe, it, expect } from 'vitest'
import {
  haversine,
  bearingRad,
  movePoint,
  lineIntersectsPolygon,
  bboxOf,
  EARTH_RADIUS_M,
} from './geo'

describe('haversine', () => {
  it('returns 0 for equal points', () => {
    expect(haversine({ lat: 47.3779, lon: 8.5403 }, { lat: 47.3779, lon: 8.5403 })).toBe(0)
  })

  it('Zürich HB to ETH Zentrum is ~615m', () => {
    const d = haversine({ lat: 47.3779, lon: 8.5403 }, { lat: 47.3763, lon: 8.5483 })
    expect(d).toBeGreaterThan(585)
    expect(d).toBeLessThan(645)
  })

  it('uses earth radius constant', () => {
    expect(EARTH_RADIUS_M).toBe(6_371_000)
  })
})

describe('bearingRad', () => {
  it('north bearing ~0', () => {
    const b = bearingRad({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })
    expect(b).toBeCloseTo(0, 5)
  })

  it('east bearing ~π/2', () => {
    const b = bearingRad({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })
    expect(b).toBeCloseTo(Math.PI / 2, 5)
  })
})

describe('movePoint', () => {
  it('roundtrips ~500m there and back', () => {
    const start = { lat: 47.3769, lon: 8.5417 }
    const bearing = 1.234
    const moved = movePoint(start, bearing, 500)
    const back = movePoint(moved, bearing + Math.PI, 500)
    expect(back.lat).toBeCloseTo(start.lat, 5)
    expect(back.lon).toBeCloseTo(start.lon, 5)
  })

  it('moving distance approximately matches haversine', () => {
    const start = { lat: 47.3769, lon: 8.5417 }
    const moved = movePoint(start, Math.PI / 2, 1000)
    expect(haversine(start, moved)).toBeCloseTo(1000, 0)
  })
})

describe('lineIntersectsPolygon', () => {
  it('north-going ray hits polygon to the north', () => {
    const start = { lat: 47.37, lon: 8.54 }
    const end = { lat: 47.40, lon: 8.54 }
    // small square polygon to the north, [lon, lat] pairs
    const poly: [number, number][] = [
      [8.539, 47.385],
      [8.541, 47.385],
      [8.541, 47.387],
      [8.539, 47.387],
    ]
    const result = lineIntersectsPolygon([start, end], poly)
    expect(result).not.toBeNull()
    expect(result!.point.lat).toBeCloseTo(47.385, 3)
    expect(result!.distanceFromStartM).toBeGreaterThan(0)
  })

  it('returns null when polygon is to the south', () => {
    const start = { lat: 47.37, lon: 8.54 }
    const end = { lat: 47.40, lon: 8.54 }
    const poly: [number, number][] = [
      [8.539, 47.355],
      [8.541, 47.355],
      [8.541, 47.357],
      [8.539, 47.357],
    ]
    expect(lineIntersectsPolygon([start, end], poly)).toBeNull()
  })
})

describe('bboxOf', () => {
  it('returns padded bbox containing all points', () => {
    const pts = [
      { lat: 47.37, lon: 8.54 },
      { lat: 47.38, lon: 8.55 },
    ]
    const [w, s, e, n] = bboxOf(pts, 100)
    expect(w).toBeLessThan(8.54)
    expect(s).toBeLessThan(47.37)
    expect(e).toBeGreaterThan(8.55)
    expect(n).toBeGreaterThan(47.38)
  })
})

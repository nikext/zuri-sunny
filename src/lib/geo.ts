import type { LatLon } from './types'

export const EARTH_RADIUS_M = 6_371_000

const toRad = (deg: number): number => (deg * Math.PI) / 180
const toDeg = (rad: number): number => (rad * 180) / Math.PI

/** Great-circle distance in meters between two lat/lon points. */
export function haversine(a: LatLon, b: LatLon): number {
  if (a.lat === b.lat && a.lon === b.lon) return 0
  const φ1 = toRad(a.lat)
  const φ2 = toRad(b.lat)
  const Δφ = toRad(b.lat - a.lat)
  const Δλ = toRad(b.lon - a.lon)
  const s = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
  return EARTH_RADIUS_M * c
}

/** Initial great-circle bearing in radians, 0=N, clockwise, [0, 2π). */
export function bearingRad(from: LatLon, to: LatLon): number {
  const φ1 = toRad(from.lat)
  const φ2 = toRad(to.lat)
  const Δλ = toRad(to.lon - from.lon)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  const θ = Math.atan2(y, x)
  return (θ + 2 * Math.PI) % (2 * Math.PI)
}

/** Destination point from start given bearing (rad) and distance (m). */
export function movePoint(from: LatLon, bearingRad: number, distanceM: number): LatLon {
  const δ = distanceM / EARTH_RADIUS_M
  const φ1 = toRad(from.lat)
  const λ1 = toRad(from.lon)
  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(bearingRad)
  const φ2 = Math.asin(sinφ2)
  const y = Math.sin(bearingRad) * Math.sin(δ) * Math.cos(φ1)
  const x = Math.cos(δ) - Math.sin(φ1) * sinφ2
  const λ2 = λ1 + Math.atan2(y, x)
  return { lat: toDeg(φ2), lon: ((toDeg(λ2) + 540) % 360) - 180 }
}

/** Planar segment intersection in lat/lon space; null if parallel or outside both segments. */
export function lineSegmentIntersection(
  p1: LatLon,
  p2: LatLon,
  p3: LatLon,
  p4: LatLon,
): LatLon | null {
  const x1 = p1.lon, y1 = p1.lat
  const x2 = p2.lon, y2 = p2.lat
  const x3 = p3.lon, y3 = p3.lat
  const x4 = p4.lon, y4 = p4.lat
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  if (denom === 0) return null
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return { lat: y1 + t * (y2 - y1), lon: x1 + t * (x2 - x1) }
}

/** Nearest intersection of [line[0],line[1]] with polygon edges (polygon is [lon,lat] pairs). */
export function lineIntersectsPolygon(
  line: [LatLon, LatLon],
  polygon: [number, number][],
): { point: LatLon; distanceFromStartM: number } | null {
  if (polygon.length < 2) return null
  let best: { point: LatLon; distanceFromStartM: number } | null = null
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    if (!a || !b) continue
    const e1: LatLon = { lon: a[0], lat: a[1] }
    const e2: LatLon = { lon: b[0], lat: b[1] }
    const hit = lineSegmentIntersection(line[0], line[1], e1, e2)
    if (!hit) continue
    const d = haversine(line[0], hit)
    if (best === null || d < best.distanceFromStartM) {
      best = { point: hit, distanceFromStartM: d }
    }
  }
  return best
}

/** Bounding box [west, south, east, north] padded by paddingM converted to degrees. */
export function bboxOf(
  points: LatLon[],
  paddingM: number,
): [west: number, south: number, east: number, north: number] {
  if (points.length === 0) return [0, 0, 0, 0]
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
    if (p.lon < minLon) minLon = p.lon
    if (p.lon > maxLon) maxLon = p.lon
  }
  const meanLat = (minLat + maxLat) / 2
  const dLat = paddingM / 111_000
  const dLon = paddingM / (111_000 * Math.cos(toRad(meanLat)))
  return [minLon - dLon, minLat - dLat, maxLon + dLon, maxLat + dLat]
}

import RBush from 'rbush'
import type { Building, Poi } from './types'
import { movePoint, lineIntersectsPolygon } from './geo'
import { getSunPosition } from './sun'

export type BuildingIndexEntry = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  building: Building
}

export type BuildingIndex = RBush<BuildingIndexEntry>

/** Build an rbush index of buildings using lon as x, lat as y. */
export function buildSpatialIndex(buildings: Building[]): BuildingIndex {
  const tree: BuildingIndex = new RBush<BuildingIndexEntry>()
  const items: BuildingIndexEntry[] = buildings.map((b) => ({
    minX: b.minLon,
    minY: b.minLat,
    maxX: b.maxLon,
    maxY: b.maxLat,
    building: b,
  }))
  tree.load(items)
  return tree
}

export type IsSunnyOpts = { rayLengthM?: number }

const DEFAULT_RAY_LENGTH_M = 500
const BBOX_PAD_M = 10

/** True if direct sunlight reaches `poi` at time `t` (no building blocks the ray). */
export function isSunnyAt(
  poi: Poi,
  index: BuildingIndex,
  _buildings: Building[],
  t: Date,
  opts?: IsSunnyOpts,
): boolean {
  const sun = getSunPosition(t, poi.lat, poi.lon)
  if (sun.altitudeRad <= 0) return false

  const rayLength = opts?.rayLengthM ?? DEFAULT_RAY_LENGTH_M
  const start = { lat: poi.lat, lon: poi.lon }
  const end = movePoint(start, sun.azimuthRad, rayLength)

  // Bbox covering the ray segment, padded by BBOX_PAD_M (in degrees ~ /111000).
  const meanLat = (start.lat + end.lat) / 2
  const dLat = BBOX_PAD_M / 111_000
  const dLon = BBOX_PAD_M / (111_000 * Math.cos((meanLat * Math.PI) / 180))
  const minX = Math.min(start.lon, end.lon) - dLon
  const maxX = Math.max(start.lon, end.lon) + dLon
  const minY = Math.min(start.lat, end.lat) - dLat
  const maxY = Math.max(start.lat, end.lat) + dLat

  const candidates = index.search({ minX, minY, maxX, maxY })
  const tanAlt = Math.tan(sun.altitudeRad)

  for (const c of candidates) {
    const hit = lineIntersectsPolygon([start, end], c.building.footprint)
    if (!hit) continue
    const rayHeight = hit.distanceFromStartM * tanAlt
    if (c.building.heightM > rayHeight) return false
  }
  return true
}

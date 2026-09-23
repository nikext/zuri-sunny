import RBush from 'rbush'
import type { Building, LatLon, Poi } from './types'
import { movePoint, lineIntersectsPolygon, pointInPolygonWithHoles } from './geo'
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

function buildingsContaining(index: BuildingIndex, p: LatLon): BuildingIndexEntry[] {
  return index
    .search({ minX: p.lon, minY: p.lat, maxX: p.lon, maxY: p.lat })
    .filter((e) => pointInPolygonWithHoles(p, e.building.footprint, e.building.holes))
}

/** Every ring of a building: the outer wall plus any courtyard walls. */
function ringsOf(b: Building): [number, number][][] {
  return b.holes && b.holes.length > 0 ? [b.footprint, ...b.holes] : [b.footprint]
}

/** How far outside the facade a POI mapped inside its building is sampled —
 *  roughly where a sidewalk terrace sits. */
const FACADE_OFFSET_M = 2.5
/** Beyond this, the POI is deep inside a large building (a station hall, a
 *  mall) and is left where it is rather than teleported outside. */
const MAX_ANCHOR_SHIFT_M = 60
/** How many of the nearest facade edges to try before giving up. */
const MAX_EDGE_CANDIDATES = 16

const anchorCache = new WeakMap<BuildingIndex, Map<string, LatLon>>()

/** Where to evaluate sun/shade for `poi`.
 *
 *  ~95% of Zürich POIs are mapped as a point INSIDE their building's
 *  footprint. Raycasting from there always hits the building's own wall, so
 *  the spot read as shaded unless the sun happened to clear that wall — the
 *  result mostly measured the building's depth. Outdoor seating sits outside
 *  the facade, so for a POI inside a footprint we sample at the nearest facade
 *  point, FACADE_OFFSET_M outward, choosing the nearest edge whose outside is
 *  open (not inside the host or a neighbouring building — terraced blocks
 *  share party walls). The host building still casts shade on that point when
 *  the sun is behind it. POIs already outside every footprint are unchanged. */
export function sunAnchor(poi: Poi, index: BuildingIndex): LatLon {
  let perIndex = anchorCache.get(index)
  if (!perIndex) {
    perIndex = new Map()
    anchorCache.set(index, perIndex)
  }
  const key = `${poi.lon},${poi.lat}`
  let anchor = perIndex.get(key)
  if (!anchor) {
    anchor = computeAnchor(poi, index)
    perIndex.set(key, anchor)
  }
  return anchor
}

function computeAnchor(poi: Poi, index: BuildingIndex): LatLon {
  const origin: LatLon = { lat: poi.lat, lon: poi.lon }
  const hosts = buildingsContaining(index, origin)
  if (hosts.length === 0) return origin

  // Local metric frame centred on the POI (equirectangular; fine at <100 m).
  const mPerDegLat = 111_320
  const mPerDegLon = 111_320 * Math.cos((poi.lat * Math.PI) / 180)
  const toLatLon = (x: number, y: number): LatLon => ({
    lon: poi.lon + x / mPerDegLon,
    lat: poi.lat + y / mPerDegLat,
  })

  // Closest point on every host edge, with that edge's unit normal.
  const edges: Array<{ d: number; x: number; y: number; nx: number; ny: number }> = []
  for (const host of hosts) {
    for (const fp of ringsOf(host.building)) {
      for (let i = 0; i < fp.length; i++) {
        const a = fp[i]!
        const b = fp[(i + 1) % fp.length]!
        const ax = (a[0] - poi.lon) * mPerDegLon
        const ay = (a[1] - poi.lat) * mPerDegLat
        const ex = (b[0] - poi.lon) * mPerDegLon - ax
        const ey = (b[1] - poi.lat) * mPerDegLat - ay
        const len2 = ex * ex + ey * ey
        if (len2 < 1e-4) continue // closing vertex / duplicate point
        const t = Math.min(1, Math.max(0, -(ax * ex + ay * ey) / len2))
        const x = ax + t * ex
        const y = ay + t * ey
        const len = Math.sqrt(len2)
        edges.push({ d: Math.hypot(x, y), x, y, nx: -ey / len, ny: ex / len })
      }
    }
  }
  edges.sort((p, q) => p.d - q.d)

  for (const e of edges.slice(0, MAX_EDGE_CANDIDATES)) {
    if (e.d > MAX_ANCHOR_SHIFT_M) break
    // One normal direction points into the host, the other out of it; the
    // containment check rejects the inward one and any neighbouring building.
    for (const sign of [1, -1]) {
      const q = toLatLon(e.x + sign * e.nx * FACADE_OFFSET_M, e.y + sign * e.ny * FACADE_OFFSET_M)
      if (buildingsContaining(index, q).length === 0) return q
    }
  }
  return origin
}

export type IsSunnyOpts = { rayLengthM?: number }

const DEFAULT_RAY_LENGTH_M = 500
const BBOX_PAD_M = 10

/** True if direct sunlight reaches `poi` at time `t` (no building blocks the
 *  ray). Evaluated at `sunAnchor(poi)`, i.e. outside the POI's own facade. */
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
  const start = sunAnchor(poi, index)
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
    // The first wall the ray meets — outer or courtyard — is where it is
    // lowest, so that's the one that decides whether the building blocks it.
    let nearestM = Infinity
    for (const ring of ringsOf(c.building)) {
      const hit = lineIntersectsPolygon([start, end], ring)
      if (hit && hit.distanceFromStartM < nearestM) nearestM = hit.distanceFromStartM
    }
    if (nearestM === Infinity) continue
    if (c.building.heightM > nearestM * tanAlt) return false
  }
  return true
}

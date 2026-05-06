// Wire-format projections for the bulk bbox endpoints.
//
// Why: the raw DB rows carry fields the client never reads, full OSM tag blobs,
// and 7-decimal coordinates — all paid as Railway egress on every pan/zoom.
// These helpers slim each row to the minimum the client actually consumes
// before serialization. `getPoiById` keeps the full row (rare, single-document)
// so the detail page still has every tag.

const COORD_DECIMALS = 5
const COORD_FACTOR = 10 ** COORD_DECIMALS

/** Round a coordinate component to ~1.1 m precision. */
export function roundCoord(n: number): number {
  return Math.round(n * COORD_FACTOR) / COORD_FACTOR
}

function roundFootprint(footprint: [number, number][]): [number, number][] {
  const out: [number, number][] = new Array(footprint.length)
  for (let i = 0; i < footprint.length; i++) {
    const p = footprint[i]!
    out[i] = [roundCoord(p[0]), roundCoord(p[1])]
  }
  return out
}

/**
 * Tag keys the bulk views (map markers + bottom sheet) actually read. The
 * detail route (`/spot/$id`) reads more keys, but it's served by `getPoiById`
 * which returns the full row.
 */
const POI_BULK_TAG_KEYS = [
  'outdoor_seating',
  'terrace',
  'addr:street',
  'addr:housenumber',
  'addr:postcode',
  'addr:city',
] as const

export function slimTags(
  tags: Record<string, string> | null | undefined,
): Record<string, string> | null {
  if (!tags || typeof tags !== 'object') return null
  let out: Record<string, string> | null = null
  for (const k of POI_BULK_TAG_KEYS) {
    const v = tags[k]
    if (v == null) continue
    if (out === null) out = {}
    out[k] = v
  }
  return out
}

export type BuildingRow = {
  id: string
  footprint: [number, number][]
  heightM: number
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
}

export type BuildingWire = Omit<BuildingRow, 'id'>

export function slimBuilding(row: BuildingRow): BuildingWire {
  return {
    footprint: roundFootprint(row.footprint),
    heightM: row.heightM,
    minLat: roundCoord(row.minLat),
    maxLat: roundCoord(row.maxLat),
    minLon: roundCoord(row.minLon),
    maxLon: roundCoord(row.maxLon),
  }
}

export type PoiRow = {
  id: string
  name: string | null
  amenity: string
  cuisine: string | null
  lat: number
  lon: number
  openingHours: string | null
  tags: Record<string, string> | null
  fetchedAt: number
}

export type PoiWire = {
  id: string
  lat: number
  lon: number
  name: string | null
  amenity: string
  openingHours: string | null
  tags: Record<string, string> | null
}

export function slimPoi(row: PoiRow): PoiWire {
  return {
    id: row.id,
    lat: row.lat,
    lon: row.lon,
    name: row.name,
    amenity: row.amenity,
    openingHours: row.openingHours,
    tags: slimTags(row.tags),
  }
}

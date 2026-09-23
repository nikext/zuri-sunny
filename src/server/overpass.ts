import type { NewPoi, NewBuilding } from './db/schema'
import { pointInRing } from '#/lib/geo'

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

// POI query rationale:
//   Branch A — Explicit `outdoor_seating=yes` for the full set of food/drink amenities.
//               This is the high-precision core: anyone who tagged it has a terrace.
//   Branch B — Explicit `terrace=yes` (older / alternative tag still in use in CH).
//   Branch C — Likely-outdoor amenities where `outdoor_seating` is unset entirely
//               (`[!outdoor_seating]`). Restricted to `cafe|bar|pub|biergarten` —
//               categories where a sidewalk/terrace setup is the norm in Zürich.
//               Restaurants are deliberately excluded here to avoid pulling in
//               every indoor-only Beiz; they only enter via Branch A or B.
//   Branch D — Anything tagged `leisure=garden` or `leisure=beer_garden` that's
//               also a food/drink amenity and not explicitly `outdoor_seating=no`
//               (covers e.g. restaurants with a Gartenwirtschaft that haven't set
//               `outdoor_seating=yes`).
export const POIS_QUERY = `
[out:json][timeout:60];
area["name"="Zürich"]["admin_level"="8"]->.zh;
(
  nwr["amenity"~"^(cafe|bar|restaurant|biergarten|pub|ice_cream)$"]["outdoor_seating"="yes"](area.zh);
  nwr["amenity"~"^(cafe|bar|restaurant|biergarten|pub|ice_cream)$"]["terrace"="yes"](area.zh);
  nwr["amenity"~"^(cafe|bar|pub|biergarten)$"][!"outdoor_seating"][!"terrace"](area.zh);
  nwr["amenity"~"^(cafe|bar|restaurant|biergarten|pub|ice_cream)$"]["outdoor_seating"!="no"]["leisure"~"^(garden|beer_garden)$"](area.zh);
);
out center tags;
`

export const BUILDINGS_QUERY = `
[out:json][timeout:120];
area["name"="Zürich"]["admin_level"="8"]->.zh;
(
  way["building"](area.zh);
  relation["building"](area.zh);
);
out geom;
`

type OverpassElement = {
  type: 'node' | 'way' | 'relation'
  id: number
  tags?: Record<string, string>
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  geometry?: Array<{ lat: number; lon: number }>
  /** Relation members; `out geom` inlines each way member's geometry. */
  members?: Array<{
    type: 'node' | 'way' | 'relation'
    ref: number
    role: string
    geometry?: Array<{ lat: number; lon: number }>
  }>
}

type OverpassResponse = {
  elements: OverpassElement[]
}

// POST the query as application/x-www-form-urlencoded with `data=<query>`.
// Overpass rejects Node's default user agent — send an explicit one.
const USER_AGENT = 'zuri-sunny/0.1 (https://github.com/Nikola/zuri-sunny)'

async function postQuery(query: string, fetcher: typeof fetch): Promise<OverpassResponse> {
  const body = new URLSearchParams({ data: query })
  const res = await fetcher(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
    body,
  })
  if (!res.ok) {
    throw new Error(`Overpass HTTP ${res.status}`)
  }
  return (await res.json()) as OverpassResponse
}

// Run the query, retrying once on transient (network/non-200) failures.
async function runQuery(query: string, fetcher: typeof fetch): Promise<OverpassResponse> {
  try {
    return await postQuery(query, fetcher)
  } catch {
    return await postQuery(query, fetcher)
  }
}

// Parse "12 m", "12m", "12", "12.5" → number; returns null on NaN/negative.
function parseHeight(raw: string | undefined): number | null {
  if (!raw) return null
  const m = raw.trim().match(/^(-?\d+(?:\.\d+)?)/)
  if (!m) return null
  const n = parseFloat(m[1]!)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

function parseLevels(raw: string | undefined): number | null {
  if (!raw) return null
  const m = raw.trim().match(/^(-?\d+)/)
  if (!m) return null
  const n = parseInt(m[1]!, 10)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

export async function fetchPois(opts?: { fetcher?: typeof fetch }): Promise<NewPoi[]> {
  const fetcher = opts?.fetcher ?? fetch
  const data = await runQuery(POIS_QUERY, fetcher)
  const now = Date.now()
  const out: NewPoi[] = []
  for (const el of data.elements ?? []) {
    const tags = el.tags
    if (!tags || !tags.amenity) continue
    let lat: number | undefined
    let lon: number | undefined
    if (typeof el.lat === 'number' && typeof el.lon === 'number') {
      lat = el.lat
      lon = el.lon
    } else if (el.center && typeof el.center.lat === 'number' && typeof el.center.lon === 'number') {
      lat = el.center.lat
      lon = el.center.lon
    }
    if (lat === undefined || lon === undefined) continue
    out.push({
      id: `${el.type}/${el.id}`,
      name: tags.name ?? null,
      amenity: tags.amenity,
      cuisine: tags.cuisine ?? null,
      lat,
      lon,
      openingHours: tags.opening_hours ?? null,
      tags,
      fetchedAt: now,
    })
  }
  return out
}

type Ring = [number, number][]

/** Join way fragments into closed rings. Multipolygon rings are often split
 *  across several ways that share end nodes (identical coordinates), in either
 *  direction. Fragments that never close are dropped. */
export function assembleRings(ways: Ring[]): Ring[] {
  const same = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1]
  const open = ways.filter((w) => w.length >= 2).map((w) => [...w])
  const rings: Ring[] = []
  while (open.length > 0) {
    let ring = open.shift()!
    while (!same(ring[0]!, ring[ring.length - 1]!)) {
      const end = ring[ring.length - 1]!
      const i = open.findIndex((w) => same(w[0]!, end) || same(w[w.length - 1]!, end))
      if (i < 0) break
      const next = open.splice(i, 1)[0]!
      const oriented = same(next[0]!, end) ? next : [...next].reverse()
      ring = ring.concat(oriented.slice(1))
    }
    if (ring.length >= 4 && same(ring[0]!, ring[ring.length - 1]!)) rings.push(ring)
  }
  return rings
}

/** Metres per storey used to turn `building:levels` into a height. */
const LEVEL_HEIGHT_M = 3

/** Typical storeys by `building=*` value, for the ~2/3 of Zürich buildings
 *  (33.8k of 50.3k) with neither `height` nor `building:levels`. Values are
 *  the median `building:levels` of the Zürich buildings of that type that do
 *  carry it (Sept 2026; e.g. apartments n=7942, house n=1461). `church` has
 *  too few tagged to measure and is a guess for the nave. Unlisted types —
 *  mostly `building=yes`, median 3 — fall back to DEFAULT_LEVELS. */
const TYPICAL_LEVELS: Record<string, number> = {
  apartments: 4,
  residential: 4,
  house: 2,
  detached: 2,
  semidetached_house: 2,
  terrace: 2,
  farm: 2,
  commercial: 5,
  office: 5,
  hotel: 5,
  public: 5,
  retail: 2,
  civic: 2,
  school: 3,
  university: 3,
  hospital: 3,
  industrial: 2,
  warehouse: 2,
  church: 5,
  allotment_house: 1,
  kindergarten: 1,
  farm_auxiliary: 1,
  garage: 1,
  garages: 1,
  carport: 1,
  shed: 1,
  hut: 1,
  kiosk: 1,
  toilets: 1,
  roof: 1,
  greenhouse: 1,
  service: 1,
}
const DEFAULT_LEVELS = 3

/** Height in metres from OSM tags: explicit `height`, else storeys
 *  (`building:levels` plus half of any `roof:levels` for the pitched roof),
 *  else a typical storey count for the building type. */
export function estimateHeightM(tags: Record<string, string>): number {
  const explicit = parseHeight(tags.height)
  if (explicit !== null) return explicit
  const roofLevels = parseLevels(tags['roof:levels']) ?? 0
  const levels = parseLevels(tags['building:levels'])
  if (levels !== null) return (levels + roofLevels / 2) * LEVEL_HEIGHT_M
  const typical = TYPICAL_LEVELS[tags.building ?? ''] ?? DEFAULT_LEVELS
  return (typical + roofLevels / 2) * LEVEL_HEIGHT_M
}

function bboxOfRing(ring: Ring) {
  let minLat = Infinity
  let maxLat = -Infinity
  let minLon = Infinity
  let maxLon = -Infinity
  for (const [lon, lat] of ring) {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
  }
  return { minLat, maxLat, minLon, maxLon }
}

export async function fetchBuildings(opts?: { fetcher?: typeof fetch }): Promise<NewBuilding[]> {
  const fetcher = opts?.fetcher ?? fetch
  const data = await runQuery(BUILDINGS_QUERY, fetcher)
  const elements = data.elements ?? []
  const out: NewBuilding[] = []

  // Multipolygon buildings (courtyard blocks, mostly). Their outer ways are
  // sometimes also tagged building=* on their own; those duplicates would
  // fill in the courtyard, so skip ways that are a building relation's outer.
  const relationOuterWays = new Set<number>()
  for (const el of elements) {
    if (el.type !== 'relation' || el.tags?.type !== 'multipolygon') continue
    const toRing = (g: Array<{ lat: number; lon: number }>): Ring => g.map((p) => [p.lon, p.lat])
    const outerWays: Ring[] = []
    const innerWays: Ring[] = []
    for (const m of el.members ?? []) {
      if (m.type !== 'way' || !m.geometry || m.geometry.length === 0) continue
      if (m.role === 'outer') {
        outerWays.push(toRing(m.geometry))
        relationOuterWays.add(m.ref)
      } else if (m.role === 'inner') {
        innerWays.push(toRing(m.geometry))
      }
    }
    const outers = assembleRings(outerWays)
    const inners = assembleRings(innerWays)
    const heightM = estimateHeightM(el.tags ?? {})
    outers.forEach((outer, k) => {
      const holes = inners.filter((inner) =>
        pointInRing({ lon: inner[0]![0], lat: inner[0]![1] }, outer),
      )
      out.push({
        id: outers.length === 1 ? `relation/${el.id}` : `relation/${el.id}/${k}`,
        footprint: outer,
        holes: holes.length > 0 ? holes : null,
        heightM,
        ...bboxOfRing(outer),
      })
    })
  }

  for (const el of elements) {
    if (el.type !== 'way' || relationOuterWays.has(el.id)) continue
    const geom = el.geometry
    if (!geom || geom.length === 0) continue
    const footprint: Ring = geom.map((p) => [p.lon, p.lat])
    out.push({
      id: `${el.type}/${el.id}`,
      footprint,
      heightM: estimateHeightM(el.tags ?? {}),
      ...bboxOfRing(footprint),
    })
  }
  return out
}

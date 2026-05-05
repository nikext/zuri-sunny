import type { NewPoi, NewBuilding } from './db/schema'

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

export const POIS_QUERY = `
[out:json][timeout:60];
area["name"="Zürich"]["admin_level"="8"]->.zh;
(
  nwr["amenity"~"^(cafe|bar|restaurant|biergarten|pub|ice_cream)$"]["outdoor_seating"="yes"](area.zh);
  nwr["amenity"~"^(cafe|bar|restaurant|biergarten|pub)$"]["outdoor_seating"!="no"]["leisure"="garden"](area.zh);
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
}

type OverpassResponse = {
  elements: OverpassElement[]
}

// POST the query as application/x-www-form-urlencoded with `data=<query>`.
async function postQuery(query: string, fetcher: typeof fetch): Promise<OverpassResponse> {
  const body = new URLSearchParams({ data: query })
  const res = await fetcher(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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

export async function fetchBuildings(opts?: { fetcher?: typeof fetch }): Promise<NewBuilding[]> {
  const fetcher = opts?.fetcher ?? fetch
  const data = await runQuery(BUILDINGS_QUERY, fetcher)
  const out: NewBuilding[] = []
  for (const el of data.elements ?? []) {
    const geom = el.geometry
    if (!geom || geom.length === 0) continue
    const footprint: [number, number][] = geom.map((p) => [p.lon, p.lat])
    let minLat = Infinity
    let maxLat = -Infinity
    let minLon = Infinity
    let maxLon = -Infinity
    for (const p of geom) {
      if (p.lat < minLat) minLat = p.lat
      if (p.lat > maxLat) maxLat = p.lat
      if (p.lon < minLon) minLon = p.lon
      if (p.lon > maxLon) maxLon = p.lon
    }
    const tags = el.tags ?? {}
    let heightM: number | null = parseHeight(tags.height)
    if (heightM === null) {
      const levels = parseLevels(tags['building:levels'])
      if (levels !== null) heightM = levels * 3
    }
    if (heightM === null) heightM = 10
    out.push({
      id: `${el.type}/${el.id}`,
      footprint,
      heightM,
      minLat,
      maxLat,
      minLon,
      maxLon,
    })
  }
  return out
}

// Fixed lon/lat grid for fetching buildings in cacheable chunks.
//
// Why: buildings used to be fetched for the exact viewport bbox, which at the
// initial city-wide bbox meant all ~50k buildings (~20 MB) in one response —
// too big for TanStack Start's server-fn output limit — and every pan refetched
// everything. Fixed tiles have stable request URLs (HTTP-cacheable), are small,
// and panning only fetches the tiles that are new.

import type { LatLon } from './types'

/** ~1.1 km × ~1.1 km at Zürich's latitude. */
export const TILE_DEG_LAT = 0.01
export const TILE_DEG_LON = 0.015

export type TileId = { x: number; y: number }

export function tileKey(t: TileId): string {
  return `${t.x}:${t.y}`
}

/** [west, south, east, north] of a tile. A building belongs to the tile that
 *  contains its bbox's south-west corner, so each building is served once. */
export function tileBbox(t: TileId): [number, number, number, number] {
  return [t.x * TILE_DEG_LON, t.y * TILE_DEG_LAT, (t.x + 1) * TILE_DEG_LON, (t.y + 1) * TILE_DEG_LAT]
}

export function tileOf(p: LatLon): TileId {
  return { x: Math.floor(p.lon / TILE_DEG_LON), y: Math.floor(p.lat / TILE_DEG_LAT) }
}

/** Tiles covering `bbox` grown by `padM` metres on every side.
 *
 *  The padding matters twice over: shadows are cast by buildings outside the
 *  viewport (a 20 m building at 10° sun throws a ~110 m shadow), and a
 *  building is served by the tile holding its south-west corner, so one that
 *  starts just outside the loaded area would otherwise be missing. */
export function tilesForBbox(
  bbox: [number, number, number, number],
  padM: number,
): TileId[] {
  const [west, south, east, north] = bbox
  const midLat = (south + north) / 2
  const dLat = padM / 111_320
  const dLon = padM / (111_320 * Math.cos((midLat * Math.PI) / 180))
  const sw = tileOf({ lon: west - dLon, lat: south - dLat })
  const ne = tileOf({ lon: east + dLon, lat: north + dLat })
  const out: TileId[] = []
  for (let y = sw.y; y <= ne.y; y++) {
    for (let x = sw.x; x <= ne.x; x++) out.push({ x, y })
  }
  return out
}

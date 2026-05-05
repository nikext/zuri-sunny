// TanStack Start server functions for POIs / buildings / refresh.
// All Node-only imports (db, drizzle, init, refresh) are confined to handler
// bodies so the TanStack Start compiler keeps them out of the client bundle.
import { createServerFn } from '@tanstack/react-start'

type Bbox = [number, number, number, number]

function parseBbox(input: { bbox: Bbox }): { bbox: Bbox } {
  const b = input?.bbox
  if (!Array.isArray(b) || b.length !== 4 || b.some((n) => typeof n !== 'number' || !isFinite(n))) {
    throw new Error('Invalid bbox: expected [west, south, east, north]')
  }
  return { bbox: [b[0], b[1], b[2], b[3]] }
}

/** POIs whose lat/lon fall inside the requested bbox. */
export const getPoisInBbox = createServerFn({ method: 'GET' })
  .inputValidator(parseBbox)
  .handler(async ({ data }) => {
    const { ensureServerStarted } = await import('./init')
    const { db } = await import('./db/client')
    const { pois } = await import('./db/schema')
    const { and, gte, lte } = await import('drizzle-orm')
    ensureServerStarted()
    const [west, south, east, north] = data.bbox
    const rows = await db
      .select()
      .from(pois)
      .where(
        and(gte(pois.lon, west), lte(pois.lon, east), gte(pois.lat, south), lte(pois.lat, north)),
      )
    return rows
  })

/** Buildings whose bbox overlaps the requested bbox. */
export const getBuildingsInBbox = createServerFn({ method: 'GET' })
  .inputValidator(parseBbox)
  .handler(async ({ data }) => {
    const { ensureServerStarted } = await import('./init')
    const { db } = await import('./db/client')
    const { buildings } = await import('./db/schema')
    const { and, gte, lte } = await import('drizzle-orm')
    ensureServerStarted()
    const [west, south, east, north] = data.bbox
    // Overlap = NOT (maxLon < west || minLon > east || maxLat < south || minLat > north)
    const rows = await db
      .select()
      .from(buildings)
      .where(
        and(
          gte(buildings.maxLon, west),
          lte(buildings.minLon, east),
          gte(buildings.maxLat, south),
          lte(buildings.minLat, north),
        ),
      )
    return rows
  })

/** Single POI by id, or null. */
export const getPoiById = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: string }) => {
    if (!d || typeof d.id !== 'string' || d.id.length === 0) throw new Error('Invalid id')
    return { id: d.id }
  })
  .handler(async ({ data }) => {
    const { ensureServerStarted } = await import('./init')
    const { db } = await import('./db/client')
    const { pois } = await import('./db/schema')
    const { eq } = await import('drizzle-orm')
    ensureServerStarted()
    const rows = await db.select().from(pois).where(eq(pois.id, data.id)).limit(1)
    return rows[0] ?? null
  })

/** Triggers a full data refresh from Overpass. v1: no auth. */
export const refreshData = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => d ?? {})
  .handler(async () => {
    const { ensureServerStarted } = await import('./init')
    const { refreshAll } = await import('./refresh')
    ensureServerStarted()
    return await refreshAll()
  })


// Seed/refresh logic for OSM data. Migrations must run before any of these are called.
import { sql } from 'drizzle-orm'
import { db, sqlite } from './db/client'
import { pois, buildings, cacheMeta } from './db/schema'
import type { NewPoi, NewBuilding } from './db/schema'
import { fetchPois, fetchBuildings } from './overpass'

const CHUNK = 500

type Database = typeof db

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function insertPois(database: Database, rows: NewPoi[]) {
  const tx = sqlite.transaction(() => {
    for (const c of chunk(rows, CHUNK)) {
      if (c.length === 0) continue
      database.insert(pois).values(c).run()
    }
  })
  tx()
}

function insertBuildings(database: Database, rows: NewBuilding[]) {
  const tx = sqlite.transaction(() => {
    for (const c of chunk(rows, CHUNK)) {
      if (c.length === 0) continue
      database.insert(buildings).values(c).run()
    }
  })
  tx()
}

function upsertMeta(database: Database, key: string, refreshedAt: number) {
  database
    .insert(cacheMeta)
    .values({ key, refreshedAt })
    .onConflictDoUpdate({ target: cacheMeta.key, set: { refreshedAt } })
    .run()
}

export async function seedIfEmpty(
  database: Database = db,
): Promise<{ poisInserted: number; buildingsInserted: number } | { skipped: true }> {
  const row = database.select({ c: sql<number>`count(*)` }).from(pois).get()
  const count = row?.c ?? 0
  if (count > 0) return { skipped: true }
  const [poiRows, buildingRows] = await Promise.all([fetchPois(), fetchBuildings()])
  insertPois(database, poiRows)
  insertBuildings(database, buildingRows)
  const now = Date.now()
  upsertMeta(database, 'pois', now)
  upsertMeta(database, 'buildings', now)
  return { poisInserted: poiRows.length, buildingsInserted: buildingRows.length }
}

export async function refreshAll(
  database: Database = db,
): Promise<{ poisInserted: number; buildingsInserted: number }> {
  const [poiRows, buildingRows] = await Promise.all([fetchPois(), fetchBuildings()])
  const replacePois = sqlite.transaction(() => {
    database.delete(pois).run()
    for (const c of chunk(poiRows, CHUNK)) {
      if (c.length === 0) continue
      database.insert(pois).values(c).run()
    }
  })
  replacePois()
  const replaceBuildings = sqlite.transaction(() => {
    database.delete(buildings).run()
    for (const c of chunk(buildingRows, CHUNK)) {
      if (c.length === 0) continue
      database.insert(buildings).values(c).run()
    }
  })
  replaceBuildings()
  const now = Date.now()
  upsertMeta(database, 'pois', now)
  upsertMeta(database, 'buildings', now)
  return { poisInserted: poiRows.length, buildingsInserted: buildingRows.length }
}

export function startRefreshLoop(
  intervalMs = 7 * 24 * 60 * 60 * 1000,
  database: Database = db,
): () => void {
  const timer = setInterval(() => {
    refreshAll(database).catch((err) => {
      console.error('[refresh] failed:', err)
    })
  }, intervalMs)
  // Allow Node process to exit even if this timer is still scheduled.
  timer.unref?.()
  return () => clearInterval(timer)
}

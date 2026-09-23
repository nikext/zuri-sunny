// Build-time seed: bakes the OSM data into the SQLite file so a fresh
// container (e.g. a Cloud Run cold start) serves data immediately instead of
// waiting on Overpass. The runtime staleness check in src/server/init.ts still
// refreshes it in the background once it is older than STALE_AGE_MS.
//
// If the build context already carries a database (deploying from a machine
// with a local ./data/zurich.db), it is migrated and reused, and only
// refreshed when older than REFRESH_AFTER_MS. A failed refresh keeps the
// existing data: Overpass often rate-limits cloud build IPs (429/504), and a
// few days' old café list beats a failed deploy. Only a build with no data at
// all fails.
import { eq } from 'drizzle-orm'
import { runMigrations } from '../src/server/db/migrate'
import { db, sqlite } from '../src/server/db/client'
import { cacheMeta } from '../src/server/db/schema'
import { refreshAll, seedIfEmpty } from '../src/server/refresh'

// The public Overpass instance regularly answers 504/429 under load.
const ATTEMPTS = 6
const REFRESH_AFTER_MS = 3 * 24 * 60 * 60 * 1000

async function withRetries<T>(label: string, attempts: number, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= attempts) throw err
      const waitS = 15 * attempt
      console.warn(`[seed] ${label} attempt ${attempt} failed (${String(err)}); retrying in ${waitS}s`)
      await new Promise((r) => setTimeout(r, waitS * 1000))
    }
  }
}

async function main() {
  runMigrations()
  const meta = db.select().from(cacheMeta).where(eq(cacheMeta.key, 'pois')).get()

  if (!meta) {
    const res = await withRetries('seed', ATTEMPTS, async () => {
      const r = await seedIfEmpty()
      if ('skipped' in r) return r
      if (r.poisInserted === 0 || r.buildingsInserted === 0) {
        throw new Error(`empty result (${r.poisInserted} pois, ${r.buildingsInserted} buildings)`)
      }
      return r
    })
    console.log('[seed]', 'skipped' in res ? 'DB already populated' : `${res.poisInserted} pois, ${res.buildingsInserted} buildings`)
  } else {
    const ageMs = Date.now() - meta.refreshedAt
    const ageH = Math.round(ageMs / 3_600_000)
    if (ageMs <= REFRESH_AFTER_MS) {
      console.log(`[seed] using bundled data (${ageH} h old)`)
    } else {
      try {
        const r = await withRetries('refresh', 3, () => refreshAll())
        console.log(`[seed] refreshed bundled data: ${r.poisInserted} pois, ${r.buildingsInserted} buildings`)
      } catch (err) {
        console.warn(`[seed] refresh failed (${String(err)}); keeping bundled data (${ageH} h old)`)
      }
    }
  }

  // Fold the WAL into the main file so the image carries a single db file.
  sqlite.pragma('wal_checkpoint(TRUNCATE)')
  sqlite.close()
}

main().catch((err) => {
  console.error('[seed] failed:', err)
  process.exit(1)
})

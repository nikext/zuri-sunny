// Build-time seed: bakes the OSM data into the SQLite file so a fresh
// container (e.g. a Cloud Run cold start) serves data immediately instead of
// waiting on Overpass. The runtime staleness check in src/server/init.ts still
// refreshes it in the background once it is older than STALE_AGE_MS.
import { runMigrations } from '../src/server/db/migrate'
import { sqlite } from '../src/server/db/client'
import { seedIfEmpty } from '../src/server/refresh'

// The public Overpass instance regularly answers 504/429 under load.
const ATTEMPTS = 6

async function main() {
  runMigrations()
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await seedIfEmpty()
      if ('skipped' in res) {
        console.log('[seed] DB already populated; nothing to do')
        break
      }
      if (res.poisInserted === 0 || res.buildingsInserted === 0) {
        throw new Error(`empty result (${res.poisInserted} pois, ${res.buildingsInserted} buildings)`)
      }
      console.log(`[seed] ${res.poisInserted} pois, ${res.buildingsInserted} buildings`)
      break
    } catch (err) {
      if (attempt === ATTEMPTS) throw err
      const waitS = 15 * attempt
      console.warn(`[seed] attempt ${attempt} failed (${String(err)}); retrying in ${waitS}s`)
      await new Promise((r) => setTimeout(r, waitS * 1000))
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

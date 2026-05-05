// Server-side bootstrap: imported by server functions. Idempotent.
// - Migrations run once (synchronous).
// - Refresh loop starts once (weekly).
// - Seed is attempted lazily; retries on subsequent calls until populated.
// - On the first request after a deploy, if existing data is older than
//   STALE_AGE_MS, a background refresh fires so the broadened-Overpass-query
//   case (or any other "DB exists but is stale") is handled automatically.
//   Server start is NOT blocked — first request gets old data, subsequent
//   requests get fresh data once the refresh resolves.

import { eq } from 'drizzle-orm'
import { runMigrations } from './db/migrate'
import { seedIfEmpty, refreshAll, startRefreshLoop } from './refresh'
import { db } from './db/client'
import { cacheMeta } from './db/schema'

// 6 hours: long enough that rapid back-to-back deploys don't hammer Overpass,
// short enough that a query-broadening deploy gets fresh data on first request.
const STALE_AGE_MS = 6 * 60 * 60 * 1000

let migrated = false
let refreshLoopStarted = false
let seedInFlight: Promise<unknown> | null = null
let seedDone = false
let startupRefreshChecked = false

async function maybeRefreshIfStale(): Promise<void> {
  if (startupRefreshChecked) return
  startupRefreshChecked = true
  try {
    const meta = db.select().from(cacheMeta).where(eq(cacheMeta.key, 'pois')).get()
    const ageMs = meta ? Date.now() - meta.refreshedAt : Number.POSITIVE_INFINITY
    if (ageMs <= STALE_AGE_MS) {
      console.log(
        `[init] data fresh (${Math.round(ageMs / 60000)} min old); skipping startup refresh`,
      )
      return
    }
    console.log(
      `[init] data is ${Math.round(ageMs / 60000)} min old; running background refresh`,
    )
    const result = await refreshAll()
    console.log(
      `[init] startup refresh done: ${result.poisInserted} pois, ${result.buildingsInserted} buildings`,
    )
  } catch (err) {
    console.error('[init] startup refresh failed:', err)
  }
}

export function ensureServerStarted(): void {
  if (!migrated) {
    runMigrations()
    migrated = true
    console.log('[init] migrations applied')
  }

  if (!refreshLoopStarted) {
    startRefreshLoop()
    refreshLoopStarted = true
  }

  if (seedDone || seedInFlight) return
  seedInFlight = seedIfEmpty()
    .then((res) => {
      if ('skipped' in res) {
        console.log('[init] seed skipped — DB already populated')
        seedDone = true
        // Existing data path — check freshness; refresh in background if stale.
        maybeRefreshIfStale()
      } else if (res.poisInserted > 0 || res.buildingsInserted > 0) {
        console.log(`[init] seeded ${res.poisInserted} pois, ${res.buildingsInserted} buildings`)
        seedDone = true
        // Just-seeded data is fresh by definition; suppress the staleness check.
        startupRefreshChecked = true
      } else {
        console.log('[init] seed inserted 0 rows; will retry on next request')
      }
    })
    .catch((err) => {
      console.error('[init] seed failed; will retry on next request:', err)
    })
    .finally(() => {
      seedInFlight = null
    })
}

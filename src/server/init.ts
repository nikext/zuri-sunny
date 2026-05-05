// Server-side bootstrap: imported by server functions. Idempotent.
// - Migrations run once (synchronous).
// - Refresh loop starts once.
// - Seed is attempted lazily; retries on subsequent calls until populated.

import { runMigrations } from './db/migrate'
import { seedIfEmpty, startRefreshLoop } from './refresh'

let migrated = false
let refreshLoopStarted = false
let seedInFlight: Promise<unknown> | null = null
let seedDone = false

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
      } else if (res.poisInserted > 0 || res.buildingsInserted > 0) {
        console.log(`[init] seeded ${res.poisInserted} pois, ${res.buildingsInserted} buildings`)
        seedDone = true
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

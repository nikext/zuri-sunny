# Cloud-aware sun + per-spot daily rating — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the app from claiming spots are sunny when it's overcast, and add a per-spot daily sun rating (0–99) inside each marker so users can pick good sun spots at a glance.

**Architecture:** Server-side weather fetch (Open-Meteo, 30-min cache) feeds a city-wide "sky chip" UI element. Client-side worker computes per-POI daily ratings (geometric, clear-sky) using the existing rbush index + `dailyTimeline`. Marker color stays geometric; on overcast skies, sunny markers desaturate and the chip says ☁️. Marker numbers fade in at zoom ≥ 14.

**Tech Stack:** TanStack Start + Nitro server functions, deck.gl `ScatterplotLayer` + `TextLayer`, MapLibre GL, SunCalc, Web Worker, Vitest.

**Reference spec:** `docs/superpowers/specs/2026-05-06-cloud-aware-sun-and-percentage-design.md`

**Notes for the implementer:**
- Vitest's `vite.config.ts` pins `env.TZ = 'UTC'`. Always construct test Dates with explicit UTC ISO strings (`new Date('2026-05-06T10:00:00Z')`) so behaviour is deterministic regardless of local timezone.
- `@deck.gl/layers` is already installed and exports `TextLayer` — no new dependency.
- The shadow worker is a Vite module worker; existing `'init'` and `'compute'` messages must keep working unchanged.
- Test pure functions (`sky.ts`, `score.ts`, `weather.ts`) directly. Worker glue is verified by manual smoke test, not Vitest.

---

## Task 1: Extend shared types for `Sky` and worker messages

**Files:**
- Modify: `src/lib/types.ts`

This is a contract-only change with no behavioural test. Subsequent tasks depend on these types being present.

- [ ] **Step 1: Add `Sky` type and extend worker message unions**

Edit `src/lib/types.ts` so the file ends like this (preserve the existing types above):

```ts
// ...existing types unchanged above (LatLon, BuildingFootprint, Building, Poi, SunPosition)...

// Worker message protocol
export type WorkerInitMessage = { type: 'init'; buildings: Building[] }
export type WorkerComputeMessage = { type: 'compute'; pois: Poi[]; t: string }
export type WorkerScoreDailyMessage = {
  type: 'score-daily'
  pois: Poi[]
  /** Local-day anchor as ISO string. The worker derives the YYYY-MM-DD cache
   *  key from this in `Europe/Zurich`. */
  day: string
}
export type WorkerInbound =
  | WorkerInitMessage
  | WorkerComputeMessage
  | WorkerScoreDailyMessage

export type WorkerReadyMessage = { type: 'ready' }
export type WorkerResultMessage = { type: 'result'; sunny: Record<string, boolean> }
export type WorkerRatingMessage = {
  type: 'rating'
  /** POI id -> 0..99 integer (geometric daily exposure, clear-sky). */
  rating: Record<string, number>
}
export type WorkerOutbound =
  | WorkerReadyMessage
  | WorkerResultMessage
  | WorkerRatingMessage

export type Category = 'breakfast' | 'coffee' | 'lunch' | 'apero' | 'all'

/** Current sky state for the city (Open-Meteo derived). `null` from the server
 *  fn means "no signal — degrade UI gracefully" (fetch failed or out of horizon). */
export type Sky = {
  state: 'clear' | 'partly' | 'overcast' | 'night'
  cloudCoverPct: number
  directRadiationWm2: number
  sunAltitudeRad: number
  /** ISO of the hour we sampled (snapped down to the hour). */
  at: string
}
```

- [ ] **Step 2: Verify the project still type-checks and tests pass**

Run: `pnpm test -- --run`
Expected: all 35 existing tests still pass; no TS errors. (Vitest also type-checks via the bundler.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(types): add Sky type and score-daily/rating worker messages"
```

---

## Task 2: `classifySky` pure function (`src/lib/sky.ts`)

**Files:**
- Create: `src/lib/sky.ts`
- Test: `src/lib/sky.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/sky.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { classifySky } from './sky'

describe('classifySky', () => {
  it('returns night when sun is below the horizon', () => {
    expect(
      classifySky({ cloudCoverPct: 0, directRadiationWm2: 0, sunAltitudeRad: -0.01 }),
    ).toBe('night')
    expect(
      classifySky({ cloudCoverPct: 100, directRadiationWm2: 800, sunAltitudeRad: -1 }),
    ).toBe('night')
  })

  it('returns overcast when direct radiation is below 80 W/m^2', () => {
    expect(
      classifySky({ cloudCoverPct: 100, directRadiationWm2: 0, sunAltitudeRad: 0.5 }),
    ).toBe('overcast')
    expect(
      classifySky({ cloudCoverPct: 50, directRadiationWm2: 79.9, sunAltitudeRad: 0.5 }),
    ).toBe('overcast')
  })

  it('returns partly between 80 and 350 W/m^2', () => {
    expect(
      classifySky({ cloudCoverPct: 60, directRadiationWm2: 80, sunAltitudeRad: 0.5 }),
    ).toBe('partly')
    expect(
      classifySky({ cloudCoverPct: 30, directRadiationWm2: 349.9, sunAltitudeRad: 0.5 }),
    ).toBe('partly')
  })

  it('returns clear at 350 W/m^2 and above', () => {
    expect(
      classifySky({ cloudCoverPct: 0, directRadiationWm2: 350, sunAltitudeRad: 0.5 }),
    ).toBe('clear')
    expect(
      classifySky({ cloudCoverPct: 0, directRadiationWm2: 900, sunAltitudeRad: 1.0 }),
    ).toBe('clear')
  })

  it('night flag wins over high radiation (defensive — should not happen in practice)', () => {
    // If Open-Meteo ever returns positive direct_radiation while geometric sun
    // is below the horizon, we should still call it night.
    expect(
      classifySky({ cloudCoverPct: 0, directRadiationWm2: 500, sunAltitudeRad: -0.1 }),
    ).toBe('night')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- --run src/lib/sky.test.ts`
Expected: FAIL with "Cannot find module './sky'" (or similar import error).

- [ ] **Step 3: Implement `classifySky`**

Create `src/lib/sky.ts`:

```ts
import type { Sky } from './types'

export type ClassifySkyInput = {
  cloudCoverPct: number
  directRadiationWm2: number
  sunAltitudeRad: number
}

/** Pure classifier. Thresholds are intentionally tunable; the test suite pins
 *  the current values. `direct_radiation` already integrates clouds + sun
 *  angle, which is why it (not raw cloud %) drives the clear/partly/overcast
 *  buckets. */
export function classifySky(input: ClassifySkyInput): Sky['state'] {
  if (input.sunAltitudeRad <= 0) return 'night'
  if (input.directRadiationWm2 < 80) return 'overcast'
  if (input.directRadiationWm2 < 350) return 'partly'
  return 'clear'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- --run src/lib/sky.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sky.ts src/lib/sky.test.ts
git commit -m "feat(sky): classifySky thresholds (night/overcast/partly/clear)"
```

---

## Task 3: `dailyRating` pure function (`src/lib/score.ts`)

**Files:**
- Create: `src/lib/score.ts`
- Test: `src/lib/score.test.ts`

This is the per-POI daily exposure integer (0–99). Reuses `dailyTimeline` and intersects with `opening_hours` evaluated for `day`.

- [ ] **Step 1: Write the failing test (clear-sky / no buildings / no opening hours)**

Create `src/lib/score.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { dailyRating } from './score'
import { buildSpatialIndex } from './shadows'
import type { Building, Poi } from './types'

const ZURICH: Poi = {
  id: 'test-poi',
  lat: 47.3769,
  lon: 8.5417,
}

describe('dailyRating', () => {
  it('open plaza with no opening hours rates near 99 on the summer solstice', () => {
    // Empty building index = nothing ever blocks the sun. With no opening hours,
    // the rating window is the full daylight day, and the entire window is sunny.
    const index = buildSpatialIndex([])
    const day = new Date('2026-06-21T12:00:00Z')
    const r = dailyRating(ZURICH, index, [], day)
    expect(r).toBeGreaterThanOrEqual(98)
    expect(r).toBeLessThanOrEqual(99)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- --run src/lib/score.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `dailyRating` (minimal — covers the first test)**

Create `src/lib/score.ts`:

```ts
import type { Building, Poi } from './types'
import type { BuildingIndex } from './shadows'
import { dailyTimeline } from './timeline'
import { getSunTimes } from './sun'
import OpeningHours from 'opening_hours'

type Interval = { from: number; to: number } // ms epoch

/** Resolve the rating window for `day`:
 *   - intersection of (open hours) ∩ (sunrise..sunset) if non-empty
 *   - else full (sunrise..sunset)
 *  Returns one or more sorted, disjoint intervals.
 */
function ratingWindow(poi: Poi, day: Date): Interval[] {
  const { sunrise, sunset } = getSunTimes(day, poi.lat, poi.lon)
  if (
    !(sunrise instanceof Date) || isNaN(sunrise.getTime()) ||
    !(sunset instanceof Date) || isNaN(sunset.getTime()) ||
    sunset.getTime() <= sunrise.getTime()
  ) {
    return []
  }
  const dayStart = sunrise.getTime()
  const dayEnd = sunset.getTime()
  const daylightOnly: Interval[] = [{ from: dayStart, to: dayEnd }]

  const oh = poi.openingHours
  if (!oh || oh.trim() === '') return daylightOnly
  let parser: OpeningHours
  try {
    parser = new OpeningHours(oh, null)
  } catch {
    return daylightOnly
  }

  // Query for a 36h window so multi-interval, late-night, and "wraps past
  // midnight" specs all surface inside daylight on `day`.
  const queryStart = new Date(dayStart - 12 * 60 * 60 * 1000)
  const queryEnd = new Date(dayEnd + 12 * 60 * 60 * 1000)
  let raw: Array<[Date, Date, boolean | undefined, string | undefined]>
  try {
    raw = parser.getOpenIntervals(queryStart, queryEnd) as Array<
      [Date, Date, boolean | undefined, string | undefined]
    >
  } catch {
    return daylightOnly
  }

  // Intersect each open interval with [dayStart, dayEnd], then merge.
  const intersected: Interval[] = []
  for (const [from, to] of raw) {
    const a = Math.max(from.getTime(), dayStart)
    const b = Math.min(to.getTime(), dayEnd)
    if (b > a) intersected.push({ from: a, to: b })
  }
  if (intersected.length === 0) return daylightOnly

  intersected.sort((x, y) => x.from - y.from)
  const merged: Interval[] = [intersected[0]!]
  for (let i = 1; i < intersected.length; i++) {
    const cur = intersected[i]!
    const last = merged[merged.length - 1]!
    if (cur.from <= last.to) {
      if (cur.to > last.to) last.to = cur.to
    } else {
      merged.push(cur)
    }
  }
  return merged
}

function totalMs(intervals: Interval[]): number {
  let sum = 0
  for (const i of intervals) sum += i.to - i.from
  return sum
}

/** Returns a 0..99 integer: percent of the rating window during which the POI
 *  is geometrically sunny (clear-sky assumption). */
export function dailyRating(
  poi: Poi,
  index: BuildingIndex,
  buildings: Building[],
  day: Date,
): number {
  const window = ratingWindow(poi, day)
  const windowMs = totalMs(window)
  if (windowMs <= 0) return 0

  const segs = dailyTimeline(poi, index, buildings, day)
  let sunnyMs = 0
  for (const s of segs) {
    if (!s.sunny) continue
    const segStart = s.from.getTime()
    const segEnd = s.to.getTime()
    // Sample at midpoint to mirror dailyTimeline's own segmentation rule.
    const mid = (segStart + segEnd) / 2
    for (const w of window) {
      if (mid >= w.from && mid < w.to) {
        // Count the slice of the sunny segment that overlaps the window.
        const a = Math.max(segStart, w.from)
        const b = Math.min(segEnd, w.to)
        if (b > a) sunnyMs += b - a
        break
      }
    }
  }
  return Math.min(99, Math.max(0, Math.round((100 * sunnyMs) / windowMs)))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- --run src/lib/score.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Add a "fully shadowed" test**

Append to `src/lib/score.test.ts`:

```ts
describe('dailyRating — fully shadowed', () => {
  it('returns 0 when a tall building blocks the sun all day from due south', () => {
    // 100m wall ~30m south of the POI, spanning enough longitude that the
    // sun's ray is blocked at every azimuth from sunrise through sunset.
    const dLat = 30 / 111_000
    const south = ZURICH.lat - dLat
    // Long enough wall (E-W) to block from SE through SW.
    const halfLon = 200 / (111_000 * Math.cos((ZURICH.lat * Math.PI) / 180))
    const minLon = ZURICH.lon - halfLon
    const maxLon = ZURICH.lon + halfLon
    const minLat = south - dLat
    const maxLat = south + dLat
    const wall: Building = {
      id: 'wall',
      heightM: 100,
      footprint: [
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat],
      ],
      minLat,
      maxLat,
      minLon,
      maxLon,
    }
    const index = buildSpatialIndex([wall])
    // Winter solstice — sun is always low and due south of Zürich; this wall
    // blocks every ray.
    const day = new Date('2026-12-21T12:00:00Z')
    const r = dailyRating(ZURICH, index, [wall], day)
    expect(r).toBe(0)
  })
})
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test -- --run src/lib/score.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 7: Add an "opening hours window" test**

Append to `src/lib/score.test.ts`:

```ts
describe('dailyRating — opening hours window', () => {
  it('rating reflects opening_hours window, not full daylight', () => {
    // No buildings -> always sunny when the sun is up. With 07:00-09:00
    // opening hours and a sunrise around 05:30 in June, the rating window is
    // 2h long and entirely sunny -> 99.
    const index = buildSpatialIndex([])
    const day = new Date('2026-06-21T12:00:00Z')
    const poi: Poi = {
      ...ZURICH,
      id: 'breakfast-cafe',
      openingHours: 'Mo-Su 07:00-09:00',
    }
    const r = dailyRating(poi, index, [], day)
    expect(r).toBeGreaterThanOrEqual(98)
  })

  it('falls back to full daylight when open hours and daylight do not overlap', () => {
    // Club open 02:00-05:00 in June (sunrise ~05:30 -> 0 overlap with daylight).
    // Falls back to full daylight; with no buildings, that's near-100% sunny.
    const index = buildSpatialIndex([])
    const day = new Date('2026-06-21T12:00:00Z')
    const poi: Poi = {
      ...ZURICH,
      id: 'night-club',
      openingHours: 'Mo-Su 02:00-05:00',
    }
    const r = dailyRating(poi, index, [], day)
    expect(r).toBeGreaterThanOrEqual(98)
  })

  it('treats unparseable opening_hours as no-window (uses full daylight)', () => {
    const index = buildSpatialIndex([])
    const day = new Date('2026-06-21T12:00:00Z')
    const poi: Poi = {
      ...ZURICH,
      id: 'broken-hours',
      openingHours: 'this is not valid OSM hours',
    }
    const r = dailyRating(poi, index, [], day)
    expect(r).toBeGreaterThanOrEqual(98)
  })
})
```

- [ ] **Step 8: Run all score tests to verify they pass**

Run: `pnpm test -- --run src/lib/score.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 9: Commit**

```bash
git add src/lib/score.ts src/lib/score.test.ts
git commit -m "feat(score): dailyRating — geometric clear-sky daily exposure 0..99"
```

---

## Task 4: Open-Meteo fetch + cache (`src/server/weather.ts`)

**Files:**
- Create: `src/server/weather.ts`
- Test: `src/server/weather.test.ts`

We mirror the dependency-injection pattern from `src/server/overpass.ts` (accept a `fetcher` arg) so tests can mock the network without `vi.spyOn(globalThis, 'fetch')`.

- [ ] **Step 1: Write the failing test**

Create `src/server/weather.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { __resetWeatherCacheForTest, fetchSky } from './weather'

function meteoResponse(opts: {
  startIsoHour: string // e.g. '2026-05-06T10:00'
  hours: number
  cloudCover: number[]
  directRadiation: number[]
}): Response {
  const time: string[] = []
  const start = new Date(opts.startIsoHour + ':00Z')
  for (let i = 0; i < opts.hours; i++) {
    const h = new Date(start.getTime() + i * 60 * 60 * 1000)
    // Open-Meteo returns local-tz strings of the form "YYYY-MM-DDTHH:mm".
    // We mimic Europe/Zurich here as if the API timezone=Europe/Zurich was set.
    const yyyy = h.getUTCFullYear()
    const mm = String(h.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(h.getUTCDate()).padStart(2, '0')
    const hh = String(h.getUTCHours()).padStart(2, '0')
    time.push(`${yyyy}-${mm}-${dd}T${hh}:00`)
  }
  const body = {
    hourly: {
      time,
      cloud_cover: opts.cloudCover,
      direct_radiation: opts.directRadiation,
    },
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  __resetWeatherCacheForTest()
})

describe('fetchSky', () => {
  it('snaps to the hour and returns the matching sample', async () => {
    const fetcher = vi.fn(async () =>
      meteoResponse({
        startIsoHour: '2026-05-06T10:00',
        hours: 4,
        cloudCover: [10, 20, 80, 100],
        directRadiation: [600, 500, 100, 5],
      }),
    ) as unknown as typeof fetch
    const sky = await fetchSky({ at: '2026-05-06T10:30:00Z', fetcher })
    expect(sky).not.toBeNull()
    expect(sky!.cloudCoverPct).toBe(10)
    expect(sky!.directRadiationWm2).toBe(600)
    expect(sky!.at).toBe('2026-05-06T10:00:00Z')
  })

  it('caches the response across calls within TTL', async () => {
    const fetcher = vi.fn(async () =>
      meteoResponse({
        startIsoHour: '2026-05-06T10:00',
        hours: 3,
        cloudCover: [0, 0, 0],
        directRadiation: [800, 800, 800],
      }),
    ) as unknown as typeof fetch
    await fetchSky({ at: '2026-05-06T10:00:00Z', fetcher })
    await fetchSky({ at: '2026-05-06T11:30:00Z', fetcher })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('returns null when the time is outside the fetched window', async () => {
    const fetcher = vi.fn(async () =>
      meteoResponse({
        startIsoHour: '2026-05-06T10:00',
        hours: 2,
        cloudCover: [0, 0],
        directRadiation: [500, 500],
      }),
    ) as unknown as typeof fetch
    const sky = await fetchSky({ at: '2026-05-20T12:00:00Z', fetcher })
    expect(sky).toBeNull()
  })

  it('returns null when the fetch throws', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('boom')
    }) as unknown as typeof fetch
    const sky = await fetchSky({ at: '2026-05-06T10:00:00Z', fetcher })
    expect(sky).toBeNull()
  })

  it('returns null on non-200', async () => {
    const fetcher = vi.fn(async () => new Response('oops', { status: 500 })) as unknown as typeof fetch
    const sky = await fetchSky({ at: '2026-05-06T10:00:00Z', fetcher })
    expect(sky).toBeNull()
  })

  it('classifies the sample using sun altitude (overcast at zero radiation)', async () => {
    const fetcher = vi.fn(async () =>
      meteoResponse({
        startIsoHour: '2026-05-06T12:00',
        hours: 1,
        cloudCover: [100],
        directRadiation: [0],
      }),
    ) as unknown as typeof fetch
    const sky = await fetchSky({ at: '2026-05-06T12:00:00Z', fetcher })
    expect(sky).not.toBeNull()
    expect(sky!.state).toBe('overcast')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- --run src/server/weather.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `fetchSky` and the cache**

Create `src/server/weather.ts`:

```ts
import SunCalc from 'suncalc'
import { classifySky } from '#/lib/sky'
import type { Sky } from '#/lib/types'

const ZURICH_LAT = 47.3769
const ZURICH_LON = 8.5417
const TTL_MS = 30 * 60 * 1000
const ENDPOINT = 'https://api.open-meteo.com/v1/forecast'

type HourlyCache = {
  fetchedAt: number
  // Parallel arrays — index lookups are O(1) by hour offset.
  hourEpochMs: number[] // UTC ms of each hourly sample
  cloudCover: number[]
  directRadiation: number[]
}

let cache: HourlyCache | null = null

/** Test seam — drops the in-memory cache between cases. */
export function __resetWeatherCacheForTest(): void {
  cache = null
}

function buildUrl(): string {
  const params = new URLSearchParams({
    latitude: String(ZURICH_LAT),
    longitude: String(ZURICH_LON),
    hourly: 'cloud_cover,direct_radiation',
    timezone: 'Europe/Zurich',
    forecast_days: '16',
  })
  return `${ENDPOINT}?${params.toString()}`
}

/** Parse an Open-Meteo "YYYY-MM-DDTHH:mm" local-time string (timezone is
 *  always Europe/Zurich since we ask for that) into a UTC epoch ms. We rely
 *  on the fact that the offset is fully determined by the timestamp + ZH
 *  rules; using the JS Date constructor with that suffix would mis-parse it
 *  as local-of-the-current-machine. Strategy: treat as wall-clock in ZH and
 *  let SunCalc/etc. care about its own conversions for downstream math. For
 *  our purposes (matching client-supplied UTC ms after snapping to the hour),
 *  we round-trip via the Intl API. */
function parseZhWallTimeToUtcMs(local: string): number {
  // Build a candidate UTC time by treating the wall-clock as UTC, then
  // measure the offset Intl reports for that instant in ZH and subtract it.
  const asIfUtc = new Date(local + 'Z')
  if (Number.isNaN(asIfUtc.getTime())) return NaN
  const zhParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(asIfUtc)
  const get = (t: string) => zhParts.find((p) => p.type === t)?.value ?? '00'
  const zhWall = `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00Z`
  const zhAsUtc = new Date(zhWall).getTime()
  const offsetMs = zhAsUtc - asIfUtc.getTime()
  return asIfUtc.getTime() - offsetMs
}

async function refreshCache(fetcher: typeof fetch): Promise<HourlyCache | null> {
  try {
    const res = await fetcher(buildUrl(), {
      headers: { 'User-Agent': 'zuri-sunny (https://github.com/) +contact' },
    })
    if (!res.ok) return null
    const body = (await res.json()) as {
      hourly?: { time?: string[]; cloud_cover?: number[]; direct_radiation?: number[] }
    }
    const time = body.hourly?.time ?? []
    const cloudCover = body.hourly?.cloud_cover ?? []
    const directRadiation = body.hourly?.direct_radiation ?? []
    if (
      time.length === 0 ||
      cloudCover.length !== time.length ||
      directRadiation.length !== time.length
    ) {
      return null
    }
    const hourEpochMs = time.map(parseZhWallTimeToUtcMs)
    if (hourEpochMs.some((n) => Number.isNaN(n))) return null
    return { fetchedAt: Date.now(), hourEpochMs, cloudCover, directRadiation }
  } catch {
    return null
  }
}

function lookupIndex(c: HourlyCache, atMs: number): number {
  // Snap down to the hour bucket: find the largest i with hourEpochMs[i] <= atMs.
  let lo = 0
  let hi = c.hourEpochMs.length - 1
  if (atMs < c.hourEpochMs[lo]!) return -1
  if (atMs >= c.hourEpochMs[hi]! + 60 * 60 * 1000) return -1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (c.hourEpochMs[mid]! <= atMs) lo = mid
    else hi = mid - 1
  }
  return lo
}

export type FetchSkyArgs = {
  at: string
  /** Override for tests; defaults to globalThis.fetch. */
  fetcher?: typeof fetch
}

export async function fetchSky(args: FetchSkyArgs): Promise<Sky | null> {
  const fetcher = args.fetcher ?? fetch
  const atMs = new Date(args.at).getTime()
  if (Number.isNaN(atMs)) return null

  if (!cache || Date.now() - cache.fetchedAt > TTL_MS) {
    const fresh = await refreshCache(fetcher)
    if (!fresh) {
      // Fail closed — UI hides the chip rather than rendering stale numbers.
      return null
    }
    cache = fresh
  }

  const idx = lookupIndex(cache, atMs)
  if (idx < 0) return null

  const sampleAtMs = cache.hourEpochMs[idx]!
  const cloudCoverPct = cache.cloudCover[idx]!
  const directRadiationWm2 = cache.directRadiation[idx]!

  const sunPos = SunCalc.getPosition(new Date(atMs), ZURICH_LAT, ZURICH_LON)
  const sunAltitudeRad = sunPos.altitude
  const state = classifySky({ cloudCoverPct, directRadiationWm2, sunAltitudeRad })

  return {
    state,
    cloudCoverPct,
    directRadiationWm2,
    sunAltitudeRad,
    at: new Date(sampleAtMs).toISOString(),
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- --run src/server/weather.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/weather.ts src/server/weather.test.ts
git commit -m "feat(weather): Open-Meteo fetch with 30-min cache and hour-snap lookup"
```

---

## Task 5: `getSkyAt` server function

**Files:**
- Modify: `src/server/functions.ts`

Wraps `fetchSky` as a TanStack server fn so the client can call it via `getSkyAt({ data: { at } })`.

- [ ] **Step 1: Add the server function**

Append to `src/server/functions.ts` (above any closing newline; preserve the rest of the file unchanged):

```ts
/** Current sky state for Zürich at the supplied ISO time. Returns null when
 *  the upstream fetch fails or the time is outside the forecast horizon. */
export const getSkyAt = createServerFn({ method: 'GET' })
  .inputValidator((d: { at: string }) => {
    if (!d || typeof d.at !== 'string' || d.at.length === 0) throw new Error('Invalid at')
    return { at: d.at }
  })
  .handler(async ({ data }) => {
    const { fetchSky } = await import('./weather')
    setResponseHeader('cache-control', 'public, max-age=300, stale-while-revalidate=1800')
    return await fetchSky({ at: data.at })
  })
```

- [ ] **Step 2: Type-check by running the existing suite**

Run: `pnpm test -- --run`
Expected: all tests still pass; no TS errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/functions.ts
git commit -m "feat(server): getSkyAt server fn for the time slider's current t"
```

---

## Task 6: Worker `score-daily` handler with per-day cache

**Files:**
- Modify: `src/workers/shadow-worker.ts`

Existing `init`/`compute` paths stay byte-identical. New branch handles `score-daily`, returns `rating` outbound.

- [ ] **Step 1: Replace the worker file with the extended dispatcher**

Overwrite `src/workers/shadow-worker.ts`:

```ts
/// <reference lib="webworker" />
import type {
  Building,
  WorkerInbound,
  WorkerOutbound,
} from '../lib/types'
import { buildSpatialIndex, isSunnyAt, type BuildingIndex } from '../lib/shadows'
import { dailyRating } from '../lib/score'

let index: BuildingIndex | null = null
let buildings: Building[] = []
const ratingCache: Map<string, number> = new Map() // key: `${poiId}:${YYYY-MM-DD}` (Europe/Zurich)

const ctx = self as unknown as DedicatedWorkerGlobalScope

const post = (msg: WorkerOutbound) => ctx.postMessage(msg)

function zhDateKey(d: Date): string {
  // Format the calendar day in Europe/Zurich. en-CA gives YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

ctx.addEventListener('message', (e: MessageEvent<WorkerInbound>) => {
  const msg = e.data
  if (msg.type === 'init') {
    buildings = msg.buildings
    index = buildSpatialIndex(buildings)
    // Building set changed -> any cached ratings are stale.
    ratingCache.clear()
    post({ type: 'ready' })
    return
  }
  if (msg.type === 'compute') {
    if (!index) {
      post({ type: 'result', sunny: {} })
      return
    }
    const t = new Date(msg.t)
    const sunny: Record<string, boolean> = {}
    for (const poi of msg.pois) {
      sunny[poi.id] = isSunnyAt(poi, index, buildings, t)
    }
    post({ type: 'result', sunny })
    return
  }
  if (msg.type === 'score-daily') {
    if (!index) {
      post({ type: 'rating', rating: {} })
      return
    }
    const day = new Date(msg.day)
    const dayKey = zhDateKey(day)
    const rating: Record<string, number> = {}
    for (const poi of msg.pois) {
      const cacheKey = `${poi.id}:${dayKey}`
      const cached = ratingCache.get(cacheKey)
      if (cached !== undefined) {
        rating[poi.id] = cached
        continue
      }
      const r = dailyRating(poi, index, buildings, day)
      ratingCache.set(cacheKey, r)
      rating[poi.id] = r
    }
    post({ type: 'rating', rating })
    return
  }
})
```

- [ ] **Step 2: Verify the build still works**

Run: `pnpm test -- --run`
Expected: all existing tests still pass (worker is exercised only manually).

- [ ] **Step 3: Commit**

```bash
git add src/workers/shadow-worker.ts
git commit -m "feat(worker): score-daily message + per-day per-POI rating cache"
```

---

## Task 7: Extend `useSunStatus` to also expose `rating`

**Files:**
- Modify: `src/lib/use-sun-status.ts`

We add a new `rating: Record<id, number>` to the hook's return shape. Dispatch a `score-daily` message whenever `pois`, `buildings`, or the *Europe/Zurich calendar day* of `t` changes. Within a day, slider scrubbing does NOT redispatch.

- [ ] **Step 1: Read the existing file fully so the patch keeps existing behaviour intact**

Read: `src/lib/use-sun-status.ts` (already in context — confirm the dispatch + result-handling flow before editing).

- [ ] **Step 2: Replace the file with the extended hook**

Overwrite `src/lib/use-sun-status.ts`:

```ts
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  Building,
  Poi,
  WorkerInbound,
  WorkerOutbound,
} from './types'

export type UseSunStatusInput = {
  pois: Poi[]
  buildings: Building[]
  t: Date
  /** When false, the hook is dormant: no init, no compute, no rating dispatch. */
  enabled?: boolean
  /** Debounce window for compute messages, default 50ms. */
  debounceMs?: number
}

export type UseSunStatusResult = {
  sunny: Record<string, boolean>
  /** POI id -> 0..99 daily exposure rating. Empty until the worker emits the
   *  first 'rating' message for the current day + POI set. */
  rating: Record<string, number>
  loading: boolean
}

/** Returns 'YYYY-MM-DD' in Europe/Zurich. Used as the dependency key for
 *  re-dispatching score-daily so scrubbing within a day is free. */
function zhDayKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

export function useSunStatus(input: UseSunStatusInput): UseSunStatusResult {
  const { pois, buildings, t, enabled = true, debounceMs = 50 } = input

  const [sunny, setSunny] = useState<Record<string, boolean>>({})
  const [rating, setRating] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState<boolean>(true)

  const workerRef = useRef<Worker | null>(null)
  const seqRef = useRef<number>(0)
  const latestDispatchedSeqRef = useRef<number>(0)
  const resultsReceivedRef = useRef<number>(0)
  const lastBuildingsRef = useRef<Building[] | null>(null)
  const lastBuildingsLenRef = useRef<number>(-1)
  const initInFlightRef = useRef<boolean>(false)
  const pendingComputeRef = useRef<{ pois: Poi[]; t: Date } | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const worker = new Worker(
      new URL('../workers/shadow-worker.ts', import.meta.url),
      { type: 'module' },
    )
    workerRef.current = worker
    lastBuildingsRef.current = null
    lastBuildingsLenRef.current = -1
    seqRef.current = 0
    latestDispatchedSeqRef.current = 0
    resultsReceivedRef.current = 0
    initInFlightRef.current = false
    pendingComputeRef.current = null

    const onMessage = (e: MessageEvent<WorkerOutbound>) => {
      const msg = e.data
      if (msg.type === 'ready') {
        initInFlightRef.current = false
        const pending = pendingComputeRef.current
        pendingComputeRef.current = null
        if (pending) sendCompute(pending.pois, pending.t)
        setLoading(false)
        return
      }
      if (msg.type === 'result') {
        resultsReceivedRef.current += 1
        const resultSeq = resultsReceivedRef.current
        if (resultSeq === latestDispatchedSeqRef.current) {
          setSunny(msg.sunny)
        }
        setLoading(false)
        return
      }
      if (msg.type === 'rating') {
        // Merge so partial dispatches (different POI subsets) compose.
        setRating((prev) => ({ ...prev, ...msg.rating }))
        return
      }
    }

    worker.addEventListener('message', onMessage)

    return () => {
      worker.removeEventListener('message', onMessage)
      worker.terminate()
      workerRef.current = null
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sendCompute = (poisArg: Poi[], tArg: Date) => {
    const w = workerRef.current
    if (!w) return
    seqRef.current += 1
    latestDispatchedSeqRef.current = seqRef.current
    const msg: WorkerInbound = {
      type: 'compute',
      pois: poisArg,
      t: tArg.toISOString(),
    }
    w.postMessage(msg)
  }

  useEffect(() => {
    if (!enabled) return
    const w = workerRef.current
    if (!w) return
    const changed =
      lastBuildingsRef.current !== buildings ||
      lastBuildingsLenRef.current !== buildings.length
    if (!changed) return
    lastBuildingsRef.current = buildings
    lastBuildingsLenRef.current = buildings.length
    initInFlightRef.current = true
    setLoading(true)
    // Clear stale ratings — the new building set changes the geometry.
    setRating({})
    const initMsg: WorkerInbound = { type: 'init', buildings }
    w.postMessage(initMsg)
  }, [buildings, enabled])

  useEffect(() => {
    if (!enabled) return
    const w = workerRef.current
    if (!w) return
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      if (initInFlightRef.current) {
        pendingComputeRef.current = { pois, t }
        return
      }
      sendCompute(pois, t)
    }, debounceMs)
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pois, pois.length, t, debounceMs, enabled])

  // Re-dispatch score-daily only when the calendar day (in Zürich) or the POI
  // set changes — scrubbing within a day reuses the worker's per-day cache.
  const dayKey = useMemo(() => zhDayKey(t), [t])
  useEffect(() => {
    if (!enabled) return
    const w = workerRef.current
    if (!w) return
    if (initInFlightRef.current) return
    if (pois.length === 0) return
    const msg: WorkerInbound = {
      type: 'score-daily',
      pois,
      day: t.toISOString(),
    }
    w.postMessage(msg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pois, pois.length, dayKey, enabled, lastBuildingsLenRef.current])

  return { sunny, rating, loading }
}
```

- [ ] **Step 3: Verify all existing tests still pass**

Run: `pnpm test -- --run`
Expected: PASS — the hook signature change is purely additive (callers that destructure `{ sunny }` are unaffected).

- [ ] **Step 4: Commit**

```bash
git add src/lib/use-sun-status.ts
git commit -m "feat(use-sun-status): expose daily rating from the worker"
```

---

## Task 8: Add `sky` and `rating` to `MapData` context

**Files:**
- Modify: `src/lib/map-context.ts`

- [ ] **Step 1: Extend the context type**

Overwrite `src/lib/map-context.ts`:

```ts
import { createContext, useContext } from 'react'
import type { Poi, Building, Category, Sky } from './types'

export type MapData = {
  pois: Poi[]
  buildings: Building[]
  buildingsLoaded: boolean
  filteredPois: Poi[]
  sunny: Record<string, boolean>
  /** POI id -> 0..99 geometric daily exposure for the current day. */
  rating: Record<string, number>
  /** Current sky state for the city, or null when unavailable / past horizon. */
  sky: Sky | null
  openNow: Record<string, boolean>
  selectedId: string | null
  setSelectedId: (id: string | null) => void
  t: Date
  setT: (t: Date) => void
  cat: Category
}

const MapDataContext = createContext<MapData | null>(null)

export const MapDataProvider = MapDataContext.Provider

export function useMapData(): MapData {
  const ctx = useContext(MapDataContext)
  if (!ctx) {
    throw new Error('useMapData must be used inside the _app layout')
  }
  return ctx
}
```

- [ ] **Step 2: Type-check via the existing suite**

Run: `pnpm test -- --run`
Expected: TS errors will appear in `_app.tsx` because the context provider is now missing `sky` and `rating`. The next task supplies them; for now we accept the temporary breakage. (If your editor is the only place this surfaces, that's fine.)

If the test suite exits non-zero **only** due to the missing context fields in `_app.tsx`, proceed to Task 9 — that task fixes them. If anything else fails, stop and investigate.

- [ ] **Step 3: Commit**

```bash
git add src/lib/map-context.ts
git commit -m "feat(map-context): add sky + rating fields"
```

---

## Task 9: Wire `sky` + `rating` through `_app.tsx`

**Files:**
- Modify: `src/routes/_app.tsx`

We add a `sky` state, debounce-fetch it via `getSkyAt` whenever `t` changes, and surface `rating` from the hook into the provider.

- [ ] **Step 1: Apply the wiring**

In `src/routes/_app.tsx`:

1. Update the import line from `'#/server/functions'`:

```ts
import { getPoisInBbox, getBuildingsInBbox, getSkyAt } from '#/server/functions'
```

2. Update imports from `'#/lib/types'` to include `Sky`:

```ts
import type { Building, Category, Poi, Sky } from '#/lib/types'
```

3. Inside `AppLayout`, change the `useSunStatus` destructure to also pull `rating`:

```ts
  const { sunny, rating } = useSunStatus({
    pois: filteredPois,
    buildings,
    t,
    enabled: buildingsLoaded,
  })
```

4. Add a `sky` state and a debounced fetch effect, placed AFTER the existing `useEffect` that fetches buildings (around the location currently between the buildings effect and `filteredPois`):

```ts
  const [sky, setSky] = useState<Sky | null>(null)

  useEffect(() => {
    let cancelled = false
    // Coalesce slider scrubs — only fetch 250ms after the slider settles.
    const timer = setTimeout(() => {
      getSkyAt({ data: { at: t.toISOString() } })
        .then((res) => {
          if (!cancelled) setSky((res ?? null) as Sky | null)
        })
        .catch(() => {
          if (!cancelled) setSky(null)
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [t])
```

5. Update the `MapData` value to include `rating` and `sky`. Replace the existing `useMemo` block with:

```ts
  const ctx: MapData = useMemo(
    () => ({
      pois,
      buildings,
      buildingsLoaded,
      filteredPois,
      sunny,
      rating,
      sky,
      openNow,
      selectedId,
      setSelectedId,
      t,
      setT,
      cat,
    }),
    [pois, buildings, buildingsLoaded, filteredPois, sunny, rating, sky, openNow, selectedId, t, cat],
  )
```

- [ ] **Step 2: Verify the build is green**

Run: `pnpm test -- --run`
Expected: PASS — same test count as before (35).

- [ ] **Step 3: Smoke test the dev server briefly**

Run: `pnpm run dev` (in a separate terminal). Open `http://localhost:3000`. The map should load identically to before; nothing visible has changed yet. Stop the dev server when you've confirmed the page renders.

- [ ] **Step 4: Commit**

```bash
git add src/routes/_app.tsx
git commit -m "feat(app): fetch sky and surface rating through MapData"
```

---

## Task 10: SunMap — `TextLayer` for ratings + overcast desaturation

**Files:**
- Modify: `src/components/SunMap.tsx`

- [ ] **Step 1: Add `rating` and `sky` to props and add a TextLayer**

Apply these edits to `src/components/SunMap.tsx`:

1. Update imports — add `TextLayer`:

```ts
import { PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
```

2. Import `Sky` from types:

```ts
import type { Building, Poi, Sky } from '#/lib/types'
```

3. Extend `SunMapProps`:

```ts
export type SunMapProps = {
  pois: Poi[]
  buildings: Building[]
  sunny: Record<string, boolean>
  /** POI id -> 0..99 daily rating; missing keys render no number. */
  rating: Record<string, number>
  /** Current sky state for the city, or null when unavailable. */
  sky: Sky | null
  openNow: Record<string, boolean>
  selectedId?: string | null
  onSelect: (id: string) => void
  onViewportChange?: (bbox: [number, number, number, number]) => void
}
```

4. Replace `buildLayers` (and add a `RATING_ZOOM_THRESHOLD` constant near the top of the file, by the other constants):

```ts
const RATING_ZOOM_THRESHOLD = 14

function buildLayers(
  pois: Poi[],
  buildings: Building[],
  sunny: Record<string, boolean>,
  rating: Record<string, number>,
  sky: Sky | null,
  openNow: Record<string, boolean>,
  selectedId: string | null | undefined,
  onSelect: (id: string) => void,
  zoom: number,
) {
  const overcast = sky?.state === 'overcast'
  // 0.7 multiplier on the gold RGB channels — preserves alpha so closed/open
  // distinction (alpha 200 vs 255) is unchanged.
  const goldOpen: [number, number, number, number] = overcast
    ? [Math.round(255 * 0.7), Math.round(200 * 0.7), Math.round(40 * 0.7), 255]
    : [255, 200, 40, 255]
  const goldClosed: [number, number, number, number] = overcast
    ? [Math.round(230 * 0.7), Math.round(180 * 0.7), Math.round(40 * 0.7), 200]
    : [230, 180, 40, 200]

  return [
    new PolygonLayer<Building>({
      id: 'buildings',
      data: buildings,
      getPolygon: (b: Building) => b.footprint,
      extruded: true,
      getElevation: (b: Building) => b.heightM,
      getFillColor: [120, 120, 120, 38],
      pickable: false,
    }),
    new ScatterplotLayer<Poi>({
      id: 'pois',
      data: pois,
      getPosition: (p: Poi) => [p.lon, p.lat],
      getRadius: (p: Poi) => (p.id === selectedId ? 90 : 60),
      radiusMinPixels: 8,
      radiusMaxPixels: 16,
      pickable: true,
      stroked: true,
      parameters: { depthCompare: 'always' },
      getFillColor: (p: Poi) =>
        sunny[p.id]
          ? openNow[p.id] === false
            ? goldClosed
            : goldOpen
          : openNow[p.id] === false
            ? [80, 90, 110, 140]
            : [80, 90, 110, 230],
      getLineColor: [255, 255, 255, 240],
      getLineWidth: (p: Poi) => (p.id === selectedId ? 3 : 1.75),
      lineWidthUnits: 'pixels',
      lineWidthMinPixels: 1.5,
      lineWidthMaxPixels: 3,
      onClick: (info) => {
        const obj = info.object as Poi | undefined
        if (obj) onSelect(obj.id)
      },
      updateTriggers: {
        getFillColor: [sunny, openNow, overcast],
        getRadius: [selectedId],
        getLineWidth: [selectedId],
      },
    }),
    new TextLayer<Poi>({
      id: 'poi-ratings',
      data: pois,
      visible: zoom >= RATING_ZOOM_THRESHOLD,
      getPosition: (p: Poi) => [p.lon, p.lat],
      getText: (p: Poi) => {
        const v = rating[p.id]
        return typeof v === 'number' ? String(v) : ''
      },
      getColor: [255, 255, 255, 240],
      getSize: 12,
      sizeUnits: 'pixels',
      // Drawn on top of the scatter dots regardless of camera angle.
      parameters: { depthCompare: 'always' },
      // No interactivity — picking still resolves to ScatterplotLayer.
      pickable: false,
      fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
      fontWeight: 700,
      updateTriggers: {
        getText: [rating],
      },
    }),
  ]
}
```

5. Update the `SunMap` component to also destructure `rating` and `sky` from props. Find the existing line:

```ts
  const { pois, buildings, sunny, openNow, selectedId, onSelect, onViewportChange } = props
```

Replace it with:

```ts
  const { pois, buildings, sunny, rating, sky, openNow, selectedId, onSelect, onViewportChange } = props
```

6. Add a `zoom` state right after the existing `mounted` state:

```ts
  const [mounted, setMounted] = useState(false)
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM)
```

7. Inside the existing init useEffect (the one keyed on `[mounted]` that creates the map), find this line:

```ts
    map.on('moveend', handleMoveEnd)
```

Immediately AFTER it, add:

```ts
    const handleZoom = () => setZoom(map.getZoom())
    map.on('zoom', handleZoom)
```

8. In the same useEffect's cleanup function, find this line:

```ts
      map.off('moveend', handleMoveEnd)
```

Immediately AFTER it, add:

```ts
      map.off('zoom', handleZoom)
```

9. Replace the existing layer-push useEffect (the one keyed on `[pois, buildings, sunny, openNow, selectedId]`) entirely with:

```ts
  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return
    overlay.setProps({
      layers: buildLayers(
        pois,
        buildings,
        sunny,
        rating,
        sky,
        openNow,
        selectedId,
        (id) => onSelectRef.current(id),
        zoom,
      ),
    })
  }, [pois, buildings, sunny, rating, sky, openNow, selectedId, zoom])
```

- [ ] **Step 2: Update the call site**

In `src/routes/_app.tsx`, find the `<SunMap ... />` JSX and add `rating` and `sky` props:

```tsx
          <SunMap
            pois={filteredPois}
            buildings={buildings}
            sunny={sunny}
            rating={rating}
            sky={sky}
            openNow={openNow}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onViewportChange={handleViewport}
          />
```

- [ ] **Step 3: Run the test suite to confirm nothing regresses**

Run: `pnpm test -- --run`
Expected: PASS — 35 tests still pass.

- [ ] **Step 4: Manual smoke**

Run: `pnpm run dev`. Visit `http://localhost:3000`. Zoom past 14 — markers should now show numbers like "67", "12", etc. (depending on your buildings cache). Zoom back out — numbers disappear. There should be no console errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/SunMap.tsx src/routes/_app.tsx
git commit -m "feat(map): TextLayer for daily rating at zoom>=14 + overcast desaturation"
```

---

## Task 11: `SkyChip` component

**Files:**
- Create: `src/components/SkyChip.tsx`

A small button that shows the sky state and opens a popover with the underlying numbers.

- [ ] **Step 1: Create the component**

Create `src/components/SkyChip.tsx`:

```tsx
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { Sky } from '#/lib/types'

export type SkyChipProps = {
  sky: Sky | null
  /** Sunrise/sunset for the popover footer. */
  sunrise?: Date | null
  sunset?: Date | null
}

const ICONS: Record<Sky['state'], string> = {
  clear: '☀️',
  partly: '⛅',
  overcast: '☁️',
  night: '⏾',
}

const LABELS: Record<Sky['state'], string> = {
  clear: 'Clear',
  partly: 'Partly cloudy',
  overcast: 'Overcast',
  night: 'Night',
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function fmtHm(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function SkyChip(props: SkyChipProps): ReactElement | null {
  const { sky, sunrise, sunset } = props
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onClickAway(e: MouseEvent) {
      const el = wrapperRef.current
      if (el && !el.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClickAway)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClickAway)
    }
  }, [open])

  if (!sky) return null

  const icon = ICONS[sky.state]
  const label = LABELS[sky.state]

  return (
    <div className="relative inline-block" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full bg-white/90 backdrop-blur px-3 py-1.5 text-sm font-medium text-slate-800 border border-slate-200 shadow-sm hover:bg-white"
        aria-label={`Sky: ${label}`}
        aria-expanded={open}
      >
        <span aria-hidden="true">{icon}</span>
        <span>{label}</span>
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Sky details"
          className="absolute right-0 mt-1 w-56 rounded-lg bg-white border border-slate-200 shadow-lg p-3 text-xs text-slate-700 z-10"
        >
          <dl className="grid grid-cols-2 gap-y-1">
            <dt className="text-slate-500">Cloud cover</dt>
            <dd className="text-right tabular-nums">{Math.round(sky.cloudCoverPct)}%</dd>
            <dt className="text-slate-500">Direct sun</dt>
            <dd className="text-right tabular-nums">{Math.round(sky.directRadiationWm2)} W/m²</dd>
            {sunrise instanceof Date && !Number.isNaN(sunrise.getTime()) ? (
              <>
                <dt className="text-slate-500">Sunrise</dt>
                <dd className="text-right tabular-nums">{fmtHm(sunrise)}</dd>
              </>
            ) : null}
            {sunset instanceof Date && !Number.isNaN(sunset.getTime()) ? (
              <>
                <dt className="text-slate-500">Sunset</dt>
                <dd className="text-right tabular-nums">{fmtHm(sunset)}</dd>
              </>
            ) : null}
          </dl>
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm test -- --run`
Expected: PASS — component is unused but compiles.

- [ ] **Step 3: Commit**

```bash
git add src/components/SkyChip.tsx
git commit -m "feat(ui): SkyChip — city-wide sky state badge with details popover"
```

---

## Task 12: Place `SkyChip` on the map

**Files:**
- Modify: `src/routes/_app.index.tsx`

The chip floats at the top-right of the map below the existing FilterBar (which already occupies the top row, full-width). Same placement on mobile and desktop — the spec lists this as a fit-and-finish call; we keep it simple.

- [ ] **Step 1: Add the SkyChip to the home route**

In `src/routes/_app.index.tsx`:

1. Find the existing import block and add:

```ts
import { SkyChip } from '#/components/SkyChip'
import { getSunTimes } from '#/lib/sun'
```

2. Find the existing `useMapData()` destructure (currently around line 23):

```ts
  const { filteredPois, buildings, buildingsLoaded, selectedId, setSelectedId, t, setT, cat } =
    useMapData()
```

Replace it with (adds `sky`):

```ts
  const { filteredPois, buildings, buildingsLoaded, selectedId, setSelectedId, t, setT, cat, sky } =
    useMapData()
```

3. Add a sunrise/sunset `useMemo` after the existing `selectedTimeline` `useMemo`:

```ts
  const { sunrise: chipSunrise, sunset: chipSunset } = useMemo(
    () => getSunTimes(t, ZURICH.lat, ZURICH.lon),
    [t],
  )
```

4. Add the chip JSX as a new sibling block at the top of the returned fragment, AFTER the existing FilterBar block (so the chip sits below the filter row). Insert this between the FilterBar `<div>` and the TimeSlider `<div>`:

```tsx
      <div className="absolute top-14 right-3 z-20 pointer-events-none sm:top-16">
        <div className="pointer-events-auto">
          <SkyChip sky={sky} sunrise={chipSunrise} sunset={chipSunset} />
        </div>
      </div>
```

> The `top-14` (mobile) / `sm:top-16` (desktop) values clear the FilterBar row; tweak by ±2 if it ends up overlapping the buttons in dev.

- [ ] **Step 2: Type-check**

Run: `pnpm test -- --run`
Expected: PASS.

- [ ] **Step 3: Manual smoke**

Run: `pnpm run dev`. Visit `http://localhost:3000`. The chip should appear at the top-right (just below FilterBar) ~250ms after first paint — text shows the sky state, popover shows numbers when clicked, Esc closes it. With network disabled in DevTools (block `api.open-meteo.com`), the chip should not appear at all (sky stays `null`).

- [ ] **Step 4: Commit**

```bash
git add src/routes/_app.index.tsx
git commit -m "feat(home): float SkyChip top-right of the map"
```

---

## Task 13: PoiSheet — daily rating explanation

**Files:**
- Modify: `src/components/PoiSheet.tsx`

A short paragraph above the existing sun timeline summary, explaining today's rating and where the number comes from.

- [ ] **Step 1: Add a rating-explanation paragraph**

In `src/components/PoiSheet.tsx`:

1. Extend the prop type:

```ts
export type PoiSheetProps = {
  poi: Poi | null
  t: Date
  timeline?: Array<{ from: Date; to: Date; sunny: boolean }> | null
  /** 0..99 daily exposure rating for the displayed day; null hides the line. */
  rating?: number | null
  onClose: () => void
}
```

2. Add a helper near `sunStatus`:

```ts
function ratingExplanation(rating: number | null | undefined, openHoursParseable: boolean): string | null {
  if (typeof rating !== 'number') return null
  if (rating === 0) {
    return openHoursParseable
      ? 'In shade for all of today’s open hours.'
      : 'In shade for all of daylight today.'
  }
  return openHoursParseable
    ? `In direct sun for about ${rating}% of today’s open hours (clear-sky estimate). See the sky chip for today’s actual conditions.`
    : `In direct sun for about ${rating}% of today’s daylight hours (clear-sky estimate). See the sky chip for today’s actual conditions.`
}
```

3. Inside the component, after the existing `sunStatus` computation, derive the explanation:

```tsx
  const explanation = ratingExplanation(
    props.rating ?? null,
    !!(poi.openingHours && poi.openingHours.trim() !== ''),
  )
```

4. Render the explanation above the existing timeline-summary line. Find the location currently rendering the `sun` string (e.g. "Sunny until 18:00") and add immediately before it:

```tsx
        {explanation ? (
          <p className="text-xs text-slate-500 mt-1">{explanation}</p>
        ) : null}
```

- [ ] **Step 2: Pass the rating from the call site**

`<PoiSheet />` is mounted in `src/routes/_app.index.tsx`. Update the destructure and the JSX:

1. Find the `useMapData()` destructure (which Task 12 already extended). Add `rating`:

```ts
  const {
    filteredPois,
    buildings,
    buildingsLoaded,
    selectedId,
    setSelectedId,
    t,
    setT,
    cat,
    sky,
    rating,
  } = useMapData()
```

2. Find the existing `<PoiSheet ... />` JSX and add the `rating` prop:

```tsx
      <PoiSheet
        poi={selectedPoi}
        t={t}
        timeline={selectedTimeline}
        rating={selectedPoi ? (rating[selectedPoi.id] ?? null) : null}
        onClose={() => setSelectedId(null)}
      />
```

- [ ] **Step 3: Type-check**

Run: `pnpm test -- --run`
Expected: PASS.

- [ ] **Step 4: Manual smoke**

Run: `pnpm run dev`. Click any marker — the sheet should now show the explanation paragraph above the sun status line. Wording should be grammatical for both the open-hours-known and open-hours-unknown branches.

- [ ] **Step 5: Commit**

```bash
git add src/components/PoiSheet.tsx src/routes/_app.index.tsx
git commit -m "feat(sheet): explain daily sun rating in PoiSheet"
```

---

## Task 14: Detail page — daily rating explanation

**Files:**
- Modify: `src/routes/_app.spot.$id.tsx`

The full detail page already computes its own `dailyTimeline` server-side. It can compute the rating directly from `dailyRating` since it has the building set in scope.

- [ ] **Step 1: Compute the rating and render the explanation**

In `src/routes/_app.spot.$id.tsx`:

1. Add the import:

```ts
import { dailyRating } from '#/lib/score'
```

2. Inside `SpotDetail`, alongside the existing `useMemo` blocks (search the file for the `dailyTimeline` call to find the right spot — there is already a `useMemo` that builds the spatial index from `buildings`), add:

```ts
  const rating = useMemo<number | null>(() => {
    if (!poi) return null
    const idx = buildSpatialIndex(buildings)
    return dailyRating(poi, idx, buildings, t)
  }, [poi, buildings, t])
```

> Building the index inline here keeps this task self-contained — it's cheap (rbush bulk-load is O(N)) and avoids reasoning about whether the existing index `useMemo` is in scope at the insertion point.

3. Render the explanation immediately above the existing `<SunTimeline ... />` JSX:

```tsx
        {typeof rating === 'number' ? (
          <p className="text-sm text-slate-600 mb-2">
            {rating === 0
              ? (poi?.openingHours
                ? 'In shade for all of today’s open hours.'
                : 'In shade for all of daylight today.')
              : (poi?.openingHours
                ? `In direct sun for about ${rating}% of today’s open hours (clear-sky estimate). See the sky chip for today’s actual conditions.`
                : `In direct sun for about ${rating}% of today’s daylight hours (clear-sky estimate). See the sky chip for today’s actual conditions.`)}
          </p>
        ) : null}
```

- [ ] **Step 2: Type-check**

Run: `pnpm test -- --run`
Expected: PASS.

- [ ] **Step 3: Manual smoke**

Run: `pnpm run dev`. Click any marker, then the link to the detail page (or visit `/spot/<id>` directly). The explanation should render above the sun timeline.

- [ ] **Step 4: Commit**

```bash
git add src/routes/_app.spot.$id.tsx
git commit -m "feat(detail): explain daily sun rating on /spot/$id"
```

---

## Task 15: End-to-end manual smoke + cleanup commit

**Files:** none (pure verification)

Walk through the full flow once with the dev server running. Document anything you notice in the PR description.

- [ ] **Step 1: Run the full unit suite one more time**

Run: `pnpm test -- --run`
Expected: PASS, all green. Test count should be the original 35 plus the new ones added (sky: 5, score: 5, weather: 6 → 51 total).

- [ ] **Step 2: Manual end-to-end flow**

Run: `pnpm run dev`. Walk through, with network ENABLED:

1. Page loads, dots appear within ~1s.
2. After ~250ms a Sky chip appears top-right showing the current state.
3. Clicking the chip opens the popover with cloud %, direct W/m², sunrise/sunset.
4. Zoom in past 14 — numbers fade in inside the markers.
5. Zoom back below 14 — numbers disappear.
6. Drag the time slider — `sunny` colours update; numbers do NOT (they're a daily property).
7. Drag the date picker forward a day — numbers re-resolve (worker batch).
8. Click any marker — sheet appears with the explanation paragraph above sun-status.
9. Open `/spot/$id` — detail page shows the same explanation above the timeline.

With network DISABLED for `api.open-meteo.com` (block via DevTools):

10. Sky chip is hidden. No console errors. Markers and numbers still render.

With direct radiation forced low (temporary edit: in `src/server/weather.ts`, change the relevant line in `fetchSky` after `cache.directRadiation[idx]` is read so that `directRadiationWm2 = 0` for verification, then revert):

11. Chip says ☁️ Overcast. Sunny markers visibly desaturate. Revert the edit before committing.

- [ ] **Step 3: If anything in the smoke pass surfaced an issue, fix it now and stage/commit those fixes here. Otherwise no commit is needed.**

- [ ] **Step 4: Open the PR description**

When opening the PR, paste this checklist into the body so reviewers can repeat the smoke tests.

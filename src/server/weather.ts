import SunCalc from 'suncalc'
import { classifySky } from '#/lib/sky'
import type { Sky } from '#/lib/types'

const ZURICH_LAT = 47.3769
const ZURICH_LON = 8.5417
const TTL_MS = 30 * 60 * 1000
const ENDPOINT = 'https://api.open-meteo.com/v1/forecast'

type HourlyCache = {
  fetchedAt: number
  hourEpochMs: number[]
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

/** Convert an Open-Meteo "YYYY-MM-DDTHH:mm" wall-clock string (which we know
 *  is in Europe/Zurich because we asked the API for that timezone) to a UTC
 *  epoch ms. Strategy: build the wall-clock instant as if it were UTC, then
 *  read what ZH thinks that instant is, and apply the difference as the
 *  offset. Handles DST transitions correctly via Intl. */
function parseZhWallTimeToUtcMs(local: string): number {
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
    if (!fresh) return null
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

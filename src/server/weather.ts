import SunCalc from 'suncalc'
import { classifySky, clearSkyDni, MIN_CLEAR_SKY_DNI_WM2 } from '#/lib/sky'
import type { Sky } from '#/lib/types'

const ZURICH_LAT = 47.3769
const ZURICH_LON = 8.5417
const TTL_MS = 30 * 60 * 1000
const ENDPOINT = 'https://api.open-meteo.com/v1/forecast'
const HOUR_MS = 60 * 60 * 1000
/** Sampling step when averaging clear-sky DNI over an hour. */
const CLEAR_SKY_STEP_MS = 5 * 60 * 1000

type HourlyCache = {
  fetchedAt: number
  hourEpochMs: number[]
  cloudCover: number[]
  /** Direct normal irradiance, mean over the hour ENDING at hourEpochMs[i]. */
  dni: number[]
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
    // DNI (irradiance on a surface facing the sun) rather than
    // direct_radiation (on a horizontal surface): the horizontal value shrinks
    // with sun angle, which made clear mornings and winters read as cloudy.
    hourly: 'cloud_cover,direct_normal_irradiance',
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
      hourly?: { time?: string[]; cloud_cover?: number[]; direct_normal_irradiance?: number[] }
    }
    const time = body.hourly?.time ?? []
    const cloudCover = body.hourly?.cloud_cover ?? []
    const dni = body.hourly?.direct_normal_irradiance ?? []
    if (time.length === 0 || cloudCover.length !== time.length || dni.length !== time.length) {
      return null
    }
    const hourEpochMs = time.map(parseZhWallTimeToUtcMs)
    if (hourEpochMs.some((n) => Number.isNaN(n))) return null
    return { fetchedAt: Date.now(), hourEpochMs, cloudCover, dni }
  } catch {
    return null
  }
}

/** Index of the hourly sample whose averaging window contains `atMs`.
 *
 *  Open-Meteo radiation values are the mean over the PRECEDING hour, stamped
 *  with the hour they end on — the 14:00 value covers 13:00–14:00. So 13:30
 *  belongs to the 14:00 sample: the smallest i with hourEpochMs[i] >= atMs.
 *  (Snapping down instead used the hour before, which around sunrise is mostly
 *  darkness and read as "overcast" on clear mornings.) */
function lookupIndex(c: HourlyCache, atMs: number): number {
  let lo = 0
  let hi = c.hourEpochMs.length - 1
  if (atMs <= c.hourEpochMs[lo]! - HOUR_MS) return -1
  if (atMs > c.hourEpochMs[hi]!) return -1
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (c.hourEpochMs[mid]! >= atMs) hi = mid
    else lo = mid + 1
  }
  return lo
}

/** Mean clear-sky DNI over (endMs - 1h, endMs], matching the averaging window
 *  of the measured value it is compared against. */
function meanClearSkyDni(endMs: number): number {
  let sum = 0
  let n = 0
  for (let ms = endMs - HOUR_MS + CLEAR_SKY_STEP_MS / 2; ms < endMs; ms += CLEAR_SKY_STEP_MS) {
    sum += clearSkyDni(SunCalc.getPosition(new Date(ms), ZURICH_LAT, ZURICH_LON).altitude)
    n++
  }
  return n > 0 ? sum / n : 0
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
  // Cloud cover, unlike radiation, is an instantaneous on-the-hour value, so
  // take the nearest hour rather than the end of the averaging window.
  const prevIdx = idx > 0 && sampleAtMs - atMs > HOUR_MS / 2 ? idx - 1 : idx
  const cloudCoverPct = cache.cloudCover[prevIdx]!
  const dniWm2 = cache.dni[idx]!
  const clearSkyDniWm2 = meanClearSkyDni(sampleAtMs)

  const sunPos = SunCalc.getPosition(new Date(atMs), ZURICH_LAT, ZURICH_LON)
  const sunAltitudeRad = sunPos.altitude
  const state = classifySky({ sunAltitudeRad, dniWm2, clearSkyDniWm2, cloudCoverPct })
  const clearSkyIndex =
    clearSkyDniWm2 >= MIN_CLEAR_SKY_DNI_WM2 ? Math.round((dniWm2 / clearSkyDniWm2) * 100) / 100 : null

  return {
    state,
    cloudCoverPct,
    dniWm2,
    clearSkyIndex,
    sunAltitudeRad,
    at: new Date(sampleAtMs).toISOString(),
  }
}

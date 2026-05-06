// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { __resetWeatherCacheForTest, fetchSky } from './weather'

/** Build a fake Open-Meteo response. `hourlyTimes` are wall-clock strings as
 *  Open-Meteo emits them when called with `timezone=Europe/Zurich` — the parser
 *  is responsible for converting them back to UTC, so tests must hand it ZH
 *  wall-clock strings, not UTC. */
function meteoResponse(opts: {
  hourlyTimes: string[]
  cloudCover: number[]
  directRadiation: number[]
}): Response {
  const body = {
    hourly: {
      time: opts.hourlyTimes,
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
    // May → ZH is UTC+2. ZH 12:00 == UTC 10:00.
    const fetcher = vi.fn(async () =>
      meteoResponse({
        hourlyTimes: [
          '2026-05-06T12:00', // UTC 10:00
          '2026-05-06T13:00', // UTC 11:00
          '2026-05-06T14:00', // UTC 12:00
          '2026-05-06T15:00', // UTC 13:00
        ],
        cloudCover: [10, 20, 80, 100],
        directRadiation: [600, 500, 100, 5],
      }),
    ) as unknown as typeof fetch
    const sky = await fetchSky({ at: '2026-05-06T10:30:00Z', fetcher })
    expect(sky).not.toBeNull()
    expect(sky!.cloudCoverPct).toBe(10)
    expect(sky!.directRadiationWm2).toBe(600)
    expect(sky!.at).toBe('2026-05-06T10:00:00.000Z')
  })

  it('caches the response across calls within TTL', async () => {
    const fetcher = vi.fn(async () =>
      meteoResponse({
        hourlyTimes: ['2026-05-06T12:00', '2026-05-06T13:00', '2026-05-06T14:00'],
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
        hourlyTimes: ['2026-05-06T12:00', '2026-05-06T13:00'],
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
    // ZH 14:00 May == UTC 12:00. Sun is well above the horizon at noon UTC in
    // Zürich in May, so any altitude>0 + radiation<80 → overcast.
    const fetcher = vi.fn(async () =>
      meteoResponse({
        hourlyTimes: ['2026-05-06T14:00'],
        cloudCover: [100],
        directRadiation: [0],
      }),
    ) as unknown as typeof fetch
    const sky = await fetchSky({ at: '2026-05-06T12:00:00Z', fetcher })
    expect(sky).not.toBeNull()
    expect(sky!.state).toBe('overcast')
  })
})

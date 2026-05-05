// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { fetchPois, fetchBuildings } from './overpass'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

const POI_FIXTURE = {
  elements: [
    {
      type: 'node',
      id: 1,
      lat: 47.37,
      lon: 8.54,
      tags: {
        amenity: 'cafe',
        name: 'Café Alpha',
        opening_hours: 'Mo-Fr 08:00-18:00',
        cuisine: 'coffee_shop',
        outdoor_seating: 'yes',
      },
    },
    {
      type: 'way',
      id: 2,
      center: { lat: 47.38, lon: 8.55 },
      tags: {
        amenity: 'restaurant',
        name: 'Beta Garden',
        outdoor_seating: 'yes',
      },
    },
    // Skipped: missing amenity tag.
    {
      type: 'node',
      id: 3,
      lat: 47.39,
      lon: 8.56,
      tags: { name: 'Nameless' },
    },
    // Skipped: no coords.
    {
      type: 'way',
      id: 4,
      tags: { amenity: 'bar', name: 'Lost' },
    },
  ],
}

const BUILDING_FIXTURE = {
  elements: [
    {
      type: 'way',
      id: 100,
      tags: { building: 'yes', height: '15' },
      geometry: [
        { lat: 47.37, lon: 8.54 },
        { lat: 47.37, lon: 8.55 },
        { lat: 47.38, lon: 8.55 },
        { lat: 47.38, lon: 8.54 },
      ],
    },
    {
      type: 'way',
      id: 101,
      tags: { building: 'yes', 'building:levels': '3' },
      geometry: [
        { lat: 47.4, lon: 8.5 },
        { lat: 47.4, lon: 8.51 },
        { lat: 47.41, lon: 8.51 },
        { lat: 47.41, lon: 8.5 },
      ],
    },
    {
      type: 'way',
      id: 102,
      tags: { building: 'yes' },
      geometry: [
        { lat: 47.42, lon: 8.52 },
        { lat: 47.42, lon: 8.53 },
        { lat: 47.43, lon: 8.53 },
      ],
    },
    // Skipped: empty geometry.
    {
      type: 'way',
      id: 103,
      tags: { building: 'yes', height: '20' },
      geometry: [],
    },
  ],
}

describe('fetchPois', () => {
  it('parses node and way POIs, prefixes ids, skips invalid', async () => {
    const fetcher = vi.fn(async () => jsonResponse(POI_FIXTURE)) as unknown as typeof fetch
    const rows = await fetchPois({ fetcher })
    expect(rows).toHaveLength(2)
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
    expect(byId['node/1']).toBeDefined()
    expect(byId['node/1']!.amenity).toBe('cafe')
    expect(byId['node/1']!.openingHours).toBe('Mo-Fr 08:00-18:00')
    expect(byId['node/1']!.lat).toBe(47.37)
    expect(byId['node/1']!.lon).toBe(8.54)
    expect(byId['node/1']!.tags).toMatchObject({ outdoor_seating: 'yes' })
    expect(byId['way/2']).toBeDefined()
    expect(byId['way/2']!.lat).toBe(47.38)
    expect(byId['way/2']!.lon).toBe(8.55)
    // Skipped elements absent.
    expect(byId['node/3']).toBeUndefined()
    expect(byId['way/4']).toBeUndefined()
  })
})

describe('fetchBuildings', () => {
  it('resolves heights, footprints in [lon,lat], bboxes, skips empty geometry', async () => {
    const fetcher = vi.fn(async () => jsonResponse(BUILDING_FIXTURE)) as unknown as typeof fetch
    const rows = await fetchBuildings({ fetcher })
    expect(rows).toHaveLength(3)
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]))

    const a = byId['way/100']!
    expect(a.heightM).toBe(15)
    expect(a.footprint).toEqual([
      [8.54, 47.37],
      [8.55, 47.37],
      [8.55, 47.38],
      [8.54, 47.38],
    ])
    expect(a.minLat).toBeCloseTo(47.37)
    expect(a.maxLat).toBeCloseTo(47.38)
    expect(a.minLon).toBeCloseTo(8.54)
    expect(a.maxLon).toBeCloseTo(8.55)

    const b = byId['way/101']!
    expect(b.heightM).toBe(9) // 3 levels * 3

    const c = byId['way/102']!
    expect(c.heightM).toBe(10) // default

    expect(byId['way/103']).toBeUndefined()
  })

  it('parses "12 m" / "12m" suffixed heights', async () => {
    const fixture = {
      elements: [
        {
          type: 'way',
          id: 200,
          tags: { building: 'yes', height: '12 m' },
          geometry: [
            { lat: 1, lon: 1 },
            { lat: 1, lon: 2 },
            { lat: 2, lon: 2 },
          ],
        },
        {
          type: 'way',
          id: 201,
          tags: { building: 'yes', height: '8m' },
          geometry: [
            { lat: 1, lon: 1 },
            { lat: 1, lon: 2 },
            { lat: 2, lon: 2 },
          ],
        },
        {
          type: 'way',
          id: 202,
          tags: { building: 'yes', height: '-5' },
          geometry: [
            { lat: 1, lon: 1 },
            { lat: 1, lon: 2 },
            { lat: 2, lon: 2 },
          ],
        },
      ],
    }
    const fetcher = vi.fn(async () => jsonResponse(fixture)) as unknown as typeof fetch
    const rows = await fetchBuildings({ fetcher })
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
    expect(byId['way/200']!.heightM).toBe(12)
    expect(byId['way/201']!.heightM).toBe(8)
    // negative height falls through to default.
    expect(byId['way/202']!.heightM).toBe(10)
  })
})

describe('retry behaviour', () => {
  it('retries once on a thrown error, then succeeds', async () => {
    let calls = 0
    const fetcher = vi.fn(async () => {
      calls++
      if (calls === 1) throw new Error('ECONNRESET')
      return jsonResponse(POI_FIXTURE)
    }) as unknown as typeof fetch
    const rows = await fetchPois({ fetcher })
    expect(calls).toBe(2)
    expect(rows).toHaveLength(2)
  })

  it('retries once on non-200, then succeeds', async () => {
    let calls = 0
    const fetcher = vi.fn(async () => {
      calls++
      if (calls === 1) return new Response('boom', { status: 503 })
      return jsonResponse(BUILDING_FIXTURE)
    }) as unknown as typeof fetch
    const rows = await fetchBuildings({ fetcher })
    expect(calls).toBe(2)
    expect(rows).toHaveLength(3)
  })

  it('throws on second consecutive failure', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('boom')
    }) as unknown as typeof fetch
    await expect(fetchPois({ fetcher })).rejects.toThrow(/boom/)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})

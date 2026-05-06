// Pathless layout that keeps the SunMap + viewport data mounted across
// child routes (`/` and `/spot/$id`). State lifted here so back-navigation
// from the detail page is instant.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, Outlet } from '@tanstack/react-router'
import { SunMap } from '#/components/SunMap'
import { useSunStatus } from '#/lib/use-sun-status'
import { isOpenAt } from '#/lib/opening-hours'
import { getPoisInBbox, getBuildingsInBbox } from '#/server/functions'
import { MapDataProvider, type MapData } from '#/lib/map-context'
import type { Building, Category, Poi } from '#/lib/types'

type AppSearch = {
  t?: string
  cat?: Category
  outdoor?: boolean
}

const CATEGORIES: ReadonlyArray<Category> = ['breakfast', 'coffee', 'lunch', 'apero', 'all']
const DEFAULT_BBOX: [number, number, number, number] = [8.45, 47.32, 8.62, 47.42]

export const Route = createFileRoute('/_app')({
  validateSearch: (raw: Record<string, unknown>): AppSearch => {
    const out: AppSearch = {}
    if (typeof raw.t === 'string' && raw.t.length > 0) out.t = raw.t
    if (typeof raw.cat === 'string' && (CATEGORIES as ReadonlyArray<string>).includes(raw.cat)) {
      out.cat = raw.cat as Category
    }
    // Accept whatever shape the parser hands us — boolean, string, number — so
    // the filter survives any quirks in URL search-param serialization between
    // dev/prod or across TanStack Router upgrades.
    const v = raw.outdoor
    if (v === true || v === 'true' || v === 1 || v === '1') out.outdoor = true
    return out
  },
  // Server-side fetch of POIs for the default Zürich bbox so markers ship with
  // the SSR HTML and paint on hydration. Buildings are intentionally excluded
  // — they're heavier and only gate the sun/shade calculation, which can
  // arrive a beat later without delaying the visible map.
  loader: async () => {
    const rows = await getPoisInBbox({ data: { bbox: DEFAULT_BBOX } })
    return { initialPois: rows as unknown as Poi[] }
  },
  component: AppLayout,
})

function hasOutdoorSeating(poi: Poi): boolean {
  // Defensive: tags is declared as Record<string, string> | null | undefined
  // but if it ever round-trips as a JSON string (some serializer quirks have
  // been reported in mixed-mode Nitro builds) we still want a correct answer.
  let tags: Record<string, string> | null | undefined = poi.tags
  if (typeof tags === 'string') {
    try {
      tags = JSON.parse(tags) as Record<string, string>
    } catch {
      return false
    }
  }
  if (!tags || typeof tags !== 'object') return false
  return tags.outdoor_seating === 'yes' || tags.terrace === 'yes'
}

function parseT(s: string | undefined): Date {
  if (!s) return new Date()
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? new Date() : d
}

function categoryMatches(poi: Poi, cat: Category): boolean {
  if (cat === 'all') return true
  const a = poi.amenity ?? ''
  switch (cat) {
    case 'breakfast':
    case 'coffee':
      return a === 'cafe' || a === 'ice_cream'
    case 'lunch':
      return a === 'restaurant'
    case 'apero':
      return a === 'bar' || a === 'pub' || a === 'biergarten' || a === 'restaurant'
  }
}

function AppLayout() {
  const search = Route.useSearch()
  const { initialPois } = Route.useLoaderData()

  const [t, setT] = useState<Date>(() => parseT(search.t))
  const cat: Category = search.cat ?? 'all'
  const outdoor: boolean = search.outdoor ?? false

  const [pois, setPois] = useState<Poi[]>(initialPois)
  const [buildings, setBuildings] = useState<Building[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [bbox, setBbox] = useState<[number, number, number, number]>(DEFAULT_BBOX)

  // The loader already seeded POIs for the initial bbox; skip the redundant
  // first client-side fetch. Subsequent bbox changes (pan/zoom) refetch.
  const skipNextPoiFetch = useRef(true)

  useEffect(() => {
    if (skipNextPoiFetch.current) {
      skipNextPoiFetch.current = false
      return
    }
    let cancelled = false
    getPoisInBbox({ data: { bbox } })
      .then((rows) => {
        if (!cancelled) setPois(rows as unknown as Poi[])
      })
      .catch((err) => {
        if (!cancelled) console.error('pois fetch failed', err)
      })
    return () => {
      cancelled = true
    }
  }, [bbox])

  // Buildings load independently so they don't gate POI render. Markers paint
  // immediately from the loader; sun/shade colors light up once buildings
  // arrive and the worker computes.
  useEffect(() => {
    let cancelled = false
    getBuildingsInBbox({ data: { bbox } })
      .then((rows) => {
        if (!cancelled) setBuildings(rows as unknown as Building[])
      })
      .catch((err) => {
        if (!cancelled) console.error('buildings fetch failed', err)
      })
    return () => {
      cancelled = true
    }
  }, [bbox])

  const filteredPois = useMemo(() => {
    let result = pois.filter((p) => categoryMatches(p, cat))
    if (outdoor) result = result.filter(hasOutdoorSeating)
    return result
  }, [pois, cat, outdoor])

  const { sunny } = useSunStatus({ pois: filteredPois, buildings, t })

  const openNow = useMemo<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {}
    for (const p of filteredPois) out[p.id] = isOpenAt(p.openingHours, t)
    return out
  }, [filteredPois, t])

  const handleViewport = useCallback((next: [number, number, number, number]) => {
    setBbox((prev) => {
      const dx = Math.abs(next[0] - prev[0]) + Math.abs(next[2] - prev[2])
      const dy = Math.abs(next[1] - prev[1]) + Math.abs(next[3] - prev[3])
      if (dx < 0.001 && dy < 0.001) return prev
      return next
    })
  }, [])

  const ctx: MapData = useMemo(
    () => ({
      pois,
      buildings,
      filteredPois,
      sunny,
      openNow,
      selectedId,
      setSelectedId,
      t,
      setT,
      cat,
    }),
    [pois, buildings, filteredPois, sunny, openNow, selectedId, t, cat],
  )

  return (
    <MapDataProvider value={ctx}>
      <div className="fixed inset-0 flex flex-col">
        <div className="flex-1 relative">
          <SunMap
            pois={filteredPois}
            buildings={buildings}
            sunny={sunny}
            openNow={openNow}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onViewportChange={handleViewport}
          />
          <Outlet />
        </div>
      </div>
    </MapDataProvider>
  )
}

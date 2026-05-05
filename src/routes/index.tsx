// Map view: full-screen MapLibre + deck.gl, time slider, category filter, bottom sheet.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { SunMap } from '#/components/SunMap'
import { TimeSlider } from '#/components/TimeSlider'
import { FilterBar } from '#/components/FilterBar'
import { PoiSheet } from '#/components/PoiSheet'
import { useSunStatus } from '#/lib/use-sun-status'
import { buildSpatialIndex } from '#/lib/shadows'
import { dailyTimeline } from '#/lib/timeline'
import { isOpenAt } from '#/lib/opening-hours'
import { getPoisInBbox, getBuildingsInBbox } from '#/server/functions'
import type { Building, Category, Poi } from '#/lib/types'

type IndexSearch = {
  t?: string
  cat?: Category
}

const CATEGORIES: ReadonlyArray<Category> = ['breakfast', 'coffee', 'lunch', 'apero', 'all']
const ZURICH = { lat: 47.3769, lon: 8.5417 }
const DEFAULT_BBOX: [number, number, number, number] = [8.45, 47.32, 8.62, 47.42]

export const Route = createFileRoute('/')({
  validateSearch: (raw: Record<string, unknown>): IndexSearch => {
    const out: IndexSearch = {}
    if (typeof raw.t === 'string' && raw.t.length > 0) out.t = raw.t
    if (typeof raw.cat === 'string' && (CATEGORIES as ReadonlyArray<string>).includes(raw.cat)) {
      out.cat = raw.cat as Category
    }
    return out
  },
  component: Home,
})

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

function Home() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  const [t, setT] = useState<Date>(() => parseT(search.t))
  const cat: Category = search.cat ?? 'all'

  const [pois, setPois] = useState<Poi[]>([])
  const [buildings, setBuildings] = useState<Building[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [bbox, setBbox] = useState<[number, number, number, number]>(DEFAULT_BBOX)

  // Sync `t` to URL with a small debounce so dragging doesn't spam history.
  const tWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (tWriteTimer.current) clearTimeout(tWriteTimer.current)
    tWriteTimer.current = setTimeout(() => {
      navigate({
        to: '/',
        search: (prev) => ({ ...prev, t: t.toISOString() }),
        replace: true,
      })
    }, 200)
    return () => {
      if (tWriteTimer.current) clearTimeout(tWriteTimer.current)
    }
  }, [t, navigate])

  // Fetch viewport data when bbox changes (debounced upstream of moveend by SunMap's natural cadence).
  useEffect(() => {
    let cancelled = false
    Promise.all([
      getPoisInBbox({ data: { bbox } }),
      getBuildingsInBbox({ data: { bbox } }),
    ])
      .then(([poiRows, buildingRows]) => {
        if (cancelled) return
        setPois(poiRows as unknown as Poi[])
        setBuildings(buildingRows as unknown as Building[])
      })
      .catch((err) => {
        if (!cancelled) console.error('viewport fetch failed', err)
      })
    return () => {
      cancelled = true
    }
  }, [bbox])

  const filteredPois = useMemo(() => pois.filter((p) => categoryMatches(p, cat)), [pois, cat])

  const { sunny } = useSunStatus({ pois: filteredPois, buildings, t })

  const openNow = useMemo<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {}
    for (const p of filteredPois) out[p.id] = isOpenAt(p.openingHours, t)
    return out
  }, [filteredPois, t])

  const selectedPoi = useMemo(
    () => (selectedId ? (pois.find((p) => p.id === selectedId) ?? null) : null),
    [pois, selectedId],
  )

  // Build spatial index once per buildings change for the selected POI's daily timeline.
  const spatialIndex = useMemo(() => buildSpatialIndex(buildings), [buildings])

  const selectedTimeline = useMemo(() => {
    if (!selectedPoi) return null
    return dailyTimeline(selectedPoi, spatialIndex, buildings, t)
  }, [selectedPoi, spatialIndex, buildings, t])

  const handleViewport = useCallback((next: [number, number, number, number]) => {
    setBbox((prev) => {
      // Avoid refetching on micro-movements (<100m).
      const dx = Math.abs(next[0] - prev[0]) + Math.abs(next[2] - prev[2])
      const dy = Math.abs(next[1] - prev[1]) + Math.abs(next[3] - prev[3])
      if (dx < 0.001 && dy < 0.001) return prev
      return next
    })
  }, [])

  const handleCategoryChange = useCallback(
    (next: Category) => {
      setSelectedId(null)
      navigate({
        to: '/',
        search: (prev) => ({ ...prev, cat: next === 'all' ? undefined : next }),
        replace: true,
      })
    },
    [navigate],
  )

  return (
    <div className="fixed inset-0 flex flex-col">
      <div className="absolute top-0 left-0 right-0 z-30 p-2 sm:p-3 pt-[calc(env(safe-area-inset-top)+0.5rem)] sm:pt-[calc(env(safe-area-inset-top)+0.75rem)] pointer-events-none">
        <div className="pointer-events-auto">
          <FilterBar value={cat} onChange={handleCategoryChange} />
        </div>
      </div>

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
      </div>

      <div className="absolute bottom-0 left-0 right-0 z-20 p-2 sm:p-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] sm:pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pointer-events-none">
        {selectedPoi ? null : (
          <div className="pointer-events-auto max-w-md mx-auto">
            <TimeSlider value={t} center={ZURICH} onChange={setT} onDayChange={setT} />
          </div>
        )}
      </div>

      <PoiSheet
        poi={selectedPoi}
        t={t}
        timeline={selectedTimeline}
        onClose={() => setSelectedId(null)}
      />
    </div>
  )
}

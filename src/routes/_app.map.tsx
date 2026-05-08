// Home overlays — FilterBar, TimeSlider, PoiSheet. The map itself lives in
// the parent _app layout so it stays mounted across navigation.
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { TimeSlider } from '#/components/TimeSlider'
import { FilterBar } from '#/components/FilterBar'
import { PoiSheet } from '#/components/PoiSheet'
import { SkyChip } from '#/components/SkyChip'
import { buildSpatialIndex } from '#/lib/shadows'
import { dailyTimeline } from '#/lib/timeline'
import { getSunTimes } from '#/lib/sun'
import { useMapData } from '#/lib/map-context'
import type { Category } from '#/lib/types'

const ZURICH = { lat: 47.3769, lon: 8.5417 }

export const Route = createFileRoute('/_app/map')({
  component: Home,
})

function Home() {
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()
  const outdoor = search.outdoor ?? false
  const { filteredPois, buildings, buildingsLoaded, selectedId, setSelectedId, t, setT, cat, sky, rating } =
    useMapData()

  // Sync `t` to URL with a small debounce so dragging doesn't spam history.
  const tWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (tWriteTimer.current) clearTimeout(tWriteTimer.current)
    tWriteTimer.current = setTimeout(() => {
      navigate({
        to: '/map',
        search: (prev) => ({ ...prev, t: t.toISOString() }),
        replace: true,
      })
    }, 200)
    return () => {
      if (tWriteTimer.current) clearTimeout(tWriteTimer.current)
    }
  }, [t, navigate])

  const selectedPoi = useMemo(
    () => (selectedId ? (filteredPois.find((p) => p.id === selectedId) ?? null) : null),
    [filteredPois, selectedId],
  )

  // Build spatial index once per buildings change for the selected POI's daily timeline.
  const spatialIndex = useMemo(() => buildSpatialIndex(buildings), [buildings])

  const selectedTimeline = useMemo(() => {
    if (!selectedPoi) return null
    // Until buildings load, an empty index would falsely report sun all day.
    if (!buildingsLoaded) return null
    return dailyTimeline(selectedPoi, spatialIndex, buildings, t)
  }, [selectedPoi, spatialIndex, buildings, buildingsLoaded, t])

  const { sunrise: chipSunrise, sunset: chipSunset } = useMemo(
    () => getSunTimes(t, ZURICH.lat, ZURICH.lon),
    [t],
  )

  const handleCategoryChange = useCallback(
    (next: Category) => {
      setSelectedId(null)
      navigate({
        to: '.',
        search: (prev) => ({ ...prev, cat: next === 'all' ? undefined : next }),
        replace: true,
      })
    },
    [navigate, setSelectedId],
  )

  const handleOutdoorChange = useCallback(
    (next: boolean) => {
      setSelectedId(null)
      navigate({
        to: '.',
        search: (prev) => ({ ...prev, outdoor: next ? true : undefined }),
        replace: true,
      })
    },
    [navigate, setSelectedId],
  )

  return (
    <>
      <div className="absolute top-0 left-0 right-0 z-30 p-2 sm:p-3 pt-[calc(env(safe-area-inset-top)+0.5rem)] sm:pt-[calc(env(safe-area-inset-top)+0.75rem)] pointer-events-none">
        <div className="pointer-events-auto">
          <FilterBar
            value={cat}
            onChange={handleCategoryChange}
            outdoor={outdoor}
            onOutdoorChange={handleOutdoorChange}
          />
        </div>
      </div>

      <div className="absolute top-14 left-2 z-20 pointer-events-none sm:top-16 sm:left-3">
        <div className="pointer-events-auto">
          <SkyChip sky={sky} sunrise={chipSunrise} sunset={chipSunset} />
        </div>
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
        rating={selectedPoi ? (rating[selectedPoi.id] ?? null) : null}
        onClose={() => setSelectedId(null)}
      />
    </>
  )
}

import { createContext, useContext } from 'react'
import type { Poi, Building, Category, Sky } from './types'

export type MapData = {
  /** All POIs in the current bbox (NOT filtered by category). */
  pois: Poi[]
  buildings: Building[]
  /** False until the first buildings fetch resolves. Consumers that compute
   *  sun/shade should treat `false` as "not yet ready" rather than "no buildings
   *  here" — otherwise an empty index makes every POI look sunny during the day. */
  buildingsLoaded: boolean
  /** POIs after applying the active category filter. */
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

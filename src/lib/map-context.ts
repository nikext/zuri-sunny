import { createContext, useContext } from 'react'
import type { Poi, Building, Category } from './types'

export type MapData = {
  /** All POIs in the current bbox (NOT filtered by category). */
  pois: Poi[]
  buildings: Building[]
  /** POIs after applying the active category filter. */
  filteredPois: Poi[]
  sunny: Record<string, boolean>
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

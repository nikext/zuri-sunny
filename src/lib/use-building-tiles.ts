import { useEffect, useMemo, useRef, useState } from 'react'
import { getBuildingTile } from '#/server/functions'
import { tileKey, tilesForBbox } from './tiles'
import type { Building } from './types'

/** Load buildings this far beyond the viewport: shadows are cast from outside
 *  it (a 20 m building at 10° sun throws a ~110 m shadow). */
const PAD_M = 300
/** Above this many tiles the view is zoomed out too far for per-spot sun to
 *  be worth ~20k+ buildings of download; the map shows sun as unknown and
 *  asks the user to zoom in. */
export const MAX_TILES = 64

export type BuildingTiles = {
  /** Buildings for the last viewport whose tiles all loaded. Kept while a new
   *  viewport's tiles are in flight so the map never shows a partial set. */
  buildings: Building[]
  /** True when `buildings` covers the current viewport. */
  ready: boolean
  /** True when the viewport needs more than MAX_TILES tiles. */
  tooWide: boolean
}

/** Buildings for `bbox` (null = viewport not known yet), fetched in fixed
 *  grid tiles (see `#/lib/tiles`) and cached for the session. */
export function useBuildingTiles(bbox: [number, number, number, number] | null): BuildingTiles {
  const cacheRef = useRef(new Map<string, Building[]>())
  const inFlightRef = useRef(new Set<string>())
  // Bumped whenever a tile lands, to re-render and re-check completeness.
  const [loadedCount, setLoadedCount] = useState(0)
  const publishedRef = useRef<{ sig: string; buildings: Building[] } | null>(null)

  const tiles = useMemo(() => (bbox ? tilesForBbox(bbox, PAD_M) : []), [bbox])
  const tooWide = tiles.length > MAX_TILES

  useEffect(() => {
    if (tooWide) return
    for (const t of tiles) {
      const k = tileKey(t)
      if (cacheRef.current.has(k) || inFlightRef.current.has(k)) continue
      inFlightRef.current.add(k)
      getBuildingTile({ data: t })
        .then((rows) => {
          cacheRef.current.set(k, rows as unknown as Building[])
          setLoadedCount((n) => n + 1)
        })
        .catch((err) => console.error('building tile fetch failed', k, err))
        // A failed tile is retried the next time the viewport changes.
        .finally(() => inFlightRef.current.delete(k))
    }
  }, [tiles, tooWide])

  const sig = tiles.map(tileKey).join(',')
  const ready =
    !tooWide && tiles.length > 0 && tiles.every((t) => cacheRef.current.has(tileKey(t)))

  const buildings = useMemo(() => {
    if (ready && publishedRef.current?.sig !== sig) {
      publishedRef.current = {
        sig,
        buildings: tiles.flatMap((t) => cacheRef.current.get(tileKey(t)) ?? []),
      }
    }
    return publishedRef.current?.buildings ?? []
    // loadedCount re-runs this when a tile lands and completes the set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, sig, loadedCount])

  return { buildings, ready, tooWide }
}

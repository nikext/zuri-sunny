import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import type { Map as MapLibreMap, IControl } from 'maplibre-gl'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import type { Building, Poi, Sky } from '#/lib/types'

export type SunMapProps = {
  pois: Poi[]
  buildings: Building[]
  /** Map of POI id -> sunny? Missing keys default to false (treat as shaded). */
  sunny: Record<string, boolean>
  /** POI id -> 0..99 daily rating; missing keys render no number. */
  rating: Record<string, number>
  /** Current sky state for the city, or null when unavailable. */
  sky: Sky | null
  /** Map of POI id -> open at currently displayed time? Missing keys default to true (assume open). */
  openNow: Record<string, boolean>
  selectedId?: string | null
  onSelect: (id: string) => void
  /** Called whenever the visible viewport changes. Args: [west, south, east, north]. */
  onViewportChange?: (bbox: [number, number, number, number]) => void
}

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
const ZURICH_CENTER: [number, number] = [8.5417, 47.3769] // [lon, lat]
const DEFAULT_ZOOM = 14
/** Below this zoom we never draw any rating numbers — at city scale the
 *  signal-to-noise ratio is bad even with overlap dedup. */
const RATING_HARD_HIDE_ZOOM = 13
/** Screen-space cell (pixels) for the overlap dedup. Markers are at most
 *  ~32px diameter (radiusMaxPixels=16). 36px gives breathing room around
 *  the labels so adjacent numbers don't collide. */
const LABEL_CELL_PX = 36

function buildLayers(
  pois: Poi[],
  buildings: Building[],
  sunny: Record<string, boolean>,
  rating: Record<string, number>,
  sky: Sky | null,
  openNow: Record<string, boolean>,
  selectedId: string | null | undefined,
  onSelect: (id: string) => void,
  zoom: number,
  visibleLabelIds: Set<string>,
) {
  const overcast = sky?.state === 'overcast'
  // 0.7 multiplier on the gold RGB channels — preserves alpha so closed/open
  // distinction (alpha 200 vs 255) is unchanged.
  const goldOpen: [number, number, number, number] = overcast
    ? [Math.round(255 * 0.7), Math.round(200 * 0.7), Math.round(40 * 0.7), 255]
    : [255, 200, 40, 255]
  const goldClosed: [number, number, number, number] = overcast
    ? [Math.round(230 * 0.7), Math.round(180 * 0.7), Math.round(40 * 0.7), 200]
    : [230, 180, 40, 200]

  return [
    new PolygonLayer<Building>({
      id: 'buildings',
      data: buildings,
      getPolygon: (b: Building) => b.footprint,
      extruded: true,
      getElevation: (b: Building) => b.heightM,
      getFillColor: [120, 120, 120, 38],
      pickable: false,
    }),
    new ScatterplotLayer<Poi>({
      id: 'pois',
      data: pois,
      getPosition: (p: Poi) => [p.lon, p.lat],
      getRadius: (p: Poi) => (p.id === selectedId ? 90 : 60),
      radiusMinPixels: 8,
      radiusMaxPixels: 16,
      pickable: true,
      stroked: true,
      // Always draw on top of the extruded buildings — without this, dots near
      // tall footprints get occluded by the 3D geometry at low camera angles.
      parameters: { depthCompare: 'always' },
      getFillColor: (p: Poi) =>
        sunny[p.id]
          ? openNow[p.id] === false
            ? goldClosed
            : goldOpen
          : openNow[p.id] === false
            ? [80, 90, 110, 140]
            : [80, 90, 110, 230],
      getLineColor: [255, 255, 255, 240],
      getLineWidth: (p: Poi) => (p.id === selectedId ? 3 : 1.75),
      lineWidthUnits: 'pixels',
      lineWidthMinPixels: 1.5,
      lineWidthMaxPixels: 3,
      onClick: (info) => {
        const obj = info.object as Poi | undefined
        if (obj) onSelect(obj.id)
      },
      updateTriggers: {
        getFillColor: [sunny, openNow, overcast],
        getRadius: [selectedId],
        getLineWidth: [selectedId],
      },
    }),
    new TextLayer<Poi>({
      id: 'poi-ratings',
      data: pois,
      visible: zoom >= RATING_HARD_HIDE_ZOOM,
      getPosition: (p: Poi) => [p.lon, p.lat],
      getText: (p: Poi) => {
        if (!visibleLabelIds.has(p.id)) return ''
        const v = rating[p.id]
        return typeof v === 'number' ? String(v) : ''
      },
      getColor: [255, 255, 255, 240],
      getSize: 12,
      sizeUnits: 'pixels',
      parameters: { depthCompare: 'always' },
      pickable: false,
      fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
      fontWeight: 700,
      updateTriggers: {
        getText: [rating, visibleLabelIds],
      },
    }),
  ]
}

export function SunMap(props: SunMapProps): React.ReactElement {
  const { pois, buildings, sunny, rating, sky, openNow, selectedId, onSelect, onViewportChange } = props

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  // Keep latest callbacks in refs to avoid re-initializing the map on every prop change.
  const onSelectRef = useRef(onSelect)
  const onViewportChangeRef = useRef(onViewportChange)
  const [mounted, setMounted] = useState(false)
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM)
  // Bumped on every map move (throttled to one per animation frame) so the
  // overlap-dedup recomputes against the current screen-space projection.
  const [moveTick, setMoveTick] = useState<number>(0)
  const moveRafRef = useRef<number | null>(null)

  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])
  useEffect(() => {
    onViewportChangeRef.current = onViewportChange
  }, [onViewportChange])

  // Mark client-mounted so SSR renders an empty div and we init in the browser.
  useEffect(() => {
    setMounted(true)
  }, [])

  // Init map + overlay once on mount (client only).
  useEffect(() => {
    if (!mounted) return
    if (typeof window === 'undefined') return
    const container = containerRef.current
    if (!container) return

    const map = new maplibregl.Map({
      container,
      style: STYLE_URL,
      center: ZURICH_CENTER,
      zoom: DEFAULT_ZOOM,
    })
    mapRef.current = map

    // Hide road and POI labels so dots aren't visually crowded by competing text.
    // Keep place labels (neighborhoods, city names) for orientation.
    const handleStyleLoad = () => {
      try {
        const style = map.getStyle()
        const layers = style?.layers ?? []
        for (const layer of layers) {
          if (layer.type !== 'symbol') continue
          const id = layer.id
          // Match positron's road-name + POI symbol layers; keep `place_*`/place layers.
          if (id.startsWith('transportation_name') || id.startsWith('poi')) {
            try {
              map.setLayoutProperty(id, 'visibility', 'none')
            } catch {
              // ignore individual layer failures (style ids may shift over time)
            }
          }
        }
      } catch {
        // style not ready or shape changed; safe to no-op
      }
    }
    map.on('load', handleStyleLoad)

    const overlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
    })
    overlayRef.current = overlay

    // MapboxOverlay implements the maplibre IControl interface.
    map.addControl(overlay as unknown as IControl)

    const handleMoveEnd = () => {
      const b = map.getBounds()
      onViewportChangeRef.current?.([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
    }
    map.on('moveend', handleMoveEnd)

    const handleZoom = () => setZoom(map.getZoom())
    map.on('zoom', handleZoom)

    // Pan + zoom both fire 'move'. Coalesce to one bump per animation frame so
    // we recompute the label dedup smoothly during a drag without thrashing.
    const handleMove = () => {
      if (moveRafRef.current != null) return
      moveRafRef.current = requestAnimationFrame(() => {
        moveRafRef.current = null
        setMoveTick((n) => n + 1)
      })
    }
    map.on('move', handleMove)

    return () => {
      map.off('moveend', handleMoveEnd)
      map.off('zoom', handleZoom)
      map.off('move', handleMove)
      map.off('load', handleStyleLoad)
      if (moveRafRef.current != null) {
        cancelAnimationFrame(moveRafRef.current)
        moveRafRef.current = null
      }
      try {
        map.removeControl(overlay as unknown as IControl)
      } catch {
        // map may already be torn down
      }
      overlayRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [mounted])

  // Push fresh layers whenever inputs change.
  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return
    const map = mapRef.current

    // Compute the set of POIs whose rating label is allowed to render. Above
    // the hard-hide zoom we project each POI to pixel coords and bucket into
    // 36px cells; the first POI to claim a cell gets the label, the rest are
    // dropped. Result: as the user zooms in, more labels survive naturally.
    const visibleLabelIds = new Set<string>()
    if (map && zoom >= RATING_HARD_HIDE_ZOOM) {
      const claimed = new Set<string>()
      for (const p of pois) {
        let pt: { x: number; y: number }
        try {
          pt = map.project([p.lon, p.lat])
        } catch {
          continue
        }
        const cx = Math.floor(pt.x / LABEL_CELL_PX)
        const cy = Math.floor(pt.y / LABEL_CELL_PX)
        const key = `${cx},${cy}`
        if (claimed.has(key)) continue
        claimed.add(key)
        visibleLabelIds.add(p.id)
      }
    }

    overlay.setProps({
      layers: buildLayers(
        pois,
        buildings,
        sunny,
        rating,
        sky,
        openNow,
        selectedId,
        (id) => onSelectRef.current(id),
        zoom,
        visibleLabelIds,
      ),
    })
    // moveTick is intentionally a dep so a pure pan recomputes the dedup.
  }, [pois, buildings, sunny, rating, sky, openNow, selectedId, zoom, moveTick])

  return <div ref={containerRef} className="w-full h-full" />
}

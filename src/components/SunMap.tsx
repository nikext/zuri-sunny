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
/** Minimum pixel distance between any two label centers. If two markers are
 *  closer than this on screen, BOTH lose their label (Google-Maps-style: when
 *  in doubt, hide; the user zooms in to disambiguate). Markers are up to
 *  ~32px diameter (radiusMaxPixels=16) so this leaves a small visual gap. */
const MIN_LABEL_DIST_PX = 36

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
  const goldOpen: [number, number, number, number] = [255, 200, 40, 255]
  const goldClosed: [number, number, number, number] = [230, 180, 40, 200]
  const shadedOpen: [number, number, number, number] = [80, 90, 110, 230]
  const shadedClosed: [number, number, number, number] = [80, 90, 110, 140]

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
      getFillColor: (p: Poi) => {
        // Under overcast, no marker should look "in the sun" — direct
        // radiation is too low for any geometrically-sunny spot to actually
        // catch any. Render every POI as shaded.
        const isSunny = sunny[p.id] && !overcast
        if (isSunny) return openNow[p.id] === false ? goldClosed : goldOpen
        return openNow[p.id] === false ? shadedClosed : shadedOpen
      },
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
      // Hide ratings under overcast — when nobody's actually getting sun, a
      // bright "85" on a marker reads as misleading rather than informative.
      visible: zoom >= RATING_HARD_HIDE_ZOOM && !overcast,
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

    // Compute the set of POIs whose rating label is allowed to render. Project
    // each POI to pixel coords, then drop any label that has a neighbor within
    // MIN_LABEL_DIST_PX — both POIs in an overlapping pair lose their label,
    // matching Google Maps's "hide when in doubt" behavior. Cell bucketing
    // (cell size = MIN_LABEL_DIST_PX) keeps the neighbor search local: we only
    // need to check each POI's own cell + 8 neighbors.
    const visibleLabelIds = new Set<string>()
    if (map && zoom >= RATING_HARD_HIDE_ZOOM) {
      const projected: Array<{ id: string; x: number; y: number }> = []
      for (const p of pois) {
        try {
          const pt = map.project([p.lon, p.lat])
          projected.push({ id: p.id, x: pt.x, y: pt.y })
        } catch {
          // skip un-projectable POI
        }
      }
      const cells = new Map<string, number[]>()
      for (let i = 0; i < projected.length; i++) {
        const p = projected[i]!
        const cx = Math.floor(p.x / MIN_LABEL_DIST_PX)
        const cy = Math.floor(p.y / MIN_LABEL_DIST_PX)
        const key = `${cx},${cy}`
        let bucket = cells.get(key)
        if (!bucket) {
          bucket = []
          cells.set(key, bucket)
        }
        bucket.push(i)
      }
      const minDistSq = MIN_LABEL_DIST_PX * MIN_LABEL_DIST_PX
      outer: for (let i = 0; i < projected.length; i++) {
        const a = projected[i]!
        const cx = Math.floor(a.x / MIN_LABEL_DIST_PX)
        const cy = Math.floor(a.y / MIN_LABEL_DIST_PX)
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const bucket = cells.get(`${cx + dx},${cy + dy}`)
            if (!bucket) continue
            for (const j of bucket) {
              if (j === i) continue
              const b = projected[j]!
              const ddx = a.x - b.x
              const ddy = a.y - b.y
              if (ddx * ddx + ddy * ddy < minDistSq) continue outer
            }
          }
        }
        visibleLabelIds.add(a.id)
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

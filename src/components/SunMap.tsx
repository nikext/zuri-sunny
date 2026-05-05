import { useEffect, useRef, useState } from 'react'
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { PolygonLayer, ScatterplotLayer } from '@deck.gl/layers'
import type { Building, Poi } from '#/lib/types'

export type SunMapProps = {
  pois: Poi[]
  buildings: Building[]
  /** Map of POI id -> sunny? Missing keys default to false (treat as shaded). */
  sunny: Record<string, boolean>
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

function buildLayers(
  pois: Poi[],
  buildings: Building[],
  sunny: Record<string, boolean>,
  openNow: Record<string, boolean>,
  onSelect: (id: string) => void,
) {
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
      getRadius: 60,
      radiusMinPixels: 6,
      radiusMaxPixels: 12,
      pickable: true,
      getFillColor: (p: Poi) =>
        sunny[p.id]
          ? openNow[p.id] === false
            ? [200, 160, 40, 180]
            : [255, 200, 40, 255]
          : openNow[p.id] === false
            ? [120, 120, 120, 140]
            : [160, 160, 160, 220],
      onClick: (info) => {
        const obj = info.object as Poi | undefined
        if (obj) onSelect(obj.id)
      },
      updateTriggers: {
        getFillColor: [sunny, openNow],
      },
    }),
  ]
}

export function SunMap(props: SunMapProps): React.ReactElement {
  const { pois, buildings, sunny, openNow, selectedId, onSelect, onViewportChange } = props

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  // Keep latest callbacks in refs to avoid re-initializing the map on every prop change.
  const onSelectRef = useRef(onSelect)
  const onViewportChangeRef = useRef(onViewportChange)
  const [mounted, setMounted] = useState(false)

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

    const overlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
    })
    overlayRef.current = overlay

    // MapboxOverlay implements the maplibre IControl interface.
    map.addControl(overlay as unknown as maplibregl.IControl)

    const handleMoveEnd = () => {
      const b = map.getBounds()
      onViewportChangeRef.current?.([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
    }
    map.on('moveend', handleMoveEnd)

    return () => {
      map.off('moveend', handleMoveEnd)
      try {
        map.removeControl(overlay as unknown as maplibregl.IControl)
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
    overlay.setProps({
      layers: buildLayers(pois, buildings, sunny, openNow, (id) => onSelectRef.current(id)),
    })
    // selectedId is included so a future highlight layer rebuilds; no visual diff yet.
  }, [pois, buildings, sunny, openNow, selectedId])

  return <div ref={containerRef} className="w-full h-full" />
}

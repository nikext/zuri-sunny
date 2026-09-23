import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import type { Map as MapLibreMap, IControl } from 'maplibre-gl'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { ScatterplotLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers'
import { AmbientLight, DirectionalLight, LightingEffect, _SunLight as SunLight } from '@deck.gl/core'
import { getSunPosition } from '#/lib/sun'
import type { Building, Poi, Sky } from '#/lib/types'

export type SunMapProps = {
  pois: Poi[]
  buildings: Building[]
  /** Map of POI id -> sunny? A missing key means "not computed yet" and the
   *  marker renders neutral rather than shaded. */
  sunny: Record<string, boolean>
  /** POI id -> 0..99 daily rating; missing keys render no number. */
  rating: Record<string, number>
  /** POI id -> [lon, lat] where sun is evaluated (outside the POI's own
   *  facade); markers are drawn there. Missing keys use the POI position. */
  anchors: Record<string, [number, number]>
  /** Current sky state for the city, or null when unavailable. */
  sky: Sky | null
  /** Displayed time — drives the sun light, shadows and sky tint. */
  t: Date
  /** Map of POI id -> open at currently displayed time? Missing keys default to true (assume open). */
  openNow: Record<string, boolean>
  selectedId?: string | null
  onSelect: (id: string) => void
  /** Called whenever the visible viewport changes. Args: [west, south, east, north]. */
  onViewportChange?: (bbox: [number, number, number, number]) => void
}

type Rgba = [number, number, number, number]
type Rgb = [number, number, number]

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
const ZURICH_CENTER: [number, number] = [8.5417, 47.3769] // [lon, lat]
const DEFAULT_ZOOM = 14.5
/** Tilt used for the 3D view (and on first load). */
const PITCH_3D = 50
const MAX_PITCH = 70
/** Below this zoom we never draw any rating numbers — at city scale the
 *  signal-to-noise ratio is bad even with overlap dedup. */
const RATING_HARD_HIDE_ZOOM = 13
/** Minimum pixel distance between any two label centers. If two markers are
 *  closer than this on screen, BOTH lose their label (Google-Maps-style: when
 *  in doubt, hide; the user zooms in to disambiguate). Markers are up to
 *  ~28px diameter so this leaves a small visual gap. */
const MIN_LABEL_DIST_PX = 36

/** Receives building shadows. Fully transparent: the shadow shader paints only
 *  the shadowed fragments, so the basemap shows through everywhere else. */
const SHADOW_GROUND: [number, number][][] = [
  [
    [8.3, 47.2],
    [8.8, 47.2],
    [8.8, 47.55],
    [8.3, 47.55],
    [8.3, 47.2],
  ],
]

const GOLD_OPEN: Rgba = [255, 200, 40, 255]
const GOLD_CLOSED: Rgba = [230, 180, 40, 200]
const SHADED_OPEN: Rgba = [80, 90, 110, 230]
const SHADED_CLOSED: Rgba = [80, 90, 110, 140]
/** Sun/shade not computed yet (buildings loading, or zoomed out too far). */
const UNKNOWN: Rgba = [160, 170, 186, 210]

const deg = (rad: number) => (rad * 180) / Math.PI

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, f))
}

function lerpRgb(a: Rgb, b: Rgb, f: number): Rgb {
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)]
}

/** Marker radius in pixels: small at city scale, capped when zoomed in. */
function markerRadiusPx(zoom: number, selected: boolean): number {
  const base = lerp(7, 13, (zoom - 12) / 3)
  return selected ? base + 3 : base
}

/** Sky/horizon colours for the pitched view, by sun altitude and cloud. */
function skyFor(altDeg: number, overcast: boolean) {
  if (altDeg <= 0) {
    return { sky: '#0f1a2e', horizon: '#2b3654', fog: '#2b3654' }
  }
  if (overcast) return { sky: '#b6bec8', horizon: '#dde1e5', fog: '#e3e6e9' }
  if (altDeg < 10) return { sky: '#f0ae78', horizon: '#fde1c0', fog: '#f7e8d8' }
  return { sky: '#93c4ee', horizon: '#e6eef5', fog: '#eef2f5' }
}

/** The part of the map worth loading data for. When the map is tilted,
 *  getBounds() reaches toward the horizon; cap it at one screen-size from
 *  the centre so a tilted view doesn't request buildings kilometres away. */
function viewportBbox(map: MapLibreMap): [number, number, number, number] {
  const b = map.getBounds()
  const c = map.getCenter()
  const cosLat = Math.cos((c.lat * Math.PI) / 180)
  const mPerPx = (40_075_016.686 * cosLat) / (512 * 2 ** map.getZoom())
  const canvas = map.getCanvas()
  const reachM = Math.max(canvas.clientWidth, canvas.clientHeight) * mPerPx
  const dLat = reachM / 111_320
  const dLon = reachM / (111_320 * cosLat)
  return [
    Math.max(b.getWest(), c.lng - dLon),
    Math.max(b.getSouth(), c.lat - dLat),
    Math.min(b.getEast(), c.lng + dLon),
    Math.min(b.getNorth(), c.lat + dLat),
  ]
}

/** Cool, semi-transparent shadows so street detail stays readable under them. */
const SHADOW_COLOR: [number, number, number, number] = [0.1, 0.14, 0.26, 0.45]

/** One lighting effect for the map's lifetime, re-tuned per frame for sun,
 *  cloud or night. It must stay a single instance: once deck.gl has set up a
 *  shadow-casting light it injects the shadow shader module into every layer,
 *  and swapping to an effect without shadow maps leaves those shaders with
 *  unbound textures — the layers silently stop drawing. */
type Lighting = {
  effect: LightingEffect
  ambient: AmbientLight
  sun: SunLight
  /** Shadowless top light: soft modelling under cloud, moonlight at night. */
  fill: DirectionalLight
}

function createLighting(): Lighting {
  const ambient = new AmbientLight({ color: [235, 240, 255], intensity: 1.0 })
  const sun = new SunLight({
    timestamp: Date.now(),
    color: [255, 246, 232],
    intensity: 1.1,
    _shadow: true,
  })
  const fill = new DirectionalLight({ color: [255, 255, 255], intensity: 0, direction: [-1, -2, -3] })
  const effect = new LightingEffect({ ambient, sun, fill })
  effect.shadowColor = SHADOW_COLOR
  return { effect, ambient, sun, fill }
}

type LightMode = 'sun' | 'overcast' | 'night'

function tuneLighting(l: Lighting, mode: LightMode, t: Date, sunAltDeg: number): void {
  l.sun.timestamp = t.getTime()
  if (mode === 'sun') {
    // Low sun is warmer and weaker.
    const f = sunAltDeg / 30
    l.sun.color = lerpRgb([255, 196, 140], [255, 248, 238], f)
    l.sun.intensity = lerp(0.7, 1.1, f)
    l.ambient.color = [235, 240, 255]
    l.ambient.intensity = 1.0
    l.fill.intensity = 0
    l.effect.shadowColor = SHADOW_COLOR
    return
  }
  l.sun.intensity = 0
  l.effect.shadowColor = [0, 0, 0, 0]
  if (mode === 'overcast') {
    l.ambient.color = [255, 255, 255]
    l.ambient.intensity = 1.25
    l.fill.color = [255, 255, 255]
    l.fill.intensity = 0.45
  } else {
    l.ambient.color = [170, 185, 220]
    l.ambient.intensity = 0.75
    l.fill.color = [150, 170, 220]
    l.fill.intensity = 0.3
  }
}

function buildLayers(
  pois: Poi[],
  buildings: Building[],
  sunny: Record<string, boolean>,
  rating: Record<string, number>,
  anchors: Record<string, [number, number]>,
  overcast: boolean,
  shadows: boolean,
  openNow: Record<string, boolean>,
  selectedId: string | null | undefined,
  onSelect: (id: string) => void,
  zoom: number,
  visibleLabelIds: Set<string>,
) {
  const position = (p: Poi): [number, number] => anchors[p.id] ?? [p.lon, p.lat]

  return [
    new SolidPolygonLayer<[number, number][]>({
      id: 'shadow-ground',
      data: shadows ? SHADOW_GROUND : [],
      getPolygon: (d) => d,
      getFillColor: [0, 0, 0, 0],
      pickable: false,
    }),
    new SolidPolygonLayer<Building>({
      id: 'buildings',
      data: buildings,
      getPolygon: (b: Building) => b.footprint,
      extruded: true,
      getElevation: (b: Building) => b.heightM,
      getFillColor: [232, 228, 221, 255],
      material: { ambient: 0.6, diffuse: 0.55, shininess: 8, specularColor: [20, 20, 20] },
      pickable: false,
    }),
    new ScatterplotLayer<Poi>({
      id: 'pois',
      data: pois,
      getPosition: position,
      getRadius: (p: Poi) => markerRadiusPx(zoom, p.id === selectedId),
      radiusUnits: 'pixels',
      // Face the camera when the map is tilted instead of lying flat.
      billboard: true,
      pickable: true,
      stroked: true,
      // Always draw on top of the extruded buildings — without this, dots near
      // tall footprints get occluded by the 3D geometry at low camera angles.
      parameters: { depthCompare: 'always' },
      getFillColor: (p: Poi) => {
        const s = sunny[p.id]
        if (s === undefined) return UNKNOWN
        // Under overcast, no marker should look "in the sun" — direct
        // radiation is too low for any geometrically-sunny spot to actually
        // catch any. Render every POI as shaded.
        const isSunny = s && !overcast
        if (isSunny) return openNow[p.id] === false ? GOLD_CLOSED : GOLD_OPEN
        return openNow[p.id] === false ? SHADED_CLOSED : SHADED_OPEN
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
        getPosition: [anchors],
        getFillColor: [sunny, openNow, overcast],
        getRadius: [selectedId, zoom],
        getLineWidth: [selectedId],
      },
    }),
    new TextLayer<Poi>({
      id: 'poi-ratings',
      data: pois,
      // Hide ratings under overcast — when nobody's actually getting sun, a
      // bright "85" on a marker reads as misleading rather than informative.
      visible: zoom >= RATING_HARD_HIDE_ZOOM && !overcast,
      getPosition: position,
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
        getPosition: [anchors],
        getText: [rating, visibleLabelIds],
      },
    }),
  ]
}

export function SunMap(props: SunMapProps): React.ReactElement {
  const {
    pois,
    buildings,
    sunny,
    rating,
    anchors,
    sky,
    t,
    openNow,
    selectedId,
    onSelect,
    onViewportChange,
  } = props

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const lightingRef = useRef<Lighting | null>(null)
  // Keep latest callbacks in refs to avoid re-initializing the map on every prop change.
  const onSelectRef = useRef(onSelect)
  const onViewportChangeRef = useRef(onViewportChange)
  const [mounted, setMounted] = useState(false)
  const [styleLoaded, setStyleLoaded] = useState(false)
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM)
  const [pitch, setPitch] = useState<number>(PITCH_3D)
  const [bearing, setBearing] = useState<number>(0)
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
      pitch: PITCH_3D,
      maxPitch: MAX_PITCH,
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
      setStyleLoaded(true)
    }

    const lighting = createLighting()
    lightingRef.current = lighting
    const overlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
      effects: [lighting.effect],
      // Only buildings cast shadows. Markers and rating labels would otherwise
      // throw little wedges across the map (TextLayer's sublayers don't
      // inherit a per-layer shadowEnabled flag, so filter by pass instead).
      layerFilter: ({ layer, renderPass }) =>
        renderPass !== 'shadow' || layer.id === 'buildings',
    })
    overlayRef.current = overlay

    // MapboxOverlay implements the maplibre IControl interface.
    map.addControl(overlay as unknown as IControl)

    const handleMoveEnd = () => {
      onViewportChangeRef.current?.(viewportBbox(map))
    }
    map.on('moveend', handleMoveEnd)
    map.on('load', () => {
      handleStyleLoad()
      // Report the initial viewport so data loads for what's actually visible.
      handleMoveEnd()
    })

    const handleZoom = () => setZoom(map.getZoom())
    map.on('zoom', handleZoom)

    // Pan + zoom + rotate + pitch all fire 'move'. Coalesce to one bump per
    // animation frame so we recompute the label dedup smoothly during a drag
    // without thrashing.
    const handleMove = () => {
      if (moveRafRef.current != null) return
      moveRafRef.current = requestAnimationFrame(() => {
        moveRafRef.current = null
        setPitch(map.getPitch())
        setBearing(map.getBearing())
        setMoveTick((n) => n + 1)
      })
    }
    map.on('move', handleMove)

    return () => {
      map.off('moveend', handleMoveEnd)
      map.off('zoom', handleZoom)
      map.off('move', handleMove)
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
      lightingRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [mounted])

  // Sun position at the map centre for the displayed time.
  const sunAltDeg = useMemo(
    () => deg(getSunPosition(t, ZURICH_CENTER[1], ZURICH_CENTER[0]).altitudeRad),
    [t],
  )
  const sunAzimuthDeg = useMemo(
    () => deg(getSunPosition(t, ZURICH_CENTER[1], ZURICH_CENTER[0]).azimuthRad),
    [t],
  )
  const overcast = sky?.state === 'overcast'
  const daylight = sunAltDeg > 0
  // Hard shadows only when there is direct sun to cast them.
  const shadows = daylight && !overcast

  // Tint the sky (visible when the map is tilted towards the horizon).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleLoaded) return
    const c = skyFor(sunAltDeg, overcast)
    try {
      map.setSky({
        'sky-color': c.sky,
        'horizon-color': c.horizon,
        'fog-color': c.fog,
        'sky-horizon-blend': 0.6,
        'horizon-fog-blend': 0.6,
        'fog-ground-blend': 0.9,
      })
    } catch {
      // older style spec / style mid-reload; the sky is decorative
    }
  }, [styleLoaded, sunAltDeg, overcast])

  // Push fresh layers whenever inputs change.
  useEffect(() => {
    const overlay = overlayRef.current
    const lighting = lightingRef.current
    if (!overlay || !lighting) return
    const map = mapRef.current

    tuneLighting(lighting, !daylight ? 'night' : shadows ? 'sun' : 'overcast', t, sunAltDeg)

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
          const pt = map.project(anchors[p.id] ?? [p.lon, p.lat])
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
        anchors,
        overcast,
        shadows,
        openNow,
        selectedId,
        (id) => onSelectRef.current(id),
        zoom,
        visibleLabelIds,
      ),
    })
    // moveTick is intentionally a dep so a pure pan recomputes the dedup.
  }, [
    pois,
    buildings,
    sunny,
    rating,
    anchors,
    overcast,
    shadows,
    daylight,
    sunAltDeg,
    t,
    openNow,
    selectedId,
    zoom,
    moveTick,
  ])

  const is3D = pitch > 5
  const toggle3D = () => {
    mapRef.current?.easeTo({ pitch: is3D ? 0 : PITCH_3D, duration: 600 })
  }
  const resetNorth = () => {
    mapRef.current?.easeTo({ bearing: 0, duration: 500 })
  }
  // Sun marker on the compass ring, relative to the map's rotation.
  const sunOnRingDeg = sunAzimuthDeg - bearing
  const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(sunAzimuthDeg / 45) % 8]
  const sunTitle = daylight
    ? `Sun in the ${compass}, ${Math.round(sunAltDeg)}° above the horizon. Tap to face north.`
    : 'Sun below the horizon. Tap to face north.'

  return (
    <div className="relative w-full h-full">
      {/* MapLibre forces position: relative on its container, so size it by
          width/height rather than absolute insets. */}
      <div ref={containerRef} className="w-full h-full" />
      {mounted ? (
        <div className="absolute right-2 top-14 sm:right-3 sm:top-16 z-20 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={toggle3D}
            aria-label={is3D ? 'Switch to flat 2D map' : 'Switch to tilted 3D map'}
            aria-pressed={is3D}
            className="w-10 h-10 rounded-full bg-white/90 backdrop-blur border border-slate-200 shadow-sm text-xs font-semibold text-slate-800 hover:bg-white active:bg-slate-100"
          >
            {is3D ? '2D' : '3D'}
          </button>
          <button
            type="button"
            onClick={resetNorth}
            aria-label={sunTitle}
            title={sunTitle}
            className="w-10 h-10 rounded-full bg-white/90 backdrop-blur border border-slate-200 shadow-sm hover:bg-white active:bg-slate-100 inline-flex items-center justify-center"
          >
            <svg viewBox="-20 -20 40 40" className="w-8 h-8" aria-hidden="true">
              <circle r="15" fill="none" stroke="rgb(203 213 225)" strokeWidth="1.5" />
              <g transform={`rotate(${-bearing})`}>
                <path d="M0,-12 L3.5,0 L-3.5,0 Z" fill="rgb(225 29 72)" />
                <path d="M0,12 L3.5,0 L-3.5,0 Z" fill="rgb(148 163 184)" />
              </g>
              {daylight ? (
                <circle
                  transform={`rotate(${sunOnRingDeg})`}
                  cy="-15"
                  r="4"
                  fill="rgb(251 191 36)"
                  stroke="white"
                  strokeWidth="1.5"
                />
              ) : null}
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  )
}

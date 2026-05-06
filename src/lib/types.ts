// Shared types used across libs, workers, and server functions.
// Stable contract — do not change shape without updating all consumers.

export type LatLon = { lat: number; lon: number }

export type BuildingFootprint = [number, number][] // [lon, lat] pairs, OSM order

export type Building = {
  // Server-side row id; the bulk bbox endpoint omits it from the wire payload
  // since no client/worker code reads it. DB rows still carry it as the PK.
  id?: string
  footprint: BuildingFootprint
  heightM: number
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
}

export type Poi = {
  id: string
  lat: number
  lon: number
  name?: string | null
  amenity?: string
  cuisine?: string | null
  openingHours?: string | null
  tags?: Record<string, string> | null
}

export type SunPosition = {
  /** radians above horizon; negative = below */
  altitudeRad: number
  /** compass radians: 0=N, π/2=E, π=S, 3π/2=W. Always in [0, 2π). */
  azimuthRad: number
}

// Worker message protocol
export type WorkerInitMessage = { type: 'init'; buildings: Building[] }
export type WorkerComputeMessage = { type: 'compute'; pois: Poi[]; t: string }
export type WorkerInbound = WorkerInitMessage | WorkerComputeMessage

export type WorkerReadyMessage = { type: 'ready' }
export type WorkerResultMessage = { type: 'result'; sunny: Record<string, boolean> }
export type WorkerOutbound = WorkerReadyMessage | WorkerResultMessage

export type Category = 'breakfast' | 'coffee' | 'lunch' | 'apero' | 'all'

// Daily sun-timeline for a POI: 15-minute step from sunrise to sunset, merged into segments.
import type { Building, Poi } from './types'
import type { BuildingIndex } from './shadows'
import { getSunTimes, getSunPosition } from './sun'
import { isSunnyAt } from './shadows'

export type TimelineSegment = { from: Date; to: Date; sunny: boolean }

const STEP_MS = 15 * 60 * 1000

/** Returns sun/shade segments for `day`, walking sunrise → sunset in 15-min steps. */
export function dailyTimeline(
  poi: Poi,
  index: BuildingIndex,
  buildings: Building[],
  day: Date,
): TimelineSegment[] {
  const { sunrise, sunset } = getSunTimes(day, poi.lat, poi.lon)
  if (!(sunrise instanceof Date) || isNaN(sunrise.getTime())) return []
  if (!(sunset instanceof Date) || isNaN(sunset.getTime())) return []
  if (sunset.getTime() <= sunrise.getTime()) return []

  // SunCalc's sunrise/sunset use a refracted horizon (~-0.833°), so altitude is
  // slightly negative AT those times. Bisect to the actual altitude=0 crossings
  // so segments inside [sunrise, sunset] sit above the geometric horizon.
  const sunriseMs = findHorizonCrossing(poi, sunrise.getTime(), sunset.getTime(), true)
  const sunsetMs = findHorizonCrossing(poi, sunrise.getTime(), sunset.getTime(), false)
  if (sunsetMs <= sunriseMs) return []

  // Sample at the midpoint of each interval so the boundaries don't taint segments.
  const sampleMid = (a: number, b: number) => new Date((a + b) / 2)
  const segments: TimelineSegment[] = []
  let segStart = new Date(sunriseMs)
  let segSunny = isSunnyAt(
    poi,
    index,
    buildings,
    sampleMid(sunriseMs, Math.min(sunriseMs + STEP_MS, sunsetMs)),
  )

  for (let ms = sunriseMs + STEP_MS; ms < sunsetMs; ms += STEP_MS) {
    const stepDate = new Date(ms)
    const nextMs = Math.min(ms + STEP_MS, sunsetMs)
    const sunny = isSunnyAt(poi, index, buildings, sampleMid(ms, nextMs))
    if (sunny !== segSunny) {
      segments.push({ from: segStart, to: stepDate, sunny: segSunny })
      segStart = stepDate
      segSunny = sunny
    }
  }
  segments.push({ from: segStart, to: new Date(sunsetMs), sunny: segSunny })
  return segments
}

/** Bisect [lo, hi] for the geometric (altitude=0) sunrise / sunset crossing. */
function findHorizonCrossing(poi: Poi, loMs: number, hiMs: number, ascending: boolean): number {
  let lo = loMs
  let hi = hiMs
  // 25 iterations of bisection -> ms-precision over a daylight window.
  for (let i = 0; i < 25; i++) {
    const mid = (lo + hi) / 2
    const alt = getSunPosition(new Date(mid), poi.lat, poi.lon).altitudeRad
    const above = alt > 0
    if (ascending) {
      if (above) hi = mid
      else lo = mid
    } else {
      if (above) lo = mid
      else hi = mid
    }
  }
  return ascending ? hi : lo
}

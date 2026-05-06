import type { Building, Poi } from './types'
import type { BuildingIndex } from './shadows'
import { dailyTimeline } from './timeline'
import { getSunTimes } from './sun'
import OpeningHours from 'opening_hours'

type Interval = { from: number; to: number } // ms epoch

/** Resolve the rating window for `day`:
 *   - intersection of (open hours) ∩ (sunrise..sunset) if non-empty
 *   - else full (sunrise..sunset)
 *  Returns one or more sorted, disjoint intervals.
 */
function ratingWindow(poi: Poi, day: Date): Interval[] {
  const { sunrise, sunset } = getSunTimes(day, poi.lat, poi.lon)
  if (
    !(sunrise instanceof Date) || isNaN(sunrise.getTime()) ||
    !(sunset instanceof Date) || isNaN(sunset.getTime()) ||
    sunset.getTime() <= sunrise.getTime()
  ) {
    return []
  }
  const dayStart = sunrise.getTime()
  const dayEnd = sunset.getTime()
  const daylightOnly: Interval[] = [{ from: dayStart, to: dayEnd }]

  const oh = poi.openingHours
  if (!oh || oh.trim() === '') return daylightOnly
  let parser: OpeningHours
  try {
    parser = new OpeningHours(oh, null)
  } catch {
    return daylightOnly
  }

  // Query for a 36h window so multi-interval, late-night, and "wraps past
  // midnight" specs all surface inside daylight on `day`.
  const queryStart = new Date(dayStart - 12 * 60 * 60 * 1000)
  const queryEnd = new Date(dayEnd + 12 * 60 * 60 * 1000)
  let raw: Array<[Date, Date, boolean | undefined, string | undefined]>
  try {
    raw = parser.getOpenIntervals(queryStart, queryEnd) as Array<
      [Date, Date, boolean | undefined, string | undefined]
    >
  } catch {
    return daylightOnly
  }

  // Intersect each open interval with [dayStart, dayEnd], then merge.
  const intersected: Interval[] = []
  for (const [from, to] of raw) {
    const a = Math.max(from.getTime(), dayStart)
    const b = Math.min(to.getTime(), dayEnd)
    if (b > a) intersected.push({ from: a, to: b })
  }
  if (intersected.length === 0) return daylightOnly

  intersected.sort((x, y) => x.from - y.from)
  const merged: Interval[] = [intersected[0]!]
  for (let i = 1; i < intersected.length; i++) {
    const cur = intersected[i]!
    const last = merged[merged.length - 1]!
    if (cur.from <= last.to) {
      if (cur.to > last.to) last.to = cur.to
    } else {
      merged.push(cur)
    }
  }
  return merged
}

function totalMs(intervals: Interval[]): number {
  let sum = 0
  for (const i of intervals) sum += i.to - i.from
  return sum
}

/** Returns a 0..99 integer: percent of the rating window during which the POI
 *  is geometrically sunny (clear-sky assumption). */
export function dailyRating(
  poi: Poi,
  index: BuildingIndex,
  buildings: Building[],
  day: Date,
): number {
  const window = ratingWindow(poi, day)
  const windowMs = totalMs(window)
  if (windowMs <= 0) return 0

  const segs = dailyTimeline(poi, index, buildings, day)
  let sunnyMs = 0
  for (const s of segs) {
    if (!s.sunny) continue
    const segStart = s.from.getTime()
    const segEnd = s.to.getTime()
    // Sum overlap with each window interval. A single segment may span
    // multiple disjoint window intervals (e.g. multi-shift opening hours).
    for (const w of window) {
      const a = Math.max(segStart, w.from)
      const b = Math.min(segEnd, w.to)
      if (b > a) sunnyMs += b - a
    }
  }
  return Math.min(99, Math.max(0, Math.round((100 * sunnyMs) / windowMs)))
}

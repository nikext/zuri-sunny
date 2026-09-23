// Wrapper around the `opening_hours` library. Unknown/invalid input is treated as "open".
//
// The library works in the runtime's local time, so every Date going in is
// converted to a Zürich "wall" Date (toZhWall) and every Date coming out is
// converted back (fromZhWall). Hours are then right for visitors whose device
// isn't on Swiss time, and on a server running in UTC.
import OpeningHours from 'opening_hours'
import { fromZhWall, toZhWall, zhParts } from './zurich-time'

// Parsing is the expensive part and the map re-evaluates every POI on each
// time-slider step, so keep one parser per distinct spec string (Zürich has a
// few hundred distinct strings).
const parseCache = new Map<string, OpeningHours | null>()

function tryParse(oh: string | null | undefined): OpeningHours | null {
  if (!oh || oh.trim() === '') return null
  const cached = parseCache.get(oh)
  if (cached !== undefined) return cached
  let parsed: OpeningHours | null
  try {
    parsed = new OpeningHours(oh, null)
  } catch {
    parsed = null
  }
  parseCache.set(oh, parsed)
  return parsed
}

/** True if the POI is open at time `t`. Null/empty/invalid spec → true. */
export function isOpenAt(oh: string | null | undefined, t: Date): boolean {
  const parsed = tryParse(oh)
  if (!parsed) return true
  try {
    return parsed.getState(toZhWall(t))
  } catch {
    return true
  }
}

/** True if the POI is open at any point in [from, to). Null/empty/invalid
 *  spec → true, matching `isOpenAt`. */
export function isOpenDuring(oh: string | null | undefined, from: Date, to: Date): boolean {
  const parsed = tryParse(oh)
  if (!parsed) return true
  try {
    return parsed.getOpenIntervals(toZhWall(from), toZhWall(to)).length > 0
  } catch {
    return true
  }
}

/** Next time the open/closed state flips, or null if unknown / always-on. */
export function nextStateChange(oh: string | null | undefined, t: Date): Date | null {
  const parsed = tryParse(oh)
  if (!parsed) return null
  try {
    const next = parsed.getNextChange(toZhWall(t))
    return next ? fromZhWall(next) : null
  } catch {
    return null
  }
}

/**
 * If a place is open at `t` and will close within the next 12 hours, returns
 * minutes until close. Returns null if closed at `t`, missing/unparseable
 * hours, 24/7 (no upcoming change), or the next change is >12h away.
 */
export function minutesUntilClose(
  oh: string | null | undefined,
  t: Date,
): number | null {
  if (!isOpenAt(oh, t)) return null
  const next = nextStateChange(oh, t)
  if (!next) return null
  const diffMs = next.getTime() - t.getTime()
  if (diffMs > 12 * 60 * 60 * 1000) return null
  return Math.max(0, Math.round(diffMs / 60_000))
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export type DayHours = {
  dayIndex: number // 0=Mon ... 6=Sun
  dayLabel: (typeof DAY_LABELS)[number]
  intervals: Array<{ from: string; to: string }> // "HH:MM"
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** "HH:MM" of a wall Date (its local fields already show Zürich time). */
function fmtWallHm(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** Wall Date for Monday 00:00 (Zürich) of the week containing `anchor`. */
function startOfWeek(anchor: Date): Date {
  const p = zhParts(anchor)
  return new Date(p.year, p.month - 1, p.day - p.weekday)
}

/**
 * Returns a 7-day breakdown (Mon→Sun) for the Zürich week containing `anchor`.
 * Returns null if hours can't be parsed.
 */
export function parseOpeningHoursWeek(
  oh: string | null | undefined,
  anchor: Date,
): DayHours[] | null {
  const parsed = tryParse(oh)
  if (!parsed) return null
  try {
    const monday = startOfWeek(anchor)
    const out: DayHours[] = []
    for (let i = 0; i < 7; i++) {
      const dayStart = new Date(monday)
      dayStart.setDate(monday.getDate() + i)
      const dayEnd = new Date(dayStart)
      dayEnd.setDate(dayStart.getDate() + 1)
      const raw = parsed.getOpenIntervals(dayStart, dayEnd) as Array<
        [Date, Date, boolean | undefined, string | undefined]
      >
      const intervals = raw.map(([from, to]) => ({ from: fmtWallHm(from), to: fmtWallHm(to) }))
      out.push({ dayIndex: i, dayLabel: DAY_LABELS[i]!, intervals })
    }
    return out
  } catch {
    return null
  }
}

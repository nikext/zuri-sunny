// Wrapper around the `opening_hours` library. Unknown/invalid input is treated as "open".
import OpeningHours from 'opening_hours'

function tryParse(oh: string | null | undefined): OpeningHours | null {
  if (!oh || oh.trim() === '') return null
  try {
    return new OpeningHours(oh, null)
  } catch {
    return null
  }
}

/** True if the POI is open at time `t`. Null/empty/invalid spec → true. */
export function isOpenAt(oh: string | null | undefined, t: Date): boolean {
  const parsed = tryParse(oh)
  if (!parsed) return true
  try {
    return parsed.getState(t)
  } catch {
    return true
  }
}

/** Next time the open/closed state flips, or null if unknown / always-on. */
export function nextStateChange(oh: string | null | undefined, t: Date): Date | null {
  const parsed = tryParse(oh)
  if (!parsed) return null
  try {
    const next = parsed.getNextChange(t)
    return next ?? null
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

function fmtHm(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** Returns the local-time start-of-Monday for the week containing `anchor`. */
function startOfWeek(anchor: Date): Date {
  const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 0, 0, 0, 0)
  // JS getDay(): 0=Sun..6=Sat. Convert to 0=Mon..6=Sun.
  const dow = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - dow)
  return d
}

/**
 * Returns a 7-day breakdown (Mon→Sun) for the week containing `anchor`.
 * Uses local time. Returns null if hours can't be parsed.
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
      const intervals = raw.map(([from, to]) => ({ from: fmtHm(from), to: fmtHm(to) }))
      out.push({ dayIndex: i, dayLabel: DAY_LABELS[i]!, intervals })
    }
    return out
  } catch {
    return null
  }
}

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

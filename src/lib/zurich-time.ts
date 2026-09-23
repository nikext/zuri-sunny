// Wall-clock time in Zürich, independent of the runtime's timezone.
//
// Why: everything the app shows — slider time, sunrise/sunset, opening hours,
// "open now", the day a rating belongs to — is about Zürich. Using the
// runtime's local time (Date#getHours etc.) was only right for visitors whose
// device is set to Swiss time, and for a server that happens to run in it.

export const ZURICH_TZ = 'Europe/Zurich'

const partsFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZURICH_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
})

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export type ZhParts = {
  year: number
  /** 1–12 */
  month: number
  day: number
  hour: number
  minute: number
  second: number
  /** 0 = Monday … 6 = Sunday */
  weekday: number
}

/** Zürich wall-clock fields of an instant. */
export function zhParts(d: Date): ZhParts {
  const parts = partsFormat.formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const num = (type: string) => Number(get(type))
  return {
    year: num('year'),
    month: num('month'),
    day: num('day'),
    hour: num('hour'),
    minute: num('minute'),
    second: num('second'),
    weekday: WEEKDAYS.indexOf(get('weekday')),
  }
}

/** The instant at which Zürich's wall clock reads the given time. Day and
 *  time overflow like `new Date(y, m, d, …)` (day 0 = last of previous month). */
export function zhDate(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  // Zürich is UTC+1 or UTC+2; the offset at the first guess is right except
  // within an hour of a DST switch, which the second pass settles.
  let t = wallAsUtc - zhOffsetMs(new Date(wallAsUtc))
  t = wallAsUtc - zhOffsetMs(new Date(t))
  return new Date(t)
}

/** Zürich's UTC offset at an instant, in ms. */
function zhOffsetMs(d: Date): number {
  const p = zhParts(d)
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return wallAsUtc - Math.floor(d.getTime() / 1000) * 1000
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** "HH:MM" in Zürich. */
export function fmtHmZh(d: Date): string {
  const p = zhParts(d)
  return `${pad2(p.hour)}:${pad2(p.minute)}`
}

/** "YYYY-MM-DD" of the Zürich calendar day containing `d`. */
export function zhDayKey(d: Date): string {
  const p = zhParts(d)
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`
}

/** Midnight (Zürich) starting the day that contains `d`. */
export function zhStartOfDay(d: Date): Date {
  const p = zhParts(d)
  return zhDate(p.year, p.month, p.day)
}

// The `opening_hours` library reads and returns Dates in the runtime's local
// time. These convert between a real instant and a "wall" Date whose LOCAL
// fields show Zürich's wall clock, so the library sees Zürich time anywhere.

/** Instant → Date whose local fields equal Zürich's wall clock at that instant. */
export function toZhWall(d: Date): Date {
  const p = zhParts(d)
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, d.getMilliseconds())
}

/** Inverse of `toZhWall`. */
export function fromZhWall(wall: Date): Date {
  const out = zhDate(
    wall.getFullYear(),
    wall.getMonth() + 1,
    wall.getDate(),
    wall.getHours(),
    wall.getMinutes(),
    wall.getSeconds(),
  )
  return new Date(out.getTime() + wall.getMilliseconds())
}

import { useMemo, useRef, useState } from 'react'
import { Calendar, Clock } from 'lucide-react'
import { getSunTimes } from '#/lib/sun'

export type TimeSliderProps = {
  /** Current selected time. */
  value: Date
  /** Center for sunrise/sunset bounds — typically map center. */
  center: { lat: number; lon: number }
  /** Called as the user drags. Parent should debounce expensive downstream work. */
  onChange: (t: Date) => void
  /** Optional: change the displayed day (defaults to value's date). */
  onDayChange?: (day: Date) => void
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function formatTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function formatDateInput(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function isValidDate(d: Date): boolean {
  return d instanceof Date && !Number.isNaN(d.getTime())
}

/** Build a Date for a given Y-M-D using the provided hour/minute (local time). */
function buildDate(year: number, month: number, day: number, hours: number, minutes: number): Date {
  return new Date(year, month, day, hours, minutes, 0, 0)
}

/** Fallback bounds: 06:00 -> 20:00 of value's local day. */
function fallbackBounds(value: Date): { sunrise: Date; sunset: Date } {
  const y = value.getFullYear()
  const m = value.getMonth()
  const d = value.getDate()
  return {
    sunrise: buildDate(y, m, d, 6, 0),
    sunset: buildDate(y, m, d, 20, 0),
  }
}

export function TimeSlider(props: TimeSliderProps): React.ReactElement {
  const { value, center, onChange, onDayChange } = props
  const dateInputRef = useRef<HTMLInputElement | null>(null)
  const [dateOpen, setDateOpen] = useState(false)

  const { minMs, maxMs } = useMemo(() => {
    const raw = getSunTimes(value, center.lat, center.lon)
    const ok = isValidDate(raw.sunrise) && isValidDate(raw.sunset) && raw.sunrise.getTime() < raw.sunset.getTime()
    const { sunrise, sunset } = ok ? raw : fallbackBounds(value)
    return { minMs: sunrise.getTime(), maxMs: sunset.getTime() }
  }, [value, center.lat, center.lon])

  // Clamp current value to bounds for the slider's visual position.
  const currentMs = Math.min(Math.max(value.getTime(), minMs), maxMs)

  const handleRangeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = new Date(Number(e.target.value))
    onChange(next)
  }

  const handleNow = () => {
    onChange(new Date())
  }

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value // "YYYY-MM-DD"
    if (!v) return
    const [ys, ms, ds] = v.split('-')
    const year = Number(ys)
    const month = Number(ms) - 1
    const day = Number(ds)
    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return
    const noon = buildDate(year, month, day, 12, 0)
    if (onDayChange) onDayChange(noon)
    else onChange(noon)
  }

  const openDatePicker = () => {
    const el = dateInputRef.current
    if (!el) return
    // showPicker is supported in modern browsers; fall back gracefully.
    const anyEl = el as HTMLInputElement & { showPicker?: () => void }
    if (typeof anyEl.showPicker === 'function') {
      try {
        anyEl.showPicker()
        return
      } catch {
        // fall through to focus
      }
    }
    el.focus()
    el.click()
  }

  return (
    <div className="w-full rounded-lg bg-white/90 backdrop-blur px-3 py-2 shadow-sm border border-slate-200">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 text-slate-800 font-medium text-sm tabular-nums whitespace-nowrap">
          <Clock aria-hidden="true" className="w-4 h-4 text-slate-500" />
          <span aria-label="Selected time">{formatTime(value)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={openDatePicker}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 active:bg-slate-100 whitespace-nowrap tabular-nums"
            aria-label="Change date"
          >
            <Calendar aria-hidden="true" className="w-3.5 h-3.5" />
            <span>{formatDateInput(value)}</span>
          </button>
          <input
            ref={dateInputRef}
            type="date"
            className="sr-only"
            value={formatDateInput(value)}
            onChange={handleDateChange}
            onFocus={() => setDateOpen(true)}
            onBlur={() => setDateOpen(false)}
            aria-hidden={!dateOpen}
            tabIndex={-1}
          />
          <button
            type="button"
            onClick={handleNow}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 active:bg-slate-700 whitespace-nowrap"
            aria-label="Reset to current time"
          >
            Now
          </button>
        </div>
      </div>
      <input
        type="range"
        min={minMs}
        max={maxMs}
        step={60_000}
        value={currentMs}
        onChange={handleRangeChange}
        aria-label="Time of day"
        className="range-thumb-lg w-full h-2 appearance-none rounded-full bg-gradient-to-r from-amber-200 via-yellow-300 to-orange-400 accent-amber-500 cursor-pointer"
      />
      <div className="flex items-center justify-between text-[10px] sm:text-xs text-slate-500 mt-1 tabular-nums">
        <span>{formatTime(new Date(minMs))}</span>
        <span>{formatTime(new Date(maxMs))}</span>
      </div>
    </div>
  )
}

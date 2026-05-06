// HTML/CSS day-strip showing sun/shade segments for a POI with a "now" marker.
// Renders at an explicit height so the bar stays readable on any width — the
// previous SVG with preserveAspectRatio="none" squished to ~25px on desktop.
import type { ReactElement } from 'react'

export type SunTimelineProps = {
  /** Daily timeline segments — sunny=true means in sunlight. */
  segments: Array<{ from: Date; to: Date; sunny: boolean }>
  /** Optional vertical line marker for "now" or selected time. */
  marker?: Date
}

const MINUTES_IN_DAY = 1440

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
}

function minutesInto(day: Date, t: Date): number {
  const ms = t.getTime() - day.getTime()
  return Math.max(0, Math.min(MINUTES_IN_DAY, ms / 60000))
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function fmtHm(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

type Cell = { key: string; minutes: number; kind: 'sun' | 'shade' | 'night' }

function buildCells(
  segments: Array<{ from: Date; to: Date; sunny: boolean }>,
  day: Date,
): Cell[] {
  const cells: Cell[] = []
  let cursor = 0
  segments.forEach((s, i) => {
    const start = minutesInto(day, s.from)
    const end = minutesInto(day, s.to)
    if (start > cursor) {
      cells.push({ key: `night-${i}`, minutes: start - cursor, kind: 'night' })
    }
    const w = Math.max(0, end - start)
    if (w > 0) {
      cells.push({ key: `seg-${i}`, minutes: w, kind: s.sunny ? 'sun' : 'shade' })
    }
    cursor = end
  })
  if (cursor < MINUTES_IN_DAY) {
    cells.push({ key: 'tail', minutes: MINUTES_IN_DAY - cursor, kind: 'night' })
  }
  return cells
}

const CELL_BG: Record<Cell['kind'], string> = {
  sun: 'bg-amber-400',
  shade: 'bg-slate-400',
  night: 'bg-blue-900',
}

export function SunTimeline(props: SunTimelineProps): ReactElement {
  const { segments, marker } = props
  const dayAnchor = segments[0]?.from ?? marker ?? new Date()
  const day = startOfDay(dayAnchor)

  const cells = buildCells(segments, day)
  const markerPct = marker ? (minutesInto(day, marker) / MINUTES_IN_DAY) * 100 : null

  const tickHours = [0, 6, 12, 18, 24]

  return (
    <div role="img" aria-label="Daily sun timeline" className="select-none">
      <div className="relative">
        <div className="relative h-12 sm:h-14 rounded-lg overflow-hidden ring-1 ring-slate-200 bg-blue-900 shadow-sm">
          <div className="absolute inset-0 flex">
            {cells.map((c) => (
              <div
                key={c.key}
                style={{ flexGrow: c.minutes }}
                className={CELL_BG[c.kind]}
              />
            ))}
          </div>

          {tickHours.slice(1, -1).map((h) => (
            <div
              key={`grid-${h}`}
              aria-hidden="true"
              className="absolute top-0 bottom-0 w-px bg-white/20 pointer-events-none"
              style={{ left: `${(h / 24) * 100}%` }}
            />
          ))}

          {markerPct !== null ? (
            <div
              aria-hidden="true"
              className="absolute top-0 bottom-0 w-0.5 bg-rose-500 pointer-events-none"
              style={{ left: `${markerPct}%` }}
            />
          ) : null}
        </div>

        {markerPct !== null && marker ? (
          <div
            className="absolute -top-2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-rose-500 text-white text-[10px] font-semibold tabular-nums shadow pointer-events-none"
            style={{ left: `clamp(1.5rem, ${markerPct}%, calc(100% - 1.5rem))` }}
          >
            {fmtHm(marker)}
          </div>
        ) : null}
      </div>

      <div className="relative mt-1.5 h-4">
        {tickHours.map((h) => {
          const pct = (h / 24) * 100
          const align =
            h === 0 ? 'translate-x-0' : h === 24 ? '-translate-x-full' : '-translate-x-1/2'
          return (
            <span
              key={h}
              className={`absolute top-0 text-[10px] sm:text-xs text-slate-500 tabular-nums ${align}`}
              style={{ left: `${pct}%` }}
            >
              {`${pad2(h === 24 ? 24 : h)}:00`}
            </span>
          )
        })}
      </div>

      <div className="mt-3 flex items-center gap-3 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block w-3 h-3 rounded-sm bg-amber-400" />
          Sun
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block w-3 h-3 rounded-sm bg-slate-400" />
          Shade
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block w-3 h-3 rounded-sm bg-blue-900" />
          Night
        </span>
      </div>
    </div>
  )
}

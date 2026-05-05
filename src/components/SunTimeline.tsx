// SVG day-strip showing sun/shade segments for a POI with optional time marker.
import type { ReactElement } from 'react'

export type SunTimelineProps = {
  /** Daily timeline segments — sunny=true means in sunlight. */
  segments: Array<{ from: Date; to: Date; sunny: boolean }>
  /** Optional vertical line marker for "now" or selected time. */
  marker?: Date
}

const VB_W = 1440 // one logical unit per minute of the day
const VB_H = 60
const BAR_Y = 8
const BAR_H = 28

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
}

function minutesInto(day: Date, t: Date): number {
  const ms = t.getTime() - day.getTime()
  return Math.max(0, Math.min(VB_W, ms / 60000))
}

export function SunTimeline(props: SunTimelineProps): ReactElement {
  const { segments, marker } = props
  const dayAnchor = segments[0]?.from ?? marker ?? new Date()
  const day = startOfDay(dayAnchor)

  const markerX = marker ? minutesInto(day, marker) : null
  const ticks = [6, 12, 18]

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      width="100%"
      role="img"
      aria-label="Daily sun timeline"
      className="block"
    >
      {/* Night background spans the whole day. */}
      <rect x={0} y={BAR_Y} width={VB_W} height={BAR_H} fill="#1e3a8a" />

      {segments.map((s, i) => {
        const x1 = minutesInto(day, s.from)
        const x2 = minutesInto(day, s.to)
        const w = Math.max(0, x2 - x1)
        const fill = s.sunny ? '#fbbf24' : '#9ca3af'
        return <rect key={i} x={x1} y={BAR_Y} width={w} height={BAR_H} fill={fill} />
      })}

      {ticks.map((h) => {
        const x = h * 60
        return (
          <g key={h}>
            <line x1={x} x2={x} y1={BAR_Y + BAR_H} y2={BAR_Y + BAR_H + 4} stroke="#475569" strokeWidth={1} />
            <text
              x={x}
              y={BAR_Y + BAR_H + 16}
              textAnchor="middle"
              fontSize={12}
              fill="#475569"
              fontFamily="ui-sans-serif, system-ui, sans-serif"
            >
              {`${h.toString().padStart(2, '0')}:00`}
            </text>
          </g>
        )
      })}

      {markerX !== null ? (
        <line
          x1={markerX}
          x2={markerX}
          y1={BAR_Y - 2}
          y2={BAR_Y + BAR_H + 2}
          stroke="#dc2626"
          strokeWidth={2}
        />
      ) : null}
    </svg>
  )
}

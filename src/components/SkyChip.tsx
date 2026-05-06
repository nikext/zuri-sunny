import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { Sky } from '#/lib/types'

export type SkyChipProps = {
  sky: Sky | null
  /** Sunrise/sunset for the popover footer. */
  sunrise?: Date | null
  sunset?: Date | null
}

const ICONS: Record<Sky['state'], string> = {
  clear: '☀️',
  partly: '⛅',
  overcast: '☁️',
  night: '⏾',
}

const LABELS: Record<Sky['state'], string> = {
  clear: 'Clear',
  partly: 'Partly cloudy',
  overcast: 'Overcast',
  night: 'Night',
}

const LEGEND: Record<Sky['state'], string> = {
  clear: 'full sun expected',
  partly: 'mix of sun and clouds',
  overcast: 'sunny dots dimmed',
  night: 'after sunset',
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function fmtHm(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function SkyChip(props: SkyChipProps): ReactElement | null {
  const { sky, sunrise, sunset } = props
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onClickAway(e: MouseEvent) {
      const el = wrapperRef.current
      if (el && !el.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClickAway)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClickAway)
    }
  }, [open])

  if (!sky) return null

  const icon = ICONS[sky.state]
  const label = LABELS[sky.state]

  return (
    <div className="relative inline-block" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full bg-white/90 backdrop-blur px-3 py-1.5 text-sm font-medium text-slate-800 border border-slate-200 shadow-sm hover:bg-white"
        aria-label={`Sky: ${label}`}
        aria-expanded={open}
      >
        <span aria-hidden="true">{icon}</span>
        <span>{label}</span>
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Sky details"
          className="absolute left-0 mt-1 w-60 rounded-lg bg-white border border-slate-200 shadow-lg p-3 text-xs text-slate-700 z-10"
        >
          <dl className="grid grid-cols-2 gap-y-1">
            <dt className="text-slate-500">Cloud cover</dt>
            <dd className="text-right tabular-nums">{Math.round(sky.cloudCoverPct)}%</dd>
            <dt className="text-slate-500">Direct sun</dt>
            <dd className="text-right tabular-nums">{Math.round(sky.directRadiationWm2)} W/m²</dd>
            {sunrise instanceof Date && !Number.isNaN(sunrise.getTime()) ? (
              <>
                <dt className="text-slate-500">Sunrise</dt>
                <dd className="text-right tabular-nums">{fmtHm(sunrise)}</dd>
              </>
            ) : null}
            {sunset instanceof Date && !Number.isNaN(sunset.getTime()) ? (
              <>
                <dt className="text-slate-500">Sunset</dt>
                <dd className="text-right tabular-nums">{fmtHm(sunset)}</dd>
              </>
            ) : null}
          </dl>
          <div className="mt-2 pt-2 border-t border-slate-100">
            <div className="text-slate-500 mb-1">What the icon means</div>
            <ul className="space-y-0.5 text-[11px] leading-snug">
              {(['clear', 'partly', 'overcast', 'night'] as const).map((s) => (
                <li
                  key={s}
                  className={s === sky.state ? 'text-slate-900 font-medium' : 'text-slate-600'}
                >
                  <span aria-hidden="true" className="mr-1">{ICONS[s]}</span>
                  <span>{LABELS[s]}</span>
                  <span className="text-slate-400"> — {LEGEND[s]}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100">
            <div className="text-slate-500 mb-1">Marker colors (right now)</div>
            <ul className="space-y-0.5 text-[11px] leading-snug text-slate-600">
              <li className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="inline-block w-2.5 h-2.5 rounded-full ring-1 ring-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.05)]"
                  style={{ background: 'rgb(255, 200, 40)' }}
                />
                <span><span className="text-slate-800 font-medium">Gold</span> — in the sun</span>
              </li>
              <li className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="inline-block w-2.5 h-2.5 rounded-full ring-1 ring-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.05)]"
                  style={{ background: 'rgb(80, 90, 110)' }}
                />
                <span><span className="text-slate-800 font-medium">Grey</span> — in shade</span>
              </li>
              <li className="text-slate-500">Faded = closed right now</li>
            </ul>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100">
            <div className="text-slate-500 mb-1">Number on the marker</div>
            <p className="text-[11px] leading-snug text-slate-600">
              <span className="text-slate-800 font-medium">0–99</span> — share of today's
              open hours the spot is in the sun, assuming a clear sky. It's a property of
              the day, so it doesn't change as you scrub the time slider.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}

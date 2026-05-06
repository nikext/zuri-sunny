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
          className="absolute left-0 mt-1 w-56 rounded-lg bg-white border border-slate-200 shadow-lg p-3 text-xs text-slate-700 z-10"
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
        </div>
      ) : null}
    </div>
  )
}

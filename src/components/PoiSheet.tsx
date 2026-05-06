// Bottom-sheet overlay summarizing a POI's address, hours, and current sun state.
import type { ReactElement } from 'react'
import { X, MapPin, ExternalLink, Umbrella } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import type { Poi } from '#/lib/types'
import { isOpenAt, minutesUntilClose } from '#/lib/opening-hours'

export type PoiSheetProps = {
  poi: Poi | null
  /** Current displayed time, used to compute "sunny until ...". */
  t: Date
  /** Sun timeline for this POI on the displayed day. */
  timeline?: Array<{ from: Date; to: Date; sunny: boolean }> | null
  /** 0..99 daily exposure rating for the displayed day; null hides the line. */
  rating?: number | null
  onClose: () => void
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function formatHm(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function displayName(poi: Poi): string {
  if (poi.name && poi.name.trim() !== '') return poi.name
  const amenity = poi.amenity ?? 'spot'
  return `Unnamed ${amenity}`
}

function hasOutdoorSeating(tags: Record<string, string> | null | undefined | string): boolean {
  let parsed: Record<string, string> | null | undefined = null
  if (typeof tags === 'string') {
    try {
      parsed = JSON.parse(tags) as Record<string, string>
    } catch {
      return false
    }
  } else {
    parsed = tags
  }
  if (!parsed || typeof parsed !== 'object') return false
  return parsed.outdoor_seating === 'yes' || parsed.terrace === 'yes'
}

function buildAddress(tags: Record<string, string> | null | undefined): string {
  if (!tags) return ''
  const street = tags['addr:street'] ?? ''
  const num = tags['addr:housenumber'] ?? ''
  const postcode = tags['addr:postcode'] ?? ''
  const city = tags['addr:city'] ?? ''
  const line1 = [street, num].filter(Boolean).join(' ').trim()
  const line2 = [postcode, city].filter(Boolean).join(' ').trim()
  return [line1, line2].filter(Boolean).join(', ')
}

type Segment = { from: Date; to: Date; sunny: boolean }

function ratingExplanation(rating: number | null | undefined, openHoursParseable: boolean): string | null {
  if (typeof rating !== 'number') return null
  if (rating === 0) {
    return openHoursParseable
      ? 'In shade for all of today’s open hours.'
      : 'In shade for all of daylight today.'
  }
  return openHoursParseable
    ? `In direct sun for about ${rating}% of today’s open hours (clear-sky estimate). See the sky chip for today’s actual conditions.`
    : `In direct sun for about ${rating}% of today’s daylight hours (clear-sky estimate). See the sky chip for today’s actual conditions.`
}

function sunStatus(timeline: Segment[] | null | undefined, t: Date): string | null {
  if (!timeline || timeline.length === 0) return null
  const tMs = t.getTime()
  const current = timeline.find((s) => tMs >= s.from.getTime() && tMs < s.to.getTime())
  if (current && current.sunny) return `Sunny until ${formatHm(current.to)}`
  const nextSunny = timeline.find((s) => s.sunny && s.from.getTime() > tMs)
  if (nextSunny) return `Shaded right now — sunny again at ${formatHm(nextSunny.from)}`
  return 'Shaded for the rest of today'
}

export function PoiSheet(props: PoiSheetProps): ReactElement | null {
  const { poi, t, timeline, rating, onClose } = props
  if (!poi) return null

  const address = buildAddress(poi.tags)
  const open = isOpenAt(poi.openingHours, t)
  const closingIn = open ? minutesUntilClose(poi.openingHours, t) : null
  const sun = sunStatus(timeline ?? null, t)
  const explanation = ratingExplanation(
    rating ?? null,
    !!(poi.openingHours && poi.openingHours.trim() !== ''),
  )
  const hasOutdoor = hasOutdoorSeating(poi.tags)
  // Prefer name-based search so Google resolves to the actual venue card rather
  // than dropping a generic pin at the lat/lon. Include address (or city) to
  // disambiguate common names like "Coffee" or "Brasserie".
  const name = poi.name?.trim()
  const mapsUrl = name
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        [name, address || 'Zürich'].join(', '),
      )}`
    : `https://www.google.com/maps/search/?api=1&query=${poi.lat},${poi.lon}`
  const amenityLabel = poi.amenity ?? ''

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className="fixed inset-0 z-[35] bg-slate-900/20"
      />
      <div
        role="dialog"
        aria-label="Place details"
        className="fixed inset-x-0 bottom-0 z-40 flex justify-center pointer-events-none"
      >
      <div className="w-full max-w-md pointer-events-auto rounded-t-2xl bg-white shadow-2xl border border-slate-200 px-4 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <div className="flex justify-center pt-1 pb-2">
          <div className="w-9 h-1 rounded-full bg-slate-300" aria-hidden="true" />
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900 truncate">{displayName(poi)}</h2>
            {amenityLabel ? (
              <p className="text-xs uppercase tracking-wide text-slate-500 mt-0.5">{amenityLabel}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-2.5 min-w-11 min-h-11 inline-flex items-center justify-center text-slate-500 hover:bg-slate-100 active:bg-slate-200"
          >
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-3 space-y-2.5 text-sm text-slate-700">
          {address ? (
            <p className="flex items-start gap-1.5">
              <MapPin aria-hidden="true" className="w-4 h-4 mt-0.5 text-slate-500 shrink-0" />
              <span>{address}</span>
            </p>
          ) : null}

          {hasOutdoor ? (
            <p className="flex items-center gap-1.5">
              <Umbrella aria-hidden="true" className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Outdoor seating</span>
            </p>
          ) : null}

          {poi.openingHours ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-slate-600 break-words">{poi.openingHours}</span>
              <span
                className={
                  open
                    ? 'inline-flex items-center rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-xs font-medium'
                    : 'inline-flex items-center rounded-full bg-rose-100 text-rose-800 px-2 py-0.5 text-xs font-medium'
                }
              >
                {open ? 'Open now' : 'Closed now'}
              </span>
              {closingIn !== null && closingIn < 60 ? (
                <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-xs font-medium">
                  {closingIn === 0 ? 'Closing soon' : `Closing in ${closingIn} min`}
                </span>
              ) : null}
            </div>
          ) : null}

          {sun ? (
            <p className="rounded-md bg-amber-50 border border-amber-200 text-amber-900 px-2.5 py-1.5 text-sm font-medium">
              {sun}
            </p>
          ) : null}

          {explanation ? (
            <p className="text-xs text-slate-500">{explanation}</p>
          ) : null}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 active:bg-slate-700"
          >
            <ExternalLink aria-hidden="true" className="w-4 h-4" />
            Open in Google Maps
          </a>
          <Link
            to="/spot/$id"
            params={{ id: poi.id }}
            search={(prev) => prev}
            className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100"
          >
            More details
          </Link>
        </div>
      </div>
    </div>
    </>
  )
}

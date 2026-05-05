// /spot/$id — server-loaded POI detail page with sun summary and hours table.
// Rendered as a full-screen scrollable overlay above the persistent map.
import type { ReactElement } from 'react'
import { useMemo } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, ExternalLink, Globe, Phone } from 'lucide-react'
import { getPoiById, getBuildingsInBbox } from '#/server/functions'
import { isOpenAt, minutesUntilClose, parseOpeningHoursWeek } from '#/lib/opening-hours'
import { dailyTimeline } from '#/lib/timeline'
import { buildSpatialIndex } from '#/lib/shadows'
import { summarizeSunWindows } from '#/lib/sun-summary'
import { getSunTimes } from '#/lib/sun'
import { SunTimeline } from '#/components/SunTimeline'
import type { Building, Category, Poi } from '#/lib/types'

type SpotSearch = {
  t?: string
  cat?: Category
}

const CATEGORIES: ReadonlyArray<Category> = ['breakfast', 'coffee', 'lunch', 'apero', 'all']

export const Route = createFileRoute('/_app/spot/$id')({
  validateSearch: (raw: Record<string, unknown>): SpotSearch => {
    const out: SpotSearch = {}
    if (typeof raw.t === 'string' && raw.t.length > 0) out.t = raw.t
    if (typeof raw.cat === 'string' && (CATEGORIES as ReadonlyArray<string>).includes(raw.cat)) {
      out.cat = raw.cat as Category
    }
    return out
  },
  loader: async ({ params }) => {
    const poi = await getPoiById({ data: { id: params.id } })
    if (!poi) return { poi: null, buildings: [] as Building[] }
    const dLat = 0.005
    const dLon = 0.008
    const bbox: [number, number, number, number] = [
      poi.lon - dLon,
      poi.lat - dLat,
      poi.lon + dLon,
      poi.lat + dLat,
    ]
    const buildings = await getBuildingsInBbox({ data: { bbox } })
    return { poi, buildings: buildings as unknown as Building[] }
  },
  component: SpotDetail,
})

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

function parseT(s: string | undefined): Date {
  if (!s) return new Date()
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? new Date() : d
}

function buildMapsUrl(poi: { name?: string | null; lat: number; lon: number; tags?: Record<string, string> | null }): string {
  const name = poi.name?.trim()
  if (!name) {
    return `https://www.google.com/maps/search/?api=1&query=${poi.lat},${poi.lon}`
  }
  const address = buildAddress(poi.tags)
  const q = [name, address || 'Zürich'].join(', ')
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}

function tag(tags: Record<string, string> | null | undefined, ...keys: string[]): string | null {
  if (!tags) return null
  for (const k of keys) {
    const v = tags[k]
    if (v && v.trim() !== '') return v
  }
  return null
}

function formatCuisine(v: string): string {
  return v
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' · ')
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function fmtHm(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function formatMinutes(total: number): string {
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function SpotDetail(): ReactElement {
  const { poi, buildings } = Route.useLoaderData()
  const search = Route.useSearch()
  const t = parseT(search.t)

  // Compute these unconditionally with safe fallbacks so hook order is stable
  // across the early-return on `!poi`.
  const spatialIndex = useMemo(() => buildSpatialIndex(buildings), [buildings])
  const timeline = useMemo(() => {
    if (!poi) return []
    return dailyTimeline(poi as Poi, spatialIndex, buildings, t)
  }, [poi, spatialIndex, buildings, t])
  const sunSummary = useMemo(() => summarizeSunWindows(timeline), [timeline])
  const sunTimes = useMemo(() => {
    if (!poi) return null
    try {
      return getSunTimes(t, poi.lat, poi.lon)
    } catch {
      return null
    }
  }, [poi, t])
  const week = useMemo(() => {
    if (!poi) return null
    return parseOpeningHoursWeek(poi.openingHours, t)
  }, [poi, t])

  if (!poi) {
    return (
      <div className="absolute inset-0 z-50 overflow-y-auto bg-white">
        <div className="min-h-full p-6 max-w-2xl mx-auto">
          <Link
            to="/"
            search={(prev) => prev}
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft aria-hidden="true" className="w-4 h-4" />
            Back to map
          </Link>
          <h1 className="mt-6 text-3xl font-bold text-slate-900">Spot not found</h1>
          <p className="mt-2 text-slate-600">
            We couldn't find that place. It may have been removed from the dataset.
          </p>
        </div>
      </div>
    )
  }

  const name = poi.name && poi.name.trim() !== '' ? poi.name : `Unnamed ${poi.amenity ?? 'spot'}`
  const address = buildAddress(poi.tags)
  const open = isOpenAt(poi.openingHours, t)
  const closingIn = open ? minutesUntilClose(poi.openingHours, t) : null
  const mapsUrl = buildMapsUrl(poi)

  const website = tag(poi.tags, 'website', 'contact:website')
  const phone = tag(poi.tags, 'phone', 'contact:phone')
  const description = tag(poi.tags, 'description')
  const cuisine = tag(poi.tags, 'cuisine')

  // Amenity badges — only the ones whose tag exists.
  const badges: Array<{ key: string; label: string }> = []
  if (tag(poi.tags, 'outdoor_seating') === 'yes' || tag(poi.tags, 'terrace') === 'yes') {
    badges.push({ key: 'outdoor', label: 'Outdoor seating' })
  }
  const wheelchair = tag(poi.tags, 'wheelchair')
  if (wheelchair === 'yes') badges.push({ key: 'wc-yes', label: 'Wheelchair accessible' })
  else if (wheelchair === 'limited') badges.push({ key: 'wc-lim', label: 'Limited accessibility' })
  const wifi = tag(poi.tags, 'internet_access', 'wifi')
  if (wifi === 'wlan' || wifi === 'yes' || wifi === 'free') {
    badges.push({ key: 'wifi', label: 'Wifi' })
  }
  if (cuisine) badges.push({ key: 'cuisine', label: formatCuisine(cuisine) })

  // Today index (Mon=0..Sun=6) for highlighting in the week table.
  const todayIdx = (t.getDay() + 6) % 7

  return (
    <div className="absolute inset-0 z-50 overflow-y-auto bg-white">
      <div className="min-h-full p-6 max-w-2xl mx-auto">
        <Link
          to="/"
          search={(prev) => prev}
          className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft aria-hidden="true" className="w-4 h-4" />
          Back to map
        </Link>

        <header className="mt-6">
          <h1 className="text-3xl font-bold text-slate-900">{name}</h1>
          {poi.amenity ? (
            <p className="mt-1 text-sm uppercase tracking-wide text-slate-500">{poi.amenity}</p>
          ) : null}
        </header>

        {/* Status row */}
        {poi.openingHours ? (
          <div className="mt-4 flex items-center gap-2 flex-wrap">
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

        {/* Address + contact */}
        {address ? <p className="mt-4 text-slate-700">{address}</p> : null}

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 active:bg-slate-700"
          >
            <ExternalLink aria-hidden="true" className="w-4 h-4" />
            Open in Google Maps
          </a>
          {website ? (
            <a
              href={website}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100"
            >
              <Globe aria-hidden="true" className="w-4 h-4" />
              Website
            </a>
          ) : null}
          {phone ? (
            <a
              href={`tel:${phone}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100"
            >
              <Phone aria-hidden="true" className="w-4 h-4" />
              {phone}
            </a>
          ) : null}
        </div>

        {/* Amenity badges */}
        {badges.length > 0 ? (
          <div className="mt-3 flex items-center gap-1.5 flex-wrap">
            {badges.map((b) => (
              <span
                key={b.key}
                className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 text-xs font-medium"
              >
                {b.label}
              </span>
            ))}
          </div>
        ) : null}

        {/* Description */}
        {description ? <p className="mt-4 text-slate-700 leading-relaxed">{description}</p> : null}

        {/* Sun summary card */}
        <section className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <h2 className="text-sm font-semibold text-amber-900 uppercase tracking-wide">Sun today</h2>
          {sunTimes ? (
            <p className="mt-1 text-sm text-amber-900 tabular-nums">
              Sunrise {fmtHm(sunTimes.sunrise)} · Sunset {fmtHm(sunTimes.sunset)}
            </p>
          ) : null}
          <p className="mt-1 text-sm text-amber-900">
            {sunSummary.totalSunnyMinutes > 0
              ? `${formatMinutes(sunSummary.totalSunnyMinutes)} of sun at this spot today.`
              : 'No sun reaches this spot today.'}
          </p>
          {sunSummary.windows.length > 0 ? (
            <p className="mt-1 text-sm text-amber-900 tabular-nums">
              Sunny windows:{' '}
              {sunSummary.windows.map((w) => `${fmtHm(w.from)}–${fmtHm(w.to)}`).join(', ')}
            </p>
          ) : null}
        </section>

        {/* Sun timeline */}
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
            Sun timeline
          </h2>
          <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3">
            <SunTimeline segments={timeline} marker={t} />
            <p className="mt-2 text-xs text-slate-500">
              Yellow = sun, gray = shade. Red line marks the selected time.
            </p>
          </div>
        </section>

        {/* Hours this week */}
        {week ? (
          <section className="mt-6">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
              Hours this week
            </h2>
            <table className="mt-2 w-full text-sm">
              <tbody>
                {week.map((row) => {
                  const today = row.dayIndex === todayIdx
                  const intervalText =
                    row.intervals.length === 0
                      ? 'Closed'
                      : row.intervals.map((iv) => `${iv.from}–${iv.to}`).join(', ')
                  return (
                    <tr key={row.dayIndex} className={today ? 'bg-amber-50' : ''}>
                      <td className="py-1 pr-4 text-slate-500 font-medium w-16">{row.dayLabel}</td>
                      <td className="py-1 text-slate-800 tabular-nums">{intervalText}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {poi.openingHours ? (
              <p className="mt-2 text-xs text-slate-500 break-words">{poi.openingHours}</p>
            ) : null}
          </section>
        ) : poi.openingHours ? (
          <p className="mt-3 text-sm text-slate-600 break-words">{poi.openingHours}</p>
        ) : null}
      </div>
    </div>
  )
}

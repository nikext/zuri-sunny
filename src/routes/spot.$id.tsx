// /spot/$id — server-loaded POI detail page with placeholder timeline.
import type { ReactElement } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { getPoiById } from '#/server/functions'
import { isOpenAt } from '#/lib/opening-hours'
import { SunTimeline } from '#/components/SunTimeline'
import type { Category } from '#/lib/types'

type SpotSearch = {
  t?: string
  cat?: Category
}

const CATEGORIES: ReadonlyArray<Category> = ['breakfast', 'coffee', 'lunch', 'apero', 'all']

export const Route = createFileRoute('/spot/$id')({
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
    return { poi }
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

function SpotDetail(): ReactElement {
  const { poi } = Route.useLoaderData()
  const search = Route.useSearch()
  const t = parseT(search.t)

  if (!poi) {
    return (
      <div className="min-h-screen p-6 max-w-2xl mx-auto">
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
    )
  }

  const name = poi.name && poi.name.trim() !== '' ? poi.name : `Unnamed ${poi.amenity ?? 'spot'}`
  const address = buildAddress(poi.tags)
  const open = isOpenAt(poi.openingHours, t)

  return (
    <div className="min-h-screen p-6 max-w-2xl mx-auto">
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

      {address ? <p className="mt-4 text-slate-700">{address}</p> : null}

      {poi.openingHours ? (
        <div className="mt-3 flex items-center gap-2 flex-wrap text-sm">
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
        </div>
      ) : null}

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
          Sun timeline
        </h2>
        <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3">
          <SunTimeline segments={[]} marker={t} />
          <p className="mt-2 text-xs text-slate-500">Daily sun timeline shown here</p>
        </div>
      </section>
    </div>
  )
}

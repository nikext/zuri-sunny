// One-shot admin page to re-pull POIs and buildings from Overpass.
// No auth (v1) — keep the URL out of public navigation. The action is
// idempotent (full replace) but expensive (~30–60s + Overpass rate limit).
import { useState, type ReactElement } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { getDataStats, refreshData } from '#/server/functions'

type Stats = { poiCount: number; buildingCount: number; lastRefresh: number | null }

export const Route = createFileRoute('/admin/refresh')({
  loader: async (): Promise<{ stats: Stats }> => {
    const stats = (await getDataStats()) as Stats
    return { stats }
  },
  component: AdminRefresh,
})

function formatStamp(ms: number | null): string {
  if (!ms) return 'Never'
  return new Date(ms).toLocaleString()
}

function AdminRefresh(): ReactElement {
  const { stats: initialStats } = Route.useLoaderData()
  const [stats, setStats] = useState<Stats>(initialStats)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{
    poisInserted: number
    buildingsInserted: number
    ms: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleRefresh = async () => {
    setBusy(true)
    setError(null)
    setResult(null)
    const t0 = Date.now()
    try {
      const r = (await refreshData({ data: {} })) as {
        poisInserted: number
        buildingsInserted: number
      }
      const ms = Date.now() - t0
      setResult({ ...r, ms })
      const fresh = (await getDataStats()) as Stats
      setStats(fresh)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen p-6 max-w-2xl mx-auto">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft aria-hidden="true" className="w-4 h-4" />
        Back to map
      </Link>

      <h1 className="mt-6 text-3xl font-bold text-slate-900">Data refresh</h1>
      <p className="mt-2 text-slate-600">
        Re-pull POIs and buildings from Overpass and replace the local DB. Takes ~30–60 seconds and
        is rate-limited by the Overpass server, so don&apos;t hammer it.
      </p>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
          Current data
        </h2>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-500">POIs</dt>
          <dd className="text-slate-800 tabular-nums">{stats.poiCount.toLocaleString()}</dd>
          <dt className="text-slate-500">Buildings</dt>
          <dd className="text-slate-800 tabular-nums">{stats.buildingCount.toLocaleString()}</dd>
          <dt className="text-slate-500">Last refresh</dt>
          <dd className="text-slate-800">{formatStamp(stats.lastRefresh)}</dd>
        </dl>
      </section>

      <button
        type="button"
        onClick={handleRefresh}
        disabled={busy}
        className="mt-6 inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 active:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <RefreshCw aria-hidden="true" className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
        {busy ? 'Refreshing from Overpass…' : 'Refresh from OSM'}
      </button>

      {result ? (
        <p className="mt-4 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-900 px-3 py-2 text-sm">
          Done in {Math.round(result.ms / 1000)}s · {result.poisInserted.toLocaleString()} POIs ·{' '}
          {result.buildingsInserted.toLocaleString()} buildings inserted.
        </p>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-md bg-rose-50 border border-rose-200 text-rose-900 px-3 py-2 text-sm break-words">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/// <reference lib="webworker" />
import type {
  Building,
  WorkerInbound,
  WorkerOutbound,
} from '../lib/types'
import { buildSpatialIndex, isSunnyAt, type BuildingIndex } from '../lib/shadows'
import { dailyRating } from '../lib/score'

let index: BuildingIndex | null = null
let buildings: Building[] = []
const ratingCache: Map<string, number> = new Map() // key: `${poiId}:${YYYY-MM-DD}` (Europe/Zurich)

const ctx = self as unknown as DedicatedWorkerGlobalScope

const post = (msg: WorkerOutbound) => ctx.postMessage(msg)

function zhDateKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

ctx.addEventListener('message', (e: MessageEvent<WorkerInbound>) => {
  const msg = e.data
  if (msg.type === 'init') {
    buildings = msg.buildings
    index = buildSpatialIndex(buildings)
    // Building set changed -> any cached ratings are stale.
    ratingCache.clear()
    post({ type: 'ready' })
    return
  }
  if (msg.type === 'compute') {
    if (!index) {
      post({ type: 'result', sunny: {} })
      return
    }
    const t = new Date(msg.t)
    const sunny: Record<string, boolean> = {}
    for (const poi of msg.pois) {
      sunny[poi.id] = isSunnyAt(poi, index, buildings, t)
    }
    post({ type: 'result', sunny })
    return
  }
  if (msg.type === 'score-daily') {
    if (!index) {
      post({ type: 'rating', rating: {} })
      return
    }
    const day = new Date(msg.day)
    const dayKey = zhDateKey(day)
    const rating: Record<string, number> = {}
    for (const poi of msg.pois) {
      const cacheKey = `${poi.id}:${dayKey}`
      const cached = ratingCache.get(cacheKey)
      if (cached !== undefined) {
        rating[poi.id] = cached
        continue
      }
      const r = dailyRating(poi, index, buildings, day)
      ratingCache.set(cacheKey, r)
      rating[poi.id] = r
    }
    post({ type: 'rating', rating })
    return
  }
})

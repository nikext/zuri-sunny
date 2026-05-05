/// <reference lib="webworker" />
import type {
  Building,
  WorkerInbound,
  WorkerOutbound,
} from '../lib/types'
import { buildSpatialIndex, isSunnyAt, type BuildingIndex } from '../lib/shadows'

let index: BuildingIndex | null = null
let buildings: Building[] = []

const ctx = self as unknown as DedicatedWorkerGlobalScope

const post = (msg: WorkerOutbound) => ctx.postMessage(msg)

ctx.addEventListener('message', (e: MessageEvent<WorkerInbound>) => {
  const msg = e.data
  if (msg.type === 'init') {
    buildings = msg.buildings
    index = buildSpatialIndex(buildings)
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
})

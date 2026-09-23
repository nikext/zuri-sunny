import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  Building,
  Poi,
  WorkerInbound,
  WorkerOutbound,
} from './types'
import { zhDayKey } from './zurich-time'

export type UseSunStatusInput = {
  pois: Poi[]
  buildings: Building[]
  t: Date
  /** When false, the hook is dormant: no init, no compute, no rating dispatch. */
  enabled?: boolean
  /** Debounce window for compute messages, default 50ms. */
  debounceMs?: number
}

export type UseSunStatusResult = {
  sunny: Record<string, boolean>
  /** POI id -> 0..99 daily exposure rating. Empty until the worker emits the
   *  first 'rating' message for the current day + POI set. */
  rating: Record<string, number>
  /** POI id -> [lon, lat] where sun is evaluated, for POIs moved outside their
   *  building footprint. Markers are drawn here so they sit where the sun is
   *  measured. */
  anchors: Record<string, [number, number]>
  loading: boolean
}

export function useSunStatus(input: UseSunStatusInput): UseSunStatusResult {
  const { pois, buildings, t, enabled = true, debounceMs = 50 } = input

  const [sunny, setSunny] = useState<Record<string, boolean>>({})
  const [rating, setRating] = useState<Record<string, number>>({})
  const [anchors, setAnchors] = useState<Record<string, [number, number]>>({})
  const [loading, setLoading] = useState<boolean>(true)
  // Bumped each time a new building set is posted to the worker, so daily
  // ratings are re-requested against the new index.
  const [indexVersion, setIndexVersion] = useState<number>(0)

  const workerRef = useRef<Worker | null>(null)
  const seqRef = useRef<number>(0)
  const latestDispatchedSeqRef = useRef<number>(0)
  const resultsReceivedRef = useRef<number>(0)
  const lastBuildingsRef = useRef<Building[] | null>(null)
  const lastBuildingsLenRef = useRef<number>(-1)
  const initInFlightRef = useRef<boolean>(false)
  const pendingComputeRef = useRef<{ pois: Poi[]; t: Date } | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const worker = new Worker(
      new URL('../workers/shadow-worker.ts', import.meta.url),
      { type: 'module' },
    )
    workerRef.current = worker
    lastBuildingsRef.current = null
    lastBuildingsLenRef.current = -1
    seqRef.current = 0
    latestDispatchedSeqRef.current = 0
    resultsReceivedRef.current = 0
    initInFlightRef.current = false
    pendingComputeRef.current = null

    const onMessage = (e: MessageEvent<WorkerOutbound>) => {
      const msg = e.data
      if (msg.type === 'ready') {
        initInFlightRef.current = false
        const pending = pendingComputeRef.current
        pendingComputeRef.current = null
        if (pending) sendCompute(pending.pois, pending.t)
        setLoading(false)
        return
      }
      if (msg.type === 'result') {
        resultsReceivedRef.current += 1
        const resultSeq = resultsReceivedRef.current
        if (resultSeq === latestDispatchedSeqRef.current) {
          setSunny(msg.sunny)
          setAnchors(msg.anchors)
        }
        setLoading(false)
        return
      }
      if (msg.type === 'rating') {
        // Merge so partial dispatches (different POI subsets) compose.
        setRating((prev) => ({ ...prev, ...msg.rating }))
        return
      }
    }

    worker.addEventListener('message', onMessage)

    return () => {
      worker.removeEventListener('message', onMessage)
      worker.terminate()
      workerRef.current = null
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sendCompute = (poisArg: Poi[], tArg: Date) => {
    const w = workerRef.current
    if (!w) return
    seqRef.current += 1
    latestDispatchedSeqRef.current = seqRef.current
    const msg: WorkerInbound = {
      type: 'compute',
      pois: poisArg,
      t: tArg.toISOString(),
    }
    w.postMessage(msg)
  }

  useEffect(() => {
    if (!enabled) return
    const w = workerRef.current
    if (!w) return
    const changed =
      lastBuildingsRef.current !== buildings ||
      lastBuildingsLenRef.current !== buildings.length
    if (!changed) return
    lastBuildingsRef.current = buildings
    lastBuildingsLenRef.current = buildings.length
    initInFlightRef.current = true
    setLoading(true)
    // Clear stale ratings — the new building set changes the geometry.
    setRating({})
    const initMsg: WorkerInbound = { type: 'init', buildings }
    w.postMessage(initMsg)
    setIndexVersion((v) => v + 1)
  }, [buildings, enabled])

  useEffect(() => {
    if (!enabled) return
    const w = workerRef.current
    if (!w) return
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      if (initInFlightRef.current) {
        pendingComputeRef.current = { pois, t }
        return
      }
      sendCompute(pois, t)
    }, debounceMs)
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pois, pois.length, t, debounceMs, enabled])

  // Re-dispatch score-daily only when the calendar day (in Zürich), the POI
  // set, or the building index changes — scrubbing within a day reuses the
  // worker's per-day cache. No need to wait for an in-flight 'init': the
  // worker handles messages in order, so this runs against the new index.
  // (Waiting here used to drop the request, and nothing re-sent it once the
  // worker was ready, so rating numbers went missing after a pan.)
  const dayKey = useMemo(() => zhDayKey(t), [t])
  useEffect(() => {
    if (!enabled) return
    const w = workerRef.current
    if (!w) return
    if (indexVersion === 0) return
    if (pois.length === 0) return
    const msg: WorkerInbound = {
      type: 'score-daily',
      pois,
      day: t.toISOString(),
    }
    w.postMessage(msg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pois, pois.length, dayKey, enabled, indexVersion])

  return { sunny, rating, anchors, loading }
}

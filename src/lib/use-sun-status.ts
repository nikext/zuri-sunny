import { useEffect, useRef, useState } from 'react'
import type {
  Building,
  Poi,
  WorkerInbound,
  WorkerOutbound,
} from './types'

export type UseSunStatusInput = {
  pois: Poi[]
  buildings: Building[]
  t: Date
  /** When false, the hook is dormant: no init, no compute, sunny stays `{}`.
   *  Use to gate on "buildings actually loaded" — without this, the first render
   *  computes against an empty index and marks every POI sunny during daytime. */
  enabled?: boolean
  /** Debounce window for compute messages, default 50ms. */
  debounceMs?: number
}

export type UseSunStatusResult = {
  /** Map of POI id -> sunny? Empty object before the first result returns. */
  sunny: Record<string, boolean>
  /** True before the worker has emitted its first 'ready' or 'result'. */
  loading: boolean
}

export function useSunStatus(input: UseSunStatusInput): UseSunStatusResult {
  const { pois, buildings, t, enabled = true, debounceMs = 50 } = input

  const [sunny, setSunny] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState<boolean>(true)

  const workerRef = useRef<Worker | null>(null)
  const seqRef = useRef<number>(0)
  const latestDispatchedSeqRef = useRef<number>(0)
  const resultsReceivedRef = useRef<number>(0)
  const lastBuildingsRef = useRef<Building[] | null>(null)
  const lastBuildingsLenRef = useRef<number>(-1)
  const initInFlightRef = useRef<boolean>(false)
  const pendingComputeRef = useRef<{ pois: Poi[]; t: Date } | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Lazy create the worker on mount; SSR-safe via useEffect.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const worker = new Worker(
      new URL('../workers/shadow-worker.ts', import.meta.url),
      { type: 'module' },
    )
    workerRef.current = worker
    // Reset markers so the buildings effect re-inits this fresh worker.
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
        // Flush any compute queued while init was in flight.
        const pending = pendingComputeRef.current
        pendingComputeRef.current = null
        if (pending) sendCompute(pending.pois, pending.t)
        setLoading(false)
        return
      }
      if (msg.type === 'result') {
        // Worker is FIFO — results arrive in dispatch order. Tag each result with
        // the next-in-line seq; only apply if it matches the latest dispatched.
        resultsReceivedRef.current += 1
        const resultSeq = resultsReceivedRef.current
        if (resultSeq === latestDispatchedSeqRef.current) {
          setSunny(msg.sunny)
        }
        setLoading(false)
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

  // Helper: post a compute, tagging dispatch seq for stale-drop logic.
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

  // Detect buildings change — by reference or length — and (re)init.
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
    const initMsg: WorkerInbound = { type: 'init', buildings }
    w.postMessage(initMsg)
  }, [buildings, enabled])

  // Schedule debounced compute when pois ref/length or t changes.
  useEffect(() => {
    if (!enabled) return
    const w = workerRef.current
    if (!w) return
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      if (initInFlightRef.current) {
        // Queue the latest compute; will fire on 'ready'.
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

  return { sunny, loading }
}

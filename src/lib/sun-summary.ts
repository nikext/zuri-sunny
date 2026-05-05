import type { TimelineSegment } from './timeline'

export type SunSummary = {
  totalSunnyMinutes: number
  windows: Array<{ from: Date; to: Date }>
}

/**
 * Coalesces consecutive sunny segments into windows and totals minutes.
 * Two segments are "consecutive" when prev.to.getTime() === next.from.getTime().
 */
export function summarizeSunWindows(segments: TimelineSegment[]): SunSummary {
  const windows: Array<{ from: Date; to: Date }> = []
  let totalMs = 0
  for (const s of segments) {
    if (!s.sunny) continue
    const ms = s.to.getTime() - s.from.getTime()
    if (ms <= 0) continue
    totalMs += ms
    const last = windows[windows.length - 1]
    if (last && last.to.getTime() === s.from.getTime()) {
      last.to = s.to
    } else {
      windows.push({ from: s.from, to: s.to })
    }
  }
  return {
    totalSunnyMinutes: Math.round(totalMs / 60_000),
    windows,
  }
}

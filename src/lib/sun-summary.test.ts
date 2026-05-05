import { describe, expect, it } from 'vitest'
import { summarizeSunWindows } from './sun-summary'
import type { TimelineSegment } from './timeline'

function seg(fromMs: number, toMs: number, sunny: boolean): TimelineSegment {
  return { from: new Date(fromMs), to: new Date(toMs), sunny }
}

describe('summarizeSunWindows', () => {
  it('returns zero for empty input', () => {
    expect(summarizeSunWindows([])).toEqual({ totalSunnyMinutes: 0, windows: [] })
  })

  it('returns one window for one sunny segment', () => {
    const r = summarizeSunWindows([seg(0, 60 * 60_000, true)])
    expect(r.totalSunnyMinutes).toBe(60)
    expect(r.windows.length).toBe(1)
    expect(r.windows[0]!.from.getTime()).toBe(0)
    expect(r.windows[0]!.to.getTime()).toBe(60 * 60_000)
  })

  it('ignores shaded segments', () => {
    const r = summarizeSunWindows([
      seg(0, 30 * 60_000, false),
      seg(30 * 60_000, 90 * 60_000, true),
    ])
    expect(r.totalSunnyMinutes).toBe(60)
    expect(r.windows.length).toBe(1)
  })

  it('coalesces adjacent sunny segments into one window', () => {
    const r = summarizeSunWindows([
      seg(0, 30 * 60_000, true),
      seg(30 * 60_000, 60 * 60_000, true),
    ])
    expect(r.totalSunnyMinutes).toBe(60)
    expect(r.windows.length).toBe(1)
  })

  it('keeps non-adjacent sunny segments as separate windows', () => {
    const r = summarizeSunWindows([
      seg(0, 30 * 60_000, true),
      seg(30 * 60_000, 60 * 60_000, false),
      seg(60 * 60_000, 90 * 60_000, true),
    ])
    expect(r.totalSunnyMinutes).toBe(60)
    expect(r.windows.length).toBe(2)
  })
})

# Spot Detail + Mobile Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken sun timeline on `/spot/$id`, enrich the detail page with OSM data + sun summary + hours-by-week, add a closing-soon (<60min) amber badge in `PoiSheet` and on the detail page, and ship a batch of mobile polish (safe-area, tap targets, sheet backdrop/drag handle, missing `no-scrollbar` utility).

**Architecture:** Three independent buckets that the spec calls out for parallel execution: **A) lib helpers** (pure new functions + tests, no UI dependencies), **B) mobile polish** (CSS + small UI tweaks), **C) detail page rewrite + closing-soon badge in PoiSheet** (consumes Bucket A's helpers). Wave 1: dispatch A and B in parallel. Wave 2: C builds on top.

**Tech Stack:** TypeScript / React 19 / TanStack Start (Nitro 3.x nightly) / Tailwind v4 / vitest / `opening_hours` (npm) / deck.gl + maplibre-gl on `/`. Tests live next to source as `*.test.ts` and run via `pnpm test` (vitest). Typecheck via `pnpm exec tsc --noEmit`.

**Spec:** `docs/superpowers/specs/2026-05-05-spot-detail-and-mobile-polish-design.md`

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `src/lib/opening-hours.ts` | Modify | Add `minutesUntilClose`, `parseOpeningHoursWeek`, `DayHours` type |
| `src/lib/opening-hours.test.ts` | Modify | Tests for both new helpers |
| `src/lib/sun-summary.ts` | Create | `summarizeSunWindows` + `SunSummary` type |
| `src/lib/sun-summary.test.ts` | Create | Tests for `summarizeSunWindows` |
| `src/styles.css` | Modify | `no-scrollbar` utility + `range-thumb-lg` thumb CSS |
| `src/routes/__root.tsx` | Modify | Viewport meta gets `viewport-fit=cover` |
| `src/routes/index.tsx` | Modify | Safe-area padding on the three overlay containers |
| `src/components/TimeSlider.tsx` | Modify | Bigger Now/date buttons; `range-thumb-lg` on input |
| `src/components/PoiSheet.tsx` | Modify | Close button size; `break-words`; backdrop; drag handle; closing-soon badge |
| `src/routes/spot.$id.tsx` | Modify | Loader fetches buildings; full body rewrite; `break-words` |

---

## Wave 1 (parallel)

Bucket A and Bucket B are fully independent — no shared file, no dependency between their tasks. Dispatch both as parallel agents.

---

## Bucket A — Library helpers

### Task A1: `minutesUntilClose`

**Files:**
- Modify: `src/lib/opening-hours.ts` (append after `nextStateChange`)
- Test: `src/lib/opening-hours.test.ts` (append a new `describe` block)

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/opening-hours.test.ts`:

```ts
import { isOpenAt, nextStateChange, minutesUntilClose } from './opening-hours'

// (existing utc helper + describes stay above; add the import to the existing import line)

describe('minutesUntilClose', () => {
  it('returns null for null/undefined/empty hours', () => {
    expect(minutesUntilClose(null, new Date())).toBe(null)
    expect(minutesUntilClose(undefined, new Date())).toBe(null)
    expect(minutesUntilClose('', new Date())).toBe(null)
  })

  it('returns null when closed at t', () => {
    // Wednesday 20:00 with hours Mo-Fr 09:00-17:00 => closed.
    expect(minutesUntilClose('Mo-Fr 09:00-17:00', utc(2026, 5, 6, 20))).toBe(null)
  })

  it('returns minutes until close when open and closing within window', () => {
    // Wednesday 16:30 with hours Mo-Fr 09:00-17:00 => 30 min until close.
    expect(minutesUntilClose('Mo-Fr 09:00-17:00', utc(2026, 5, 6, 16, 30))).toBe(30)
  })

  it('returns null for invalid syntax', () => {
    expect(minutesUntilClose('garbage', new Date())).toBe(null)
  })

  it('returns null for 24/7 spec (no upcoming change)', () => {
    expect(minutesUntilClose('24/7', new Date())).toBe(null)
  })
})
```

Note: do NOT duplicate the existing `import` line — extend it: `import { isOpenAt, nextStateChange, minutesUntilClose } from './opening-hours'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/opening-hours.test.ts -- --run`

Expected: failures referencing `minutesUntilClose is not a function` or similar TS error.

- [ ] **Step 3: Implement `minutesUntilClose`**

Append to `src/lib/opening-hours.ts`:

```ts
/**
 * If a place is open at `t` and will close within the next 12 hours, returns
 * minutes until close. Returns null if closed at `t`, missing/unparseable
 * hours, 24/7 (no upcoming change), or the next change is >12h away.
 */
export function minutesUntilClose(
  oh: string | null | undefined,
  t: Date,
): number | null {
  if (!isOpenAt(oh, t)) return null
  const next = nextStateChange(oh, t)
  if (!next) return null
  const diffMs = next.getTime() - t.getTime()
  if (diffMs > 12 * 60 * 60 * 1000) return null
  return Math.max(0, Math.round(diffMs / 60_000))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/opening-hours.test.ts -- --run`

Expected: all `minutesUntilClose` tests pass; existing `isOpenAt` and `nextStateChange` tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/opening-hours.ts src/lib/opening-hours.test.ts
git commit -m "feat(opening-hours): add minutesUntilClose helper"
```

---

### Task A2: `summarizeSunWindows`

**Files:**
- Create: `src/lib/sun-summary.ts`
- Create: `src/lib/sun-summary.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/sun-summary.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/sun-summary.test.ts -- --run`

Expected: failures (file doesn't exist).

- [ ] **Step 3: Implement `summarizeSunWindows`**

Create `src/lib/sun-summary.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/sun-summary.test.ts -- --run`

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sun-summary.ts src/lib/sun-summary.test.ts
git commit -m "feat(lib): add summarizeSunWindows helper"
```

---

### Task A3: `parseOpeningHoursWeek`

**Files:**
- Modify: `src/lib/opening-hours.ts` (append `DayHours` type and the function)
- Test: `src/lib/opening-hours.test.ts` (append a new `describe`)

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/opening-hours.test.ts` (and extend the import line to include `parseOpeningHoursWeek`):

```ts
import { isOpenAt, nextStateChange, minutesUntilClose, parseOpeningHoursWeek } from './opening-hours'

describe('parseOpeningHoursWeek', () => {
  // Anchor on Wednesday 2026-05-06 — week should be Mon 2026-05-04 → Sun 2026-05-10.
  const anchor = utc(2026, 5, 6, 12)

  it('returns null for missing hours', () => {
    expect(parseOpeningHoursWeek(null, anchor)).toBe(null)
    expect(parseOpeningHoursWeek('', anchor)).toBe(null)
  })

  it('returns null for invalid syntax', () => {
    expect(parseOpeningHoursWeek('garbage', anchor)).toBe(null)
  })

  it('returns 7 days with Mon-Fri 09-17 intervals and Sat/Sun closed', () => {
    const wk = parseOpeningHoursWeek('Mo-Fr 09:00-17:00', anchor)
    expect(wk).not.toBe(null)
    expect(wk!.length).toBe(7)
    expect(wk![0]!.dayLabel).toBe('Mon')
    expect(wk![0]!.intervals).toEqual([{ from: '09:00', to: '17:00' }])
    expect(wk![4]!.dayLabel).toBe('Fri')
    expect(wk![4]!.intervals).toEqual([{ from: '09:00', to: '17:00' }])
    expect(wk![5]!.dayLabel).toBe('Sat')
    expect(wk![5]!.intervals).toEqual([])
    expect(wk![6]!.dayLabel).toBe('Sun')
    expect(wk![6]!.intervals).toEqual([])
  })

  it('handles split intervals and Saturday-only differences', () => {
    const wk = parseOpeningHoursWeek('Mo-Fr 09:00-12:00,13:00-17:00; Sa 10:00-14:00', anchor)
    expect(wk).not.toBe(null)
    expect(wk![0]!.intervals).toEqual([
      { from: '09:00', to: '12:00' },
      { from: '13:00', to: '17:00' },
    ])
    expect(wk![5]!.intervals).toEqual([{ from: '10:00', to: '14:00' }])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/opening-hours.test.ts -- --run`

Expected: failures referencing `parseOpeningHoursWeek is not a function`.

- [ ] **Step 3: Implement `parseOpeningHoursWeek`**

Append to `src/lib/opening-hours.ts`:

```ts
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export type DayHours = {
  dayIndex: number // 0=Mon ... 6=Sun
  dayLabel: (typeof DAY_LABELS)[number]
  intervals: Array<{ from: string; to: string }> // "HH:MM"
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function fmtHm(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** Returns the local-time start-of-Monday for the week containing `anchor`. */
function startOfWeek(anchor: Date): Date {
  const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 0, 0, 0, 0)
  // JS getDay(): 0=Sun..6=Sat. Convert to 0=Mon..6=Sun.
  const dow = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - dow)
  return d
}

/**
 * Returns a 7-day breakdown (Mon→Sun) for the week containing `anchor`.
 * Uses local time. Returns null if hours can't be parsed.
 */
export function parseOpeningHoursWeek(
  oh: string | null | undefined,
  anchor: Date,
): DayHours[] | null {
  const parsed = tryParse(oh)
  if (!parsed) return null
  try {
    const monday = startOfWeek(anchor)
    const out: DayHours[] = []
    for (let i = 0; i < 7; i++) {
      const dayStart = new Date(monday)
      dayStart.setDate(monday.getDate() + i)
      const dayEnd = new Date(dayStart)
      dayEnd.setDate(dayStart.getDate() + 1)
      const raw = parsed.getOpenIntervals(dayStart, dayEnd) as Array<
        [Date, Date, boolean | undefined, string | undefined]
      >
      const intervals = raw.map(([from, to]) => ({ from: fmtHm(from), to: fmtHm(to) }))
      out.push({ dayIndex: i, dayLabel: DAY_LABELS[i]!, intervals })
    }
    return out
  } catch {
    return null
  }
}
```

Note: `tryParse` is the existing private helper at the top of the file — reuse it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/opening-hours.test.ts -- --run`

Expected: all `parseOpeningHoursWeek` tests pass; existing tests still pass.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/opening-hours.ts src/lib/opening-hours.test.ts
git commit -m "feat(opening-hours): add parseOpeningHoursWeek helper"
```

---

## Bucket B — Mobile polish

### Task B1: `no-scrollbar` utility, range-thumb CSS, viewport meta

**Files:**
- Modify: `src/styles.css`
- Modify: `src/routes/__root.tsx:25`

- [ ] **Step 1: Add the utility + thumb CSS**

Append to `src/styles.css`:

```css
@utility no-scrollbar {
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
}

input[type="range"].range-thumb-lg::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgb(245, 158, 11);
  border: 2px solid white;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  cursor: pointer;
}
input[type="range"].range-thumb-lg::-moz-range-thumb {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgb(245, 158, 11);
  border: 2px solid white;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  cursor: pointer;
}
```

- [ ] **Step 2: Update viewport meta to enable iOS safe-area insets**

In `src/routes/__root.tsx`, change:

```ts
{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
```

to:

```ts
{ name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/styles.css src/routes/__root.tsx
git commit -m "feat(styles): add no-scrollbar utility, range-thumb-lg, viewport-fit=cover"
```

---

### Task B2: Safe-area padding on overlay containers

**Files:**
- Modify: `src/routes/index.tsx:151`, `:169`

- [ ] **Step 1: Add safe-area padding to the FilterBar wrapper**

Change line 151 from:

```tsx
<div className="absolute top-0 left-0 right-0 z-30 p-2 sm:p-3 pointer-events-none">
```

to:

```tsx
<div className="absolute top-0 left-0 right-0 z-30 p-2 sm:p-3 pt-[calc(env(safe-area-inset-top)+0.5rem)] sm:pt-[calc(env(safe-area-inset-top)+0.75rem)] pointer-events-none">
```

- [ ] **Step 2: Add safe-area padding to the TimeSlider wrapper**

Change line 169 from:

```tsx
<div className="absolute bottom-0 left-0 right-0 z-20 p-2 sm:p-3 pointer-events-none">
```

to:

```tsx
<div className="absolute bottom-0 left-0 right-0 z-20 p-2 sm:p-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] sm:pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pointer-events-none">
```

(Bottom padding for `PoiSheet` itself is handled in Task B4 — that file owns its own card.)

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/index.tsx
git commit -m "feat(mobile): clear iOS notch + home indicator on overlay containers"
```

---

### Task B3: Bigger TimeSlider tap targets

**Files:**
- Modify: `src/components/TimeSlider.tsx`

- [ ] **Step 1: Bump the date button**

Find the date button (currently `className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs sm:text-sm text-slate-700 hover:bg-slate-50 active:bg-slate-100 whitespace-nowrap tabular-nums"`).

Replace its className with:

```
inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 active:bg-slate-100 whitespace-nowrap tabular-nums
```

- [ ] **Step 2: Bump the Now button**

Find the Now button (currently `className="rounded-md bg-slate-900 px-2 py-1 text-xs sm:text-sm font-medium text-white hover:bg-slate-800 active:bg-slate-700 whitespace-nowrap"`).

Replace its className with:

```
rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 active:bg-slate-700 whitespace-nowrap
```

- [ ] **Step 3: Add `range-thumb-lg` to the range input**

Find the range input. Its current className is:

```
w-full h-2 appearance-none rounded-full bg-gradient-to-r from-amber-200 via-yellow-300 to-orange-400 accent-amber-500 cursor-pointer
```

Replace with:

```
range-thumb-lg w-full h-2 appearance-none rounded-full bg-gradient-to-r from-amber-200 via-yellow-300 to-orange-400 accent-amber-500 cursor-pointer
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/TimeSlider.tsx
git commit -m "feat(mobile): bigger TimeSlider tap targets + range thumb"
```

---

### Task B4: PoiSheet mobile polish (close button, wrapping, backdrop, drag handle)

**Files:**
- Modify: `src/components/PoiSheet.tsx`

This task does NOT add the closing-soon badge — that's Bucket C, Task C4.

- [ ] **Step 1: Replace the dialog wrapper with a fragment containing a backdrop + the existing dialog**

Find the current return — starts with `<div role="dialog" ...>` near the bottom of the file.

Replace the outer wrapper so the JSX becomes:

```tsx
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
        {/* …existing children, with the close button updated as below… */}
      </div>
    </div>
  </>
)
```

Notes:
- The drag handle goes ABOVE the existing title row (which contains `<h2>` + close button).
- The card's bottom padding now includes `env(safe-area-inset-bottom)` (replaces the old `pb-6`).
- `z-[35]` for the backdrop sits above FilterBar (`z-30`) and below the dialog (`z-40`).

- [ ] **Step 2: Bump the close button**

Find the close button (currently `className="shrink-0 rounded-full p-1.5 text-slate-500 hover:bg-slate-100 active:bg-slate-200"`).

Replace its className with:

```
shrink-0 rounded-full p-2.5 min-w-11 min-h-11 inline-flex items-center justify-center text-slate-500 hover:bg-slate-100 active:bg-slate-200
```

- [ ] **Step 3: Replace `break-all` with `break-words` on the opening-hours line**

Find `<span className="text-slate-600 break-all">{poi.openingHours}</span>` and change to:

```tsx
<span className="text-slate-600 break-words">{poi.openingHours}</span>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/PoiSheet.tsx
git commit -m "feat(mobile): PoiSheet backdrop, drag handle, larger close button, safe-area"
```

---

### Task B5: `break-all` → `break-words` on the spot detail page

**Files:**
- Modify: `src/routes/spot.$id.tsx`

- [ ] **Step 1: Replace the class**

Find `<span className="text-slate-600 break-all">{poi.openingHours}</span>` (around line 100).

Change to:

```tsx
<span className="text-slate-600 break-words">{poi.openingHours}</span>
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/spot.$id.tsx
git commit -m "fix(spot): wrap opening-hours on whitespace, not mid-token"
```

---

## Wave 1 manual verification

After Bucket A and Bucket B are both complete, run:

- [ ] `pnpm test -- --run` — all tests pass
- [ ] `pnpm exec tsc --noEmit` — no errors
- [ ] `pnpm dev` — open `http://localhost:3000` in Chrome devtools mobile emulation (iPhone 14 Pro). Verify:
  - FilterBar overflow scrolls without a scrollbar
  - PoiSheet sits above the home indicator (visible safe-area padding at bottom)
  - Tapping outside the sheet (visible greyed backdrop) closes it
  - Drag handle pill visible at top of the sheet
  - Range slider thumb is visibly larger (24px)
  - Now/date buttons feel finger-friendly

---

## Wave 2 — Bucket C (depends on Bucket A)

Bucket C imports from Bucket A's helpers. Start only after A is committed.

### Task C1: Closing-soon badge in PoiSheet

**Files:**
- Modify: `src/components/PoiSheet.tsx`

- [ ] **Step 1: Import `minutesUntilClose`**

Find the existing import:

```ts
import { isOpenAt } from '#/lib/opening-hours'
```

Change to:

```ts
import { isOpenAt, minutesUntilClose } from '#/lib/opening-hours'
```

- [ ] **Step 2: Compute closing-soon and render the badge**

In the `PoiSheet` component, after the `const open = isOpenAt(...)` line, add:

```ts
const closingIn = open ? minutesUntilClose(poi.openingHours, t) : null
```

Inside the existing opening-hours block (right after the `Open now`/`Closed now` `<span>`), add a sibling badge:

```tsx
{closingIn !== null && closingIn < 60 ? (
  <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-xs font-medium">
    {closingIn === 0 ? 'Closing soon' : `Closing in ${closingIn} min`}
  </span>
) : null}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/PoiSheet.tsx
git commit -m "feat(sheet): show closing-soon badge when <60 min to close"
```

---

### Task C2: Spot detail page — loader fetches buildings

**Files:**
- Modify: `src/routes/spot.$id.tsx` (loader function only)

- [ ] **Step 1: Import the buildings server function and the Building type**

Update the imports at the top of the file:

```ts
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
```

- [ ] **Step 2: Update the loader**

Replace the existing loader:

```ts
loader: async ({ params }) => {
  const poi = await getPoiById({ data: { id: params.id } })
  return { poi }
},
```

with:

```ts
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
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`

Expected: no errors. (The `useMemo`, `getSunTimes`, `summarizeSunWindows`, etc. imports are unused at this step — that's fine, they get used in C3/C4. If the project has strict no-unused-imports lint, defer adding them until those tasks; otherwise leave them.)

- [ ] **Step 4: Commit**

```bash
git add src/routes/spot.$id.tsx
git commit -m "feat(spot): loader fetches buildings around the POI"
```

---

### Task C3: Spot detail page — body rewrite (status, contact, badges, description)

**Files:**
- Modify: `src/routes/spot.$id.tsx` (component body)

- [ ] **Step 1: Add helpers at top of file**

After the existing `buildAddress` and `parseT` helpers, add:

```ts
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
```

- [ ] **Step 2: Rewrite the `SpotDetail` component body**

Replace the existing `SpotDetail` function in its entirety with:

```tsx
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
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Manual verification (dev server)**

Run: `pnpm dev`

In the browser:
1. Open `http://localhost:3000`
2. Click any POI dot, then "More details"
3. Confirm:
   - Sun timeline shows yellow/gray segments and a red marker
   - Sunrise/sunset times displayed
   - "X h Y m of sun today" copy correct
   - Hours-by-week table shows today highlighted in amber
   - For a POI with `website` / `phone` tags, the buttons render
   - Amenity badges (Outdoor seating, Wifi, etc.) render only when tags exist
4. Visit `/spot/<bogus-id>` and confirm "Spot not found" still renders without crashing.

- [ ] **Step 5: Commit**

```bash
git add src/routes/spot.$id.tsx
git commit -m "feat(spot): rich detail page with sun summary, hours table, contact links"
```

---

## Final verification

After all tasks are complete:

- [ ] `pnpm test -- --run` — all tests pass
- [ ] `pnpm exec tsc --noEmit` — no errors
- [ ] `pnpm build` — production build succeeds
- [ ] Manual mobile pass at iPhone 14 Pro emulation:
  - Home: dots above buildings (already shipped earlier this session), tap a dot, sheet has drag handle + amber backdrop, tap-outside dismisses, "Open now" + "Closing in X min" badges if applicable
  - Click "More details", verify all detail sections render
  - Confirm safe-area padding visible at top + bottom of overlays

- [ ] Push:

```bash
git push
```

---

## Self-review notes

**Spec coverage check** — every spec section maps to a task:

| Spec section | Task |
|---|---|
| Bucket A `minutesUntilClose` | A1 |
| Bucket A `summarizeSunWindows` | A2 |
| Bucket A `parseOpeningHoursWeek` | A3 |
| Bucket B `no-scrollbar` + range CSS | B1 |
| Bucket B `viewport-fit=cover` | B1 |
| Bucket B safe-area on overlays | B2 (FilterBar, TimeSlider) + B4 (sheet card) |
| Bucket B TimeSlider tap targets | B3 |
| Bucket B PoiSheet polish (close, break-words, backdrop, drag handle) | B4 |
| Bucket B spot break-words | B5 |
| Bucket C closing-soon badge in PoiSheet | C1 |
| Bucket C loader buildings | C2 |
| Bucket C detail page sections (status, contact, badges, description, sun summary, timeline, hours-by-week) | C3 |

No gaps.

**Wave dependencies:**
- A1, A2, A3 are independent within Bucket A — could run in parallel sub-dispatches if Wave 1 is sub-parallelized further. Default: serial within Bucket A.
- B1–B5 are independent within Bucket B — same.
- C1 depends on A1. C2 has no helper deps but should follow C1 to keep the file edit history clean. C3 depends on A1 + A2 + A3 + C2.

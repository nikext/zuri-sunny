# Spot detail enhancements + closing-soon + mobile polish — design

**Date:** 2026-05-05
**Status:** Approved (pending implementation plan)
**Supersedes:** `2026-05-05-mobile-polish-and-closing-warning-design.md` — that spec is rolled into this one to share helpers (closing-soon, hours-by-day) and execute as one batch.

## Goals

1. **Fix the broken sun timeline on `/spot/$id`** (currently passes `segments={[]}` so the bar is empty navy).
2. **Make `/spot/$id` actually useful** — surface OSM data we already have, add a sun-windows summary, hours-by-day breakdown, sunrise/sunset, contact info, amenity badges, "Open in Google Maps".
3. **Closing-soon warning** (≤60 min) shown as an amber badge in both `PoiSheet` and the detail page.
4. **Mobile polish** — safe-area, tap targets, undefined `no-scrollbar` utility, sheet backdrop + drag handle, opening-hours wrapping.

## Non-goals

- Google / Foursquare ratings — out of scope (cost / API key).
- Sheet+slider coexistence on the home screen — bigger redesign, deferred.
- Photos, mini map preview, walking directions — Tier 3 ideas, deferred.
- Day picker on detail page — overlaps with the home-screen slider workflow.
- Swipe-down-to-dismiss gesture — backdrop tap covers the same intent.

## Architecture overview

Three logical buckets that can be implemented in parallel, with a small dependency arrow:

```
Bucket A (lib)         Bucket B (mobile polish)        Bucket C (detail page)
  helpers + tests        CSS + UI tweaks                 spot.$id rewrite
       │                                                       │
       └─────────────── consumed by ──────────────────────────┘
                            (PoiSheet badge + detail page)
```

- **Bucket A** is pure new helpers + their tests. No UI dependencies. Produces `minutesUntilClose`, `summarizeSunWindows`, `parseOpeningHoursWeek`.
- **Bucket B** is mobile polish — `styles.css`, viewport meta, tap targets, sheet backdrop/drag handle, `break-words`, safe-area padding. Touches `PoiSheet` for the backdrop/drag handle but **not** for the badge.
- **Bucket C** is the detail page rewrite, plus consuming the helpers in `PoiSheet` for the badge and on the detail page.

Bucket C depends on Bucket A's helpers being in place (it imports them). Bucket B is fully independent of A and C.

## Bucket A — new helpers (`src/lib`)

### `minutesUntilClose` (extends `src/lib/opening-hours.ts`)

```ts
/**
 * If a place is open at `t` and will close within the next 12 hours, returns
 * minutes until close. Returns null if closed at `t`, if opening hours are
 * missing/unparseable, if the spec is 24/7 (no upcoming change), or if the
 * next change is further than 12h away.
 */
export function minutesUntilClose(
  openingHours: string | null | undefined,
  t: Date,
): number | null
```

Implementation:
- If `isOpenAt(openingHours, t) === false`, return `null`.
- Use existing `nextStateChange(openingHours, t)`. If it returns `null`, return `null`.
- If the change is more than 12h after `t`, return `null` (defensive cap for very long open windows).
- Return `Math.max(0, Math.round((next.getTime() - t.getTime()) / 60000))`.

### `summarizeSunWindows` (new file `src/lib/sun-summary.ts`)

```ts
import type { TimelineSegment } from './timeline'

export type SunSummary = {
  /** Total sunny minutes across the day. */
  totalSunnyMinutes: number
  /** Coalesced sunny windows (consecutive sunny segments). */
  windows: Array<{ from: Date; to: Date }>
}

export function summarizeSunWindows(segments: TimelineSegment[]): SunSummary
```

- Filter to sunny segments, merge contiguous ones (where `prev.to.getTime() === next.from.getTime()`).
- Sum minutes across sunny windows.
- Returns `{ totalSunnyMinutes: 0, windows: [] }` for empty input.

### `parseOpeningHoursWeek` (extends `src/lib/opening-hours.ts`)

```ts
export type DayHours = {
  /** 0=Mon … 6=Sun. */
  dayIndex: number
  dayLabel: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun'
  /** Empty array = closed all day. */
  intervals: Array<{ from: string; to: string }>  // "HH:MM"
}

/**
 * Returns a 7-day breakdown for the week containing `anchor`.
 * Returns null if hours can't be parsed.
 */
export function parseOpeningHoursWeek(
  openingHours: string | null | undefined,
  anchor: Date,
): DayHours[] | null
```

Implementation:
- Parse with `opening_hours` library (same defensive try/catch).
- Compute Monday-of-week from `anchor` (local time).
- For each of 7 days: call `getOpenIntervals(dayStart, dayEnd)` — this returns `[[from, to, ...], ...]`. Map each to `HH:MM` strings.
- If parsing fails at any point, return `null`.

### Tests

Add `src/lib/opening-hours.test.ts` (if absent, create) covering:
- `minutesUntilClose`: open and closing in <60min, open with 24/7 spec → null, closed → null, missing hours → null, exactly at close → 0.
- `parseOpeningHoursWeek`: `Mo-Fr 09:00-18:00; Sa 10:00-22:00` → correct 7-day breakdown with Sun closed.
- Invalid spec → null.

Add `src/lib/sun-summary.test.ts`:
- Empty segments → `{ totalSunnyMinutes: 0, windows: [] }`.
- Single sunny segment → 1 window, correct minutes.
- Sunny → shaded → sunny → 2 windows.
- Two adjacent sunny segments → coalesced into 1 window.

## Bucket B — mobile polish

### Files

- `src/styles.css` — define `no-scrollbar` utility + `range-thumb-lg` class (Tailwind v4 `@utility` syntax).
- `src/routes/__root.tsx` — viewport meta gets `viewport-fit=cover`.
- `src/routes/index.tsx` — safe-area padding on the three overlay containers.
- `src/components/TimeSlider.tsx` — bigger Now/date buttons (`px-3 py-2 text-sm`), add `range-thumb-lg` class to range input.
- `src/components/PoiSheet.tsx` — close button to `p-2.5 min-w-11 min-h-11`, replace `break-all` with `break-words`, add backdrop sibling (`z-[35]`) and a 36×4px drag handle pill at top of card.
- `src/routes/spot.$id.tsx` — `break-all` → `break-words` on the opening-hours line. (Other detail-page edits live in Bucket C, but this single substitution is trivial enough that whichever bucket gets there first does it; mark it as Bucket B's responsibility to avoid the diff colliding.)

### `no-scrollbar` + range thumb CSS

```css
@utility no-scrollbar {
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
}

input[type="range"].range-thumb-lg::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 24px; height: 24px; border-radius: 50%;
  background: rgb(245, 158, 11); border: 2px solid white;
  box-shadow: 0 1px 2px rgba(0,0,0,0.2); cursor: pointer;
}
input[type="range"].range-thumb-lg::-moz-range-thumb {
  width: 24px; height: 24px; border-radius: 50%;
  background: rgb(245, 158, 11); border: 2px solid white;
  box-shadow: 0 1px 2px rgba(0,0,0,0.2); cursor: pointer;
}
```

### Safe-area padding (`routes/index.tsx`)

| Container | Add |
|---|---|
| FilterBar wrapper (top) | `pt-[env(safe-area-inset-top)]` |
| TimeSlider wrapper (bottom) | `pb-[env(safe-area-inset-bottom)]` |
| PoiSheet inner card | replace `pb-6` with `pb-[calc(1.5rem+env(safe-area-inset-bottom))]` |

### Sheet backdrop + drag handle (`PoiSheet.tsx`)

- Backdrop: sibling div, only rendered when `poi !== null` (component already returns null otherwise — naturally satisfied):
  ```tsx
  <div onClick={onClose} aria-hidden="true" className="fixed inset-0 z-[35] bg-slate-900/20" />
  ```
  `z-[35]` sits between the `z-30` FilterBar wrapper and the `z-40` sheet dialog, so backdrop covers the map but not the sheet.
- Drag handle inside the card, above the existing title row:
  ```tsx
  <div className="flex justify-center pt-1 pb-2">
    <div className="w-9 h-1 rounded-full bg-slate-300" aria-hidden="true" />
  </div>
  ```

## Bucket C — detail page rewrite

### Data loading change

Detail page currently only loads the POI. It needs nearby buildings to compute the sun timeline. Approach: in the route loader, after fetching the POI, fetch a small bbox of buildings around it.

Bbox: `±0.005°` lat and `±0.008°` lon around the POI (~550m × ~600m at Zürich's latitude — comfortably covers buildings whose shadows can reach the POI even when the sun is low).

Loader becomes:
```ts
loader: async ({ params }) => {
  const poi = await getPoiById({ data: { id: params.id } })
  if (!poi) return { poi: null, buildings: [] }
  const dLat = 0.005, dLon = 0.008
  const bbox: [number, number, number, number] = [
    poi.lon - dLon, poi.lat - dLat,
    poi.lon + dLon, poi.lat + dLat,
  ]
  const buildings = await getBuildingsInBbox({ data: { bbox } })
  return { poi, buildings }
}
```

### Page layout

Single-column, max-width-2xl, currently uses `p-6`. Keep that container. Replace the body with these sections in order. Each section renders only if it has data (no empty containers).

1. **Header** — name + amenity label (unchanged).
2. **Status row** — open/closed badge, closing-soon badge if `<60min`. Uses `minutesUntilClose` from Bucket A.
3. **Address + contact row** — address (existing), plus, if tags present:
   - `website` / `contact:website` → external link button (Globe icon)
   - `phone` / `contact:phone` → `tel:` link button (Phone icon)
   - "Open in Google Maps" button — same URL builder as `PoiSheet` (name + address fallback to coords).
4. **Amenity badges row** — small pill chips for each truthy/relevant tag found:
   - `outdoor_seating=yes` or `terrace=yes` → "Outdoor seating"
   - `wheelchair=yes` → "Wheelchair accessible"
   - `wheelchair=limited` → "Limited accessibility"
   - `internet_access=wlan` or `wifi=yes`/`free` → "Wifi"
   - `cuisine` → render value (lowercase, semicolons → " · ").
   Skip the row entirely if no badges apply.
5. **Description** — if `description` tag exists, render as a paragraph.
6. **Sun summary card** — sunrise/sunset for the day, total sunny minutes, and the sunny windows from `summarizeSunWindows`. Format example:
   ```
   Sunrise 06:14 · Sunset 20:43
   3h 18m of sun today
   Sunny windows: 11:14–14:32, 16:05–17:18
   ```
7. **Sun timeline** — `<SunTimeline segments={timeline} marker={t} />` where `timeline = dailyTimeline(poi, spatialIndex, buildings, t)`. `spatialIndex` comes from `buildSpatialIndex(buildings)` (import from `#/lib/shadows`); `dailyTimeline` from `#/lib/timeline`. Both `useMemo`'d on `buildings` / `t`. Replace the placeholder text with a small caption: "Yellow = sun, gray = shade. Red line marks the selected time."
8. **Hours this week** — table from `parseOpeningHoursWeek(poi.openingHours, t)`. Highlight the row for `t`'s day-of-week (not wall-clock today — consistent with how the rest of the app treats `t` as the user's chosen viewing time). Each row: day label, intervals comma-separated, or "Closed" if empty. Skip the section entirely if `parseOpeningHoursWeek` returns `null` or hours are missing.
9. **Raw opening-hours string** — small muted text under the table (`text-xs text-slate-500`), only if hours exist. Useful for power users who recognize the OSM grammar.

### Closing-soon badge in PoiSheet (also Bucket C, since it consumes Bucket A)

In `src/components/PoiSheet.tsx`, in the existing opening-hours block:
- Compute `closingIn = open ? minutesUntilClose(poi.openingHours, t) : null`.
- When `closingIn !== null && closingIn < 60`, render an amber badge next to "Open now":
  - Text: `Closing in ${closingIn} min` (or `Closing soon` if `closingIn === 0`).
  - Class: `inline-flex items-center rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-xs font-medium`.

## File-by-file change summary

| File | Bucket | Change |
|---|---|---|
| `src/lib/opening-hours.ts` | A | Add `minutesUntilClose`, `parseOpeningHoursWeek`, `DayHours` type |
| `src/lib/opening-hours.test.ts` | A | New tests for the helpers |
| `src/lib/sun-summary.ts` | A | New file: `summarizeSunWindows`, `SunSummary` type |
| `src/lib/sun-summary.test.ts` | A | Tests |
| `src/styles.css` | B | `no-scrollbar` utility + `range-thumb-lg` class |
| `src/routes/__root.tsx` | B | viewport meta gets `viewport-fit=cover` |
| `src/routes/index.tsx` | B | Safe-area padding on three overlay containers |
| `src/components/TimeSlider.tsx` | B | Bigger Now/date buttons, `range-thumb-lg` class on input |
| `src/components/PoiSheet.tsx` | B + C | B: close button size, `break-words`, backdrop, drag handle. C: closing-soon badge |
| `src/routes/spot.$id.tsx` | C | Loader fetches buildings, full body rewrite, `break-words` |

`PoiSheet.tsx` is touched by both buckets — the changes are non-overlapping (B touches the wrapper / close button / classes; C adds a single badge inside the existing hours row). Strategy: implement Bucket B first into `PoiSheet`, then Bucket C amends. Or run them on separate worktrees and merge at the end. **Recommendation:** B writes the file first, C rebases on top.

## Testing

Per-bucket:
- **A**: unit tests for the three helpers (see Bucket A "Tests" section above). `pnpm test` must pass.
- **B**: `pnpm exec tsc --noEmit` passes. Manual mobile check at viewport widths 375/414/480 — sheet sits above home indicator, FilterBar overflow has no scrollbar, range thumb is bigger, sheet backdrop dismisses.
- **C**: `pnpm exec tsc --noEmit` passes. Manual: visit `/spot/<id>` for a known cafe — verify timeline shows colors, sunny windows match the bar, hours-by-day matches the OSM string, badges render only when tags are present, closing-soon badge appears when `t` is within 60min of close.

## Risks

- **Loader build cost on `/spot/$id`** — computing the timeline is currently cheap because it only runs while a sheet is open on the home screen. Doing it on the detail page is per-page-load. Mitigation: bbox is small (~600m square), spatial index built per-render, `dailyTimeline` already step-bounds itself to sunrise→sunset.
- **OSM tag coverage is uneven** — the amenity badges and contact links will simply not render for places that lack the tags. No empty rows, no broken UI.
- **`viewport-fit=cover`** — required for `env()` insets to be non-zero on iOS Safari. Lets content extend under the notch; our overlays are absolute-positioned with intentional padding, so this is a net improvement.
- **`PoiSheet` cross-bucket edit** — addressed above with the "B then C" ordering rule.

## Parallel execution plan (preview)

The implementation plan will dispatch two waves:

**Wave 1 (parallel):**
- Agent A: Implement Bucket A (helpers + tests). Pure additions, no consumer touched yet.
- Agent B: Implement Bucket B (mobile polish, including all the `PoiSheet` non-badge edits).

**Wave 2:**
- Agent C: Implement Bucket C — needs Bucket A's exports to import, and rebases on B's `PoiSheet` changes. Adds the badge to `PoiSheet` and rewrites the spot page.

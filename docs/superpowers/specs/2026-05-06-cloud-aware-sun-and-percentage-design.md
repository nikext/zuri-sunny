# Cloud-aware sun + per-spot daily rating — design

**Date:** 2026-05-06
**Status:** Approved (pending implementation plan)

## Problem

The app currently determines "sunny" purely geometrically: SunCalc gives sun position, the shadow-worker raycasts each POI through a building index, and a marker is gold whenever no building blocks the ray (`src/lib/shadows.ts:36-69`, `src/workers/shadow-worker.ts`). On an overcast day in Zürich the city is uniformly grey but the map paints terraces gold — because the algorithm never asks the sky.

A second, related gap: the marker tells you *right now*, but not *whether this spot is generally sunny*. Two terraces both currently in the sun may have very different daily exposure profiles, and the user can't tell at a glance.

## Goals

1. **Stop lying about overcast skies.** When real-world solar exposure is low, the UI should say so.
2. **Add a per-spot sun-rating** so users can pick "good sun spots" at a glance, not just "sunny right now."
3. **Keep visual elements doing one job.** Marker color = is this spot in the sun *right now* (geometric). Marker number = how good is this spot for sun *generally today*. City-wide chip = is the sky letting sun through *right now*.
4. **Don't regress the at-a-glance scan.** Low-zoom map stays clean; the rating only appears when the user has zoomed in to a neighborhood.

## Non-goals

- Per-POI cloud variation. Cloud cover doesn't vary meaningfully across Zürich's bbox; a single city-wide signal is sufficient.
- DB schema changes. Ratings are derived; they live in worker memory and recompute cheaply.
- Multi-day forecast UX (forecast confidence indicators, "tomorrow looks better" hints). Out of scope for v1.
- Air-quality, UV index, temperature. Could be added later in the sky chip popover; not now.
- Switching map markers from deck.gl `ScatterplotLayer` to DOM markers. The `TextLayer` overlay approach keeps the existing rendering stack.

## User-facing changes

### 1. Sky chip next to the time slider

A single city-wide indicator showing the current sky state at the slider's `t`:

- ☀️ **Clear** — direct sun is reaching the ground at full or near-full intensity.
- ⛅ **Partly cloudy** — meaningful sun coming through but reduced.
- ☁️ **Overcast** — direct sun is essentially blocked.
- ⏾ **Night** — sun is below the horizon (no sky-state classification needed).

Tap → small popover showing the underlying numbers: cloud cover %, direct radiation W/m², plus today's sunrise / sunset times.

When weather data is unavailable (fetch failed, slider beyond forecast horizon), the chip is hidden and no desaturation is applied. The app degrades to today's behavior.

### 2. Sun-rating number inside markers (zoom ≥ 14)

A 0–99 integer drawn centered inside each POI circle, white text, via a deck.gl `TextLayer` over the existing `ScatterplotLayer`. Below zoom 14 the markers stay as colored dots, identical to today.

The rating is the **percent of (today's open hours ∩ daylight hours) during which the spot is geometrically sunny under clear skies**. It is:

- Stable for the day — does not change when the slider moves.
- Per-day — opening hours can vary by weekday, and the geometric sun path varies through the year, so the same POI can read 88 today and 91 tomorrow.
- Cloud-independent — the chip handles "today the sky is bad."

The `%` sign is omitted from the marker for legibility in tight pixel space.

### 3. Honest sunny markers on overcast days

When the sky chip is **Overcast**, sunny markers desaturate by ~30% — still distinguishable from grey shaded markers, but visibly less appealing. Shaded markers don't change. This is the only weather signal applied per-marker; the chip carries the rest of the nuance.

### 4. PoiSheet / detail page explanation

A short paragraph above the existing `SunTimeline`:

> "Today this spot is in direct sun for 4h 18m of its 6h open hours (72%). Estimate uses today's sunrise / sunset, opening hours, and building shadows. Doesn't account for clouds — see the sky chip for today's conditions."

Numbers come straight from `score.ts` (see below). The explanation references the chip so the user can connect the rating (clear-sky property) with the chip (today's actual sky).

## Worked examples

These are normative — they document how `score.ts` is expected to behave and serve as the basis for `score.test.ts` fixtures.

| POI                      | Open hours      | Geometry                | Daylight ∩ open | Sunny within | Rating |
|--------------------------|-----------------|-------------------------|-----------------|--------------|--------|
| Café Frühstück           | 07:00–14:00     | Mostly south-facing     | 6h 30m          | 5h 45m       | **88** |
| Bar Abendrot             | 17:00–01:00     | West-facing             | 3h 48m          | 2h 50m       | **75** |
| Café Nordseite           | 08:00–18:00     | Tall building due south | 10h 00m         | 0h           | **0**  |
| Kiosk (no opening_hours) | (fallback)      | Open plaza              | full daylight   | most of it   | varies |

Notes on the math:
- "Daylight" = sunrise → sunset, computed via SunCalc and refined by `findHorizonCrossing` (already used by `dailyTimeline`).
- "Open hours" come from `opening_hours` parsing, evaluated for today's weekday.
- "Daylight ∩ open" is the intersection. If empty (e.g., a club open 02:00–06:00 in summer when sunrise is 05:30), the rating falls back to the daylight-only window so the spot still has a meaningful number; this fallback is documented in the PoiSheet copy.
- "Sunny within" comes from the existing 15-minute step in `dailyTimeline`, summed over segments with `sunny === true` whose midpoints fall inside daylight ∩ open.
- Rating = `Math.round(100 * sunnyMs / windowMs)`, clamped to 0–99 (hard 100 reserved for an explicit "perfect sun all day" sentinel; we never need it given typical urban geometry, and 99 reads better than 100 in a small marker).

## Architecture

```
                       ┌──────────────────────────────────┐
                       │ Open-Meteo (free, no API key)    │
                       │  /v1/forecast?lat=47.37&lon=8.54  │
                       │   &hourly=cloud_cover,            │
                       │           direct_radiation        │
                       └──────────────┬───────────────────┘
                                      │ fetch (server-side only)
                                      ▼
   ┌──────────────────────────────────────────────────────────┐
   │ src/server/weather.ts                                     │
   │  - in-memory cache, 30 min TTL                            │
   │  - one fetch covers all of Zürich                         │
   │  - server fn: getSkyAt({ at: ISO }) → Sky | null          │
   └──────────────┬───────────────────────────────────────────┘
                  │ called from _app.tsx (per slider t change, debounced)
                  ▼
   ┌──────────────────────────────────────────────────────────┐
   │ Client (_app.tsx + MapDataProvider)                       │
   │  - sky:    Sky | null                                     │
   │  - rating: Record<poiId, number>                          │
   └──────────┬───────────────────────────────────┬────────────┘
              │                                   │
              ▼                                   ▼
   ┌──────────────────────┐            ┌──────────────────────┐
   │ SunMap (deck.gl)     │            │ Time slider area     │
   │  - ScatterplotLayer  │            │  - SkyChip           │
   │  - TextLayer (zoom)  │            │                      │
   │  - desat on overcast │            │                      │
   └──────────────────────┘            └──────────────────────┘
              ▲
              │ rating computed in worker
   ┌──────────┴───────────────────────────────────────────────┐
   │ src/workers/shadow-worker.ts (extended)                   │
   │  - existing 'init' / 'compute' messages: unchanged        │
   │  - NEW 'score-daily' message → Record<id, 0..99>          │
   │  - in-worker cache keyed (poiId, YYYY-MM-DD) so panning   │
   │    back doesn't recompute                                 │
   └───────────────────────────────────────────────────────────┘
```

### Why this split

- **Weather is server-side only.** Avoids browser CORS surprises, lets us cache so 200 client viewports share one fetch, and hides any future API-key swap.
- **Daily rating is computed client-side in the worker.** It needs the building rbush index, which already lives in the worker. Recomputing this on the server would require shipping building geometry to a function whose data already exists in the worker's heap.
- **No DB schema change.** Ratings are derived. The rbush + `dailyTimeline` is fast enough that a fresh batch for visible POIs runs in a few ms.
- **Day-of-year keying.** Geometric daily sun for a given POI on May 6 differs by ~23 seconds year over year — irrelevant. Cache key: `${poiId}:${YYYY-MM-DD}` where the date is **interpreted in `Europe/Zurich`** (the timezone the user thinks in and the timezone `opening_hours` evaluates against). Entries naturally expire at local midnight when `t` rolls into a new day; no timer needed.

## Files

### New

#### `src/server/weather.ts`

```ts
export type Sky = {
  state: 'clear' | 'partly' | 'overcast' | 'night'
  cloudCoverPct: number       // 0..100
  directRadiationWm2: number  // 0..1100ish
  sunAltitudeRad: number      // < 0 means night
  at: string                  // ISO, snapped to the hour we sampled
}

export const getSkyAt: (args: { at: string }) => Promise<Sky | null>
```

- Fetches `https://api.open-meteo.com/v1/forecast?latitude=47.37&longitude=8.54&hourly=cloud_cover,direct_radiation&timezone=Europe%2FZurich&forecast_days=16`.
- Module-level cache: `{ fetchedAt: number, hourly: { time: string[], cloudCover: number[], directRadiation: number[] } }`. Refresh when `Date.now() - fetchedAt > 30 * 60_000`.
- Lookup: floor `at` to the hour, find index in `hourly.time`. If outside the 16-day window, return `null`.
- Adds sun altitude via SunCalc for the night flag (`altitude < 0` → `state: 'night'`).
- Wraps the fetch in `try/catch`; on failure, returns `null` and logs once. Never throws to the client.
- Sends a `User-Agent` header (Open-Meteo doesn't require it but it's polite, and matches the project's existing convention in `src/server/overpass.ts`).

#### `src/lib/sky.ts`

```ts
export function classifySky(input: {
  cloudCoverPct: number
  directRadiationWm2: number
  sunAltitudeRad: number
}): Sky['state']
```

Pure. Thresholds:
- `sunAltitudeRad <= 0` → `'night'`.
- `directRadiationWm2 < 80` → `'overcast'`.
- `directRadiationWm2 < 350` → `'partly'`.
- else → `'clear'`.

These are tunable; the test suite pins the current thresholds.

#### `src/lib/score.ts`

```ts
export function dailyRating(
  poi: Poi,
  index: BuildingIndex,
  buildings: Building[],
  day: Date,
): number  // 0..99
```

- Computes `dailyTimeline(poi, index, buildings, day)` — already exists.
- Determines the rating window:
  - If `poi.openingHours` parses for `day`: window = `[openIntervals(day) ∩ [sunrise, sunset]]`. Multi-interval allowed.
  - Else: window = `[sunrise, sunset]`.
  - If the open-hours intersection is empty (e.g., night-only club), fall back to `[sunrise, sunset]`.
- Sums milliseconds of `sunny === true` segments whose midpoint falls inside the window. (Reusing midpoint sampling matches `dailyTimeline`'s semantics — no double-counting at boundaries.)
- Returns `Math.min(99, Math.round(100 * sunnyMs / windowMs))`.

#### `src/components/SkyChip.tsx`

A small chip + popover. Tailwind-styled to match `TimeSlider`'s aesthetic. Reads `sky` from `MapDataProvider`, renders nothing when `sky === null`. Accessible: `<button>` with `aria-label`, popover on click + Esc-to-close, focus trap not needed (single non-interactive popover).

#### Tests

- `src/lib/sky.test.ts` — table tests across the threshold boundaries and the night flag.
- `src/lib/score.test.ts` — fixtures matching the worked examples above. Each fixture builds a small synthetic `BuildingIndex` and asserts the rating to within ±1 (rounding tolerance).
- `src/server/weather.test.ts` — mocks `fetch`, verifies cache hit/miss, verifies the hour-floor lookup at arbitrary times, verifies `null` returns on fetch failure and out-of-window times.

### Touched

- `src/workers/shadow-worker.ts` — handle new `'score-daily'` inbound and emit `'rating'` outbound. In-worker `Map<string, number>` cache keyed `${poiId}:${YYYY-MM-DD}`.
- `src/lib/use-sun-status.ts` — extend the hook (or add a sibling `useDailyRating`) to dispatch `score-daily` whenever `pois`, `buildings`, or the calendar day of `t` changes; expose `rating: Record<id, number>`. Same FIFO/seq drop-stale logic as the existing compute path.
- `src/lib/types.ts` — add `Sky`, extend `WorkerInbound` with `{ type: 'score-daily', pois, day: ISO }`, extend `WorkerOutbound` with `{ type: 'rating', rating: Record<string, number> }`.
- `src/lib/map-context.ts` — add `sky: Sky | null` and `rating: Record<string, number>` to `MapData`.
- `src/routes/_app.tsx` — fetch sky via server fn (debounced on `t`); pass `sky` and `rating` through `MapDataProvider`.
- `src/components/SunMap.tsx`:
  - Add a deck.gl `TextLayer` with `getText: p => String(rating[p.id] ?? '')`, `getColor: [255,255,255,240]`, `getSize: 12`, `getPosition` matching the scatter, `visible` gated on a viewState `zoom >= 14` check.
  - In `getFillColor`, when `sky?.state === 'overcast'`, multiply the gold RGB channels by 0.7 (preserves alpha).
- `src/components/TimeSlider.tsx` — slot for `<SkyChip />` to its right or above, depending on layout fit (see Mobile section).
- `src/components/PoiSheet.tsx` and `src/routes/_app.spot.$id.tsx` — render the explanation paragraph using `dailyRating` + `summarizeSunWindows` outputs.

## Mobile / responsive considerations

- **Sky chip on narrow screens.** The current `TimeSlider` already uses the full row at the bottom on mobile. Plan: chip sits at the top-right of the time slider area on desktop; on mobile (`< 640px`) it floats top-right of the map (like a status pill), independent of the slider, so the slider keeps its full width.
- **Marker numbers on small screens.** Same zoom gate (≥ 14). At zoom 14 on a phone, markers are ~16px diameter and a 2-digit number at 11–12px renders crisply on retina; good enough.

## Edge cases & failure modes

- **Open-Meteo fetch fails / times out** — `getSkyAt` returns `null`. UI hides chip, applies no desaturation, ratings still show. App is at least as good as today.
- **Slider time past forecast horizon (16 days)** — `getSkyAt` returns `null`. Same handling as fetch fail.
- **Slider time at night** — chip shows ⏾; no desaturation logic runs (markers respect existing `altitudeRad <= 0` shaded path).
- **POI with no `opening_hours`** — `score.ts` falls back to full daylight window.
- **POI fully shadowed all day** — rating = 0; PoiSheet copy: *"This spot is in shade for all of today's open hours."*
- **POI in winter where sun never clears local geometry** — same as above, 0.
- **Worker not yet ready / buildings still loading** — `rating` is `{}`, no number rendered yet. Existing `enabled` gate in `use-sun-status` already covers this for the per-second compute; the daily-rating dispatch reuses the same gate.
- **Buildings change (panning loads new bbox)** — daily-rating cache is keyed by `poiId+date`; panning back to a previously-seen area is free. New-bbox POIs fan out a fresh batch.
- **Day rollover at midnight** — cache entries auto-expire because the `day` key changes; we don't need a timer.

## Performance budget

- **Open-Meteo fetch:** one request per 30 minutes, ~3 KB JSON. Negligible.
- **Sky lookup per slider change:** O(log N) over `hourly.time` (or O(1) with a precomputed index). The server fn does the snapping; client gets a single `Sky` object.
- **Daily rating per POI:** `dailyTimeline` already runs ~50 step-evaluations per POI per day. For ~200 visible POIs that's ~10k `isSunnyAt` calls — same order as a single slider compute. Worth it once per day per POI.
- **Worker batch:** dispatch `score-daily` only when the *calendar day* of `t` changes (not on every slider tick), so scrubbing within a day is free after the first compute.
- **TextLayer:** deck.gl batches text into a single GL draw call. Adding 200 text labels is a non-event.

## Tests

- New: `sky.test.ts`, `score.test.ts`, `weather.test.ts` (mocked fetch).
- Existing suites stay green: `geo`, `sun`, `shadows`, `timeline`, `opening-hours`, `overpass`, `sun-summary`, `projections`.
- Manual UI smoke (documented in PR description):
  1. Start dev server, scrub slider — chip changes when crossing into night, ratings stable.
  2. Zoom past 14 — numbers fade in. Zoom back out — numbers disappear.
  3. Force `direct_radiation < 80` in `weather.ts` (temporary) — confirm sunny markers desaturate, chip says ☁️.
  4. Open a known south-facing café in the sheet — rating in the 80s in May, explanation paragraph is grammatical.
  5. Disconnect network / kill the fetch — chip hidden, ratings still rendered, no console errors.

## Open questions (for implementation phase, not blockers)

- Exact desaturation factor (0.7 multiplier vs HSL adjust) — pick whichever looks better in dev.
- Exact font size and color for the marker number — 12px white likely, but verify on retina + non-retina.
- Whether the popover stays anchored to the chip on mobile or becomes a bottom sheet — implementation-time call.

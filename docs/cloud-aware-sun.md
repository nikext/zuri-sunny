# Cloud-aware sun + per-spot daily rating

This doc describes the feature that landed on `feat/cloud-aware-sun` (merged 2026-05-06). Read alongside the spec at `docs/superpowers/specs/2026-05-06-cloud-aware-sun-and-percentage-design.md` and the plan at `docs/superpowers/plans/2026-05-06-cloud-aware-sun-and-percentage.md`.

## What it does

Three user-visible additions to the home map:

1. **Sky chip (top-right)** — a single city-wide indicator of current conditions:
   - ☀️ Clear · ⛅ Partly cloudy · ☁️ Overcast · ⏾ Night
   - Tap → popover with cloud %, direct radiation (W/m²), today's sunrise/sunset.
   - Hidden silently when the upstream forecast is unavailable.
2. **Per-spot sun rating** — a 0–99 number drawn inside each marker:
   - "% of (today's open hours ∩ daylight hours) the spot is geometrically sunny under clear skies".
   - Stable for the day; doesn't move when the user scrubs the time slider.
   - Visible only when there's room: hidden below zoom 13 entirely, and at higher zooms hidden whenever any other marker is within 36px on screen (Google-Maps-style — both labels in an overlapping pair drop out, the user zooms in to disambiguate).
3. **Overcast desaturation** — when the sky chip says ☁️ Overcast, sunny markers desaturate to ~70% of full gold so they don't look misleadingly inviting. Shaded markers are unchanged.

The PoiSheet bottom sheet and the `/spot/$id` detail page each gained a one-paragraph plain-language explanation of the rating, referring users to the chip for "today's actual conditions."

## Architecture

```
   ┌────────────────────────────────────────────────────────┐
   │ Open-Meteo /v1/forecast (free, no API key)             │
   │   timezone=Europe/Zurich, hourly: cloud_cover + direct │
   └─────────────────────────┬──────────────────────────────┘
                             │ server-side fetch
                             ▼
   ┌────────────────────────────────────────────────────────┐
   │ src/server/weather.ts                                  │
   │  • 30-min in-memory cache                              │
   │  • parseZhWallTimeToUtcMs (Intl-based, DST-safe)       │
   │  • exposes fetchSky({ at, fetcher? })                  │
   │  • test seam: __resetWeatherCacheForTest               │
   └─────────────────────────┬──────────────────────────────┘
                             │ getSkyAt server fn (functions.ts)
                             ▼
   ┌────────────────────────────────────────────────────────┐
   │ src/routes/_app.tsx                                    │
   │  • debounced (250ms) sky fetch keyed on slider t       │
   │  • plumbs sky + rating through MapDataProvider         │
   └────────┬──────────────────────────────────┬────────────┘
            │                                  │
            ▼                                  ▼
   ┌──────────────────────┐         ┌──────────────────────┐
   │ SunMap (deck.gl)     │         │ SkyChip (DOM)        │
   │  • ScatterplotLayer  │         │  • renders nothing   │
   │  • TextLayer         │         │    when sky === null │
   │  • desat on overcast │         └──────────────────────┘
   │  • screen-space      │
   │    label dedup       │
   └──────────┬───────────┘
              │ ratings come from useSunStatus
              ▼
   ┌────────────────────────────────────────────────────────┐
   │ src/workers/shadow-worker.ts                           │
   │  • 'init' / 'compute' (existing, unchanged)            │
   │  • 'score-daily' → Record<id, 0..99>                   │
   │  • per-day per-POI cache keyed `${id}:${YYYY-MM-DD}`   │
   │    (date interpreted in Europe/Zurich)                 │
   └────────────────────────────────────────────────────────┘
```

### Why this split

- **Weather is server-side.** One fetch covers all viewers; CORS-free; lets us swap providers without touching the bundle.
- **Daily rating is client-side, in the worker.** It needs the rbush building index, which already lives there; pushing it server-side would require shipping geometry to a function whose data already exists in the worker's heap.
- **No DB schema change.** Ratings are derived; the `dailyTimeline` + rbush combo recomputes a batch in a few ms.
- **Day-of-year cache key.** Geometric daily sun on May 6 differs by ~23s year-over-year — irrelevant. Cache entries auto-expire when local midnight rolls into a new key.

## Files

### New
- `src/server/weather.ts` — Open-Meteo fetch + 30-min cache. DST-safe ZH→UTC conversion via `Intl.DateTimeFormat`. Returns `null` on any failure (fetch error, non-200, malformed body, out-of-window).
- `src/lib/sky.ts` — pure `classifySky({ cloudCoverPct, directRadiationWm2, sunAltitudeRad })` returning `'clear' | 'partly' | 'overcast' | 'night'`. Thresholds pinned by tests.
- `src/lib/score.ts` — pure `dailyRating(poi, index, buildings, day): number`. Computes the rating window (open hours ∩ daylight, fall back to daylight), sums sunny-segment overlap, returns `0..99`.
- `src/components/SkyChip.tsx` — DOM chip + popover with click-away + Esc-to-close. Renders nothing when `sky === null`.
- Tests: `sky.test.ts` (5), `score.test.ts` (5), `weather.test.ts` (6).

### Touched
- `src/lib/types.ts` — added `Sky`, `WorkerScoreDailyMessage`, `WorkerRatingMessage`.
- `src/workers/shadow-worker.ts` — handles `'score-daily'`, emits `'rating'`, in-worker rating cache.
- `src/lib/use-sun-status.ts` — exposes `rating` in addition to `sunny`. Re-dispatches `score-daily` when the calendar day in `Europe/Zurich` changes (scrubbing within a day is free).
- `src/lib/map-context.ts` — `sky` and `rating` plumbed through `MapData`.
- `src/routes/_app.tsx` — debounced sky fetch + provider wiring + `<SunMap>` props.
- `src/components/SunMap.tsx` — `TextLayer` for ratings, overcast color desaturation, screen-space label dedup.
- `src/routes/_app.index.tsx` — places `<SkyChip>`, passes `rating` into `<PoiSheet>`.
- `src/components/PoiSheet.tsx` — rating-explanation paragraph.
- `src/routes/_app.spot.$id.tsx` — same paragraph, computed inline.
- `src/server/functions.ts` — `getSkyAt` server fn (5-min `cache-control` + 30-min `stale-while-revalidate`).

## Tunables (one-line tweaks)

| Constant | File | Default | Effect |
|---|---|---|---|
| `directRadiationWm2 < 80` → overcast | `src/lib/sky.ts` | 80 W/m² | Lower = stricter "overcast" trigger |
| `directRadiationWm2 < 350` → partly | `src/lib/sky.ts` | 350 W/m² | Boundary between partly cloudy and clear |
| `TTL_MS` | `src/server/weather.ts` | 30 min | How long the Open-Meteo response is cached |
| `cache-control` on `getSkyAt` | `src/server/functions.ts` | `max-age=300, swr=1800` | Browser cache lifetime |
| `RATING_HARD_HIDE_ZOOM` | `src/components/SunMap.tsx` | 13 | Below this zoom, all labels hidden |
| `MIN_LABEL_DIST_PX` | `src/components/SunMap.tsx` | 36 | Min screen-space gap between two labels — both hide if closer |
| Desaturation factor | `src/components/SunMap.tsx` | × 0.7 | Multiplier on gold RGB when overcast |
| Sky-fetch debounce | `src/routes/_app.tsx` | 250 ms | Slider-scrub coalescing window |

## Edge cases handled

- **Open-Meteo down / non-200 / malformed JSON** → `getSkyAt` returns `null`. UI hides chip, no desaturation, ratings still show. App degrades to pre-feature behavior.
- **Slider past forecast horizon (16 days out)** → `getSkyAt` returns `null`. Same.
- **Night** → the chip shows ⏾, no desaturation runs, rating is unchanged (it's a property of the day, not the moment).
- **POI without `opening_hours`** → rating uses full daylight window.
- **POI with night-only hours that don't overlap daylight** → rating falls back to full daylight (still a useful signal).
- **POI fully shadowed all day** → rating = 0; PoiSheet copy: *"In shade for all of today's open hours."*
- **Buildings change (panning loads a new bbox)** → rating cache cleared in `useSunStatus`; worker rebuilds its index and the per-day cache.
- **Day rollover at midnight** → cache keys naturally change, no timer needed.
- **DST transitions** → handled via `Intl.DateTimeFormat({ timeZone: 'Europe/Zurich' })`, no manual offset math.

## Label dedup behavior (the subtle part)

The TextLayer renders only POIs in `visibleLabelIds`. That set is computed in the layer-push effect:

1. Bail entirely if `zoom < RATING_HARD_HIDE_ZOOM` (13).
2. Project every POI to pixel coords via `map.project([lon, lat])`.
3. Bucket projections into `MIN_LABEL_DIST_PX × MIN_LABEL_DIST_PX` cells.
4. For each POI, walk its own cell + 8 neighbours and compare squared pixel distance against `MIN_LABEL_DIST_PX²`. If any other POI is within range → drop the label.

Both members of an overlapping pair lose their label (deliberate: the user shouldn't see an arbitrary "winner"; they zoom in to read both). This recomputes on `move` (rAF-throttled) and `zoom`.

## Local verification

```bash
pnpm install
pnpm test                # 74 tests should pass
pnpm run build           # production build sanity-check
pnpm run dev             # http://localhost:3000
```

Manual smoke (with network ENABLED for `api.open-meteo.com`):
1. Page loads, dots appear within ~1 s.
2. ~250 ms after first paint, the sky chip appears top-right.
3. Tap the chip → popover with cloud %, direct W/m², sunrise/sunset.
4. Zoom to 14+ → numbers fade in inside markers; dense clusters drop their labels.
5. Pan into a sparser area → more numbers survive.
6. Drag the time slider → marker colours update; numbers do NOT (rating is a daily property).
7. Click a marker → bottom sheet shows the rating-explanation paragraph above the sun-status line.
8. Open `/spot/<id>` → the same explanation appears above the sun timeline.

Manual smoke (with network DISABLED for `api.open-meteo.com`):
9. Sky chip is hidden, no console errors. Markers and numbers still render.

## Production verification

After deploy, watch for in the logs:
- `[init] migrations applied` and `[init] seeded N pois, M buildings` (or `data fresh`).
- One Open-Meteo fetch per ~30 min per server process — confirm by tailing logs and counting outbound requests.

In the browser:
- Chip appears within ~250 ms of first paint.
- DevTools Network tab → `getSkyAt` server-fn call returns ~200 with a JSON body (or `null` if Open-Meteo is down — UI handles that gracefully).

## Known limitations / future work

- **Per-POI cloud cover** is not modelled. Cloud cover doesn't vary meaningfully across Zürich's bbox, so a single city-wide signal is fine — but if the feature ever extends beyond a single city, the chip-style approach would no longer hold.
- **Forecast confidence past T+24h** isn't surfaced in the UI. If the slider is dragged days into the future, the chip shows the forecast as if it were certain. The spec lists this as deferred; a "forecast" badge past T+24h would be a small follow-up.
- **`MIN_LABEL_DIST_PX`** is a single global value. A density-aware variant (smaller gap in sparse zoom levels) would be slightly nicer at zoom 14 in residential areas.
- **Air quality / UV / temperature** could naturally extend the chip popover but are out of scope here.
- **Historical mode** — Open-Meteo's free API also serves historical hourly data. We could let the user scrub backwards in time and see "the rating you'd have got" — but that's a feature, not a bug fix, so deferred.

## Tests

Pure-function suites (run in node env):
- `src/lib/sky.test.ts` — threshold table, including the "night flag wins over high radiation" defensive case.
- `src/lib/score.test.ts` — open-plaza max rating, fully-shadowed minimum, opening-hours window scoping, daylight fallback for night-only hours, unparseable hours fallback.
- `src/server/weather.test.ts` — hour snap, cache hit/miss, out-of-window null, fetch-throws null, non-200 null, classification via sun altitude.

Worker glue is verified by manual smoke; the heavy lifting (`dailyRating`) is tested directly without the worker boundary.

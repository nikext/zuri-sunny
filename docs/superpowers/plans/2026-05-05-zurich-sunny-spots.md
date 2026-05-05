# Zürich Sunny Spots — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a map-based web app showing Zürich cafés/bars/restaurants with outdoor seating that are currently in the sun (or will be at a chosen time), backed by SQLite + a single Node process, deployed on Railway.

**Architecture:** TanStack Start (Vite + SSR + server functions) talks to a local SQLite DB via Drizzle. POIs and building footprints are fetched from OSM Overpass at cold start and refreshed weekly. The browser pulls viewport-bounded data, then a Web Worker raycasts sun/shadow per POI and recolors markers in real time as the user scrubs the time slider. Heavy compute is client-side; the server is essentially a static-data API.

**Tech Stack:** TanStack Start, TanStack Router, TanStack Query, better-sqlite3, drizzle-orm, suncalc, rbush, MapLibre GL JS, deck.gl, opening_hours, TypeScript, npm. Hosting: Railway with a persistent volume.

**Deviations from PRD:**
- **Hosting:** Railway (not Fly.io). Persistent volume mounted at `/data`, region close to Zürich.
- **Package manager:** npm (pnpm not available locally; lockfile compat is fine on Railway).

---

## File Structure

```
.
├── src/
│   ├── routes/
│   │   ├── __root.tsx          # shell, MapLibre + deck.gl CSS
│   │   ├── index.tsx           # map view + slider + filters
│   │   └── spot.$id.tsx        # POI detail page
│   ├── server/
│   │   ├── db/
│   │   │   ├── client.ts       # better-sqlite3 + drizzle init, /data path
│   │   │   └── schema.ts       # pois, buildings, cache_meta
│   │   ├── overpass.ts         # Overpass fetch + transform (POIs + buildings)
│   │   ├── refresh.ts          # cold-start seed + weekly setInterval
│   │   └── functions.ts        # createServerFn handlers
│   ├── lib/
│   │   ├── sun.ts              # SunCalc wrapper, azimuth conversion
│   │   ├── shadows.ts          # raycasting, isSunnyAt
│   │   ├── geo.ts              # haversine, bearing, line-poly intersect, movePoint
│   │   ├── opening-hours.ts    # opening_hours wrapper
│   │   └── timeline.ts         # daily 15-min sunny/shaded timeline
│   ├── workers/
│   │   └── shadow-worker.ts    # owns rbush index + computes per-POI status
│   ├── components/
│   │   ├── SunMap.tsx          # MapLibre + deck.gl 3D buildings + markers
│   │   ├── TimeSlider.tsx      # slider, sunrise/sunset bounds, search params
│   │   ├── FilterBar.tsx       # category chips
│   │   ├── PoiSheet.tsx        # bottom sheet
│   │   └── SunTimeline.tsx     # bar chart
│   └── styles/
│       └── globals.css
├── data/                        # gitignored, local dev SQLite
├── drizzle/migrations/
├── drizzle.config.ts
├── vite.config.ts
├── Dockerfile                   # for Railway
├── railway.json                 # Railway service config
├── package.json
└── README.md
```

---

## Phase A — Foundation (sequential, single context)

Scaffold + install + DB schema + base routing. Must complete before parallel agents launch, because every later agent needs the project layout to exist.

- [ ] **A1: Scaffold TanStack Start project**
  - Use `npm create @tanstack/start@latest` non-interactively into `.`, accept TypeScript, file-based router.
  - If interactive, manually create the minimal scaffold matching TanStack Start docs.
- [ ] **A2: Install runtime deps**
  - `npm i better-sqlite3 drizzle-orm suncalc rbush maplibre-gl deck.gl @deck.gl/mapbox @deck.gl/layers opening_hours`
- [ ] **A3: Install dev deps**
  - `npm i -D drizzle-kit @types/better-sqlite3 @types/suncalc @types/rbush vitest @types/node`
- [ ] **A4: Create `drizzle.config.ts`** pointing at `./src/server/db/schema.ts` and `./drizzle/migrations`, with `dbCredentials.url = process.env.DB_PATH ?? './data/zurich.db'`.
- [ ] **A5: Create `src/server/db/schema.ts`** with `pois`, `buildings`, `cacheMeta` per PRD §6, plus indices.
- [ ] **A6: Create `src/server/db/client.ts`** that opens better-sqlite3 at `process.env.DB_PATH ?? './data/zurich.db'` (mkdir -p the parent dir), wraps in drizzle, exports `db`.
- [ ] **A7: Generate + run initial migration** with drizzle-kit; commit migration files.
- [ ] **A8: Set up vitest** in `vite.config.ts` (or `vitest.config.ts`) with `globals: true`, jsdom env for component tests.
- [ ] **A9: Add `data/` to `.gitignore`**, plus `.env`, `.env.local`.
- [ ] **A10: Stub the routes** (`__root.tsx`, `index.tsx`, `spot.$id.tsx`) so the project builds.
- [ ] **A11: Confirm `npm run dev` starts the server and serves an empty page; commit baseline.**

---

## Phase B — Libs & Data Layer (parallel agents, batch 1)

Once Phase A is committed, dispatch four agents in parallel. Each agent owns a disjoint set of files. **No agent edits files outside its list.**

### Agent B1 — Geo math & sun position
**Owns:** `src/lib/geo.ts`, `src/lib/sun.ts`, `src/lib/geo.test.ts`, `src/lib/sun.test.ts`

Required exports & behavior:
- `haversine(a: LatLon, b: LatLon): number` — meters between two points.
- `bearingRad(from: LatLon, to: LatLon): number` — initial bearing radians, 0=N, clockwise.
- `movePoint(from: LatLon, bearingRad: number, distanceM: number): LatLon` — destination point on great circle.
- `lineSegmentIntersection(p1, p2, p3, p4): LatLon | null` — returns intersection of segments [p1,p2] and [p3,p4] using planar approximation (Zürich span <10km, fine).
- `lineIntersectsPolygon(line: [LatLon, LatLon], polygon: LatLon[]): { point: LatLon } | null` — returns the intersection nearest to `line[0]`, or null.
- `bboxOf(points: LatLon[], paddingM: number): [west, south, east, north]`.
- `LatLon = { lat: number; lon: number }`.

In `sun.ts`:
- `getSunPosition(t: Date, lat: number, lon: number): { altitudeRad: number; azimuthRad: number }` — wraps SunCalc, **converts azimuth from "radians from south, west-positive" to compass radians (0=N, clockwise, range [0, 2π))**.
- `getSunTimes(t: Date, lat: number, lon: number): { sunrise: Date; sunset: Date }`.

Tests must cover: known distances (Zürich HB → ETH ≈ 600m), known bearings (north, east), polygon intersect hits/misses, sun azimuth at noon points roughly south.

### Agent B2 — Shadow raycasting & worker
**Owns:** `src/lib/shadows.ts`, `src/lib/shadows.test.ts`, `src/workers/shadow-worker.ts`

Required exports:
- `type Building = { id: string; footprint: [number, number][]; heightM: number; minLat; maxLat; minLon; maxLon }`.
- `type Poi = { id: string; lat: number; lon: number }`.
- `buildSpatialIndex(buildings: Building[]): RBush` — rbush over building bboxes; the indexed item carries the building reference.
- `isSunnyAt(poi: Poi, index: RBush, buildings: Building[], t: Date, opts?: { rayLengthM?: number }): boolean`. Default 500m ray. Uses `lib/geo.ts` and `lib/sun.ts`. Returns false at altitude ≤ 0.
- Worker (`shadow-worker.ts`) message protocol:
  - `{ type: 'init', buildings }` → builds rbush, replies `{ type: 'ready' }`.
  - `{ type: 'compute', pois, t }` (t as ISO string) → replies `{ type: 'result', sunny: Record<id, boolean> }`.
  - Worker is a module worker (`type: 'module'`).

Tests (in node env, not jsdom): mock buildings forming a box south of a POI at noon → POI shaded; remove the box → POI sunny; altitude ≤ 0 → always shaded.

### Agent B3 — Overpass fetcher & refresh
**Owns:** `src/server/overpass.ts`, `src/server/refresh.ts`, `src/server/overpass.test.ts`

Required exports:
- `fetchPois(): Promise<PoiRow[]>` — runs the POI Overpass query from PRD §5.1, parses `out center tags`, normalizes to schema rows. ID format `node/<id>` or `way/<id>` or `relation/<id>`.
- `fetchBuildings(): Promise<BuildingRow[]>` — runs the building query, extracts `out geom`, derives `heightM` via fallback chain (`height` → `building:levels * 3` → 10), computes bbox per row.
- `seedIfEmpty(db): Promise<void>` — checks `pois` count; if 0 runs both fetches, inserts in transactions, writes `cache_meta`.
- `startRefreshLoop(db, intervalMs = 7*24*3600*1000): () => void` — `setInterval`, returns stop fn. Use `unref()` so Node can still exit.

Use the public Overpass instance `https://overpass-api.de/api/interpreter` with a 60–120s timeout. Wrap with retry-once on transient failures. Tests mock `fetch` and assert the SQL inserts.

### Agent B4 — Opening hours, timeline, server functions
**Owns:** `src/lib/opening-hours.ts`, `src/lib/timeline.ts`, `src/server/functions.ts`, plus tests

Required exports:
- `isOpenAt(oh: string | null, t: Date): boolean` — wraps `opening_hours` library; null/invalid → returns true (treat as unknown = assume open).
- `nextStateChange(oh: string | null, t: Date): Date | null`.
- `dailyTimeline(poi, index, buildings, day: Date): Array<{ from: Date; to: Date; sunny: boolean }>` — 15-min steps from sunrise to sunset, merge consecutive equal states.
- Server functions: `getPoisInBbox`, `getBuildingsInBbox`, `getPoiById`, `refreshData` (auth gate is a no-op for v1).

Bbox queries use the indexed columns. `getBuildingsInBbox` returns rows where the bbox overlaps the request bbox (standard 4-way comparison).

---

## Phase C — UI Components (parallel agents, batch 2)

Dispatch after Phase B is reviewed and committed. Each agent owns disjoint component files.

### Agent C1 — `SunMap.tsx`
**Owns:** `src/components/SunMap.tsx`

Props: `{ pois, buildings, sunny: Record<id, boolean>, openNow: Record<id, boolean>, onSelect(id) }`. Renders a MapLibre map (free OSM raster tiles or `https://tiles.openfreemap.org/styles/positron`) with deck.gl overlay: `PolygonLayer` for buildings (extruded by `heightM`, opacity 0.15), `ScatterplotLayer` for POIs colored gold/gray/faded. Center 47.3769, 8.5417, zoom 14. Loads viewport data via `getPoisInBbox` + `getBuildingsInBbox` on `moveend`.

### Agent C2 — `TimeSlider.tsx` + `FilterBar.tsx`
**Owns:** `src/components/TimeSlider.tsx`, `src/components/FilterBar.tsx`

`TimeSlider`: range = sunrise→sunset of the displayed day, value = current `t`, debounced onChange (50ms). Includes a date picker for non-today. Reads/writes `?t=<iso>` search param via TanStack Router.

`FilterBar`: chips for `breakfast | coffee | lunch | apero | all` mapped to amenity+cuisine heuristics (e.g., breakfast = cafe before 11; coffee = cafe; lunch = restaurant 11-15; apero = bar/restaurant 16-20). Reads/writes `?cat=<value>` search param.

### Agent C3 — `PoiSheet.tsx` + `SunTimeline.tsx` + spot route
**Owns:** `src/components/PoiSheet.tsx`, `src/components/SunTimeline.tsx`, `src/routes/spot.$id.tsx`

`PoiSheet`: bottom sheet with name, address (from `tags.addr:*`), `opening_hours`, "Sunny until HH:MM" computed from the timeline, Google Maps link, "More details" → `/spot/$id`.

`SunTimeline`: SVG/canvas bar chart of the daily timeline, gold/gray/blue (night).

`spot.$id.tsx`: hero, timeline, hours, small map snippet, back-link that preserves `?t` and `?cat`.

### Agent C4 — Worker integration hook
**Owns:** `src/lib/use-sun-status.ts`

Hook that owns the worker lifecycle:
- Creates one shared worker per page.
- Sends `init` when buildings change.
- Debounces `compute` calls when `pois` or `t` change (50ms).
- Returns `Record<id, boolean>`.

---

## Phase D — Integration (sequential, single context)

- [ ] **D1: Wire `index.tsx`** — fetch POIs + buildings via TanStack Query, drive `useSunStatus`, pass to `SunMap`, render `TimeSlider`, `FilterBar`, `PoiSheet`.
- [ ] **D2: Cold-start hook** — call `seedIfEmpty` from server entry; start `startRefreshLoop` once.
- [ ] **D3: URL state** — confirm `?t` and `?cat` round-trip and shareable links work.
- [ ] **D4: Run `npm run build`** — fix any TS or build errors. **Do not skip TypeScript errors.**
- [ ] **D5: Smoke test in browser** — open dev server, drag slider, click a POI, navigate to detail, return.
- [ ] **D6: Commit integration.**

---

## Phase E — Railway Deployment

- [ ] **E1: Dockerfile** — multi-stage Node 22-alpine build. Final stage runs `node` with the built server. Install build deps for `better-sqlite3` (python3, make, g++) in builder stage only.
- [ ] **E2: `railway.json`** — set `deploy.startCommand` to `node .output/server/index.mjs` (or whatever TanStack Start emits), `numReplicas: 1`, `restartPolicyType: ON_FAILURE`.
- [ ] **E3: Persistent volume** — document Railway dashboard step: create a volume mounted at `/data`. Set `DB_PATH=/data/zurich.db` env var.
- [ ] **E4: README** — local dev, env vars (`DB_PATH`), Railway deployment steps, refresh trigger.
- [ ] **E5: Verify Docker build locally** — `docker build .` succeeds.
- [ ] **E6: Commit deploy config.**

---

## Self-Review Checklist

- Spec coverage: every PRD §3-§14 item has a task, except v2 items in §15.
- No placeholders: every file has a defined owner, exports, and acceptance criteria.
- Type consistency: `LatLon`, `Building`, `Poi` types used uniformly across geo/shadows/worker.
- Parallel safety: each batch's agents own disjoint file sets; integration happens between batches.

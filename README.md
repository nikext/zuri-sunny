# Zürich Sunny Spots

Explore at: [zuri-sunny-286937397059.europe-west6.run.app](https://zuri-sunny-286937397059.europe-west6.run.app)

A web app that shows which Zürich cafés, bars, and restaurants with outdoor seating are currently in the sun — or will be at a chosen time. POIs and building footprints come from OpenStreetMap; sun position from SunCalc; shadow occlusion is raycast in a Web Worker on the client.

Built with TanStack Start (Vite + Nitro), Drizzle + better-sqlite3, MapLibre GL + deck.gl. Deploys to Google Cloud Run as a single Node container with the SQLite data baked into the image.

## Screenshots

![Zürich Sunny Spots screenshot 1](./public/Screenshot1.png)

![Zürich Sunny Spots screenshot 2](./public/Screenshot2.png)

![Zürich Sunny Spots screenshot 3](./public/Screenshot3.png)

## Local development

```bash
pnpm install
pnpm run dev
```

Open [http://localhost:3000](http://localhost:3000). On the very first request, the server will:

1. Apply Drizzle migrations to `./data/zurich.db`.
2. Fetch all Zürich POIs and building footprints from the public Overpass API (~30–60s, blocking on the seed not the first response — the page renders immediately, data appears once seed completes).

To clear the local DB and force a re-seed:

```bash
rm -f data/zurich.db data/zurich.db-shm data/zurich.db-wal
```

## Tests

```bash
pnpm test
```

Vitest runs the geo / sun / shadow / Overpass / opening-hours / timeline suites — 35 tests across 6 files.

## Architecture

- **Server (TanStack Start + Nitro):** server functions in `src/server/functions.ts` for `getPoisInBbox`, `getBuildingTile`, `getBuildingsInBbox`, `getPoiById`, `getSkyAt`, `refreshData`. SQLite lives at `process.env.DB_PATH ?? ./data/zurich.db`. Seed and weekly refresh loop bootstrap on first server-function call (`src/server/init.ts`).
- **Client:** the home route fetches viewport-bounded POIs, and buildings in fixed ~1.1 km grid tiles (`src/lib/tiles.ts`, `src/lib/use-building-tiles.ts`) covering the viewport plus 300 m, since shadows come from outside it. Tiles are cached, so panning only fetches new ones; past 64 tiles the map asks the user to zoom in. Both go to a Web Worker (`src/workers/shadow-worker.ts`) along with the current time. The worker raycasts each POI toward the sun bearing through an rbush index of building footprints and reports back a `{ id → sunny? }` map. Marker colors update in real time as the user drags the slider.
- **Where sun is measured:** ~95% of POIs are mapped as a point inside their own building, where a ray always hits the building's own wall. `sunAnchor` (`src/lib/shadows.ts`) moves such a POI to 2.5 m outside the nearest facade that faces open space (not a party wall) — roughly where the terrace is — and markers are drawn there.
- **3D map:** deck.gl over MapLibre, tilted by default (2D/3D toggle, a shadows toggle and a compass with the sun's direction on the right). Buildings are lit by a `_SunLight` at the slider time and cast real shadows onto a transparent ground layer, so the shadows move as you scrub; overcast skies and night switch to soft, shadowless light. Shadows start off on phones and low-memory devices (the choice is remembered), and rendering is capped at 2× pixel density.
- **Buildings:** OSM ways plus multipolygon relations, whose split outer ways are joined into rings and whose inner rings are kept as courtyards (`holes`), used both for rendering and raycasting. Height comes from `height`, else `building:levels` (+ half of `roof:levels`) × 3 m, else the median storey count for that `building=*` type in Zürich (`src/server/overpass.ts`).
- **Time zone:** all times, opening hours and calendar days are Zürich wall-clock (`src/lib/zurich-time.ts`), whatever the device's or server's timezone.
- **Categories:** Breakfast / Lunch / Apéro also require the place to be open during that meal's window on the selected day (`src/lib/categories.ts`).
- **URL state:** `?t=<ISO>` and `?cat=<category>` round-trip through TanStack Router search params for shareable links.

## Deploy to Google Cloud Run

Production runs on Cloud Run (`europe-west6`, Zürich). The `Dockerfile` builds the app and then runs `pnpm run seed` (`scripts/seed.ts`), which fetches Zürich's POIs and buildings from Overpass (with retries) and bakes them into `./data/zurich.db` inside the image. Cloud Run instances have no persistent disk, so this lets every cold start serve data immediately; the runtime staleness check in `src/server/init.ts` still refreshes it in the background, and every redeploy picks up fresh data.

```bash
gcloud run deploy zuri-sunny --source . --region europe-west6 --port 3000 \
  --memory 1Gi --cpu 1 --min-instances 0 --max-instances 1 --cpu-boost \
  --allow-unauthenticated
```

`--source .` builds the `Dockerfile` with Cloud Build and pushes the image to Artifact Registry. Leave `DB_PATH` unset so the baked database is used.

Overpass often rate-limits Cloud Build's IPs (429/504). If you have a local `./data/zurich.db` (from `pnpm run dev` or `pnpm run seed`), it is uploaded with the source (`.gcloudignore`) and reused by the build; it is only re-fetched when older than 3 days, and a failed re-fetch keeps the bundled data. Without a local database the build fetches everything and fails if Overpass stays down. Checkpoint the WAL first if a dev server has it open: `node -e "new (require('better-sqlite3'))('data/zurich.db').pragma('wal_checkpoint(TRUNCATE)')"`.

## Deploy to Railway (alternative)

1. Push this repo to GitHub.
2. [https://railway.com/new](https://railway.com/new) → "Deploy from GitHub repo" → pick this repo. Railway detects `nixpacks.toml` and builds with `pnpm install --frozen-lockfile && pnpm run build` on Node 24.
3. **Provision a volume** for the SQLite database:
  - In the service, click **Settings → Volumes → New volume**.
  - Mount path: `/data`. Pick any size; <100MB is sufficient (current data is ~50MB).
4. **Set environment variables** under the Variables tab:
  - `DB_PATH=/data/zurich.db`
5. Deploy. The first cold start runs migrations and seeds the DB from Overpass (logs print `[init] seeded N pois, M buildings` when complete).

The default `railway.json` requests 1 replica with `ON_FAILURE` restart policy and a `/` healthcheck.

## Project layout

```
src/
  routes/          file-based TanStack Router routes
  components/      SunMap, TimeSlider, FilterBar, PoiSheet, SunTimeline
  lib/             geo / sun / shadows / opening-hours / timeline / use-sun-status
  server/          functions, overpass, refresh, init, db (drizzle schema + client)
  workers/         shadow-worker (module worker)
drizzle/migrations/ generated SQL migrations
data/              local SQLite (gitignored)
```

## Tech notes

- The `opening_hours` library wraps OSM-style opening hours strings; we treat `null` / unparseable as "open".
- `better-sqlite3` ships prebuilds for Node 22/24 on Linux x64; `python3` + `build-essential` are included in the Dockerfile as a fallback for source builds.
- deck.gl's experimental shadows use one shadow map the size of the canvas for the whole view, so in a steeply tilted view the far edges get jagged. Keep the lighting a single `LightingEffect` instance: swapping to an effect without shadows after one with them leaves layers unable to draw.
- MapLibre's CJS named exports break Vite SSR — the map component imports `maplibregl` as default and uses a `mounted` gate so the map only initializes client-side.
- Overpass blocks Node's default user agent — `src/server/overpass.ts` sends an explicit `User-Agent`.
- `nitro-nightly` is pinned (not `@latest`) — recent 4.x nightlies broke the SSR self-fetch pattern. See `docs/prod.md`.

For the full deployment journey — what broke on Railway, why, and how it was fixed — see `[docs/prod.md](./docs/prod.md)`.

For the cloud-aware sun + per-spot daily rating feature (sky chip, marker numbers, overcast desaturation), see `[docs/cloud-aware-sun.md](./docs/cloud-aware-sun.md)`.






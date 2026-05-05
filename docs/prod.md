# Production / Deployment Notes

Hard-won lessons from getting this app onto Railway. Each item is here because we hit it and the fix wasn't obvious from a stack trace.

## Stack-specific gotchas

### Pin `nitro-nightly` — don't use `@latest`

Symptom: production server enters a self-fetch loop (`GET /` → server makes an outbound HTTPS request to its own public URL → Railway's edge returns HTTP 431 → undici parser blows up with `UND_ERR_HEADERS_OVERFLOW` → recursion).

Root cause: `nitro-nightly@4.0.0-20251010-091516-7cafddba` replaces `globalThis.fetch` with a wrapper. The bundled SSR renderer is literally:
```js
function ssrRenderer({ req }) { return fetch(req, { viteEnv: "ssr" }) }
```
The wrapper was supposed to read `init.viteEnv` and route internally but doesn't. So every request becomes a real HTTPS fetch to `req.url`.

Fix: pin to a 3.x nightly in `package.json`:
```json
"nitro": "npm:nitro-nightly@3.0.1-20260505-131157-aee73f19"
```
The 3.x build uses a `lazyService` SSR pattern that doesn't touch `globalThis.fetch`.

How we found it: `node --require <wrapper>` script that monkey-patched `globalThis.fetch` to log every URL with a stack trace — within one request the logs printed thousands of self-fetches with the call site at `nitroFetch (.output/server/index.mjs:1998)` and `ssrRenderer (.output/server/index.mjs:2338)`.

### Server-only imports leak into the client bundle from top-level side effects

Symptom: white screen in production. Browser console shows `Module "util"/"fs" has been externalized for browser compatibility. Cannot access "util.promisify" / "fs.access"`. React never mounts.

Root cause: a top-level `ensureServerStarted()` call in `src/server/functions.ts`. Even though TanStack Start's compiler strips `createServerFn` *handler bodies* from the client, top-level statements run on both sides — that side-effecting call dragged `init.ts → db/client.ts → better-sqlite3` (with its `node:fs` / `node:util` deps) into the client bundle.

Fix: move every Node-only import inside handler bodies as `await import(...)`. Top-level imports in a server-fn file should be limited to `createServerFn` itself.

Verify by curl-ing the compiled chunk for the server-fn file:
```bash
curl http://localhost:3000/src/server/functions.ts | head -20
```
Expect to see only `createServerFn` + `createClientRpc` imports, with handler bodies replaced by `createClientRpc(<base64-id>)` stubs.

### MapLibre's CJS named exports break Vite SSR

Symptom: server-rendered home page emits `Switched to client rendering because the server rendering errored: Named export 'Map' not found. The requested module 'maplibre-gl' is a CommonJS module`.

Fix: in `SunMap.tsx`, use the default import for the runtime, type-only imports for types:
```ts
import maplibregl from 'maplibre-gl'
import type { Map as MapLibreMap, IControl } from 'maplibre-gl'
// then: new maplibregl.Map(...)
```
Plus a `mounted` gate so the map only initializes client-side (returns `<div className="w-full h-full" />` on SSR).

### Overpass blocks Node's default User-Agent

Symptom: cold-start seed throws `Overpass HTTP 406` from `src/server/refresh.ts → seedIfEmpty`.

Fix: send an explicit `User-Agent` (and `Accept: application/json`) in `src/server/overpass.ts`. Curl from the same machine works fine because curl sets a UA; Node's fetch doesn't by default.

### TanStack Devtools should not render in production

Devtools modules can do unexpected things server-side and they bloat the bundle. Gate them in `__root.tsx`:
```ts
const TanStackDevtools = import.meta.env.DEV
  ? lazy(() => import('@tanstack/react-devtools').then((m) => ({ default: m.TanStackDevtools })))
  : null
```

## Railway specifics

### Lockfile must match the package manager

The TanStack Start scaffold ships `nixpacks.toml` set up for `npm ci`. If you switch to pnpm locally (committing `pnpm-lock.yaml`), `npm ci` will fail on Railway because `package-lock.json` drifts from `package.json` after pnpm-managed updates. Pick one:

- **Stay on npm:** delete `pnpm-lock.yaml`, regenerate `package-lock.json`, keep nixpacks defaults.
- **Switch to pnpm (this repo's choice):** delete `package-lock.json`, gitignore it, configure nixpacks to use pnpm.

This repo uses pnpm — see `nixpacks.toml` (which is a fallback; the active builder is the `Dockerfile`).

### Node version

`nodejs_22` in Railway's nixpkgs snapshot resolves to **22.11**, but TanStack Start, vite 8, and rolldown require **>=22.12**. The fix is a `Dockerfile` based on `node:24-slim` rather than nixpacks — that snapshot doesn't have `nodejs_24` available either, so trying to use it via nixpacks throws `undefined variable 'nodejs_24'`.

Dockerfile builder is selected via `railway.json`:
```json
{ "build": { "builder": "DOCKERFILE", "dockerfilePath": "Dockerfile" } }
```

### Railway can strip `NODE_OPTIONS`

If you need a Node CLI flag (e.g., `--max-http-header-size`), put it directly in the `start` script in `package.json`:
```json
"start": "node --max-http-header-size=65536 .output/server/index.mjs"
```
Setting `NODE_OPTIONS` via `ENV` in the Dockerfile or via Railway's Variables UI is unreliable — some platforms strip it for security, and the log won't show the flag in the `$ node ...` line if it didn't take effect.

### Volume + DB_PATH

For SQLite to survive deploys:
1. Service Settings → Volumes → New volume, mount path `/data`.
2. Variables → `DB_PATH=/data/zurich.db`.
3. `src/server/db/client.ts` reads `process.env.DB_PATH`; `mkdirSync(dirname, { recursive: true })` handles the directory creation on first boot.

### Build/Start Command UI fields

Leave them **blank** in Railway when using a `Dockerfile`. The Dockerfile's `RUN`/`CMD` and `railway.json`'s `startCommand` cover both. UI-set commands override `railway.json` and re-trigger broken legacy flows.

### Healthcheck

`railway.json` sets `healthcheckPath: "/"` with a 30s window. Don't tighten this until the seed step is fast — first cold start runs Overpass (`fetchPois` + `fetchBuildings`) which can take ~30–60s and the home page won't render markers until those rows land.

## Server bootstrap pattern

`src/server/init.ts` is idempotent and retry-friendly:
- migrations run **once** (synchronous via better-sqlite3)
- weekly refresh loop starts **once** (`setInterval(...).unref()`)
- seed is attempted **lazily on each request until the DB has rows** — so a transient Overpass failure during the very first request doesn't permanently leave the DB empty

Each `createServerFn` handler does `ensureServerStarted()` first. The function checks flags so subsequent calls are near-instant.

## Data refresh & recovery

The server pulls POIs + buildings from Overpass three ways, in order of priority:

1. **Cold seed** (`seedIfEmpty`) — first request after a fresh deploy with an empty DB. Runs once per process lifetime if the DB is empty.
2. **Startup refresh** — on the first request after deploy, if existing data is older than 6 hours (`STALE_AGE_MS` in `init.ts`), `refreshAll()` fires in the background. Server responds immediately with old data; subsequent requests get fresh data once the refresh resolves (~30–60s later).
3. **Periodic refresh** — `startRefreshLoop` registers a 7-day `setInterval` on first request, so a long-running container keeps drifting data fresh.

The startup-refresh threshold catches the most common drift scenario: you broaden the Overpass query in `src/server/overpass.ts`, redeploy, and old POIs need to be replaced with the new (broader) set. Without that step the periodic loop wouldn't refresh for up to 7 days.

### Manual recovery (if auto-refresh fails or you need it now)

If auto-refresh isn't running for some reason — Overpass is down at deploy time, the staleness check needs to be bypassed, you broadened the query and don't want to wait — there are three escape hatches, in order of preference.

**Force a refresh on the next request: mark data as stale.**
```bash
railway link        # if not already linked
railway run --service <name> sqlite3 /data/zurich.db "UPDATE cache_meta SET refreshed_at = 0;"
```
Next request after this triggers `maybeRefreshIfStale()` (since `Date.now() - 0 > STALE_AGE_MS`). No restart needed; just hit any page.

**Full re-seed: drop the data and let `seedIfEmpty` run again.**
```bash
railway run --service <name> sqlite3 /data/zurich.db "DELETE FROM pois; DELETE FROM buildings; DELETE FROM cache_meta;"
railway redeploy    # or restart the service so the next cold start re-seeds
```
Slower (cold start blocks on the first Overpass call) but bulletproof.

**Re-add a temporary admin route on a feature branch** if SSH access isn't available. The previous `src/routes/admin.refresh.tsx` (deleted in commit history — `git log --diff-filter=D --summary` to find it) was a button-driven page calling `refreshAll`. Cherry-pick + push, hit the route, then revert. Don't leave it on `main` without auth.

The auto-refresh logic is in `src/server/init.ts → maybeRefreshIfStale`. If that function ever silently fails, the startup logs (`[init] startup refresh failed: …`) are the place to look — Railway log tail.

## Observability snippets

### Trace every outbound fetch

Drop `scripts/debug-fetch.cjs` (CommonJS) that wraps `globalThis.fetch` to log URL + stack, then run via:
```
node --require ./scripts/debug-fetch.cjs .output/server/index.mjs
```
Saved this session — wired/unwired by toggling the `--require` flag in `package.json` `start` script. Re-add when something fishy happens in prod.

### Inspect what's in the client chunk

```bash
# find the route module
curl -s http://localhost:3000/src/routes/index.tsx | grep -oE 'import\("[^"]+"\)' | head
# look at the lazy split-component chunk for server leaks
curl -s 'http://localhost:3000/src/routes/index.tsx?tsr-split=component' | grep -oE 'better-sqlite3|fs\.access|util\.promisify|drizzle-orm|/server/'
```

If anything Node-only shows up there, you have a top-level side-effect leak.

## When in doubt

- Local prod parity: `pnpm run build && PORT=3010 DB_PATH=./data/zurich.db pnpm run start`. Reproduces 95% of Railway issues except those that need the platform's edge proxy (header overflows, X-Forwarded-* injection).
- Reproducing only-on-Railway behavior: spawn an undici debug log via `NODE_DEBUG=undici,fetch` env var. Combined with `debug-fetch.cjs` you usually find the culprit on the first failing request.

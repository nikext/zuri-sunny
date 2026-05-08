# Hero Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-screen hero landing page at `/` introducing Zürich Sunny Spots, with a primary CTA that navigates to the map. The existing map moves from `/` to `/map`. Old shareable links (`/?t=…&cat=…&outdoor=…`) redirect to `/map` preserving search params.

**Architecture:** New top-level route `src/routes/index.tsx` lives outside the `_app` pathless layout — so the hero does not trigger the POI/buildings loaders. The current `src/routes/_app.index.tsx` is renamed to `src/routes/_app.map.tsx`, giving the map URL `/map` while keeping its content unchanged. A new `Hero` component holds the JSX. Inter is loaded from Google Fonts via `<link>` tags in `__root.tsx` and set as the default body font in `styles.css`. Three internal `to="/"` references (two in `_app.spot.$id.tsx`, one in the renamed map route) are updated to `to="/map"`.

**Tech Stack:** TanStack Start (Vite + Nitro), TanStack Router file-based routes, React 19, Tailwind 4, Lucide icons, Google Fonts (Inter).

---

## File Structure

**Create:**
- `src/components/Hero.tsx` — hero JSX component (wordmark, headline, sub, CTA, image slot).
- `src/routes/index.tsx` — new top-level route at `/`. Defines `validateSearch`, `beforeLoad` (redirect on params), `head` metadata, and renders `<Hero />`.

**Rename:**
- `src/routes/_app.index.tsx` → `src/routes/_app.map.tsx` (content unchanged except for the navigate call below).

**Modify:**
- `src/routes/__root.tsx` — add Inter preconnect + stylesheet links to `head().links`. Update document `<title>`.
- `src/styles.css` — set `body { font-family: 'Inter', … }`.
- `src/routes/_app.map.tsx` (renamed) — change `navigate({ to: '/', … })` to `navigate({ to: '/map', … })` at the URL-sync effect.
- `src/routes/_app.spot.$id.tsx` — change two `<Link to="/">` instances to `<Link to="/map">`.

The TanStack router Vite plugin regenerates `src/routeTree.gen.ts` automatically when `pnpm dev` runs.

---

## Task 1: Rename map route file and fix internal navigate

**Files:**
- Move: `src/routes/_app.index.tsx` → `src/routes/_app.map.tsx`
- Modify: `src/routes/_app.map.tsx` (after rename)

This task gets the existing map onto `/map` first so we can verify nothing broke before adding the hero.

- [ ] **Step 1: Rename the file**

```bash
git mv src/routes/_app.index.tsx src/routes/_app.map.tsx
```

- [ ] **Step 2: Update the URL-sync `navigate` call**

In `src/routes/_app.map.tsx`, find the effect that writes `t` to the URL (around line 30–42). Change `to: '/'` to `to: '/map'`.

Old:
```tsx
tWriteTimer.current = setTimeout(() => {
  navigate({
    to: '/',
    search: (prev) => ({ ...prev, t: t.toISOString() }),
    replace: true,
  })
}, 200)
```

New:
```tsx
tWriteTimer.current = setTimeout(() => {
  navigate({
    to: '/map',
    search: (prev) => ({ ...prev, t: t.toISOString() }),
    replace: true,
  })
}, 200)
```

The `useNavigate({ from: Route.fullPath })` line one above does NOT need to change — `Route.fullPath` is read from the file route, which now resolves to `/map`.

- [ ] **Step 3: Start the dev server to regenerate the route tree**

Run: `pnpm dev`
Expected: Server boots on `http://localhost:3000`. Vite logs should show no errors. The file `src/routeTree.gen.ts` is regenerated and now references `_app.map` instead of `_app.index`. Leave the dev server running for the next steps.

- [ ] **Step 4: Verify in browser**

Open `http://localhost:3000/map` — the existing map UI (filter bar, time slider, sky chip) should appear as before.
Open `http://localhost:3000/` — currently shows a TanStack 404 (expected; we add the hero next).
Open `http://localhost:3000/spot/<some-id>` — clicking "Back to map" still goes to `/` (currently 404). We fix the back link in Task 5.

- [ ] **Step 5: TypeScript check**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/_app.map.tsx src/routeTree.gen.ts
git commit -m "refactor(routes): move map from / to /map"
```

(`_app.index.tsx` is recorded as deleted by `git mv`; the deletion is included in the same commit by `git add`'s rename detection. If `git status` shows it as untracked-deletion, also `git add src/routes/_app.index.tsx`.)

---

## Task 2: Wire Inter font

**Files:**
- Modify: `src/routes/__root.tsx`
- Modify: `src/styles.css`

Inter is loaded at the document level so both hero and map benefit. Page title also gets a small refresh.

- [ ] **Step 1: Add Inter to the document head**

In `src/routes/__root.tsx`, locate the `links` array inside `head()` (around line 28–35). Add three new entries at the top of the array, before the existing entries:

```tsx
links: [
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: '' },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  },
  { rel: 'stylesheet', href: appCss },
  { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
  // ...rest unchanged
],
```

- [ ] **Step 2: Set Inter as the body font**

In `src/styles.css`, modify the existing `body { … }` block (line 16). Add a `font-family` declaration:

```css
body {
  margin: 0;
  overscroll-behavior: none;
  -webkit-tap-highlight-color: transparent;
  font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif;
}
```

- [ ] **Step 3: Verify in browser**

Refresh `http://localhost:3000/map`. Open DevTools → Network → filter "fonts" — you should see two requests to `fonts.gstatic.com` for Inter weights. Page text now renders in Inter (subtle but visible — letterforms are slightly more geometric than the previous system fallback).

- [ ] **Step 4: Commit**

```bash
git add src/routes/__root.tsx src/styles.css
git commit -m "chore(fonts): load Inter from Google Fonts as default sans"
```

---

## Task 3: Build the Hero component

**Files:**
- Create: `src/components/Hero.tsx`

The component is presentational only — no hooks, no data, no router params. It uses TanStack `<Link>` for the CTA so middle/cmd-click work and the route is preloaded on hover.

- [ ] **Step 1: Create the component file**

Create `src/components/Hero.tsx` with:

```tsx
import type { ReactElement } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'

export function Hero(): ReactElement {
  return (
    <main className="min-h-screen bg-stone-50 text-stone-900 flex flex-col">
      <header className="px-6 sm:px-10 pt-6 sm:pt-8">
        <p className="text-sm font-medium tracking-tight text-stone-500">
          Zürich Sunny Spots
        </p>
      </header>

      <section className="flex-1 flex flex-col items-start justify-center px-6 sm:px-10 max-w-5xl mx-auto w-full gap-6 sm:gap-8 py-16">
        <h1 className="text-5xl sm:text-6xl md:text-7xl font-semibold tracking-tight leading-[1.05]">
          Find sun in Zürich.
        </h1>
        <p className="text-lg sm:text-xl text-stone-500 max-w-[52ch] leading-relaxed">
          See which cafés, bars, and restaurants with outdoor seating are in the
          sun right now — or will be at any time today.
        </p>
        <Link
          to="/map"
          className="inline-flex items-center gap-2 rounded-full bg-stone-900 px-6 py-3 text-base font-medium text-white hover:bg-stone-800 active:bg-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50"
        >
          Open the map
          <ArrowRight aria-hidden="true" className="w-4 h-4" />
        </Link>

        {/* Image slot — final asset wired in Task 6 */}
        <figure className="w-full max-w-3xl mt-4">
          {/* Placeholder until the user provides the asset. Removed in Task 6. */}
        </figure>
      </section>
    </main>
  )
}
```

- [ ] **Step 2: TypeScript check**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors. (The component isn't imported anywhere yet — we wire it next.)

- [ ] **Step 3: Commit**

```bash
git add src/components/Hero.tsx
git commit -m "feat(hero): add Hero component with headline, sub, and CTA"
```

---

## Task 4: Add hero route at `/`

**Files:**
- Create: `src/routes/index.tsx`

This route lives outside the `_app` pathless layout, so the POI loader does not run for hero visitors. `validateSearch` accepts the same shape as the old map route, and `beforeLoad` redirects to `/map` if any of those params are present (so old shareable links keep working).

- [ ] **Step 1: Create the route file**

Create `src/routes/index.tsx` with:

```tsx
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Hero } from '#/components/Hero'
import type { Category } from '#/lib/types'

type IndexSearch = {
  t?: string
  cat?: Category
  outdoor?: boolean
}

const CATEGORIES: ReadonlyArray<Category> = ['breakfast', 'coffee', 'lunch', 'apero', 'all']

export const Route = createFileRoute('/')({
  validateSearch: (raw: Record<string, unknown>): IndexSearch => {
    const out: IndexSearch = {}
    if (typeof raw.t === 'string' && raw.t.length > 0) out.t = raw.t
    if (typeof raw.cat === 'string' && (CATEGORIES as ReadonlyArray<string>).includes(raw.cat)) {
      out.cat = raw.cat as Category
    }
    const v = raw.outdoor
    if (v === true || v === 'true' || v === 1 || v === '1') out.outdoor = true
    return out
  },
  beforeLoad: ({ search }) => {
    if (search.t || search.cat || search.outdoor) {
      throw redirect({ to: '/map', search })
    }
  },
  head: () => ({
    meta: [
      { title: 'Zürich Sunny Spots — Find sun in Zürich' },
      {
        name: 'description',
        content:
          'See which cafés, bars, and restaurants with outdoor seating are in the sun right now — or will be at any time today.',
      },
    ],
  }),
  component: Hero,
})
```

- [ ] **Step 2: Save and let the route tree regenerate**

If `pnpm dev` is running, saving `src/routes/index.tsx` triggers a regeneration of `src/routeTree.gen.ts`. If the dev server isn't running, start it: `pnpm dev`.
Expected: No errors in the dev server log. The new route is added to the generated tree.

- [ ] **Step 3: Verify hero in browser**

Open `http://localhost:3000/` — the hero appears: wordmark top-left, big "Find sun in Zürich." headline, sub copy, black "Open the map →" pill button.

Open DevTools → Network → reload `/`. Expected: NO requests to `/_serverFn/getPoisInBbox` or `/_serverFn/getBuildingsInBbox` (the hero is outside `_app`).

Click "Open the map →". Expected: navigates to `/map` and the map appears with markers.

- [ ] **Step 4: Verify the deep-link redirect**

Open `http://localhost:3000/?t=2026-05-08T15:00:00.000Z&cat=apero`.
Expected: URL changes to `http://localhost:3000/map?t=2026-05-08T15%3A00%3A00.000Z&cat=apero` and the map renders with the Apéro filter chip selected and the time slider at 15:00.

Open `http://localhost:3000/?outdoor=true`.
Expected: redirected to `http://localhost:3000/map?outdoor=true` with outdoor filter on.

- [ ] **Step 5: TypeScript check**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/index.tsx src/routeTree.gen.ts
git commit -m "feat(routes): hero at /, redirect old map links to /map"
```

---

## Task 5: Update `_app.spot.$id.tsx` back-link

**Files:**
- Modify: `src/routes/_app.spot.$id.tsx`

Two `<Link to="/">` instances (the "Back to map" link in both the not-found and main render paths) currently point to the hero. They should point to the map.

- [ ] **Step 1: Update the not-found back-link**

In `src/routes/_app.spot.$id.tsx` around line 145, change:

```tsx
<Link
  to="/"
  search={(prev) => prev}
  className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
>
```

to:

```tsx
<Link
  to="/map"
  search={(prev) => prev}
  className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
>
```

- [ ] **Step 2: Update the main back-link**

Same file, around line 193. Same edit: `to="/"` → `to="/map"`.

- [ ] **Step 3: Verify in browser**

Open `http://localhost:3000/map`, click any marker → POI sheet appears. Click into the spot detail (depending on UX, may need to navigate to `/spot/<id>` directly, e.g. `http://localhost:3000/spot/node-12345`). The "← Back to map" link should now go to `/map`, not `/`.

- [ ] **Step 4: TypeScript check**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/routes/_app.spot.$id.tsx
git commit -m "fix(spot): back link goes to /map, not the hero"
```

---

## Task 6: Wire the user-provided image (assets land separately)

**Files:**
- Modify: `src/components/Hero.tsx`
- Add: image asset(s) to `public/`

This task is parameterized on what the user delivers. Until the asset arrives, the placeholder `<figure>` in `Hero.tsx` is empty. After receiving the asset:

- [ ] **Step 1: Place the asset(s) into `public/`**

Save the file(s) the user provided into `public/` with a clear name, e.g. `public/hero.jpg` (or `.webp`, `.png`). Multiple assets can be named `public/hero-1.jpg`, `public/hero-2.jpg`.

- [ ] **Step 2: Replace the placeholder figure**

In `src/components/Hero.tsx`, replace the empty `<figure>` block with the actual image markup. For a single image:

```tsx
<figure className="w-full max-w-3xl mt-4">
  <img
    src="/hero.jpg"
    alt="Sunny terrace in Zürich"
    className="w-full rounded-lg"
    loading="eager"
  />
</figure>
```

For multiple images (e.g. a 3-up grid), use:

```tsx
<figure className="w-full max-w-4xl mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
  <img src="/hero-1.jpg" alt="…" className="w-full rounded-lg aspect-[4/3] object-cover" />
  <img src="/hero-2.jpg" alt="…" className="w-full rounded-lg aspect-[4/3] object-cover" />
  <img src="/hero-3.jpg" alt="…" className="w-full rounded-lg aspect-[4/3] object-cover" />
</figure>
```

The `alt` text should briefly describe the picture (or be empty if purely decorative — the user will say which).

- [ ] **Step 3: Verify in browser**

Reload `http://localhost:3000/`. The image renders below the button at full container width. Resize viewport — image scales without overflow.

- [ ] **Step 4: TypeScript check**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add public/ src/components/Hero.tsx
git commit -m "feat(hero): wire hero image"
```

---

## Task 7: Final verification

This task has no commits — it's a pre-merge sanity sweep.

- [ ] **Step 1: Tests pass**

Run: `pnpm test`
Expected: all 35 tests pass (no test changes were made, but this confirms nothing broke).

- [ ] **Step 2: Production build**

Run: `pnpm build`
Expected: build succeeds with no TypeScript or Vite errors.

- [ ] **Step 3: Manual browser smoke**

With `pnpm dev` running:
1. `/` → hero, no Overpass requests in network panel.
2. `/?t=2026-05-08T15:00:00.000Z&cat=apero` → redirects to `/map?...` with filters/time applied.
3. `/?outdoor=true` → redirects to `/map?outdoor=true`.
4. Click "Open the map →" on `/`. Test left-click, middle-click, cmd-click — all behave correctly (left-click navigates, middle/cmd open in new tab).
5. `/map` → existing UI works (filters, time slider, sky chip, marker click → POI sheet).
6. `/spot/<id>` (open any from the map) → "← Back to map" returns to `/map`.
7. Mobile viewport (DevTools → 375px wide) → hero headline scales down, button is tappable, image fits.
8. Inter font loads (Network panel shows `fonts.gstatic.com` requests; page text is in Inter).

- [ ] **Step 4: Confirm no stray references to old `/` for the map**

Run: `grep -rn "to: '/'\|to=\"/\"" src/ --include="*.tsx" --include="*.ts" | grep -v routeTree.gen.ts`
Expected: no matches. (`routeTree.gen.ts` is allowed to mention `/` as a route id.)

If any matches appear, those are bugs — change them to `'/map'` and add a follow-up commit.

---

## Summary

After all tasks:
- `/` → hero landing page (Inter, minimal Swiss palette, single image, CTA).
- `/map` → original home (filters, time slider, sky chip, map markers).
- `/spot/$id` → unchanged, but back-link now returns to `/map`.
- Old shareable links (`/?t=…`, `/?cat=…`, `/?outdoor=…`) redirect to `/map` preserving search params.
- Inter is the default body font.

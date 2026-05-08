# Hero Landing Page

## Goal

Add a simple landing page at `/` that briefly introduces the product and links into the existing map experience. The map currently lives at `/`; it moves to `/map`. Old shareable links (`/?t=...&cat=...&outdoor=...`) keep working via redirect.

## Scope

**In:**
- New hero route at `/` (outside the `_app` layout, no POI/building loaders).
- Move existing home (map) from `/` to `/map`.
- Redirect `/?<any-app-search>` → `/map?<same-search>` so old links still work.
- One-screen hero: wordmark, headline, sub, primary button, single image slot.
- Inter via Google Fonts in the document head.
- Page metadata (title + description) for the hero route.

**Out:**
- No animations, dark-mode toggle, nav bar, footer, or analytics.
- No content beyond the one screen.
- No restructure of `/spot/$id` (stays where it is).

## Vibe & visuals

- Minimal Swiss / editorial. Generous whitespace. Black on near-white.
- Single typeface: Inter, weights 400 / 500 / 600 / 700.
- Palette (Tailwind): `bg-stone-50`, `text-stone-900`, sub copy `text-stone-500`, button `bg-stone-900` / `hover:bg-stone-800`.
- A single image area below the button. Image asset(s) provided separately by the user; the component reserves a responsive slot (`w-full max-w-3xl rounded-lg`) and loads from `/public`.

## Copy

- Wordmark: `Zürich Sunny Spots`
- H1: `Find sun in Zürich.`
- Sub: `See which cafés, bars, and restaurants with outdoor seating are in the sun right now — or will be at any time today.`
- Button: `Open the map →`

## Routing changes

| Before | After |
| --- | --- |
| `src/routes/_app.index.tsx` (URL `/`) | `src/routes/_app.map.tsx` (URL `/map`) — same content |
| — | `src/routes/index.tsx` (URL `/`) — new hero, no `_app` layout |
| `src/routes/_app.spot.$id.tsx` (URL `/spot/$id`) | unchanged |

Inside the renamed map route, the only edits are:
- `useNavigate({ from: Route.fullPath })` reads `Route.fullPath` from the new route (no string change needed).
- `navigate({ to: '/', search: ... })` calls update to `navigate({ to: '/map', search: ... })`.

`routeTree.gen.ts` is regenerated automatically by the TanStack router Vite plugin.

### Redirect for old shareable links

`src/routes/index.tsx` defines `validateSearch` matching the old `_app` schema (`t?: string`, `cat?: Category`, `outdoor?: boolean`) and a `beforeLoad`:

```ts
beforeLoad: ({ search }) => {
  if (search.t || search.cat || search.outdoor) {
    throw redirect({ to: '/map', search })
  }
}
```

If none of those are present, render the hero. This keeps `/?t=2026-05-08T15:00Z&cat=apero` links working.

## Components

### `src/components/Hero.tsx`

Plain React + Tailwind, no data dependencies. Structure:

```
<main bg-stone-50 min-h-screen flex flex-col>
  <header>  Zürich Sunny Spots wordmark
  <section flex-1 centered>
    <h1>     Find sun in Zürich.
    <p>      sub copy
    <Link to="/map">  Open the map →
    <figure> image slot (single <img>)
```

- Headline: `text-5xl sm:text-6xl md:text-7xl font-semibold tracking-tight leading-[1.05]`.
- Sub: `text-lg sm:text-xl text-stone-500 max-w-[52ch]`.
- Button: TanStack `<Link to="/map">`, rendered as a black pill (`rounded-full px-6 py-3 font-medium text-white bg-stone-900 hover:bg-stone-800 focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2`). Using `<Link>` (not a click handler) preserves middle-click / cmd-click and gives free hover-prefetch.
- Image slot: `<img src="/hero.jpg" alt="" className="w-full max-w-3xl rounded-lg" />`. Final filename and `alt` text wired when assets arrive.

### `src/routes/index.tsx`

```ts
export const Route = createFileRoute('/')({
  validateSearch: /* same shape as _app */,
  beforeLoad: /* redirect if any search param present */,
  head: () => ({
    meta: [
      { title: 'Zürich Sunny Spots — Find sun in Zürich' },
      { name: 'description', content: 'See which cafés, bars, and restaurants with outdoor seating are in the sun right now — or will be at any time today.' },
    ],
  }),
  component: () => <Hero />,
})
```

### Font loading

In `src/routes/__root.tsx`, add to `head().links`:

```ts
{ rel: 'preconnect', href: 'https://fonts.googleapis.com' },
{ rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: '' },
{ rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap' },
```

Set Inter as the default sans in `src/styles.css`:

```css
body {
  font-family: 'Inter', ui-sans-serif, system-ui, sans-serif;
}
```

(System fallback covers the brief moment before Inter loads.)

## Behavior

- Visiting `/` with no params → hero.
- Visiting `/?t=...` → redirect to `/map?t=...`.
- Clicking "Open the map →" → navigate to `/map`.
- All existing map behavior unchanged (POI loader runs on `/_app` as before, just under `/map` now).

## Accessibility

- One `<h1>` per page; hero uses it for the headline.
- Button has visible focus ring.
- Image gets descriptive `alt` once provided (or empty string if purely decorative).

## Testing

Manual (no automated tests for this feature):
- `/` shows the hero, no console errors, no Overpass requests in network tab.
- `/map` shows the original home (filter bar, time slider, sky chip, map).
- `/?t=2026-05-08T15:00:00Z&cat=apero` redirects to `/map?t=...&cat=apero` and the timeline + filter reflect the params.
- `/spot/<id>` still works.
- "Open the map →" supports left-click, middle-click, cmd-click as expected.
- Mobile viewport: headline scales, padding tight, button tappable.

## Risks / notes

- Renaming a route file changes the generated route tree. Run `pnpm dev` once to confirm regen and a clean type-check.
- Google Fonts adds two preconnects + one stylesheet request. Acceptable — alternative is self-hosting via `@fontsource/inter` later if we want zero third-party requests.
- `beforeLoad` redirect only fires for params we listed. If we add new search keys later, update the predicate.

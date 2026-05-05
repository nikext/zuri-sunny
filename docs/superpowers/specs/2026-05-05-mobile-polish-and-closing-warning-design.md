# Mobile polish + closing-soon warning — design

**Date:** 2026-05-05
**Status:** Approved (pending implementation plan)
**Scope:** UI polish on the home map screen — adds a closing-soon indicator inside the POI bottom sheet and fixes a cluster of mobile-specific issues (safe-area, tap targets, missing utility class, sheet ergonomics).

## Goals

1. Warn the user when a selected place closes within an hour of the displayed time, so they don't walk over to a place that's about to shut.
2. Make the existing UI usable on a phone — clear the iOS notch/home-indicator, hit Apple's 44px touch-target floor, and add a backdrop tap to dismiss the sheet.

## Non-goals

- Google / Foursquare ratings — skipped. Adding a paid API key is out of scope for this iteration; revisit if free-tier appetite changes.
- Showing the time slider while a POI sheet is open — would require a layout redesign of the bottom area; deferred.
- Swipe-down-to-dismiss gesture on the sheet — backdrop tap covers the same need at a fraction of the code. Pure-visual drag handle is included as an affordance.
- Map-level "closing soon" indicator on the dot itself — risk of visual overload alongside existing sun/open-state encoding.

## Closing-soon warning

### New helper: `minutesUntilClose`

Added to `src/lib/opening-hours.ts` (sits next to existing `isOpenAt`).

```ts
/**
 * If a place is open at `t` and will close within the next 12 hours, returns
 * minutes until close. Returns null if closed at `t`, if opening hours are
 * missing/unparseable, or if the next state change is further than 12h away.
 */
export function minutesUntilClose(
  openingHours: string | null | undefined,
  t: Date,
): number | null
```

**Implementation notes:**
- Uses the existing `opening_hours` library already in `package.json`.
- Constructs an `opening_hours` instance with the same defensive try/catch pattern as `isOpenAt`. If parsing throws, return `null`.
- If `op.getState(t) === false`, return `null`.
- Compute next change with `op.getNextChange(t, new Date(t.getTime() + 12 * 60 * 60 * 1000))`. If it returns `undefined` (no change in window — e.g. 24/7), return `null`.
- Return `Math.round((nextChange.getTime() - t.getTime()) / 60000)`.

### UI integration in `PoiSheet`

In `src/components/PoiSheet.tsx`, inside the opening-hours block:

- Compute `const closingIn = open ? minutesUntilClose(poi.openingHours, t) : null`.
- When `closingIn !== null && closingIn < 60`, render an additional badge **next to** "Open now":
  - Text: `Closing in ${closingIn} min` (or `Closing in <1 min` for `closingIn === 0`).
  - Style: `inline-flex items-center rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-xs font-medium`.
- Computed against the displayed time `t` (the slider value), not wall-clock — consistent with how the rest of the sheet treats `t`.

## Mobile fixes

### iOS safe-area insets

In `src/routes/index.tsx`, three overlay containers need safe-area padding:

| Container | Current | Add |
|---|---|---|
| FilterBar wrapper (top) | `p-2 sm:p-3` | `pt-[env(safe-area-inset-top)]` |
| TimeSlider wrapper (bottom) | `p-2 sm:p-3` | `pb-[env(safe-area-inset-bottom)]` |
| PoiSheet positioning | `bottom-0` on the dialog wrapper | inner card gets `pb-[calc(1.5rem+env(safe-area-inset-bottom))]` (replaces existing `pb-6`) |

Existing `<meta name="viewport">` already has `width=device-width, initial-scale=1`. Note: it does NOT include `viewport-fit=cover`, which is required for `env()` insets to be non-zero on iOS Safari. Add `viewport-fit=cover` to the meta tag in `src/routes/__root.tsx`.

### `no-scrollbar` utility

Add to `src/styles.css` (Tailwind v4 syntax):

```css
@utility no-scrollbar {
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
}
```

`FilterBar.tsx` already references this class — currently it's a no-op, so the chip row can show a horizontal scrollbar when categories overflow on narrow screens.

### Tap targets

| Element | Current | New |
|---|---|---|
| `PoiSheet` close button | `p-1.5` (~32px) | `p-2.5 min-w-11 min-h-11` |
| `TimeSlider` "Now" button | `px-2 py-1 text-xs sm:text-sm` | `px-3 py-2 text-sm` |
| `TimeSlider` date button | `px-2 py-1 text-xs sm:text-sm` | `px-3 py-2 text-sm` |
| Range slider thumb | browser default (~12-14px) | 24px via custom CSS |

Range thumb CSS goes in `src/styles.css`, scoped to the time slider input. Cleanest is a class — add `range-thumb` to the `<input type="range">` and define:

```css
input[type="range"].range-thumb-lg::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgb(245, 158, 11); /* amber-500 */
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

Apply `range-thumb-lg` class on the existing range input in `TimeSlider.tsx`.

### Opening-hours wrapping

Replace `break-all` with `break-words` in two places:
- `src/components/PoiSheet.tsx` line ~98
- `src/routes/spot.$id.tsx` line ~100

`break-all` shatters cleanly-formattable strings like `Mo-Fr 09:00-18:00` mid-token. `break-words` only breaks long unbreakable words.

### Sheet backdrop + drag handle

Modify `src/components/PoiSheet.tsx`:

1. **Backdrop**: when `poi !== null`, render a sibling div *behind* the sheet card:
   ```tsx
   <div
     onClick={onClose}
     aria-hidden="true"
     className="fixed inset-0 z-35 bg-slate-900/20"
   />
   ```
   `z-35` (between the FilterBar wrapper at `z-30` and the sheet dialog at `z-40`) ensures the backdrop sits above the map and overlay UI but under the sheet card. `z-35` is not in the default Tailwind scale; add an arbitrary value via `z-[35]`. The dialog wrapper itself keeps `pointer-events-none` — the new backdrop is a separate sibling and is interactive by default. Render the backdrop only when `poi !== null` (currently the entire component returns `null` when no poi, so this naturally holds).

2. **Drag handle**: at the very top of the sheet card (above the title row), add:
   ```tsx
   <div className="flex justify-center pt-1 pb-2">
     <div className="w-9 h-1 rounded-full bg-slate-300" aria-hidden="true" />
   </div>
   ```
   Pure visual affordance — no swipe gesture wired up.

3. **Escape key**: existing close behavior handled via the X. Backdrop covers tap-out. Skipping keyboard shortcut for this iteration.

## File-by-file change summary

| File | Change |
|---|---|
| `src/lib/opening-hours.ts` | Add `minutesUntilClose` helper |
| `src/components/PoiSheet.tsx` | Closing-soon badge, larger close button, backdrop, drag handle, `break-words` |
| `src/components/TimeSlider.tsx` | Bigger Now/date buttons, `range-thumb-lg` class on input |
| `src/components/FilterBar.tsx` | No code change (already uses `no-scrollbar`) |
| `src/routes/index.tsx` | Safe-area padding on the three overlay containers |
| `src/routes/spot.$id.tsx` | `break-words` instead of `break-all` |
| `src/routes/__root.tsx` | Add `viewport-fit=cover` to viewport meta |
| `src/styles.css` | Define `no-scrollbar` utility + `range-thumb-lg` class |

## Testing

- **Unit test** `minutesUntilClose` — covers: open and closing within 60min, open with no close in window (24/7), closed, missing/unparseable hours, exactly at close time. Add to `src/lib/opening-hours.test.ts` if it exists, otherwise create.
- **Manual mobile check** at three viewport widths (375, 414, 480) with browser devtools mobile emulation:
  - Sheet sits above the home indicator on iPhone profiles.
  - FilterBar scrolls horizontally without a visible scrollbar.
  - Tap targets feel large enough (visual eyeball pass).
  - Backdrop tap dismisses the sheet.
  - Drag handle visible.
  - Closing-soon badge appears for a known cafe near closing time (or by manually advancing the time slider on a place with set hours).
- **Typecheck** `pnpm exec tsc --noEmit` passes.

## Risks

- `viewport-fit=cover` is required for `env()` insets to take effect, but it also changes how Safari treats the viewport (allows content under the notch). Our overlays are already absolute-positioned with intentional padding, so this should be a net improvement, but worth eyeballing the FilterBar position on a notched device profile.
- `opening_hours.getNextChange` can be expensive on complex schedules. Capping the lookahead window to 12h bounds the cost. Computed once per render of the sheet — only when a sheet is open.

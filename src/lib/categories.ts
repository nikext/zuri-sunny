// Category chips: which POIs each chip shows.
import { isOpenDuring } from './opening-hours'
import { zhDate, zhParts } from './zurich-time'
import type { Category, Poi } from './types'

/** Zürich-time window (minutes after midnight) in which a place has to be open
 *  to count for a meal chip. Coffee and All are not time-bound. */
const MEAL_WINDOWS: Partial<Record<Category, [number, number]>> = {
  breakfast: [7 * 60, 10 * 60 + 30],
  lunch: [11 * 60 + 30, 14 * 60],
  apero: [16 * 60 + 30, 20 * 60],
}

function cuisineHas(poi: Poi, ...values: string[]): boolean {
  const c = poi.cuisine
  if (!c) return false
  return c.split(';').some((v) => values.includes(v.trim().toLowerCase()))
}

function kindMatches(poi: Poi, cat: Category): boolean {
  const a = poi.amenity ?? ''
  switch (cat) {
    case 'all':
      return true
    case 'breakfast':
      // Cafés, plus anything OSM tags as serving breakfast/brunch.
      return a === 'cafe' || cuisineHas(poi, 'breakfast', 'brunch')
    case 'coffee':
      return a === 'cafe' || a === 'ice_cream' || cuisineHas(poi, 'coffee_shop')
    case 'lunch':
      return a === 'restaurant'
    case 'apero':
      return a === 'bar' || a === 'pub' || a === 'biergarten' || a === 'restaurant'
  }
}

/** Does `poi` belong under chip `cat` on the Zürich calendar day of `day`?
 *
 *  Meal chips also require the place to be open at some point during that
 *  meal's window on that day, so Breakfast drops cafés that open at noon and
 *  Apéro drops lunch-only restaurants. Places with missing or unparseable
 *  hours are kept, consistent with the rest of the app treating them as open. */
export function categoryMatches(poi: Poi, cat: Category, day: Date): boolean {
  if (!kindMatches(poi, cat)) return false
  const window = MEAL_WINDOWS[cat]
  if (!window) return true
  const { year, month, day: date } = zhParts(day)
  const at = (min: number) => zhDate(year, month, date, Math.floor(min / 60), min % 60)
  return isOpenDuring(poi.openingHours, at(window[0]), at(window[1]))
}

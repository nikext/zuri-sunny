// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { categoryMatches } from './categories'
import type { Poi } from './types'

// Wednesday. Tests run with TZ=UTC, so local wall-clock == UTC here.
const WED = new Date('2026-09-23T12:00:00Z')

const poi = (p: Partial<Poi>): Poi => ({ id: 'x', lat: 47.37, lon: 8.54, ...p })

describe('categoryMatches', () => {
  it('shows everything under All', () => {
    expect(categoryMatches(poi({ amenity: 'bar', openingHours: 'Mo-Su 20:00-02:00' }), 'all', WED)).toBe(true)
  })

  it('distinguishes Breakfast from Coffee by opening hours', () => {
    const earlyCafe = poi({ amenity: 'cafe', openingHours: 'Mo-Fr 07:00-18:00' })
    const noonCafe = poi({ amenity: 'cafe', openingHours: 'Mo-Fr 12:00-23:00' })
    expect(categoryMatches(earlyCafe, 'breakfast', WED)).toBe(true)
    expect(categoryMatches(noonCafe, 'breakfast', WED)).toBe(false)
    expect(categoryMatches(noonCafe, 'coffee', WED)).toBe(true)
  })

  it('includes brunch restaurants under Breakfast, but not ice cream', () => {
    expect(categoryMatches(poi({ amenity: 'restaurant', cuisine: 'regional;brunch' }), 'breakfast', WED)).toBe(true)
    expect(categoryMatches(poi({ amenity: 'restaurant', cuisine: 'pizza' }), 'breakfast', WED)).toBe(false)
    expect(categoryMatches(poi({ amenity: 'ice_cream' }), 'breakfast', WED)).toBe(false)
  })

  it('drops restaurants that are closed for lunch or for apéro', () => {
    const dinnerOnly = poi({ amenity: 'restaurant', openingHours: 'Tu-Sa 18:00-23:00' })
    const lunchOnly = poi({ amenity: 'restaurant', openingHours: 'Mo-Fr 11:00-14:30' })
    expect(categoryMatches(dinnerOnly, 'lunch', WED)).toBe(false)
    expect(categoryMatches(dinnerOnly, 'apero', WED)).toBe(true)
    expect(categoryMatches(lunchOnly, 'lunch', WED)).toBe(true)
    expect(categoryMatches(lunchOnly, 'apero', WED)).toBe(false)
  })

  it('respects the day of week', () => {
    const weekdays = poi({ amenity: 'restaurant', openingHours: 'Mo-Fr 11:00-14:30' })
    const sunday = new Date('2026-09-27T12:00:00Z')
    expect(categoryMatches(weekdays, 'lunch', sunday)).toBe(false)
  })

  it('keeps places with missing or unparseable hours', () => {
    expect(categoryMatches(poi({ amenity: 'restaurant' }), 'lunch', WED)).toBe(true)
    expect(categoryMatches(poi({ amenity: 'bar', openingHours: 'ask the barman' }), 'apero', WED)).toBe(true)
  })
})

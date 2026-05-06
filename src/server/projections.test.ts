// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { roundCoord, slimBuilding, slimPoi, slimTags } from './projections'

describe('roundCoord', () => {
  it('rounds to 5 decimal places', () => {
    expect(roundCoord(8.5278554)).toBe(8.52786)
    expect(roundCoord(47.3748081)).toBe(47.37481)
    expect(roundCoord(0)).toBe(0)
    expect(roundCoord(-8.123456789)).toBe(-8.12346)
  })

  it('leaves already-short values unchanged', () => {
    expect(roundCoord(8.5)).toBe(8.5)
    expect(roundCoord(47.37)).toBe(47.37)
  })
})

describe('slimTags', () => {
  it('returns null for missing or empty tags', () => {
    expect(slimTags(null)).toBeNull()
    expect(slimTags(undefined)).toBeNull()
    expect(slimTags({})).toBeNull()
  })

  it('returns null when no whitelisted key is present', () => {
    expect(slimTags({ cuisine: 'pizza', phone: '123', website: 'x.com' })).toBeNull()
  })

  it('keeps only whitelisted keys', () => {
    const out = slimTags({
      'addr:street': 'Albisstrasse',
      'addr:housenumber': '44',
      'addr:postcode': '8038',
      'addr:city': 'Zürich',
      cuisine: 'pizza',
      phone: '+41 43 ...',
      website: 'https://example.ch',
      outdoor_seating: 'yes',
      terrace: 'yes',
      wheelchair: 'yes',
      description: 'a long description',
    })
    expect(out).toEqual({
      'addr:street': 'Albisstrasse',
      'addr:housenumber': '44',
      'addr:postcode': '8038',
      'addr:city': 'Zürich',
      outdoor_seating: 'yes',
      terrace: 'yes',
    })
  })

  it('partial whitelist hit returns only what is present', () => {
    expect(slimTags({ outdoor_seating: 'yes', cuisine: 'pizza' })).toEqual({
      outdoor_seating: 'yes',
    })
  })
})

describe('slimBuilding', () => {
  it('drops id and rounds footprint + bbox coords to 5 decimals', () => {
    const wire = slimBuilding({
      id: 'way/100',
      footprint: [
        [8.5278554, 47.3748081],
        [8.5279237, 47.3748421],
        [8.5279237, 47.3749999],
      ],
      heightM: 12.5,
      minLat: 47.3748081,
      maxLat: 47.3749999,
      minLon: 8.5278554,
      maxLon: 8.5279237,
    })
    expect(wire).toEqual({
      footprint: [
        [8.52786, 47.37481],
        [8.52792, 47.37484],
        [8.52792, 47.375],
      ],
      heightM: 12.5,
      minLat: 47.37481,
      maxLat: 47.375,
      minLon: 8.52786,
      maxLon: 8.52792,
    })
    expect(wire).not.toHaveProperty('id')
  })
})

describe('slimPoi', () => {
  it('drops cuisine + fetchedAt, prunes tags to the bulk whitelist', () => {
    const wire = slimPoi({
      id: 'node/73653071',
      name: 'moana',
      amenity: 'cafe',
      cuisine: 'coffee_shop',
      lat: 47.3439521,
      lon: 8.5297852,
      openingHours: 'Mo-Fr 08:00-22:00',
      tags: {
        'addr:housenumber': '44',
        'addr:street': 'Albisstrasse',
        email: 'hello@moanacafebar.ch',
        phone: '+41 43 399 00 19',
        website: 'http://www.moanacafebar.ch/',
        wheelchair: 'yes',
        outdoor_seating: 'yes',
      },
      fetchedAt: 1778007730330,
    })
    expect(wire).toEqual({
      id: 'node/73653071',
      name: 'moana',
      amenity: 'cafe',
      lat: 47.3439521,
      lon: 8.5297852,
      openingHours: 'Mo-Fr 08:00-22:00',
      tags: {
        'addr:housenumber': '44',
        'addr:street': 'Albisstrasse',
        outdoor_seating: 'yes',
      },
    })
    expect(wire).not.toHaveProperty('cuisine')
    expect(wire).not.toHaveProperty('fetchedAt')
  })

  it('preserves null/empty fields without crashing', () => {
    const wire = slimPoi({
      id: 'node/1',
      name: null,
      amenity: 'bar',
      cuisine: null,
      lat: 47.0,
      lon: 8.5,
      openingHours: null,
      tags: null,
      fetchedAt: 0,
    })
    expect(wire).toEqual({
      id: 'node/1',
      name: null,
      amenity: 'bar',
      lat: 47.0,
      lon: 8.5,
      openingHours: null,
      tags: null,
    })
  })
})

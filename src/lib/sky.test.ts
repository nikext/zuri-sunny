// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { classifySky, clearSkyDni } from './sky'

const deg = (d: number) => (d * Math.PI) / 180

describe('clearSkyDni', () => {
  it('is zero with the sun at or below the horizon', () => {
    expect(clearSkyDni(0)).toBe(0)
    expect(clearSkyDni(deg(-5))).toBe(0)
  })

  it('matches textbook clear-sky values', () => {
    // Summer noon in Zürich (~66°) and winter noon (~19.5°).
    expect(clearSkyDni(deg(66))).toBeGreaterThan(880)
    expect(clearSkyDni(deg(66))).toBeLessThan(960)
    expect(clearSkyDni(deg(19.5))).toBeGreaterThan(600)
    expect(clearSkyDni(deg(19.5))).toBeLessThan(700)
  })

  it('increases monotonically with altitude', () => {
    let prev = 0
    for (let a = 1; a <= 90; a++) {
      const v = clearSkyDni(deg(a))
      expect(v).toBeGreaterThan(prev)
      prev = v
    }
  })
})

describe('classifySky', () => {
  const base = { sunAltitudeRad: 0.5, clearSkyDniWm2: 800, cloudCoverPct: 0 }

  it('returns night when sun is below the horizon, whatever the radiation', () => {
    expect(classifySky({ ...base, sunAltitudeRad: -0.01, dniWm2: 0 })).toBe('night')
    expect(classifySky({ ...base, sunAltitudeRad: -0.1, dniWm2: 800 })).toBe('night')
  })

  it('buckets on the clear-sky index (measured ÷ clear-sky DNI)', () => {
    expect(classifySky({ ...base, dniWm2: 0 })).toBe('overcast')
    expect(classifySky({ ...base, dniWm2: 159 })).toBe('overcast') // k < 0.2
    expect(classifySky({ ...base, dniWm2: 160 })).toBe('partly') // k = 0.2
    expect(classifySky({ ...base, dniWm2: 479 })).toBe('partly') // k < 0.6
    expect(classifySky({ ...base, dniWm2: 480 })).toBe('clear') // k = 0.6
  })

  it('calls a clear low sun clear (the old horizontal-radiation bug)', () => {
    // 10° sun, clear sky: DNI ~ 450 of a possible ~500. Horizontal direct
    // radiation would be only ~80 W/m² — the old classifier said "overcast".
    const clear = clearSkyDni(deg(10))
    expect(
      classifySky({ sunAltitudeRad: deg(10), dniWm2: clear * 0.9, clearSkyDniWm2: clear, cloudCoverPct: 0 }),
    ).toBe('clear')
  })

  it('falls back to cloud cover when the sun was barely up during the hour', () => {
    const lowSun = { sunAltitudeRad: 0.01, dniWm2: 3, clearSkyDniWm2: 10 }
    expect(classifySky({ ...lowSun, cloudCoverPct: 10 })).toBe('clear')
    expect(classifySky({ ...lowSun, cloudCoverPct: 50 })).toBe('partly')
    expect(classifySky({ ...lowSun, cloudCoverPct: 90 })).toBe('overcast')
  })
})

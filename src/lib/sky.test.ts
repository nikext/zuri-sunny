// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { classifySky } from './sky'

describe('classifySky', () => {
  it('returns night when sun is below the horizon', () => {
    expect(
      classifySky({ cloudCoverPct: 0, directRadiationWm2: 0, sunAltitudeRad: -0.01 }),
    ).toBe('night')
    expect(
      classifySky({ cloudCoverPct: 100, directRadiationWm2: 800, sunAltitudeRad: -1 }),
    ).toBe('night')
  })

  it('returns overcast when direct radiation is below 80 W/m^2', () => {
    expect(
      classifySky({ cloudCoverPct: 100, directRadiationWm2: 0, sunAltitudeRad: 0.5 }),
    ).toBe('overcast')
    expect(
      classifySky({ cloudCoverPct: 50, directRadiationWm2: 79.9, sunAltitudeRad: 0.5 }),
    ).toBe('overcast')
  })

  it('returns partly between 80 and 350 W/m^2', () => {
    expect(
      classifySky({ cloudCoverPct: 60, directRadiationWm2: 80, sunAltitudeRad: 0.5 }),
    ).toBe('partly')
    expect(
      classifySky({ cloudCoverPct: 30, directRadiationWm2: 349.9, sunAltitudeRad: 0.5 }),
    ).toBe('partly')
  })

  it('returns clear at 350 W/m^2 and above', () => {
    expect(
      classifySky({ cloudCoverPct: 0, directRadiationWm2: 350, sunAltitudeRad: 0.5 }),
    ).toBe('clear')
    expect(
      classifySky({ cloudCoverPct: 0, directRadiationWm2: 900, sunAltitudeRad: 1.0 }),
    ).toBe('clear')
  })

  it('night flag wins over high radiation (defensive — should not happen in practice)', () => {
    expect(
      classifySky({ cloudCoverPct: 0, directRadiationWm2: 500, sunAltitudeRad: -0.1 }),
    ).toBe('night')
  })
})

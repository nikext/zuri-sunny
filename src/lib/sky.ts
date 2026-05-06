import type { Sky } from './types'

export type ClassifySkyInput = {
  cloudCoverPct: number
  directRadiationWm2: number
  sunAltitudeRad: number
}

/** Pure classifier. Thresholds are intentionally tunable; the test suite pins
 *  the current values. `direct_radiation` already integrates clouds + sun
 *  angle, which is why it (not raw cloud %) drives the clear/partly/overcast
 *  buckets. */
export function classifySky(input: ClassifySkyInput): Sky['state'] {
  if (input.sunAltitudeRad <= 0) return 'night'
  if (input.directRadiationWm2 < 80) return 'overcast'
  if (input.directRadiationWm2 < 350) return 'partly'
  return 'clear'
}

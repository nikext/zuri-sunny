import type { Sky } from './types'

/** Extraterrestrial direct normal irradiance used by the Meinel model (W/m²). */
const SOLAR_CONSTANT_WM2 = 1353

/** Clear-sky direct normal irradiance (W/m²) at a given sun altitude.
 *
 *  Meinel & Meinel (1976): DNI = 1353 · 0.7^(AM^0.678), with the Kasten–Young
 *  (1989) air mass. Good to ~10% for mid-latitude clear skies — plenty for
 *  telling "the sun is out" from "clouds are in the way", which is all the
 *  classifier needs. Returns 0 with the sun at or below the horizon. */
export function clearSkyDni(altitudeRad: number): number {
  if (altitudeRad <= 0) return 0
  const zenithDeg = 90 - (altitudeRad * 180) / Math.PI
  const airMass =
    1 / (Math.cos((zenithDeg * Math.PI) / 180) + 0.50572 * (96.07995 - zenithDeg) ** -1.6364)
  return SOLAR_CONSTANT_WM2 * 0.7 ** (airMass ** 0.678)
}

export type ClassifySkyInput = {
  /** Sun altitude at the displayed instant. */
  sunAltitudeRad: number
  /** Measured direct normal irradiance, mean over the sampled hour. */
  dniWm2: number
  /** Clear-sky DNI, mean over the same hour (see `clearSkyDni`). */
  clearSkyDniWm2: number
  cloudCoverPct: number
}

/** Below this mean clear-sky DNI the sun spent the hour at or near the
 *  horizon (the sunrise/sunset hours, ~5° or less). There both the model and
 *  Open-Meteo are unreliable — terrain, refraction, and Open-Meteo reports 0
 *  for the hour a clear sunset falls in — so fall back to cloud cover. */
export const MIN_CLEAR_SKY_DNI_WM2 = 150

/** Pure classifier. Thresholds are intentionally tunable; the test suite pins
 *  the current values.
 *
 *  Uses the clear-sky index (measured DNI ÷ clear-sky DNI) rather than raw
 *  radiation: horizontal radiation shrinks with sun angle, so a fixed W/m²
 *  threshold called clear winter noons "partly" and clear mornings "overcast". */
export function classifySky(input: ClassifySkyInput): Sky['state'] {
  if (input.sunAltitudeRad <= 0) return 'night'
  if (input.clearSkyDniWm2 < MIN_CLEAR_SKY_DNI_WM2) {
    if (input.cloudCoverPct <= 25) return 'clear'
    if (input.cloudCoverPct <= 75) return 'partly'
    return 'overcast'
  }
  const k = input.dniWm2 / input.clearSkyDniWm2
  if (k < 0.2) return 'overcast'
  if (k < 0.6) return 'partly'
  return 'clear'
}

import SunCalc from 'suncalc'
import type { SunPosition } from './types'

const TWO_PI = 2 * Math.PI

/** Sun position in compass radians (0=N, CW) and altitude radians. */
export function getSunPosition(t: Date, lat: number, lon: number): SunPosition {
  const p = SunCalc.getPosition(t, lat, lon)
  const azimuthRad = ((p.azimuth + Math.PI) % TWO_PI + TWO_PI) % TWO_PI
  return { altitudeRad: p.altitude, azimuthRad }
}

/** Sunrise and sunset times for a given date and location. */
export function getSunTimes(t: Date, lat: number, lon: number): { sunrise: Date; sunset: Date } {
  const times = SunCalc.getTimes(t, lat, lon)
  return { sunrise: times.sunrise, sunset: times.sunset }
}

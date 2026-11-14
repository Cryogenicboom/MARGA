/**
 * Planetary geometry on the Mars reference sphere (mirror of marga_engine/geodesy.py).
 * Latitude planetocentric; longitude EAST-positive, normalised to [-180, 180).
 */
export const MARS_RADIUS_M = 3_396_190.0;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

/** Python-style modulo (result has the sign of the divisor). */
export function pmod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

export function normalizeLon(lon: number): number {
  return pmod(lon + 180.0, 360.0) - 180.0;
}

export function lonDelta(lonTo: number, lonFrom: number): number {
  return pmod(lonTo - lonFrom + 180.0, 360.0) - 180.0;
}

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number, radiusM = MARS_RADIUS_M): number {
  const p1 = lat1 * DEG2RAD;
  const p2 = lat2 * DEG2RAD;
  const dp = p2 - p1;
  const dl = lonDelta(lon2, lon1) * DEG2RAD;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2.0 * radiusM * Math.asin(Math.min(1.0, Math.sqrt(a)));
}

export function initialBearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * DEG2RAD;
  const p2 = lat2 * DEG2RAD;
  const dl = lonDelta(lon2, lon1) * DEG2RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return pmod(Math.atan2(y, x) * RAD2DEG + 360.0, 360.0);
}

/** Python's round(): half to even. Used where the Python engine rounds to a grid index. */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** Python round(x, n) for display values (half-even on the decimal digit). */
export function roundTo(x: number, n = 1): number {
  const k = 10 ** n;
  return roundHalfEven(x * k) / k;
}

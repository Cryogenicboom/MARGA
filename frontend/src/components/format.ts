/**
 * Display formatting only. Every value shown comes from the engine response, the terrain package or
 * the target catalogue; these helpers change units and rounding for reading, never the value itself.
 * A missing value is shown as NOT_PROVIDED instead of being guessed.
 */
export const NOT_PROVIDED = 'Not provided';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Metres as "850 m" or "5.32 km". */
export function fmtDistance(m: number | null | undefined): string {
  if (!isNum(m)) return NOT_PROVIDED;
  return Math.abs(m) >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

/** Minutes as "1 h 13 min" or "45 min". */
export function fmtDuration(min: number | null | undefined): string {
  if (!isNum(min)) return NOT_PROVIDED;
  const sign = min < 0 ? '−' : '';
  const total = Math.round(Math.abs(min));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${sign}${h} h ${String(m).padStart(2, '0')} min` : `${sign}${m} min`;
}

/** Signed minutes for margins: "+4 h 06 min" / "−3 h 02 min". */
export function fmtMargin(min: number | null | undefined): string {
  if (!isNum(min)) return NOT_PROVIDED;
  return min >= 0 ? `+${fmtDuration(min)}` : fmtDuration(min);
}

export function fmtMetres(m: number | null | undefined, digits = 0): string {
  if (!isNum(m)) return NOT_PROVIDED;
  return `${m.toFixed(digits).replace('-', '−')} m`;
}

export function fmtDeg(d: number | null | undefined, digits = 1): string {
  if (!isNum(d)) return NOT_PROVIDED;
  return `${d.toFixed(digits)}°`;
}

export function fmtPct(p: number | null | undefined, digits = 0): string {
  if (!isNum(p)) return NOT_PROVIDED;
  return `${p.toFixed(digits)}%`;
}

/** Planetocentric latitude / east longitude as "4.5895° S, 137.4417° E". */
export function fmtLatLon(lat: number, lon: number, digits = 4): string {
  return `${Math.abs(lat).toFixed(digits)}° ${lat < 0 ? 'S' : 'N'}, ${lon.toFixed(digits)}° E`;
}

export function fmtDose(msv: number | null | undefined): string {
  if (!isNum(msv)) return NOT_PROVIDED;
  return `${msv.toFixed(3)} mSv`;
}

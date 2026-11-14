/**
 * Mobility, EVA budget and radiation (mirror of marga_engine/eva/*.py).
 *
 *   v(g)       = v_flat * exp(-k (|g + g0| - g0))            Tobler shape, v(0) = v_flat
 *   T_mission  = T_out + T_science + T_return + T_reserve
 *   M          = T_EVA - T_mission  (= T_remaining - T_return - T_reserve at turnaround)
 *   D          = R * t              (R = 0.67 mSv/day, Curiosity RAD, Aug 2012 - Jun 2013, historical)
 */
import type { DoseEstimate, EvaAssessment } from '../types/engine.ts';
import { DEFAULT_DOSE_REFERENCE, type DoseRateReference, type MobilityParams } from './config.ts';
import { EngineError } from './terrain.ts';

export class MobilityModel {
  readonly flatSpeedKmh: number;
  readonly params: MobilityParams;
  constructor(flatSpeedKmh: number, params: MobilityParams) {
    if (!(Number.isFinite(flatSpeedKmh) && flatSpeedKmh > 0)) {
      throw new EngineError('input', 'walkingSpeedKmh must be a positive number');
    }
    this.flatSpeedKmh = flatSpeedKmh;
    this.params = params;
  }
  speedKmh(grade: number): number {
    const { toblerK: k, toblerOffset: g0, minSpeedKmh } = this.params;
    return Math.max(this.flatSpeedKmh * Math.exp(-k * (Math.abs(grade + g0) - g0)), minSpeedKmh);
  }
  get maxSpeedKmh(): number {
    return this.flatSpeedKmh * Math.exp(this.params.toblerK * this.params.toblerOffset);
  }
  minutes(horizontalM: number, grade: number): number {
    return horizontalM / 1000.0 / this.speedKmh(grade) * 60.0;
  }
  get minMinutesPerM(): number {
    return 60.0 / (1000.0 * this.maxSpeedKmh);
  }
  describe(): string {
    const p = this.params;
    return `Tobler-shaped speed v(g) = ${this.flatSpeedKmh} km/h * exp(-${p.toblerK}(|g+${p.toblerOffset}|` +
      `-${p.toblerOffset})), g = grade along travel; time = horizontal distance / v`;
  }
}

const ZERO_MARGIN_TOL_MIN = 0.5;

function check(name: string, v: number, positive = false): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new EngineError('input', `${name} must be a finite number`);
  if (positive && v <= 0) throw new EngineError('input', `${name} must be greater than zero`);
  if (v < 0) throw new EngineError('input', `${name} must not be negative`);
  return v;
}

export type EvaCore = Omit<EvaAssessment, 'science_stops' | 'science_min_per_stop' | 'walking_speed_model' |
  'return_route_recalculated' | 'notes'>;

export function assessEva(outboundMin: number, returnMin: number, evaDurationMin: number, reserveMin: number,
                          scienceMin = 0): EvaCore {
  const eva = check('EVA duration', evaDurationMin, true);
  const res = check('reserve time', reserveMin);
  const out = check('outbound time', outboundMin);
  const ret = check('return time', returnMin);
  const sci = check('science time', scienceMin);
  const mission = out + sci + ret + res;
  const margin = eva - mission;
  const status = Math.abs(margin) < ZERO_MARGIN_TOL_MIN ? 'no_slack' : margin > 0 ? 'within_budget' : 'exceeded';
  const usable = Math.max(eva - res, 0.0);
  const used = out + sci + ret;
  // A reserve at least as long as the EVA leaves no usable time: an exceeded budget, not an error.
  const pct = usable > 0 ? Math.min(999.0, used / usable * 100.0) : (used === 0 ? 0.0 : 999.0);
  return {
    eva_duration_min: eva, reserve_min: res, usable_min: usable, outbound_min: out, science_min: sci,
    return_min: ret, mission_time_min: mission, return_margin_min: margin,
    max_science_time_min: eva - out - ret - res, latest_turnaround_elapsed_min: eva - res - ret,
    budget_used_percent: pct, status,
  };
}

export function returnMarginFrom(elapsedMin: number, returnMin: number, evaDurationMin: number, reserveMin: number) {
  const eva = check('EVA duration', evaDurationMin, true);
  const el = check('elapsed time', elapsedMin);
  const ret = check('return time', returnMin);
  const res = check('reserve time', reserveMin);
  const remaining = eva - el;
  const m = remaining - ret - res;
  return {
    elapsed_min: el, remaining_min: remaining, return_min: ret, reserve_min: res, return_margin_min: m,
    must_start_return_in_min: m,
    status: Math.abs(m) < ZERO_MARGIN_TOL_MIN ? 'no_slack' : m > 0 ? 'within_budget' : 'exceeded',
  };
}

export function referenceWithRate(rate: number | null | undefined, base: DoseRateReference = DEFAULT_DOSE_REFERENCE): DoseRateReference {
  if (rate === null || rate === undefined || rate === base.rate_msv_per_day) return base;
  return { ...base, rate_msv_per_day: rate, user_modified: true };
}

export function estimateDose(durationMin: number, ref: DoseRateReference = DEFAULT_DOSE_REFERENCE,
                             absorbedRateUgyPerDay: number | null = null, absorbedSource: string | null = null): DoseEstimate {
  if (!Number.isFinite(durationMin) || durationMin < 0) {
    throw new EngineError('input', 'exposure duration must be a non-negative finite number of minutes');
  }
  if (!(Number.isFinite(ref.rate_msv_per_day) && ref.rate_msv_per_day >= 0)) {
    throw new EngineError('input', 'dose-equivalent rate must be a non-negative finite number');
  }
  const days = durationMin / 1440.0;
  const out: DoseEstimate = {
    dose_equivalent_msv: Math.round(ref.rate_msv_per_day * days * 1e4) / 1e4,
    duration_min: Math.round(durationMin * 10) / 10,
    duration_days: Math.round(days * 1e6) / 1e6,
    formula: 'D = R x t',
    reference: { ...ref },
    absorbed_dose_ugy: null,
    absorbed_reference: null,
    disclaimers: [
      'Historical average from Curiosity RAD at Gale Crater; not a real-time or forecast value.',
      'Linear estimate: excludes solar particle events, solar-cycle changes and suit or terrain shielding.',
      'Not a certified astronaut exposure assessment.',
      'Dose equivalent (mSv) and absorbed dose (uGy) are separate quantities and are not converted.',
    ],
  };
  if (ref.user_modified) {
    out.disclaimers.unshift(`Rate changed by the user to ${ref.rate_msv_per_day} mSv/day for simulation; the source ` +
      'fields describe the original historical baseline.');
  }
  if (absorbedRateUgyPerDay !== null) {
    if (!Number.isFinite(absorbedRateUgyPerDay) || absorbedRateUgyPerDay < 0) {
      throw new EngineError('input', 'absorbed dose rate must be a non-negative finite number');
    }
    out.absorbed_dose_ugy = Math.round(absorbedRateUgyPerDay * days * 1000) / 1000;
    out.absorbed_reference = { rate_ugy_per_day: absorbedRateUgyPerDay, unit: 'uGy/day', quantity: 'absorbed_dose',
      source: absorbedSource ?? 'user supplied' };
  }
  return out;
}

"""EVA time budget and return-to-habitat margin (spec section 14).

    T_mission  = T_outbound + T_science + T_return + T_reserve          must be <= T_EVA
    M          = T_remaining - T_return - T_reserve                      (return margin)
    T_remaining= T_EVA - T_elapsed      at the moment the return starts

At the planned turnaround T_elapsed = T_outbound + T_science, so M = T_EVA - T_mission.

    M > 0   configured time constraint satisfied, M minutes of slack
    M = 0   no slack beyond the reserve       (|M| < 0.5 min is reported as zero)
    M < 0   configured return-time constraint violated

Derived planning numbers:
    max science time    = T_EVA - T_outbound - T_return - T_reserve   (if science were the only variable)
    latest turnaround   = T_EVA - T_reserve - T_return                 (elapsed time to start walking back)
    budget used (%)     = (T_outbound + T_science + T_return) / (T_EVA - T_reserve) * 100
                          (capped at 999; a reserve >= the EVA leaves no usable time -> exceeded)

T_return always comes from a separate A* search from the turnaround point to the habitat, never
from reversing the outbound path. All values are planning estimates, not certified limits.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass

from ..errors import InvalidInputError

ZERO_MARGIN_TOL_MIN = 0.5


def _check(name: str, v: float, positive: bool = False) -> float:
    if v is None or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise InvalidInputError(f"{name} must be a finite number")
    if positive and v <= 0:
        raise InvalidInputError(f"{name} must be greater than zero")
    if v < 0:
        raise InvalidInputError(f"{name} must not be negative")
    return float(v)


@dataclass
class EvaAssessment:
    eva_duration_min: float
    reserve_min: float
    usable_min: float
    outbound_min: float
    science_min: float
    return_min: float
    mission_time_min: float
    return_margin_min: float
    max_science_time_min: float
    latest_turnaround_elapsed_min: float
    budget_used_percent: float
    status: str               # within_budget | no_slack | exceeded

    def to_dict(self, ndigits: int = 1) -> dict:
        return {k: (round(v, ndigits) if isinstance(v, float) else v) for k, v in asdict(self).items()}


def assess_eva(outbound_min: float, return_min: float, eva_duration_min: float, reserve_min: float,
               science_min: float = 0.0) -> EvaAssessment:
    eva = _check("EVA duration", eva_duration_min, positive=True)
    res = _check("reserve time", reserve_min)
    out = _check("outbound time", outbound_min)
    ret = _check("return time", return_min)
    sci = _check("science time", science_min)
    mission = out + sci + ret + res
    margin = eva - mission
    status = ("no_slack" if abs(margin) < ZERO_MARGIN_TOL_MIN
              else "within_budget" if margin > 0 else "exceeded")
    usable = max(eva - res, 0.0)
    used = out + sci + ret
    # A reserve at least as long as the EVA leaves no usable time: report it as an exceeded
    # budget (capped percentage) rather than rejecting the request, so the route still draws.
    pct = min(999.0, used / usable * 100.0) if usable > 0 else (0.0 if used == 0 else 999.0)
    return EvaAssessment(
        eva_duration_min=eva, reserve_min=res, usable_min=usable,
        outbound_min=out, science_min=sci, return_min=ret,
        mission_time_min=mission, return_margin_min=margin,
        max_science_time_min=eva - out - ret - res,
        latest_turnaround_elapsed_min=eva - res - ret,
        budget_used_percent=pct,
        status=status)


def return_margin_from(elapsed_min: float, return_min: float, eva_duration_min: float, reserve_min: float) -> dict:
    """Field check from the CURRENT position: M = (T_EVA - T_elapsed) - T_return - T_reserve."""
    eva = _check("EVA duration", eva_duration_min, positive=True)
    el = _check("elapsed time", elapsed_min)
    ret = _check("return time", return_min)
    res = _check("reserve time", reserve_min)
    remaining = eva - el
    m = remaining - ret - res
    return {
        "elapsed_min": round(el, 1),
        "remaining_min": round(remaining, 1),
        "return_min": round(ret, 1),
        "reserve_min": round(res, 1),
        "return_margin_min": round(m, 1),
        "must_start_return_in_min": round(m, 1),
        "status": ("no_slack" if abs(m) < ZERO_MARGIN_TOL_MIN else "within_budget" if m > 0 else "exceeded"),
    }

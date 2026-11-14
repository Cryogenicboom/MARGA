"""Linear radiation dose estimate for an EVA (spec section 15).

    D = R * t        D  dose equivalent (mSv)
                     R  selected dose-equivalent rate (mSv/day)
                     t  exposure duration (days) = minutes / 1440

Default R = 0.67 mSv/day: surface dose-equivalent rate measured by Curiosity's RAD at Gale
Crater, August 2012 - June 2013, as reported by NASA. It is a HISTORICAL average, not a forecast:
it ignores solar particle events, solar-cycle variation, local shielding by terrain and the suit,
and location. Absorbed dose (Gy) and dose equivalent (Sv) are different quantities; an absorbed
rate is only reported if one is supplied, and the two are never converted into each other.
"""
from __future__ import annotations

import math
from dataclasses import asdict, replace

from ..config import DoseRateReference
from ..errors import InvalidInputError

MIN_PER_DAY = 1440.0


def estimate_dose(duration_min: float, reference: DoseRateReference = DoseRateReference(),
                  absorbed_rate_ugy_per_day: float | None = None, absorbed_source: str | None = None) -> dict:
    if duration_min is None or not math.isfinite(duration_min) or duration_min < 0:
        raise InvalidInputError("exposure duration must be a non-negative finite number of minutes")
    if not (math.isfinite(reference.rate_msv_per_day) and reference.rate_msv_per_day >= 0):
        raise InvalidInputError("dose-equivalent rate must be a non-negative finite number")
    days = duration_min / MIN_PER_DAY
    out = {
        "dose_equivalent_msv": round(reference.rate_msv_per_day * days, 4),
        "duration_min": round(duration_min, 1),
        "duration_days": round(days, 6),
        "formula": "D = R x t",
        "reference": asdict(reference),
        "absorbed_dose_ugy": None,
        "absorbed_reference": None,
        "disclaimers": [
            "Historical average from Curiosity RAD at Gale Crater; not a real-time or forecast value.",
            "Linear estimate: excludes solar particle events, solar-cycle changes and suit or terrain shielding.",
            "Not a certified astronaut exposure assessment.",
            "Dose equivalent (mSv) and absorbed dose (uGy) are separate quantities and are not converted.",
        ],
    }
    if reference.user_modified:
        out["disclaimers"].insert(0, f"Rate changed by the user to {reference.rate_msv_per_day:g} mSv/day for "
                                     "simulation; the source fields describe the original historical baseline.")
    if absorbed_rate_ugy_per_day is not None:
        if not math.isfinite(absorbed_rate_ugy_per_day) or absorbed_rate_ugy_per_day < 0:
            raise InvalidInputError("absorbed dose rate must be a non-negative finite number")
        out["absorbed_dose_ugy"] = round(absorbed_rate_ugy_per_day * days, 3)
        out["absorbed_reference"] = {"rate_ugy_per_day": absorbed_rate_ugy_per_day, "unit": "uGy/day",
                                     "quantity": "absorbed_dose", "source": absorbed_source or "user supplied"}
    return out


def reference_with_rate(rate_msv_per_day: float | None, base: DoseRateReference = DoseRateReference()) -> DoseRateReference:
    """A user-changed simulation rate keeps the historical provenance but is flagged as modified."""
    if rate_msv_per_day is None or rate_msv_per_day == base.rate_msv_per_day:
        return base
    return replace(base, rate_msv_per_day=float(rate_msv_per_day), user_modified=True)

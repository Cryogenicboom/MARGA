"""Walking-speed model used for travel-time estimates.

Shape: Tobler's hiking function (Tobler 1993), v = 6 exp(-3.5 |g + 0.05|) km/h, where g is the
grade (rise/run) in the direction of travel. MARGA keeps Tobler's SHAPE but scales it so that
walking on level ground gives exactly the configured `walkingSpeedKmh` from MissionConstraints:

    v(g) = v_flat * exp(-k * (|g + g0| - g0)),    k = 3.5, g0 = 0.05

    v(0)    = v_flat
    v(-g0)  = v_flat * exp(k g0) ~= 1.19 v_flat     (fastest: gentle downhill)
    v(0.27) ~= 0.33 v_flat                         (15 deg uphill)

Time over a step of horizontal length l is  t = l / v(g). This is a simulation assumption for
planning; it is not a validated model of suited astronaut mobility on Mars.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from ..config import MobilityParams
from ..errors import InvalidInputError


@dataclass(frozen=True)
class MobilityModel:
    flat_speed_kmh: float
    params: MobilityParams = MobilityParams()

    def __post_init__(self):
        if not (math.isfinite(self.flat_speed_kmh) and self.flat_speed_kmh > 0):
            raise InvalidInputError("walkingSpeedKmh must be a positive number")

    def speed_kmh(self, grade):
        """Speed for grade(s) rise/run (scalar or numpy array)."""
        k, g0 = self.params.tobler_k, self.params.tobler_offset
        v = self.flat_speed_kmh * np.exp(-k * (np.abs(np.asarray(grade, dtype=np.float64) + g0) - g0))
        v = np.maximum(v, self.params.min_speed_kmh)
        return float(v) if np.ndim(v) == 0 else v

    @property
    def max_speed_kmh(self) -> float:
        return self.flat_speed_kmh * math.exp(self.params.tobler_k * self.params.tobler_offset)

    def minutes(self, horizontal_m, grade):
        """Walking minutes for horizontal distance(s) at grade(s)."""
        return np.asarray(horizontal_m, dtype=np.float64) / 1000.0 / self.speed_kmh(grade) * 60.0

    @property
    def min_minutes_per_m(self) -> float:
        """Lower bound of minutes per horizontal metre (used by the A* heuristic)."""
        return 60.0 / (1000.0 * self.max_speed_kmh)

    def describe(self) -> str:
        p = self.params
        return (f"Tobler-shaped speed v(g) = {self.flat_speed_kmh:g} km/h * exp(-{p.tobler_k:g}(|g+{p.tobler_offset:g}|"
                f"-{p.tobler_offset:g})), g = grade along travel; time = horizontal distance / v")

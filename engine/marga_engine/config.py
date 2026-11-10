"""Engine configuration: every tunable number lives here, with its meaning.

None of these values is a certified astronaut mobility or safety limit. They are simulation
parameters for preliminary planning, chosen to be explainable and easy to change.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Literal

RouteMetric = Literal["terrain", "distance", "time"]
UnknownPolicy = Literal["exclude", "penalize"]

# Terrain classes used by TerrainSummary in shared/types/index.ts (degrees of terrain slope).
SLOPE_CLASS_FLAT_MAX = 5.0       # flat      : S < 5
SLOPE_CLASS_MODERATE_MAX = 12.0  # moderate  : 5 <= S < 12
SLOPE_CLASS_STEEP_MAX = 20.0     # steep     : 12 <= S < 20, hazardous: S >= 20


@dataclass(frozen=True)
class CostWeights:
    """Weights of the terrain cost  C = L (1 + w_s P_s + w_r P_r + w_u P_u).

    slope        w_s : at the slope limit the cost per metre is (1 + w_s) times the flat cost.
    roughness    w_r : only applied when a roughness field exists (never fabricated).
    uncertainty  w_u : only used with unknown_policy='penalize'; extra cost per metre of
                       ground with no elevation data, on top of assuming the worst allowed slope.
    slope_exponent p : P_s = (S / S_max)^p. p = 2 keeps gentle ground cheap and makes cost rise
                       steeply as the limit is approached.
    """
    slope: float = 4.0
    roughness: float = 1.0
    uncertainty: float = 2.0
    slope_exponent: float = 2.0


@dataclass(frozen=True)
class MobilityParams:
    """Shape of the speed-vs-grade curve (Tobler 1993), normalised to the configured flat speed.

        v(g) = v_flat * exp(-k * (|g + g0| - g0)),   g = rise/run along the direction of travel

    v(0) = v_flat; fastest at a slight downhill (g = -g0) where v = v_flat * exp(k g0).
    """
    tobler_k: float = 3.5
    tobler_offset: float = 0.05
    min_speed_kmh: float = 0.05   # numerical floor only; never reached at slopes below 60 deg


@dataclass(frozen=True)
class DoseRateReference:
    """Historical dose-equivalent rate used for the linear EVA dose estimate D = R t."""
    rate_msv_per_day: float = 0.67
    quantity: str = "dose_equivalent"
    unit: str = "mSv/day"
    mission: str = "Mars Science Laboratory (Curiosity)"
    instrument: str = "RAD (Radiation Assessment Detector)"
    location: str = "Gale Crater surface"
    measurement_period: str = "August 2012 - June 2013"
    source_url: str = ("https://www.nasa.gov/news-release/nasa-rover-results-include-first-age-"
                       "measurement-on-mars-and-help-for-human-exploration/")
    is_historical: bool = True
    user_modified: bool = False


@dataclass(frozen=True)
class EngineConfig:
    weights: CostWeights = field(default_factory=CostWeights)
    mobility: MobilityParams = field(default_factory=MobilityParams)
    dose_reference: DoseRateReference = field(default_factory=DoseRateReference)

    metric: RouteMetric = "terrain"
    unknown_policy: UnknownPolicy = "exclude"

    # Roughness is computed from the DEM only when its cells are this fine or finer. Coarser DEMs
    # cannot resolve walking-scale roughness, so the term is omitted instead of guessed.
    roughness_max_cell_m: float = 30.0
    roughness_ref_m: float = 2.0      # detrended RMS at which P_r saturates at 1

    # A start/target that sits on prohibited or unknown ground is moved to the nearest
    # traversable cell within this distance (and the move is reported). Beyond it: unreachable.
    endpoint_snap_m: float = 150.0

    # Search window around each leg and the cap on cells searched at once. Larger windows are
    # searched on block-aggregated cells (conservative: max slope, any-unknown).
    window_pad_fraction: float = 0.35
    window_pad_min_m: float = 600.0
    max_search_cells: int = 300_000
    # After a coarse search, re-run at native resolution inside a corridor this wide (cells of
    # the coarse grid on each side) so the final path is not limited by aggregation.
    refine_corridor_cells: int = 3

    smoothing: bool = True
    smoothing_tolerance: float = 0.0   # a straightened piece may not cost more than the grid path

    compute_alternatives: bool = True
    max_profile_points: int = 1500     # output decimation only; statistics use every sample

    # DEM resolution above which the engine warns that it is not an obstacle map.
    coarse_dem_warning_m: float = 100.0

    def with_overrides(self, **kw) -> "EngineConfig":
        return replace(self, **kw)


DEFAULT_CONFIG = EngineConfig()

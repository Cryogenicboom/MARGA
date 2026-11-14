"""EVA budget, mobility and radiation (spec 23.4, 23.5)."""
import math

import pytest

from marga_engine.config import DoseRateReference
from marga_engine.errors import InvalidInputError
from marga_engine.eva.budget import assess_eva, return_margin_from
from marga_engine.eva.mobility import MobilityModel
from marga_engine.eva.radiation import estimate_dose, reference_with_rate


# --- mobility ----------------------------------------------------------------------------------

def test_flat_speed_is_the_configured_speed():
    m = MobilityModel(1.2)
    assert m.speed_kmh(0.0) == pytest.approx(1.2)
    assert m.minutes(1000.0, 0.0) == pytest.approx(50.0)


def test_tobler_shape():
    m = MobilityModel(2.0)
    assert m.max_speed_kmh == pytest.approx(2.0 * math.exp(3.5 * 0.05))
    assert m.speed_kmh(-0.05) == pytest.approx(m.max_speed_kmh)
    assert m.speed_kmh(0.1) == pytest.approx(m.speed_kmh(-0.2))          # symmetric about -0.05
    assert m.speed_kmh(0.27) < m.speed_kmh(0.0) < m.speed_kmh(-0.05)
    assert m.min_minutes_per_m == pytest.approx(60 / (1000 * m.max_speed_kmh))


@pytest.mark.parametrize("v", [0, -1, float("nan"), float("inf")])
def test_invalid_speed_rejected(v):
    with pytest.raises(InvalidInputError):
        MobilityModel(v)


# --- EVA budget --------------------------------------------------------------------------------

def test_mission_that_fits():
    e = assess_eva(outbound_min=90, return_min=80, eva_duration_min=480, reserve_min=60, science_min=120)
    assert e.mission_time_min == 350
    assert e.return_margin_min == 130
    assert e.status == "within_budget"
    assert e.latest_turnaround_elapsed_min == 480 - 60 - 80
    assert e.max_science_time_min == 480 - 90 - 80 - 60
    assert e.budget_used_percent == pytest.approx((90 + 120 + 80) / 420 * 100)


def test_margin_formula_is_remaining_minus_return_minus_reserve():
    e = assess_eva(100, 95, 300, 30, 40)
    remaining_at_turnaround = 300 - (100 + 40)
    assert e.return_margin_min == pytest.approx(remaining_at_turnaround - 95 - 30)


def test_insufficient_return_time():
    e = assess_eva(200, 210, 480, 90, 0)
    assert e.return_margin_min == pytest.approx(-20)
    assert e.status == "exceeded"


def test_zero_margin_is_flagged():
    e = assess_eva(150, 150, 400, 100, 0)
    assert e.return_margin_min == 0 and e.status == "no_slack"


def test_changed_reserve_shifts_margin_one_for_one():
    a = assess_eva(100, 100, 480, 30, 60)
    b = assess_eva(100, 100, 480, 75, 60)
    assert a.return_margin_min - b.return_margin_min == pytest.approx(45)


@pytest.mark.parametrize("args", [
    dict(outbound_min=10, return_min=10, eva_duration_min=0, reserve_min=0),       # zero duration
    dict(outbound_min=10, return_min=10, eva_duration_min=-60, reserve_min=0),     # negative
    dict(outbound_min=-1, return_min=10, eva_duration_min=60, reserve_min=0),
    dict(outbound_min=float("nan"), return_min=10, eva_duration_min=60, reserve_min=0),
])
def test_invalid_eva_inputs(args):
    with pytest.raises(InvalidInputError):
        assess_eva(**args)


def test_reserve_not_shorter_than_eva_is_an_exceeded_budget_not_an_error():
    # The PARAMS panel allows EVA 2 h with reserve 4 h; that must still produce a route that says why it fails.
    e = assess_eva(30, 30, 120, 240)
    assert e.status == "exceeded" and e.usable_min == 0 and e.budget_used_percent == 999
    assert e.return_margin_min == pytest.approx(120 - 300)
    assert assess_eva(0, 0, 60, 60).budget_used_percent == 0


def test_return_margin_from_current_position():
    m = return_margin_from(elapsed_min=200, return_min=120, eva_duration_min=480, reserve_min=60)
    assert m["remaining_min"] == 280 and m["return_margin_min"] == 100 and m["status"] == "within_budget"
    assert return_margin_from(400, 120, 480, 60)["status"] == "exceeded"


# --- radiation ---------------------------------------------------------------------------------

def test_four_hour_eva_matches_spec_example():
    d = estimate_dose(240)
    assert d["dose_equivalent_msv"] == pytest.approx(0.67 * 4 / 24, abs=1e-4)
    assert d["dose_equivalent_msv"] == pytest.approx(0.1117, abs=1e-4)
    assert d["duration_days"] == pytest.approx(4 / 24, abs=1e-6)


def test_dose_reference_is_labelled_historical_with_units_and_period():
    r = estimate_dose(60)["reference"]
    assert r["rate_msv_per_day"] == 0.67 and r["unit"] == "mSv/day" and r["quantity"] == "dose_equivalent"
    assert r["measurement_period"] == "August 2012 - June 2013" and r["is_historical"] is True
    assert "RAD" in r["instrument"] and "Curiosity" in r["mission"]


def test_absorbed_dose_kept_separate_and_never_derived():
    d = estimate_dose(1440)
    assert d["absorbed_dose_ugy"] is None and d["absorbed_reference"] is None
    d2 = estimate_dose(1440, absorbed_rate_ugy_per_day=200.0, absorbed_source="test value")
    assert d2["absorbed_dose_ugy"] == pytest.approx(200.0)
    assert d2["dose_equivalent_msv"] == pytest.approx(0.67)            # unchanged by the absorbed input


def test_user_modified_rate_is_flagged():
    ref = reference_with_rate(1.0)
    assert ref.user_modified and ref.rate_msv_per_day == 1.0
    d = estimate_dose(1440, ref)
    assert d["dose_equivalent_msv"] == pytest.approx(1.0)
    assert "changed by the user" in d["disclaimers"][0]
    assert reference_with_rate(None) == DoseRateReference()


@pytest.mark.parametrize("bad", [-1, float("nan"), float("inf")])
def test_invalid_dose_duration(bad):
    with pytest.raises(InvalidInputError):
        estimate_dose(bad)


def test_zero_duration_zero_dose():
    assert estimate_dose(0)["dose_equivalent_msv"] == 0

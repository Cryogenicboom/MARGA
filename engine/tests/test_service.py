"""End-to-end RouteRequest -> RouteResponse, contract conformance, API."""
import copy
import json
import re

import numpy as np
import pytest

from conftest import REPO, base_request, ll
from marga_engine import plan_route
from marga_engine.contracts import TargetCatalogue
from marga_engine.service import assess_return
from marga_engine.terrain import synthetic

BRADBURY = (-4.5895, 137.4417)
MURRAY = (-4.6650, 137.3950)
RAD_ALPHA = (-4.6000, 137.4200)


def ts_interface_fields(path, name):
    """Field names of `export interface <name>` in a TypeScript file (top level of the interface)."""
    f = REPO / path
    if not f.exists():
        pytest.fail(f"{path} is missing from this checkout: the engine's TypeScript contract lives there. "
                    "Copy the whole shared/ folder (shared/types/engine.ts and shared/engine/) from the engine bundle.")
    src = f.read_text(encoding="utf-8")
    m = re.search(r"export interface " + name + r"\b[^{]*\{(.*?)\n\}", src, re.S)
    assert m, f"{name} not found in {path}"
    fields = {}
    for line in m.group(1).splitlines():
        f = re.match(r"\s*([a-z_0-9]+)(\??):", line)
        if f:
            fields[f.group(1)] = f.group(2) == "?"
    return fields


@pytest.fixture(scope="module")
def ok_response(demo):
    req = base_request(BRADBURY, MURRAY, walkingSpeedKmh=2.0, scienceTimeMinPerStop=20)
    req["waypoints"] = [{"latitude": RAD_ALPHA[0], "longitude": RAD_ALPHA[1], "name": "RAD Point Alpha"}]
    return plan_route(req, demo)


def test_response_has_every_shared_contract_field(ok_response):
    r = ok_response
    for k, optional in ts_interface_fields("shared/types/index.ts", "RouteResponse").items():
        assert optional or k in r, f"missing RouteResponse.{k}"
    for k in ts_interface_fields("shared/types/index.ts", "TerrainSummary"):
        assert isinstance(r["terrain_summary"][k], int)
    for seg in r["segments"]:
        for k in ts_interface_fields("shared/types/index.ts", "RouteSegment"):
            assert k in seg
    for p in r["elevation_profile"]:
        for k in ts_interface_fields("shared/types/index.ts", "ElevationPoint"):
            assert k in p
        assert len(p["coordinate"]) == 2
    for k in ("distance_m", "distance_3d_m", "elevation_gain_m", "elevation_loss_m", "estimated_time_min",
              "eva_budget_used_percent", "return_margin_min"):
        assert isinstance(r[k], int), k                      # frontend does integer arithmetic on these
    assert r["status"] in ("calculated", "warning", "unreachable", "failed")


def test_extension_fields_are_declared_in_engine_types(ok_response):
    declared = ts_interface_fields("shared/types/engine.ts", "EngineRouteResponse")
    base = ts_interface_fields("shared/types/index.ts", "RouteResponse")
    for k in ok_response:
        assert k in declared or k in base, f"undeclared response field {k}"
    eva = ts_interface_fields("shared/types/engine.ts", "EvaAssessment")
    assert set(ok_response["eva_assessment"]) == set(eva)


def test_coordinates_are_lon_lat_and_start_end_match(ok_response):
    c = ok_response["coordinates"]
    assert c[0] == pytest.approx([BRADBURY[1], BRADBURY[0]], abs=1e-6)
    assert c[-1] == pytest.approx([MURRAY[1], MURRAY[0]], abs=1e-6)


def test_multi_waypoint_segments_and_names(ok_response):
    s = ok_response["segments"]
    assert [(x["from_name"], x["to_name"]) for x in s] == [("Habitat", "RAD Point Alpha"), ("RAD Point Alpha", "Target")]
    assert sum(x["distance_m"] for x in s) == pytest.approx(ok_response["distance_m"], abs=2)


def test_terrain_summary_adds_to_100(ok_response):
    t = ok_response["terrain_summary"]
    assert t["flat_pct"] + t["moderate_pct"] + t["steep_pct"] + t["hazardous_pct"] + t["unknown_pct"] == 100


def test_eva_numbers_are_consistent(ok_response):
    r, e = ok_response, ok_response["eva_assessment"]
    assert e["science_min"] == 40.0 and e["science_stops"] == 2
    assert e["mission_time_min"] == pytest.approx(e["outbound_min"] + e["science_min"] + e["return_min"] + e["reserve_min"], abs=0.11)
    assert e["return_margin_min"] == pytest.approx(e["eva_duration_min"] - e["mission_time_min"], abs=0.11)
    assert r["return_margin_min"] <= e["return_margin_min"] + 0.05 < r["return_margin_min"] + 1.1   # floored
    assert r["estimated_time_min"] >= e["outbound_min"]
    assert r["return_route"]["recalculated"] is True


def test_radiation_attached_with_source(ok_response):
    rad = ok_response["radiation"]
    e = ok_response["eva_assessment"]
    exposure = e["outbound_min"] + e["science_min"] + e["return_min"]
    assert rad["planned_activity"]["dose_equivalent_msv"] == pytest.approx(0.67 * exposure / 1440, abs=2e-4)
    assert rad["full_eva_duration"]["dose_equivalent_msv"] == pytest.approx(0.67 * 8 / 24, abs=1e-4)
    assert rad["planned_activity"]["reference"]["is_historical"]


def test_synthetic_terrain_always_flagged(ok_response):
    assert ok_response["warnings"][0].startswith("SYNTHETIC TEST TERRAIN")
    assert ok_response["terrain_source"]["synthetic"] is True


def test_deterministic_ids_and_outputs(demo):
    req = base_request(BRADBURY, MURRAY)
    a, b = plan_route(copy.deepcopy(req), demo), plan_route(copy.deepcopy(req), demo)
    assert a["route_id"] == b["route_id"]
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
    req2 = base_request(BRADBURY, MURRAY, walkingSpeedKmh=1.5)
    assert plan_route(req2, demo)["route_id"] != a["route_id"]


def test_alternatives_present_and_ordered(demo):
    r = plan_route(base_request(BRADBURY, (-4.74, 137.33)), demo)
    alt = r["alternatives"]
    assert alt["selected_metric"] == "terrain"
    assert alt["distance"]["distance_m"] <= alt["terrain"]["distance_m"] + 1e-6
    assert alt["terrain"]["max_terrain_slope_deg"] <= alt["distance"]["max_terrain_slope_deg"] + 1e-6
    assert alt["direct_line"][0]["distance_m"] <= alt["distance"]["distance_m"] + 1e-6


def test_eva_budget_exceeded_is_unreachable(demo):
    r = plan_route(base_request(BRADBURY, (-4.74, 137.33), maxEvaHours=3.0, reserveEvaHours=0.5), demo)
    assert r["status"] == "unreachable" and r["status_reason"] == "eva_budget_exceeded"
    assert r["return_margin_min"] < 0 and r["coordinates"]


def test_return_goes_to_separate_habitat_and_is_recalculated(demo):
    req = base_request(BRADBURY, MURRAY)
    req["habitat"] = {"latitude": -4.60, "longitude": 137.45, "name": "Hab-2"}
    r = plan_route(req, demo)
    ret = r["return_route"]
    assert ret["to_name"] == "Hab-2"
    assert ret["coordinates"][-1] == pytest.approx([137.45, -4.60], abs=1e-6)
    assert ret["coordinates"][0] == pytest.approx(r["coordinates"][-1], abs=1e-6)


def test_return_time_is_not_assumed_equal_to_outbound(demo):
    r = plan_route(base_request(BRADBURY, MURRAY), demo)          # uphill out, downhill back
    assert r["eva_assessment"]["return_min"] < r["eva_assessment"]["outbound_min"]


@pytest.mark.parametrize("mutate,expect", [
    (lambda q: q["constraints"].update(walkingSpeedKmh=-1), "walkingSpeedKmh"),
    (lambda q: q["constraints"].update(reserveEvaHours=-1), "reserveEvaHours"),
    (lambda q: q["constraints"].update(maxEvaHours=0), "maxEvaHours"),
    (lambda q: q["start"].update(latitude=100), "latitude"),
    (lambda q: q.pop("destination"), "Destination"),
    (lambda q: q["constraints"].update(maxSlopeDegrees="steep"), "maxSlopeDegrees"),
    (lambda q: q.update(options={"metric": "fastest"}), "metric"),
])
def test_invalid_requests_fail_with_message(demo, mutate, expect):
    req = base_request(BRADBURY, MURRAY)
    mutate(req)
    r = plan_route(req, demo)
    assert r["status"] == "failed" and r["status_reason"] == "invalid_request"
    assert any(expect in w for w in r["warnings"])


def test_reserve_longer_than_eva_still_draws_route(demo):
    r = plan_route(base_request(BRADBURY, MURRAY, maxEvaHours=2.0, reserveEvaHours=4.0), demo)
    assert r["status"] == "unreachable" and r["status_reason"] == "eva_budget_exceeded"
    assert r["coordinates"] and r["eva_budget_used_percent"] == 999
    assert any("not shorter than the EVA" in w for w in r["warnings"])


def test_mission_summary_block(ok_response):
    m = ok_response["mission_summary"]
    assert m["targets"] == ["RAD Point Alpha", "Target"]
    assert m["total_distance_m"] == ok_response["distance_m"]
    assert m["estimated_working_time_min"] == 40
    assert m["return_margin_min"] == ok_response["return_margin_min"]
    assert "historical" in m["radiation"]["basis"] and m["dataset_references"]


def test_profile_values_are_integers_like_the_ui_expects(ok_response):
    p = ok_response["elevation_profile"]
    assert all(isinstance(x["elevation_m"], int) and isinstance(x["distance_m"], int) for x in p)


def test_outside_coverage_fails(demo):
    r = plan_route(base_request(BRADBURY, (18.44, 77.45)), demo)        # Jezero is not in the Gale package
    assert r["status"] == "failed" and r["status_reason"] == "outside_terrain_coverage"


def test_unreachable_target_reports_leg(demo):
    t = synthetic.from_array(np.pad(np.full((11, 11), -4500.0), 15, constant_values=-4500.0), 20.0)
    e = t.elevation.copy()
    yy, xx = np.indices(e.shape)
    e[(np.hypot(yy - 20, xx - 20) > 6) & (np.hypot(yy - 20, xx - 20) < 9)] += 300
    t2 = synthetic.from_array(e, 20.0)
    r = plan_route(base_request(ll(t2, 2, 2), ll(t2, 20, 20)), t2)
    assert r["status"] == "unreachable" and r["status_reason"] == "no_traversable_path"
    assert any("Leg 1" in w for w in r["warnings"]) and r["coordinates"] == []


def test_target_ids_resolved_from_catalogue(demo):
    cat = TargetCatalogue([
        {"id": "target_rad", "name": "RAD Point", "category": "radiation", "latitude": RAD_ALPHA[0],
         "longitude": RAD_ALPHA[1], "elevation_m": 0, "source": "test", "instrument": "RAD",
         "confidence": "high", "description": "test fixture"}])
    req = base_request(BRADBURY, MURRAY)
    req["target_ids"] = ["target_rad"]
    r = plan_route(req, demo, catalogue=cat)
    assert [s["to_name"] for s in r["segments"]] == ["RAD Point", "Target"]
    req["target_ids"] = ["nope"]
    assert plan_route(req, demo, catalogue=cat)["status"] == "failed"


def test_snapped_target_warns(demo):
    # pick a demo cell steeper than 15 deg and route to it
    s = demo.slope_deg
    r_, c_ = np.argwhere(np.nan_to_num(s) > 25)[0]
    r = plan_route(base_request(BRADBURY, ll(demo, r_, c_)), demo)
    assert r["status"] in ("warning", "unreachable")
    assert any("nearest traversable cell" in w for w in r["warnings"])


def test_penalize_policy_flags_interpolated_profile():
    e = np.full((41, 61), -4500.0)
    e[:, 28:33] = np.nan
    t = synthetic.from_array(e, 20.0)
    req = base_request(ll(t, 20, 5), ll(t, 20, 55))
    assert plan_route(req, t)["status"] == "unreachable"
    req["options"] = {"unknown_policy": "penalize"}
    r = plan_route(req, t)
    assert r["status"] == "warning"
    assert any("no elevation data" in w for w in r["warnings"])
    assert any(p["data_quality"] == "interpolated" for p in r["elevation_profile"])
    assert r["terrain_summary"]["unknown_pct"] > 0


def test_field_return_check(demo):
    body = {"position": {"latitude": -4.63, "longitude": 137.41}, "habitat": {"latitude": BRADBURY[0], "longitude": BRADBURY[1]},
            "elapsed_min": 120, "constraints": base_request(BRADBURY, MURRAY)["constraints"]}
    r = assess_return(body, demo)
    m = r["margin"]
    assert m["return_margin_min"] == pytest.approx(480 - 120 - m["return_min"] - 90, abs=0.11)
    body["elapsed_min"] = 470
    assert assess_return(body, demo)["status"] == "unreachable"


def test_http_api(demo):
    pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient
    from marga_engine.api import create_app
    c = TestClient(create_app(terrain=demo))
    assert c.get("/api/health").json()["terrain"]["synthetic"] is True
    r = c.post("/api/route", json=base_request(BRADBURY, MURRAY)).json()
    assert r["coordinates"] and r["route_id"].startswith("marga_route_")
    assert c.post("/api/radiation", json={"duration_min": 240}).json()["dose_equivalent_msv"] == pytest.approx(0.1117, abs=1e-4)
    assert c.post("/api/radiation", json={"duration_min": -5}).status_code == 400
    assert c.post("/api/eva/return", json={"position": {}}).status_code == 400

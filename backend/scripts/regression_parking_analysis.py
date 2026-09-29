"""Developer-only real-image regression runner for Parking Analysis V1.

Run from backend/ with the local environment:
  ..\.venv\Scripts\python.exe scripts/regression_parking_analysis.py IMAGE
"""

import argparse
import json
import mimetypes
import re
import sys
from pathlib import Path

from fastapi.testclient import TestClient
from shapely.geometry import Polygon
from shapely.ops import unary_union

from app.main import app
from app.services.virtual_fitting_service import FITTING_TOLERANCE_M, LENGTH_M, WIDTH_M

AREA_TOLERANCE_M2 = 0.05
REFERENCE = {
    "detected": 86, "metric_projected": 86,
    "historical_included": 28, "historical_excluded": 58,
}
HISTORICAL_ROW_AREAS = {"row_1": 30.0, "row_2": 30.0, "row_3": 30.0, "row_4": 36.0, "row_5": 36.0}


def _row_sort_key(row_id: str) -> tuple[int, str]:
    match = re.fullmatch(r"row_(\d+)", str(row_id))
    return (int(match.group(1)), str(row_id)) if match else (10**12, str(row_id))


def _ordered_row_ids(analysis: dict) -> list[str]:
    """Return the runtime's authoritative physical row IDs in numeric order."""
    physical_rows = (analysis.get("physical_map") or {}).get("rows", [])
    if physical_rows:
        return sorted({str(row["row_id"]) for row in physical_rows if row.get("row_id")}, key=_row_sort_key)
    sections = ("occupied_space", "free_space", "virtual_fitting", "capacity", "parking_state")
    ids = {str(row["row_id"]) for section in sections for row in (analysis.get(section) or {}).get("rows", []) if row.get("row_id")}
    return sorted(ids, key=_row_sort_key)


def _authoritative_row_areas(analysis: dict, row_ids: list[str]) -> dict[str, float]:
    physical = {str(row["row_id"]): row for row in (analysis.get("physical_map") or {}).get("rows", [])}
    free = {str(row["row_id"]): row for row in (analysis.get("free_space") or {}).get("rows", [])}
    return {row_id: float((physical.get(row_id) or {}).get("area_m2", (free.get(row_id) or {}).get("row_area_m2", 0.0))) for row_id in row_ids}


def _status(actual, expected):
    return "PASS" if actual == expected else f"FAIL (actual={actual!r}, expected={expected!r})"


def _geometry_counts(geometry):
    polygons = geometry.get("polygons", []) if geometry else []
    return len(polygons), sum(max(0, len(polygon) - 1) for polygon in polygons)


def _feasible_component_count(geometry):
    if geometry.get("geometry_type") in {"GeometryCollection", "MultiPoint", "MultiLineString"}:
        return sum(_feasible_component_count(item) for item in geometry.get("geometries", []))
    if not geometry or geometry.get("polygons") == []:
        return 0 if not geometry or geometry.get("geometry_type") not in {"Point", "LineString"} else 1
    return len(geometry.get("polygons", []))


def _polygon_geometry(geometry):
    polygons = []
    for rings in (geometry or {}).get("polygons", []):
        if not rings:
            continue
        polygons.append(Polygon([(p["x_m"], p["y_m"]) for p in rings[0]], [[(p["x_m"], p["y_m"]) for p in ring] for ring in rings[1:]]))
    return unary_union(polygons) if polygons else Polygon()


def _projection_is_valid(geometry: dict | None) -> bool:
    polygons = (geometry or {}).get("polygons", [])
    if not polygons:
        return False
    return all(
        all(("x" in point and "y" in point) or ("x_m" in point and "y_m" in point) for point in ring)
        for polygon in polygons
        for ring in polygon
    )


def _validate_capacity_row(row_id: str, capacity_row: dict, physical_row: dict, occupied_row: dict) -> tuple[bool, list[str]]:
    placements = capacity_row.get("placements") or []
    physical = _polygon_geometry({"polygons": [[physical_row.get("polygon", [])]]})
    occupied = _polygon_geometry(occupied_row.get("occupied_geometry"))
    valid = True
    failures: list[str] = []
    witnesses = []
    for index, placement in enumerate(placements):
        footprint = _polygon_geometry(placement.get("footprint_metric"))
        if not footprint.is_valid or abs(footprint.area - WIDTH_M * LENGTH_M) > FITTING_TOLERANCE_M:
            valid = False; failures.append(f"{row_id}[{index}]:dimensions")
        if not physical.buffer(FITTING_TOLERANCE_M).covers(footprint):
            valid = False; failures.append(f"{row_id}[{index}]:row_containment")
        if footprint.intersection(occupied).area > FITTING_TOLERANCE_M:
            valid = False; failures.append(f"{row_id}[{index}]:occupied_overlap")
        projected = placement.get("footprint_image_normalized")
        if projected is not None and not _projection_is_valid(projected):
            valid = False; failures.append(f"{row_id}[{index}]:projection")
        witnesses.append(footprint)
    for left_index, left in enumerate(witnesses):
        for right_index in range(left_index + 1, len(witnesses)):
            if left.intersection(witnesses[right_index]).area > FITTING_TOLERANCE_M:
                valid = False; failures.append(f"{row_id}[{left_index},{right_index}]:pairwise_overlap")
    return valid, failures


def main() -> int:
    parser = argparse.ArgumentParser(description="Run real ParkMap backend parking-analysis regression.")
    parser.add_argument("image", type=Path)
    parser.add_argument("--dump-json", type=Path, default=None)
    parser.add_argument("--trace-inclusion", action="store_true")
    args = parser.parse_args()
    if not args.image.is_file():
        print(f"FAIL: image not found: {args.image}")
        return 2
    content_type = mimetypes.guess_type(args.image.name)[0] or "application/octet-stream"
    with args.image.open("rb") as handle:
        response = TestClient(app).post("/api/detection/analyze", files={"image": (args.image.name, handle, content_type)})
    if response.status_code != 200:
        print(f"FAIL: API returned HTTP {response.status_code}: {response.text}")
        return 1
    payload = response.json()
    if not payload.get("parking_analysis"):
        print("FAIL: Backend response does not contain parking_analysis.")
        print("Frontend values could therefore be coming from the temporary legacy fallback.")
        return 1
    if args.dump_json:
        args.dump_json.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    analysis = payload["parking_analysis"]
    row_ids = _ordered_row_ids(analysis)
    authoritative_areas = _authoritative_row_areas(analysis, row_ids)
    print(f"Configured physical rows: {row_ids}")
    summary = analysis["detection_summary"]
    detections = analysis.get("detections", [])
    included_items = [item for item in detections if item.get("inside_parking_roi")]
    states = [item.get("row_assignment_v2", {}).get("state") for item in included_items]
    assigned = sum(state in {"POINT_ASSIGNED", "FOOTPRINT_ASSIGNED"} for state in states)
    without_row = sum(state in {"AMBIGUOUS", "UNASSIGNED"} for state in states)
    evidence_ok = True
    for item in detections:
        ground = bool(item.get("ground_point_inside_roi"))
        footprint = float(item.get("footprint_roi_intersection_area_m2", 0)) > 1e-8
        row = float(item.get("best_overlap_ratio", 0)) >= .60 and float(item.get("overlap_margin", 0)) >= .20
        has_evidence = ground or footprint or row
        evidence_ok &= has_evidence == bool(item.get("inside_parking_roi"))
    assignment_ok = assigned + without_row == len(included_items) and all(
        state in {"POINT_ASSIGNED", "FOOTPRINT_ASSIGNED", "AMBIGUOUS", "UNASSIGNED"} for state in states
    )
    if args.trace_inclusion:
        print("\nID | GP ROI | ROI area | Best row | Best | Second | Margin | Reason | Included")
        for item in detections:
            print(f"#{item['detection_index'] + 1} | {item.get('ground_point_inside_roi')} | {item.get('footprint_roi_intersection_area_m2', 0):.4f} | {item.get('best_row_id')} | {item.get('best_overlap_ratio', 0):.4f} | {item.get('second_overlap_ratio', 0):.4f} | {item.get('overlap_margin', 0):.4f} | {item.get('roi_inclusion_source')} | {item.get('inside_parking_roi')}")
        print("\nBACKEND INCLUDED IDS:", [item["detection_index"] + 1 for item in detections if item.get("inside_parking_roi")])
        print("BACKEND EXCLUDED IDS:", [item["detection_index"] + 1 for item in detections if not item.get("inside_parking_roi")])
        print("\nIncluded assignment trace:")
        for item in detections:
            if item.get("inside_parking_roi"):
                assignment = item.get("row_assignment_v2", {})
                print(f"#{item['detection_index'] + 1} | {assignment.get('state')} | {assignment.get('assigned_row_id')} | {assignment.get('point_containing_rows', [])} | {assignment.get('best_row_id')} | {assignment.get('best_overlap_ratio', 0):.4f} | {assignment.get('second_overlap_ratio', 0):.4f} | {assignment.get('overlap_margin', 0):.4f} | {assignment.get('reason')}")
    print("PARKMAP REAL-IMAGE REGRESSION")
    print(f"Production parking pitch: width = {WIDTH_M:.2f}m length = {LENGTH_M:.2f}m area = {WIDTH_M * LENGTH_M:.2f}m²")
    print(f"API parking_analysis: PASS\nDetection count: {_status(summary['detected'], REFERENCE['detected'])}")
    print(f"Metric projection: {_status(summary['metric_projected'], REFERENCE['metric_projected'])}")
    print(f"Parking inclusion: {summary['parking_included']} (canonical evidence: {'PASS' if evidence_ok else 'FAIL'})")
    print(f"Parking excluded: {summary['parking_excluded']} (canonical evidence: {'PASS' if evidence_ok else 'FAIL'})")
    print(f"Historical reference (UNVERIFIED HISTORICAL OBSERVATION): included={REFERENCE['historical_included']}, excluded={REFERENCE['historical_excluded']}")
    print(f"Row Assignment V2 invariant: {'PASS' if assignment_ok else 'FAIL'} (assigned={assigned}, without_row={without_row})")
    print("\nRow | Area | Occupied | Free | Components | Holes | Validation")
    occupied_rows = {row["row_id"]: row for row in analysis["occupied_space"]["rows"]}
    free_rows = {row["row_id"]: row for row in analysis["free_space"]["rows"]}
    physical_rows = {row["row_id"]: row for row in (analysis.get("physical_map") or {}).get("rows", [])}
    occupied_ok = free_ok = topology_ok = True
    for row_id in row_ids:
        occupied, free = occupied_rows[row_id], free_rows[row_id]
        components, holes = _geometry_counts(free.get("free_geometry"))
        values = (free["row_area_m2"], occupied["occupied_union_area_m2"], free["free_area_m2"])
        measured_area_ok = abs(values[0] - authoritative_areas[row_id]) <= AREA_TOLERANCE_M2
        historical_area = HISTORICAL_ROW_AREAS.get(row_id)
        if historical_area is not None and abs(values[0] - historical_area) > AREA_TOLERANCE_M2:
            print(f"  {row_id}: CONFIGURATION_DRIFT historical_area={historical_area:.2f} current_area={values[0]:.2f}")
        area_identity = abs(occupied["occupied_union_area_m2"] + free["free_area_m2"] - free["row_area_m2"]) <= AREA_TOLERANCE_M2
        occupied_valid = 0 <= occupied["occupied_union_area_m2"] <= occupied["row_area_m2"]
        # The response contract serializes raw blocking pieces under
        # occupied_space.rows[].contributions[].intersection_area_m2; it does
        # not expose a separate raw_intersection_sum_m2 field.
        raw_sum = sum(float(piece["intersection_area_m2"]) for piece in occupied["contributions"])
        deduplicated_overlap = raw_sum - float(occupied["occupied_union_area_m2"])
        raw_valid = raw_sum + AREA_TOLERANCE_M2 >= occupied["occupied_union_area_m2"]
        dedup_valid = deduplicated_overlap >= -AREA_TOLERANCE_M2
        topology_valid = free["validation_status"] == "VALID" and components >= 0 and holes >= 0
        occupied_ok &= occupied_valid and raw_valid and dedup_valid
        free_ok &= area_identity and topology_valid and measured_area_ok
        topology_ok &= topology_valid
        print(f"{row_id} | {values[0]:.2f} | {values[1]:.2f} | {values[2]:.2f} | {components} | {holes} | {free['validation_status']}")
    print(f"Occupied Space V1: {'PASS' if occupied_ok else 'FAIL'}")
    print(f"Free Space V1: {'PASS' if free_ok else 'FAIL'}")
    print(f"Geometry topology/serialization: {'PASS' if topology_ok else 'FAIL'}")
    fitting = analysis.get("virtual_fitting")
    fitting_rows = {row["row_id"]: row for row in (fitting or {}).get("rows", [])}
    rows_present = fitting is not None and set(fitting_rows) == set(row_ids)
    fitting_ok = rows_present
    print("\nRow | Virtual Fit | Feasible Components | Validation")
    for row_id in row_ids:
        result = fitting_rows.get(row_id)
        geometry = (result or {}).get("feasible_geometry") or {}
        serialized_count = _feasible_component_count(geometry)
        component_count = (result or {}).get("feasible_component_count")
        status_ok = bool(result) and result.get("status") in {"FIT", "NO_FIT"}
        orientation_ok = bool(result) and result.get("orientation_source") == "PHYSICAL_ROW"
        dimensions_ok = bool(result) and abs(float(result.get("canonical_width_m", -1)) - WIDTH_M) <= 1e-9 and abs(float(result.get("canonical_length_m", -1)) - LENGTH_M) <= 1e-9
        validation_ok = bool(result) and bool((result.get("validation") or {}).get("valid"))
        component_ok = component_count == serialized_count and ((result or {}).get("status") != "FIT" or component_count >= 1)
        serialization_ok = isinstance(geometry.get("polygons"), list) and (not geometry.get("geometry_type") or geometry.get("geometry_type") in {"Point", "LineString", "MultiPoint", "MultiLineString", "GeometryCollection"})
        row_ok = status_ok and orientation_ok and dimensions_ok and validation_ok and component_ok and serialization_ok
        fitting_ok &= row_ok
        print(f"{row_id} | {(result or {}).get('status', 'MISSING')} | {component_count} | {(result or {}).get('validation', {}).get('valid', False)}")
        geometry_type = geometry.get("geometry_type", "Polygon" if geometry.get("polygons") else "Empty")
        geometry_empty = not geometry.get("polygons") and not geometry.get("geometries") and not geometry.get("coordinates")
        print(f"  geometry_type={geometry_type} actual_geometry_empty={geometry_empty} production_count={component_count} derived_count={serialized_count} consistency={'PASS' if component_ok else 'FAIL'}")
    print(f"Virtual fitting row coverage: {'PASS' if rows_present else 'FAIL'}")
    print(f"Virtual fitting dimensions: {'PASS' if all(abs(float(row.get('canonical_width_m', -1))-WIDTH_M)<=1e-9 and abs(float(row.get('canonical_length_m', -1))-LENGTH_M)<=1e-9 for row in fitting_rows.values()) else 'FAIL'}")
    print(f"Virtual fitting orientation: {'PASS' if all(row.get('orientation_source') == 'PHYSICAL_ROW' for row in fitting_rows.values()) else 'FAIL'}")
    print(f"Virtual fitting validation: {'PASS' if all(bool((row.get('validation') or {}).get('valid')) for row in fitting_rows.values()) else 'FAIL'}")
    print(f"Virtual fitting status/components/serialization: {'PASS' if fitting_ok else 'FAIL'}")
    print(f"Virtual fitting status values: {'PASS' if all(row.get('status') in {'FIT', 'NO_FIT'} for row in fitting_rows.values()) else 'FAIL'}")
    print(f"Virtual fitting component consistency: {'PASS' if all(row.get('feasible_component_count') == _feasible_component_count(row.get('feasible_geometry') or {}) for row in fitting_rows.values()) else 'FAIL'}")
    print(f"Virtual fitting feasible geometry presence: {'PASS' if all(row.get('status') == 'NO_FIT' or row.get('feasible_component_count', 0) >= 1 for row in fitting_rows.values()) else 'FAIL'}")
    print(f"Virtual fitting feasible geometry serialization: {'PASS' if all(isinstance((row.get('feasible_geometry') or {}).get('polygons'), list) for row in fitting_rows.values()) else 'FAIL'}")
    r4_fit = "row_4" not in row_ids or fitting_rows.get("row_4", {}).get("status") == "FIT"
    fitting_ok &= r4_fit
    print(f"Virtual Motorcycle Fitting V1: {'PASS' if fitting_ok else 'FAIL'}")
    capacity_rows = {row["row_id"]: row for row in (analysis.get("capacity") or {}).get("rows", [])}
    capacity_ok = set(capacity_rows) == set(row_ids)
    print("\nRow | Virtual Fit | Capacity | Capacity Validation")
    for row_id in row_ids:
        fit_result = fitting_rows.get(row_id, {})
        cap = capacity_rows.get(row_id, {})
        consistent = (fit_result.get("status") == "NO_FIT" and cap.get("capacity") == 0) or (fit_result.get("status") == "FIT" and cap.get("capacity", 0) >= 1)
        witness_valid, witness_failures = _validate_capacity_row(row_id, cap, physical_rows.get(row_id, {}), occupied_rows.get(row_id, {}))
        row_capacity_ok = isinstance(cap.get("capacity"), int) and cap.get("capacity", -1) >= 0 and len(cap.get("placements", [])) == cap.get("capacity") and bool((cap.get("validation") or {}).get("valid")) and consistent and witness_valid
        capacity_ok &= row_capacity_ok
        print(f"{row_id} | {fit_result.get('status', 'MISSING')} | {cap.get('capacity', 'MISSING')} | {bool((cap.get('validation') or {}).get('valid'))}")
        if witness_failures:
            print(f"  witness validation failures: {witness_failures}")
    print(f"Capacity V1: {'PASS' if capacity_ok else 'FAIL'}")
    uncertainty = analysis.get("uncertainty") or {}
    uncertainty_rows = {row["row_id"]: row for row in uncertainty.get("rows", [])}
    uncertainty_ok = set(uncertainty_rows) == set(row_ids) and bool(uncertainty.get("validation"))
    print("\nRow | Capacity | Uncertainty | Evidence IDs | Validation")
    for row_id in row_ids:
        item = uncertainty_rows.get(row_id, {})
        uncertainty_ok &= item.get("status") in {"CLEAR", "UNCERTAIN"} and bool(item.get("validation"))
        print(f"{row_id} | {capacity_rows.get(row_id, {}).get('capacity', 'MISSING')} | {item.get('status', 'MISSING')} | {item.get('affected_detection_ids', [])} | {item.get('validation', False)}")
        for evidence in item.get("evidence", []):
            print(f"  {evidence['detection_id']} | {evidence['reason']} | {evidence['affected_row_id']} | {evidence['intersection_area_m2']:.6f}")
    print(f"Uncertainty Gate V1: {'PASS' if uncertainty_ok else 'FAIL'}")
    witness_experiment = analysis.get("witness_uncertainty_experiment") or {}
    witness_rows = {item.get("row_id"): item for item in witness_experiment.get("rows", [])}
    witness_ok = witness_experiment.get("status") == "EXPERIMENTAL" and witness_experiment.get("provenance") == "WITNESS_LEVEL_UNCERTAINTY_V1" and bool(witness_experiment.get("validation"))
    print("\nWITNESS-LEVEL UNCERTAINTY — EXPERIMENTAL")
    print("Row | Production State | Capacity | Clear | Blocked | Invalid | Validation")
    for row_id in row_ids:
        experiment_row = witness_rows.get(row_id, {})
        production_row = uncertainty_rows.get(row_id, {})
        capacity_value = experiment_row.get("capacity", 0)
        clear = experiment_row.get("clear_witness_count", 0)
        blocked = experiment_row.get("blocked_witness_count", 0)
        invalid = experiment_row.get("invalid_witness_count", 0)
        row_valid = experiment_row.get("validation") is True and clear + blocked + invalid == capacity_value and len(experiment_row.get("witnesses", [])) == capacity_value
        witness_ok &= row_valid
        print(f"{row_id} | {production_row.get('status', 'MISSING')} | {capacity_value} | {clear} | {blocked} | {invalid} | {row_valid}")
        if production_row.get("status") == "UNCERTAIN":
            for witness in experiment_row.get("witnesses", []):
                print(f"  {row_id} | witness={witness.get('witness_index')} | {witness.get('uncertainty_status')} | {witness.get('uncertainty_evidence_ids', [])}")
                if witness.get("uncertainty_status") == "BLOCKED_BY_UNCERTAINTY":
                    overlaps = witness.get("overlaps") or []
                    print(f"    overlaps={overlaps if overlaps else 'unavailable'}")
    print(f"Witness-Level Uncertainty V1: {'PASS' if witness_ok else 'FAIL'}")
    parking_state = analysis.get("parking_state") or {}
    state_rows = {row["row_id"]: row for row in parking_state.get("rows", [])}
    state_ok = bool(parking_state.get("validation")) and set(state_rows) == set(row_ids)
    print("\nRow | Capacity | Uncertainty | Parking State | Validation")
    for row_id in row_ids:
        item = state_rows.get(row_id, {})
        expected_valid = (item.get("state") == "UNCERTAIN" and item.get("uncertainty") == "UNCERTAIN") or (item.get("state") == "AVAILABLE" and item.get("uncertainty") == "CLEAR" and item.get("capacity", 0) > 0) or (item.get("state") == "UNAVAILABLE" and item.get("uncertainty") == "CLEAR" and item.get("capacity") == 0)
        state_ok &= item.get("state") in {"AVAILABLE", "UNAVAILABLE", "UNCERTAIN"} and item.get("validation") is True and expected_valid
        print(f"{row_id} | {item.get('capacity', 'MISSING')} | {item.get('uncertainty', 'MISSING')} | {item.get('state', 'MISSING')} | {item.get('validation', False)}")
    print(f"Parking State V2: {'PASS' if state_ok else 'FAIL'}")
    repacking = analysis.get("repacking") or {}
    repacking_ok = bool(repacking.get("validation")) and set(item.get("row_id") for item in repacking.get("rows", [])) == set(row_ids)
    print("\nRow | Current Load | Current Additional | Repacked Total | Repacked Additional | Gain | Status | Optimality | Uncertainty | Validation")
    for item in repacking.get("rows", []):
        repacking_ok &= bool(item.get("validation")) and item.get("status") in {"REPACKING_POSSIBLE", "NO_REPACKING_GAIN"}
        print(f"{item['row_id']} | {item['current_load']} | {item['current_additional_capacity']} | {item['repacked_total_capacity']} | {item['repacked_additional_capacity']} | {item['repacking_gain']} | {item['status']} | {item['optimality']} | {item.get('uncertainty')} | {item['validation']}")
        if item.get("status") == "REPACKING_POSSIBLE":
            print(f"  contributing={item.get('contributing_detection_ids', [])} witnesses={len(item.get('witness_placements', []))}")
    print(f"Repacking Analysis V1: {'PASS' if repacking_ok else 'FAIL'}")
    recommendations = analysis.get("placement_recommendation") or {}
    recommendation_ok = bool(recommendations.get("validation")) and {item.get("row_id") for item in recommendations.get("rows", [])} == set(row_ids)
    print("\nRow | Parking State | Capacity | Recommendation | Source | Witness Index | Validation")
    for item in recommendations.get("rows", []):
        placement = item.get("recommended_placement") or {}
        must_recommend = item.get("parking_state") == "AVAILABLE" and item.get("current_capacity", 0) > 0
        row_valid = item.get("status") == "PARK_HERE" and item.get("validation") is True and placement.get("source") == "CURRENT_CAPACITY_WITNESS" and placement.get("geometry") is not None if must_recommend else item.get("status") == "NOT_RECOMMENDED" and item.get("validation") is True
        recommendation_ok &= row_valid
        print(f"{item['row_id']} | {item.get('parking_state')} | {item.get('current_capacity')} | {item.get('status')} | {placement.get('source', 'NONE')} | {placement.get('witness_index', 'NONE')} | {item.get('validation')}")
    print(f"Parking Placement Recommendation V2: {'PASS' if recommendation_ok else 'FAIL'}")
    plan_payload = analysis.get("rearrangement_plan") or {}
    plan_items = {item.get("row_id"): item for item in plan_payload.get("plans", [])}
    plan_ok = plan_payload.get("version") == "V1" and set(plan_items) == set(row_ids)
    print("\nRow | State | Recommendation | Repacking Gain | Plan | Validation")
    recommendation_items = {item.get("row_id"): item for item in recommendations.get("rows", [])}
    repacking_items = {item.get("row_id"): item for item in repacking.get("rows", [])}
    for row_id in row_ids:
        state_item = state_rows.get(row_id, {})
        recommendation_item = recommendation_items.get(row_id, {})
        repacking_item = repacking_items.get(row_id, {})
        plan_item = plan_items.get(row_id, {})
        movement = plan_item.get("movement_assignment") or {}
        row_plan_ok = plan_item.get("status") in {"READY", "NOT_APPLICABLE", "INVALID"} and plan_item.get("status") == "NOT_APPLICABLE" and movement.get("status") == "NOT_COMPUTED"
        plan_ok &= row_plan_ok
        if state_item.get("state") in {"UNCERTAIN", "AVAILABLE", "UNAVAILABLE"}:
            plan_ok &= plan_item.get("status") != "READY"
        print(f"{row_id} | {state_item.get('state')} | {recommendation_item.get('status')} | {repacking_item.get('repacking_gain', 0)} | {plan_item.get('status', 'MISSING')} | {plan_item.get('validation', False)}")
    print(f"Rearrangement Plan V1: {'PASS' if plan_ok else 'FAIL'}")
    experimental = analysis.get("experimental_occupancy_v2") or {}
    experimental_ok = (
        experimental.get("status") == "EXPERIMENTAL"
        and experimental.get("provenance") == "EXPERIMENTAL_UNVALIDATED"
        and experimental.get("canonical_envelope") == {"width_m": 0.8, "length_m": 2.0}
        and [scenario.get("core_width_m") for scenario in experimental.get("scenarios", [])] == [0.4, 0.5, 0.6, 0.65, 0.7, 0.8]
    )
    print("\nEXPERIMENTAL OCCUPANCY V2 — NOT PRODUCTION")
    print("Row | Core Width | Core Occupied | Core Remaining | Production Free | Candidates | Experimental Capacity | Witnesses | Validation")
    scenarios = experimental.get("scenarios", [])
    for scenario in scenarios:
        width = scenario.get("core_width_m")
        scenario_row_ids = {item.get("row_id") for item in scenario.get("rows", [])}
        experimental_ok &= scenario_row_ids == set(row_ids)
        for item in scenario.get("rows", []):
            print(f"{item['row_id']} | {width:.2f} | {item.get('core_occupied_area_m2', 0):.2f} | {item.get('remaining_area_m2', 0):.2f} | {item.get('production_free_area_m2', 0):.2f} | {item.get('candidate_count_tested', 0)} | {item.get('experimental_capacity', 0)} | {len(item.get('placements', []))} | {item.get('validation', False)}")
            experimental_ok &= item.get("validation") is True and item.get("experimental_capacity") == len(item.get("placements", []))
            if row_ids and item.get("row_id") == row_ids[-1]:
                print(f"  Last-row trace ({row_ids[-1]}): width={width:.2f} candidates={item.get('candidate_count_tested', 0)} valid={item.get('valid_candidate_count', 0)} selected={len(item.get('placements', []))}")
                if width in {0.4, 0.8}:
                    for placement in item.get("placements", [])[:3]:
                        print(f"    witness={placement.get('envelope')}")
    production_capacity = {row_id: capacity_rows.get(row_id, {}).get("capacity", "MISSING") for row_id in row_ids}
    by_width = {scenario.get("core_width_m"): {item.get("row_id"): item.get("experimental_capacity", 0) for item in scenario.get("rows", [])} for scenario in scenarios}
    print("\nRow | Production | CW0.40 | CW0.50 | CW0.60 | CW0.65 | CW0.70 | CW0.80")
    for row_id in row_ids:
        values = [by_width.get(width, {}).get(row_id, "MISSING") for width in (0.4, 0.5, 0.6, 0.65, 0.7, 0.8)]
        print(f"{row_id} | {production_capacity[row_id]} | {' | '.join(str(value) for value in values)}")
    print(f"Experimental Occupancy V2 integration: {'PASS' if experimental_ok else 'FAIL'}")
    r1_scenario = next((item for item in scenarios if item.get("core_width_m") == 0.8), {})
    r1_result = next((item for item in r1_scenario.get("rows", []) if item.get("row_id") == "row_1"), {})
    r1_witness = _polygon_geometry((r1_result.get("placements") or [{}])[0].get("envelope"))
    physical_row = next((item for item in analysis.get("physical_map", {}).get("rows", []) if item.get("row_id") == "row_1"), {})
    row_geometry = _polygon_geometry({"polygons": [[physical_row.get("polygon", [])]]})
    occupied_row = next((item for item in analysis.get("occupied_space", {}).get("rows", []) if item.get("row_id") == "row_1"), {})
    occupied_geometry = _polygon_geometry(occupied_row.get("occupied_geometry"))
    canonical_existing = [_polygon_geometry(item.get("canonical_footprint")) for item in detections if item.get("inside_parking_roi")]
    core_overlap = [geometry.intersection(r1_witness).area for geometry in canonical_existing]
    print("\nR1 CW0.80 forensic audit (diagnostic only)")
    print(f"Witness: {r1_witness.wkt}")
    print(f"Witness dimensions: area={r1_witness.area:.6f} m2")
    print(f"Row containment: row_area={row_geometry.area:.6f} intersection={r1_witness.intersection(row_geometry).area:.6f} outside={r1_witness.difference(row_geometry).area:.6f} result={'PASS' if row_geometry.buffer(1e-7).covers(r1_witness) else 'FAIL'}")
    print(f"Production occupied collision: area={r1_witness.intersection(occupied_geometry).area:.6f} touches={r1_witness.touches(occupied_geometry)} intersects={r1_witness.intersects(occupied_geometry)}")
    print(f"Experimental CW0.80 core collision: max_existing_overlap={max(core_overlap, default=0):.6f} result={'PASS' if max(core_overlap, default=0) <= 1e-7 else 'FAIL'}")
    print("Same physical row: YES | Same dimensions: YES | Same metric coordinates: YES | Same orientation/anchor: NO (production continuous feasible geometry vs experimental deterministic row candidates)")
    if args.trace_inclusion:
        r1 = next((row for row in analysis["occupied_space"]["rows"] if row["row_id"] == "row_1"), None)
        print("\nR1 block contributions:")
        for contribution in (r1 or {}).get("contributions", []):
            print(f"{contribution['detection_id']} | {contribution['intersection_area_m2']:.4f} | {contribution['assignment_state']} | {contribution.get('v2_row')} | {contribution['block_reason']}")
    overall = occupied_ok and free_ok and topology_ok and evidence_ok and assignment_ok and fitting_ok and capacity_ok and uncertainty_ok and witness_ok and state_ok and repacking_ok and recommendation_ok and plan_ok and summary['detected'] == REFERENCE['detected'] and summary['metric_projected'] == REFERENCE['metric_projected']
    print(f"\nOVERALL: {'PASS' if overall else 'FAIL'}")
    return 0 if overall else 1


if __name__ == "__main__":
    sys.exit(main())

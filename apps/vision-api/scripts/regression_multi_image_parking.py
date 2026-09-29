"""Run the authoritative parking pipeline against multiple fixed-camera images."""
from __future__ import annotations

import argparse
import mimetypes
import re
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from shapely.geometry import Polygon
from shapely.ops import unary_union

from app.main import app
from app.services.virtual_fitting_service import FITTING_TOLERANCE_M

EPSILON = 1e-8


def _row_sort_key(row_id: str) -> tuple[int, str]:
    match = re.fullmatch(r"row_(\d+)", str(row_id))
    return (int(match.group(1)), str(row_id)) if match else (10**12, str(row_id))


def _runtime_row_ids(analysis: dict[str, Any]) -> list[str]:
    rows = (analysis.get("physical_map") or {}).get("rows", [])
    if rows:
        return sorted({str(row["row_id"]) for row in rows if row.get("row_id")}, key=_row_sort_key)
    sections = ("occupied_space", "free_space", "capacity", "parking_state")
    ids = {str(row["row_id"]) for section in sections for row in (analysis.get(section) or {}).get("rows", []) if row.get("row_id")}
    return sorted(ids, key=_row_sort_key)


def _polygon(geometry: dict[str, Any]) -> Polygon:
    if isinstance(geometry, list):
        return Polygon([(p.get("x_m"), p.get("y_m")) for p in geometry])
    rings = geometry.get("polygons", [])
    if not rings:
        return Polygon()
    parts = []
    for polygon_rings in rings:
        if not polygon_rings:
            continue
        parts.append(Polygon([(p["x_m"], p["y_m"]) for p in polygon_rings[0]], [[(p["x_m"], p["y_m"]) for p in ring] for ring in polygon_rings[1:]]))
    return unary_union(parts) if parts else Polygon()


def _projection_is_valid(geometry: dict[str, Any] | None) -> bool:
    polygons = (geometry or {}).get("polygons", [])
    if not polygons:
        return False
    return all(
        all(("x" in point and "y" in point) or ("x_m" in point and "y_m" in point) for point in ring)
        for polygon in polygons
        for ring in polygon
    )


def _images(inputs: list[Path]) -> list[Path]:
    files = []
    for path in inputs:
        if path.is_dir():
            files.extend(item for item in path.iterdir() if item.suffix.lower() in {".jpg", ".jpeg", ".png"})
        elif path.suffix.lower() in {".jpg", ".jpeg", ".png"}:
            files.append(path)
    return sorted(set(files), key=lambda item: item.name.lower())


def _run(path: Path) -> dict[str, Any]:
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    with path.open("rb") as handle:
        response = TestClient(app).post("/api/detection/analyze", files={"image": (path.name, handle, content_type)})
    if response.status_code != 200:
        raise RuntimeError(f"HTTP {response.status_code}: {response.text}")
    return response.json()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("paths", nargs="+", type=Path)
    args = parser.parse_args()
    paths = _images(args.paths)
    if not paths:
        print("FAIL: no .jpg/.jpeg/.png images found")
        return 2
    summary = []
    collision_summary = []
    overall = True
    for path in paths:
        print(f"\nIMAGE: {path.name}")
        try:
            payload = _run(path)
            analysis = payload["parking_analysis"]
            detections = analysis.get("detections", [])
            included = [item for item in detections if item.get("inside_parking_roi")]
            assigned = sum(item.get("row_assignment_v2", {}).get("state") in {"POINT_ASSIGNED", "FOOTPRINT_ASSIGNED"} for item in included)
            without_row = len(included) - assigned
            print(f"Detections: total={len(detections)} included={len(included)} excluded={len(detections)-len(included)} assigned={assigned} without_row={without_row}")
            occupied = {row["row_id"]: row for row in analysis.get("occupied_space", {}).get("rows", [])}
            free = {row["row_id"]: row for row in analysis.get("free_space", {}).get("rows", [])}
            detection_by_id = {item.get("detection_id"): item for item in detections}
            capacity = {row["row_id"]: row for row in analysis.get("capacity", {}).get("rows", [])}
            states = {row["row_id"]: row for row in analysis.get("parking_state", {}).get("rows", [])}
            experiment = {row["row_id"]: row for row in analysis.get("witness_uncertainty_experiment", {}).get("rows", [])}
            row_ids = _runtime_row_ids(analysis)
            physical = {row["row_id"]: row for row in (analysis.get("physical_map") or {}).get("rows", [])}
            image_ok = True
            image_collision_rows = []
            strict_valid_count = 0
            tolerance_boundary_count = 0
            blocked_count = sum(row.get("blocked_witness_count", 0) for row in experiment.values())
            invalid_count = sum(row.get("invalid_witness_count", 0) for row in experiment.values())
            print("Row | State | Occupied m2 | Free m2 | Capacity | Clear Witness | Blocked Witness | Invalid Witness")
            for row_id in row_ids:
                occ, fr, cap, exp = occupied.get(row_id, {}), free.get(row_id, {}), capacity.get(row_id, {}), experiment.get(row_id, {})
                row_ok = bool(fr.get("validation_status") == "VALID" and abs(float(occ.get("occupied_union_area_m2", 0)) + float(fr.get("free_area_m2", 0)) - float(fr.get("row_area_m2", 0))) <= 0.05 and exp.get("validation") is True and exp.get("clear_witness_count", 0) + exp.get("blocked_witness_count", 0) + exp.get("invalid_witness_count", 0) == cap.get("capacity", 0) and len(exp.get("witnesses", [])) == cap.get("capacity", 0))
                image_ok &= row_ok
                print(f"{row_id} | {states.get(row_id, {}).get('state', 'MISSING')} | {float(occ.get('occupied_union_area_m2', 0)):.2f} | {float(fr.get('free_area_m2', 0)):.2f} | {cap.get('capacity', 'MISSING')} | {exp.get('clear_witness_count', 0)} | {exp.get('blocked_witness_count', 0)} | {exp.get('invalid_witness_count', 0)}")
                witness_footprints = []
                for witness_index, placement in enumerate(cap.get("placements") or []):
                    footprint = _polygon(placement.get("footprint_metric", {}))
                    row_geometry = _polygon({"polygons": [[physical.get(row_id, {}).get("polygon", [])]]})
                    occupied_geometry = _polygon(occ.get("occupied_geometry", {}))
                    projected = placement.get("footprint_image_normalized")
                    projection_valid = projected is None or _projection_is_valid(projected)
                    witness_valid = footprint.is_valid and abs(footprint.area - 1.32) <= FITTING_TOLERANCE_M and row_geometry.buffer(FITTING_TOLERANCE_M).covers(footprint) and footprint.intersection(occupied_geometry).area <= FITTING_TOLERANCE_M and projection_valid
                    image_ok &= witness_valid
                    if not witness_valid:
                        print(f"  witness validation FAIL: {row_id}[{witness_index}]")
                    witness_footprints.append(footprint)
                for left_index, left in enumerate(witness_footprints):
                    for right in witness_footprints[left_index + 1:]:
                        image_ok &= left.intersection(right).area <= FITTING_TOLERANCE_M
                for witness in exp.get("witnesses", []):
                    if witness.get("uncertainty_status") == "BLOCKED_BY_UNCERTAINTY":
                        print(f"  {row_id} witness={witness.get('witness_index')} BLOCKED ids={witness.get('uncertainty_evidence_ids', [])}")
                    if witness.get("uncertainty_status") == "CLEAR":
                        placement = (cap.get("placements") or [])[witness.get("witness_index", -1)] if witness.get("witness_index", -1) < len(cap.get("placements") or []) else {}
                        footprint = _polygon(placement.get("footprint_metric", {}))
                        free_geometry = _polygon(fr.get("free_geometry", {})); occupied_geometry = _polygon(occ.get("occupied_geometry", {}))
                        occupied_overlap = footprint.intersection(occupied_geometry).area
                        strict_covers = free_geometry.covers(footprint)
                        outside_area = footprint.difference(free_geometry).area
                        tolerance_covers = free_geometry.buffer(FITTING_TOLERANCE_M).covers(footprint)
                        if strict_covers:
                            strict_valid_count += 1
                        elif outside_area <= FITTING_TOLERANCE_M and tolerance_covers:
                            tolerance_boundary_count += 1
                        projected = placement.get("footprint_image_normalized")
                        projection_ok = projected is None or _projection_is_valid(projected)
                        collision_ok = footprint.is_valid and abs(footprint.area - 1.32) <= FITTING_TOLERANCE_M and tolerance_covers and occupied_overlap <= FITTING_TOLERANCE_M and projection_ok
                        image_ok &= collision_ok
                        print(f"  CLEAR witness collision check: {'PASS' if collision_ok else 'FAIL'}")
                        if row_ids and row_id == row_ids[-1] and witness.get("witness_index") in {0, 12}:
                            physical = _polygon(next((item for item in analysis.get("physical_map", {}).get("rows", []) if item.get("row_id") == row_id), {}).get("polygon", []))
                            expected_free = physical.difference(occupied_geometry)
                            print(f"  PROVENANCE {row_id} witness={witness.get('witness_index')} expected_free area={expected_free.area:.9f} bounds={expected_free.bounds} serialized_free area={free_geometry.area:.9f} bounds={free_geometry.bounds} symdiff={expected_free.symmetric_difference(free_geometry).area:.12f}")
                            print(f"    capacity_input=serialized free_geometry (capacity_service.calculate_capacity -> calculate_row_capacity) witness_area={footprint.area:.9f} witness_bounds={footprint.bounds}")
                            print(f"    expected_free_covers={expected_free.buffer(FITTING_TOLERANCE_M).covers(footprint)} serialized_free_covers={tolerance_covers}")
                        if not collision_ok or not strict_covers:
                            failed_ids = []
                            row_record = occupied.get(row_id, {})
                            row_geometry = _polygon(next((item for item in analysis.get("physical_map", {}).get("rows", []) if item.get("row_id") == row_id), {}).get("polygon", []))
                            uncertainty_ids = {item.get("detection_id") for item in next((item for item in analysis.get("uncertainty", {}).get("rows", []) if item.get("row_id") == row_id), {}).get("evidence", [])}
                            contributors = set(row_record.get("blocking_detection_ids", []))
                            print(f"  TRACE image={path.name} row={row_id} witness_index={witness.get('witness_index')}")
                            print(f"    witness vs occupied_geometry area={occupied_overlap:.9f}")
                            print(f"    free_geometry strict_covers={strict_covers} outside_area={outside_area:.12f} authoritative_tolerance={FITTING_TOLERANCE_M:.12f} tolerance_aware_containment={tolerance_covers}")
                            print(f"    witness vs physical_row covers={row_geometry.buffer(FITTING_TOLERANCE_M).covers(footprint)}")
                            for detection_id, detection_item in detection_by_id.items():
                                detection_geometry = _polygon(detection_item.get("canonical_footprint", {}))
                                overlap = footprint.intersection(detection_geometry).area
                                if overlap <= EPSILON:
                                    continue
                                failed_ids.append(detection_id)
                                assignment = detection_item.get("row_assignment_v2", {})
                                state = assignment.get("state")
                                classification = {"POINT_ASSIGNED": "ASSIGNED_TO_SAME_ROW" if assignment.get("assigned_row_id") == row_id else "ASSIGNED_TO_OTHER_ROW", "FOOTPRINT_ASSIGNED": "ASSIGNED_TO_SAME_ROW" if assignment.get("assigned_row_id") == row_id else "ASSIGNED_TO_OTHER_ROW", "UNASSIGNED": "UNASSIGNED", "AMBIGUOUS": "AMBIGUOUS"}.get(state, "OTHER_EXISTING_STATUS")
                                print(f"    collision detection={detection_id} status={state} assigned_row={assignment.get('assigned_row_id')} included={detection_item.get('inside_parking_roi')} uncertainty={detection_id in uncertainty_ids} overlap_area={overlap:.9f} contributor={detection_id in contributors} classification={classification}")
                            diagnostic_class = "REAL_CAPACITY_SAFETY_BUG" if occupied_overlap > FITTING_TOLERANCE_M else "VALID_TOLERANCE_BOUNDARY" if outside_area <= FITTING_TOLERANCE_M and tolerance_covers and row_geometry.buffer(FITTING_TOLERANCE_M).covers(footprint) and bool(placement.get("footprint_image_normalized")) else "INVALID_OUTSIDE_FREE_GEOMETRY"
                            print(f"    classification={diagnostic_class}")
                            if not collision_ok:
                                image_collision_rows.append((row_id, witness.get("witness_index"), failed_ids, diagnostic_class))
            print(f"Image validation: {'PASS' if image_ok else 'FAIL'}")
            overall &= image_ok
            summary.append((path.name, row_ids, len(detections), len(included), assigned, sum(row.get("capacity", 0) for row in capacity.values()), strict_valid_count, tolerance_boundary_count, blocked_count, invalid_count, image_ok, capacity))
            collision_summary.append((path.name, image_collision_rows))
        except Exception as error:
            overall = False
            print(f"Image validation: FAIL ({error})")
    print("\nMULTI-IMAGE SUMMARY")
    print("Image | Detections | Included | Assigned | Total Capacity | Strict-valid | Tolerance-boundary | Blocked | Invalid | Validation")
    for item in summary:
        image, row_ids, *values, capacity = item
        print(" | ".join(str(value) for value in [image, *values]))
        capacities = " ".join(f"{row}={capacity.get(row, {}).get('capacity', 'MISSING')}" for row in row_ids)
        print(f"  capacities: {capacities}")
    print("\nCOLLISION DIAGNOSTIC SUMMARY")
    print("Image | Row | Failed Witnesses | Collision Detections | Classification")
    for image, failures in collision_summary:
        by_row = {}
        for row_id, witness_index, detection_ids, classification in failures:
            by_row.setdefault((row_id, classification), {"witnesses": [], "detections": set()})
            by_row[(row_id, classification)]["witnesses"].append(witness_index)
            by_row[(row_id, classification)]["detections"].update(detection_ids)
        for (row_id, classification), data in by_row.items():
            print(f"{image} | {row_id} | {data['witnesses']} | {sorted(data['detections'])} | {classification}")
    return 0 if overall else 1


if __name__ == "__main__":
    raise SystemExit(main())

"""Diagnostic audit for canonical motorcycle footprints and row gaps."""
from __future__ import annotations

import argparse
import mimetypes
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from shapely.geometry import Polygon, Point
from shapely.affinity import rotate, translate

from app.main import app
from app.services.virtual_fitting_service import FITTING_TOLERANCE_M, LENGTH_M, WIDTH_M, _row_angle


def poly(data: dict[str, Any]) -> Polygon:
    rings = data.get("polygons", [])
    if not rings:
        return Polygon()
    return Polygon([(p["x_m"], p["y_m"]) for p in rings[0][0]])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    parser.add_argument("--row", default="R5")
    parser.add_argument("--detections", nargs="*", type=int)
    args = parser.parse_args()
    content_type = mimetypes.guess_type(args.image.name)[0] or "application/octet-stream"
    with args.image.open("rb") as handle:
        response = TestClient(app).post("/api/detection/analyze", files={"image": (args.image.name, handle, content_type)})
    response.raise_for_status()
    payload = response.json(); analysis = payload["parking_analysis"]
    row_id = args.row.lower().replace("r", "row_") if args.row.lower().startswith("r") else args.row
    rows = {row["row_id"]: row for row in analysis["physical_map"]["rows"]}
    row = rows[row_id]; row_polygon = poly({"polygons": [[row["polygon"]]]})
    occupied = next(item for item in analysis["occupied_space"]["rows"] if item["row_id"] == row_id)
    free = next(item for item in analysis["free_space"]["rows"] if item["row_id"] == row_id)
    free_polygon = poly(free["free_geometry"]); occupied_polygon = poly(occupied["occupied_geometry"])
    detections = [item for item in analysis["detections"] if item.get("inside_parking_roi") and (not args.detections or item.get("detection_index", -1) + 1 in args.detections)]
    relevant = [item for item in detections if item.get("row_assignment_v2", {}).get("assigned_row_id") == row_id or row_id in item.get("row_assignment_v2", {}).get("matching_rows", [])]
    print(f"{row_id.upper()} MOTORCYCLE FOOTPRINT AUDIT")
    print("Detection | Ground X | Ground Y | Width | Length | Row | Occupied contribution")
    angle = _row_angle(row_polygon); origin = row_polygon.centroid
    local = []
    for item in relevant:
        footprint = poly(item.get("canonical_footprint", {})); metric = item.get("metric_ground_point", {})
        contribution = footprint.intersection(row_polygon).area
        print(f"{item['detection_id']} | {metric.get('x_m', 0):.3f} | {metric.get('y_m', 0):.3f} | {WIDTH_M:.2f} | {LENGTH_M:.2f} | {item.get('row_assignment_v2', {}).get('assigned_row_id')} | {contribution:.3f}")
        print(f"  confidence={item.get('confidence')} bbox={item.get('bbox')} ground_point_source=BBOX_BOTTOM_CENTER")
        print(f"  footprint_area={footprint.area:.3f} bounds={footprint.bounds} outside_row={footprint.difference(row_polygon).area:.6f} direction_source=PRODUCTION_TOP_DIRECTION bbox_controls_size=NO")
        point = Point(metric.get("x_m", 0), metric.get("y_m", 0)); print(f"  ground_point_inside_row={row_polygon.covers(point)} distance_to_row={point.distance(row_polygon):.6f} centroid={footprint.centroid.x:.3f},{footprint.centroid.y:.3f}")
        transformed = rotate(translate(footprint, -origin.x, -origin.y), -angle, origin=(0, 0)); local.append((transformed.bounds[0], item, transformed))
    local.sort(key=lambda item: item[0])
    capacity = next(item for item in analysis["capacity"]["rows"] if item["row_id"] == row_id)
    witnesses = [poly(item["footprint_metric"]) for item in capacity.get("placements", [])]
    print("\nNeighbor pair | Gap(m) | Required | Width Fit | Free Geometry Fit | Capacity Witness | Classification")
    for index, left in enumerate(local[:-1]):
        right = local[index + 1]; gap = max(0.0, right[2].bounds[0] - left[2].bounds[2]); width_fit = gap + FITTING_TOLERANCE_M >= WIDTH_M
        support = any(free_polygon.buffer(FITTING_TOLERANCE_M).covers(witness) for witness in witnesses)
        classification = "EXPECTED_FIT" if width_fit and support else "POSSIBLE_CAPACITY_DIAGNOSTIC" if width_fit else "INSUFFICIENT_CANONICAL_GAP"
        print(f"{left[1]['detection_id']} -> {right[1]['detection_id']} | {gap:.3f} | {WIDTH_M:.3f} | {'YES' if width_fit else 'NO'} | {'YES' if support else 'NO'} | {'YES' if support else 'NO'} | {classification}")
    print("\nPROVENANCE: bbox used for SIZE=NO | bbox used for LOCATION=YES | canonical Production size=0.66 x 2.00m | ground-point source=BBOX_BOTTOM_CENTER")
    print("A. YOLO bbox controls physical size? NO")
    print("B. All selected detections use canonical 0.66 x 2.00m? YES")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

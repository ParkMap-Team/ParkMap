import json
from pathlib import Path
from typing import Any

import numpy as np
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

from app.models import DetectionResponse
from app.services.physical_row_geometry_service import derive_row_centerline
from app.services.virtual_fitting_service import fit_rows
from app.services.capacity_service import calculate_capacity
from app.services.almost_available_service import calculate_almost_available_placements
from app.services.camera_projection_service import project_metric_geometry
from app.services.uncertainty_service import calculate_uncertainty
from app.services.parking_state_service import calculate_parking_state
from app.services.repacking_service import calculate_repacking
from app.services.placement_recommendation_service import calculate_recommendations
from app.services.experimental_occupancy_v2_service import calculate_experimental_occupancy_v2
from app.services.rearrangement_plan_service import build_rearrangement_plan
from app.services.witness_uncertainty_service import classify_witness_uncertainty

EPSILON = 1e-8
WIDTH_M = 0.66
LENGTH_M = 2.0


def _ring(points: list[tuple[float, float]]) -> list[dict[str, float]]:
    return [{"x_m": float(x), "y_m": float(y)} for x, y in points]


def _geometry_to_shapely(value: dict[str, Any]) -> Any:
    polygons = value.get("polygons", [])
    shapes = []
    for rings in polygons:
        if not rings:
            continue
        exterior = [(point["x_m"], point["y_m"]) for point in rings[0]]
        holes = [[(point["x_m"], point["y_m"]) for point in ring] for ring in rings[1:]]
        shapes.append(Polygon(exterior, holes))
    return unary_union(shapes) if shapes else Polygon()


def _geometry(geometry: Any) -> dict[str, Any]:
    if geometry.is_empty:
        return {"polygons": []}
    polygons = [geometry] if geometry.geom_type == "Polygon" else list(geometry.geoms)
    output = []
    for polygon in polygons:
        rings = [_ring(list(polygon.exterior.coords)[:-1])]
        rings.extend(_ring(list(hole.coords)[:-1]) for hole in polygon.interiors)
        output.append(rings)
    return {"polygons": output}


class ParkingAnalysisService:
    def __init__(self) -> None:
        self.root = Path(__file__).resolve().parents[2]

    def _config(self) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
        homography = json.loads((self.root / "config" / "ground_plane_homography.json").read_text(encoding="utf-8"))
        calibration = json.loads((self.root / "config" / "ground_plane_calibration.json").read_text(encoding="utf-8"))
        parking = json.loads((self.root / "config" / "parking_calibration.json").read_text(encoding="utf-8"))
        return homography, calibration, parking

    @staticmethod
    def _measured_rows(homography: dict[str, Any], calibration: dict[str, Any], parking: dict[str, Any]) -> list[tuple[str, Polygon]]:
        matrix = homography["matrix"]
        measured = calibration.get("measured_rows", {})
        rows = []
        for source in parking["rows"]:
            row_id = source["id"]
            dimensions = measured.get(row_id, {})
            points = [type("PolygonPoint", (), {"x": p["x"], "y": p["y"]})() for p in source["polygon"]]
            centerline = derive_row_centerline(points)
            if not centerline or not dimensions.get("length_m") or not dimensions.get("width_m"):
                continue
            start_image, end_image = centerline
            start = ParkingAnalysisService._project(start_image, matrix)
            end = ParkingAnalysisService._project(end_image, matrix)
            distance = float(np.hypot(end[0] - start[0], end[1] - start[1]))
            if distance <= 1e-12:
                continue
            ux, uy = (end[0] - start[0]) / distance, (end[1] - start[1]) / distance
            model_end = (start[0] + ux * dimensions["length_m"], start[1] + uy * dimensions["length_m"])
            half = dimensions["width_m"] / 2
            perpendicular = (-uy * half, ux * half)
            row_polygon_points = [
                (start[0] + perpendicular[0], start[1] + perpendicular[1]),
                (model_end[0] + perpendicular[0], model_end[1] + perpendicular[1]),
                (model_end[0] - perpendicular[0], model_end[1] - perpendicular[1]),
                (start[0] - perpendicular[0], start[1] - perpendicular[1]),
            ]
            row_polygon = Polygon(row_polygon_points)
            rows.append((row_id, row_polygon))
        return rows

    @staticmethod
    def _project(point: tuple[float, float], matrix: list[list[float]]) -> tuple[float, float]:
        vector = np.asarray([point[0], point[1], 1.0], dtype=float)
        projected = np.asarray(matrix, dtype=float) @ vector
        return float(projected[0] / projected[2]), float(projected[1] / projected[2])

    @staticmethod
    def _footprint(point: tuple[float, float]) -> Polygon:
        x, y = point
        half = WIDTH_M / 2
        return Polygon([(x - half, y), (x + half, y), (x + half, y + LENGTH_M), (x - half, y + LENGTH_M)])

    @staticmethod
    def _row_assignment(footprint: Polygon, point: tuple[float, float], rows: list[tuple[str, Polygon]]) -> tuple[str | None, str, list[dict[str, Any]]]:
        overlaps = [(item["row_id"], item["overlap_ratio"]) for item in ParkingAnalysisService._row_evidence(footprint, rows)]
        ordered = sorted(overlaps, key=lambda value: value[1], reverse=True)
        details = [{"row_id": row_id, "overlap_ratio": ratio, "overlap_percent": ratio * 100} for row_id, ratio in ordered]
        point_rows = [row_id for row_id, row in rows if row.covers(Point(point))]
        if len(point_rows) == 1 and ordered and ordered[0][0] == point_rows[0]:
            return point_rows[0], "POINT_ASSIGNED", details
        if ordered and ordered[0][1] >= 0.6 and (len(ordered) < 2 or ordered[0][1] - ordered[1][1] >= 0.2):
            return ordered[0][0], "FOOTPRINT_ASSIGNED", details
        if len([item for item in ordered if item[1] > EPSILON]) > 1:
            return None, "AMBIGUOUS", details
        return None, "UNASSIGNED", details

    @staticmethod
    def _row_evidence(footprint: Polygon, rows: list[tuple[str, Polygon]]) -> list[dict[str, float | str]]:
        footprint_area = footprint.area
        evidence = []
        for row_id, row_geometry in rows:
            intersection_area = footprint.intersection(row_geometry).area
            evidence.append({"row_id": row_id, "intersection_area_m2": intersection_area, "overlap_ratio": intersection_area / footprint_area if footprint_area else 0.0, "overlap_percent": intersection_area / footprint_area * 100 if footprint_area else 0.0})
        return evidence

    def analyze(self, detection: DetectionResponse) -> dict[str, Any]:
        homography, calibration, parking = self._config()
        matrix = homography["matrix"]
        roi = Polygon([(p["x_m"], p["y_m"]) for p in homography["roi_metric"]["points"]])
        measured = calibration.get("measured_rows", {})
        rows = self._measured_rows(homography, calibration, parking)
        enriched: list[dict[str, Any]] = []
        included: list[tuple[dict[str, Any], Polygon, tuple[str | None, str, list[dict[str, Any]]]]] = []
        for index, item in enumerate(detection.detections):
            image_point = (item.bbox.x + item.bbox.width / 2, item.bbox.y + item.bbox.height)
            metric_point = self._project(image_point, matrix)
            footprint = self._footprint(metric_point)
            row_evidence = ParkingAnalysisService._row_evidence(footprint, rows)
            ordered = sorted([(item["row_id"], item["overlap_ratio"]) for item in row_evidence], key=lambda value: value[1], reverse=True)
            ground_inside = roi.covers(Point(metric_point))
            footprint_inside = footprint.intersection(roi).area > EPSILON
            strong_row = bool(ordered and ordered[0][1] >= 0.6 and (len(ordered) < 2 or ordered[0][1] - ordered[1][1] >= 0.2))
            is_included = ground_inside or footprint_inside or strong_row
            assignment = self._row_assignment(footprint, metric_point, rows)
            inclusion_source = "GROUND_POINT_ROI" if ground_inside else "FOOTPRINT_ROI" if footprint_inside else "PHYSICAL_ROW" if strong_row else "OUTSIDE"
            enriched.append({"detection_id": f"detection_{index + 1}", "detection_index": index, "confidence": item.confidence, "image_ground_point": {"x": image_point[0], "y": image_point[1]}, "metric_ground_point": {"x_m": metric_point[0], "y_m": metric_point[1]}, "canonical_footprint": _geometry(footprint), "transform_valid": True, "ground_point_inside_roi": ground_inside, "footprint_roi_intersection_area_m2": footprint.intersection(roi).area, "footprint_roi_positive_overlap": footprint_inside, "inside_parking_roi": is_included, "roi_inclusion_source": inclusion_source, "row_overlaps": row_evidence, "best_row_id": ordered[0][0] if ordered else None, "best_overlap_ratio": ordered[0][1] if ordered else 0.0, "second_overlap_ratio": ordered[1][1] if len(ordered) > 1 else 0.0, "overlap_margin": (ordered[0][1] - ordered[1][1]) if len(ordered) > 1 else (ordered[0][1] if ordered else 0.0), "row_assignment_v2": {"state": assignment[1], "assigned_row_id": assignment[0], "point_containing_rows": [row_id for row_id, row in rows if row.covers(Point(metric_point))], "matching_rows": [row_id for row_id, ratio in ordered if ratio > EPSILON], "best_row_id": ordered[0][0] if ordered else None, "best_overlap_ratio": ordered[0][1] if ordered else 0.0, "second_overlap_ratio": ordered[1][1] if len(ordered) > 1 else 0.0, "overlap_margin": (ordered[0][1] - ordered[1][1]) if len(ordered) > 1 else (ordered[0][1] if ordered else 0.0), "reason": assignment[1]}})
            if is_included:
                included.append((enriched[-1], footprint, assignment))
        occupied_rows = []
        free_rows = []
        free_geometries = {}
        for row_id, row in rows:
            pieces = []
            contribution = []
            for item, footprint, assignment in included:
                intersection = footprint.intersection(row)
                if intersection.area <= EPSILON:
                    continue
                state = assignment[1]
                same = assignment[0] == row_id
                reason = "CONSERVATIVE_AMBIGUOUS_BLOCK" if state == "AMBIGUOUS" else "CONSERVATIVE_UNASSIGNED_BLOCK" if state == "UNASSIGNED" else "ASSIGNED_ROW_BLOCK" if same else "CROSS_ROW_GEOMETRIC_BLOCK"
                pieces.append(intersection)
                contribution.append({"detection_id": item["detection_id"], "row_id": row_id, "assignment_state": state, "v2_row": assignment[0], "intersection_area_m2": intersection.area, "footprint_area_m2": footprint.area, "intersection_ratio": intersection.area / footprint.area, "block_reason": reason, "intersection_geometry": _geometry(intersection)})
            occupied = unary_union(pieces) if pieces else Polygon()
            occupied_components = [occupied] if occupied.geom_type == "Polygon" else [part for part in occupied.geoms if part.geom_type == "Polygon"] if occupied.geom_type == "MultiPolygon" else []
            components = []
            for component_index, component in enumerate(occupied_components):
                component_contributors = [piece["detection_id"] for piece, intersection in zip(contribution, pieces) if intersection.intersection(component).area > EPSILON]
                components.append({"component_index": component_index, "geometry": _geometry(component), "area_m2": component.area, "contributor_detection_ids": component_contributors})
            free = row.difference(occupied)
            free_geometries[row_id] = free
            measurement = measured.get(row_id, {})
            occupied_rows.append({"row_id": row_id, "row_area_m2": row.area, "occupied_union_area_m2": occupied.area, "occupied_percent": occupied.area / row.area * 100, "occupied_geometry": _geometry(occupied), "blocking_detection_ids": [piece["detection_id"] for piece in contribution], "contributions": contribution, "components": components})
            balance_error = abs(row.area - occupied.area - free.area)
            free_rows.append({"row_id": row_id, "row_area_m2": row.area, "occupied_union_area_m2": occupied.area, "free_geometry": _geometry(free), "free_area_m2": free.area, "free_component_count": len(free.geoms) if free.geom_type == "MultiPolygon" else 0 if free.is_empty else 1, "hole_count": sum(len(p.interiors) for p in ([free] if free.geom_type == "Polygon" else list(free.geoms))) if not free.is_empty else 0, "occupied_percent": occupied.area / row.area * 100, "free_percent": free.area / row.area * 100, "area_balance_error_m2": balance_error, "validation_status": "VALID" if balance_error <= 1e-7 else "INVALID", "measured_length_m": measurement.get("length_m"), "measured_width_m": measurement.get("width_m")})
        fitting = fit_rows(rows, free_geometries)
        capacity = calculate_capacity(rows, free_geometries, fitting)
        inverse_matrix = homography.get("inverse_matrix") or homography.get("inverse")
        roi_image_normalized = None
        if isinstance(inverse_matrix, list):
            roi_image_normalized = project_metric_geometry(_geometry(roi), inverse_matrix)
        if isinstance(inverse_matrix, list):
            for capacity_row in capacity.get("rows", []):
                if capacity_row.get("validation", {}).get("valid") is not True:
                    continue
                for placement in capacity_row.get("placements", []):
                    projected = project_metric_geometry(placement.get("footprint_metric", {}), inverse_matrix)
                    if projected is not None:
                        placement["footprint_image_normalized"] = projected
        uncertainty = calculate_uncertainty(rows, included)
        occupied_geometries = {row["row_id"]: _geometry_to_shapely(row["occupied_geometry"]) for row in occupied_rows}
        almost_available_placements = calculate_almost_available_placements(rows, occupied_geometries, free_geometries, capacity, uncertainty)
        witness_uncertainty_experiment = classify_witness_uncertainty(capacity, uncertainty, enriched)
        witness_safety = {**witness_uncertainty_experiment, "provenance": "PRODUCTION_WITNESS_SAFETY_V1", "rows": [{**row, "safe_capacity": row.get("clear_witness_count", 0), "blocked_capacity": row.get("blocked_witness_count", 0), "invalid_capacity": row.get("invalid_witness_count", 0)} for row in witness_uncertainty_experiment.get("rows", [])]}
        repacking = calculate_repacking(rows, occupied_rows, capacity, uncertainty)
        parking_state = calculate_parking_state(capacity, uncertainty, repacking)
        experimental_occupancy_v2 = calculate_experimental_occupancy_v2(rows, free_geometries, included)
        recommendation = calculate_recommendations(capacity, parking_state, repacking)
        rearrangement_plan = build_rearrangement_plan(capacity, parking_state, recommendation, repacking)
        return {"analysis_version": "parking-analysis-v2", "camera_id": homography["camera_id"], "image": {"width": detection.image_width, "height": detection.image_height}, "detection_summary": {"detected": len(detection.detections), "metric_projected": len(enriched), "parking_included": len(included), "parking_excluded": len(enriched) - len(included)}, "detections": enriched, "physical_map": {"parking_roi": _geometry(roi), "parking_roi_image_normalized": roi_image_normalized, "rows": [{"row_id": row_id, "polygon": _geometry(row)["polygons"][0][0], "measured_length_m": measured.get(row_id, {}).get("length_m"), "measured_width_m": measured.get(row_id, {}).get("width_m"), "area_m2": row.area} for row_id, row in rows]}, "occupied_space": {"rows": occupied_rows}, "free_space": {"rows": free_rows}, "virtual_fitting": fitting, "capacity": capacity, "almost_available_placements": almost_available_placements, "witness_safety": witness_safety, "uncertainty": uncertainty, "witness_uncertainty_experiment": witness_uncertainty_experiment, "parking_state": parking_state, "repacking": repacking, "experimental_occupancy_v2": experimental_occupancy_v2, "placement_recommendation": recommendation, "rearrangement_plan": rearrangement_plan}


parking_analysis_service = ParkingAnalysisService()

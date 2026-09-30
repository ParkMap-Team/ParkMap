"""Experimental multi-image parking-structure discovery.

This module deliberately stops at evidence-backed region and row discovery.
It does not use calibrated ROI/rows, homography, metric geometry, capacity,
or availability semantics.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from math import hypot
from typing import Any, Sequence

import numpy as np
from shapely.geometry import MultiPoint

from app.models import DetectionResponse


@dataclass(frozen=True)
class AutoDetection:
    image_index: int
    image_name: str
    confidence: float
    x1: float
    y1: float
    x2: float
    y2: float

    def as_dict(self) -> dict[str, Any]:
        return {
            "image_index": self.image_index,
            "image_name": self.image_name,
            "confidence": self.confidence,
            "bbox": {"x1": self.x1, "y1": self.y1, "x2": self.x2, "y2": self.y2},
            "bbox_width": self.x2 - self.x1,
            "bbox_height": self.y2 - self.y1,
            "bottom_center": {"x": (self.x1 + self.x2) / 2, "y": self.y2},
        }


def detections_from_response(response: DetectionResponse, image_index: int, image_name: str) -> list[AutoDetection]:
    return [
        AutoDetection(
            image_index=image_index,
            image_name=image_name,
            confidence=detection.confidence,
            x1=detection.bbox.x,
            y1=detection.bbox.y,
            x2=detection.bbox.x + detection.bbox.width,
            y2=detection.bbox.y + detection.bbox.height,
        )
        for detection in response.detections
    ]


def aggregate_detections(items: Sequence[AutoDetection]) -> dict[str, Any]:
    per_image: dict[int, int] = defaultdict(int)
    for item in items:
        per_image[item.image_index] += 1
    return {
        "detections": [item.as_dict() for item in items],
        "detections_per_image": [per_image[index] for index in sorted(per_image)],
        "bottom_center_points": [{"x": (item.x1 + item.x2) / 2, "y": item.y2} for item in items],
        "bbox_statistics": _bbox_statistics(items),
    }


def _bbox_statistics(items: Sequence[AutoDetection]) -> dict[str, float | None]:
    if not items:
        return {"width_mean": None, "height_mean": None, "width_median": None, "height_median": None}
    widths = np.array([item.x2 - item.x1 for item in items], dtype=float)
    heights = np.array([item.y2 - item.y1 for item in items], dtype=float)
    return {"width_mean": float(widths.mean()), "height_mean": float(heights.mean()), "width_median": float(np.median(widths)), "height_median": float(np.median(heights))}


def density_heatmap(items: Sequence[AutoDetection], bins: int = 64, smoothing_radius: int = 2) -> list[list[float]]:
    """Return a normalized image-space density grid; no calibrated geometry is used."""
    heatmap = np.zeros((bins, bins), dtype=float)
    for item in items:
        x = min(bins - 1, max(0, int(((item.x1 + item.x2) / 2) * bins)))
        y = min(bins - 1, max(0, int(item.y2 * bins)))
        heatmap[y, x] += 1.0
    if smoothing_radius > 0 and heatmap.any():
        padded = np.pad(heatmap, smoothing_radius, mode="constant")
        smoothed = np.zeros_like(heatmap)
        size = 2 * smoothing_radius + 1
        for y in range(bins):
            for x in range(bins):
                smoothed[y, x] = padded[y : y + size, x : x + size].mean()
        heatmap = smoothed
    peak = float(heatmap.max())
    if peak:
        heatmap /= peak
    return heatmap.tolist()


def estimate_parking_region(items: Sequence[AutoDetection]) -> dict[str, Any]:
    points = [(float((item.x1 + item.x2) / 2), float(item.y2)) for item in items]
    if len(points) < 3:
        return {"status": "INSUFFICIENT_EVIDENCE", "confidence": 0.0, "coordinate_space": "NORMALIZED_IMAGE", "polygon": []}
    hull = MultiPoint(points).convex_hull
    if hull.geom_type not in {"Polygon", "MultiPolygon"}:
        return {"status": "INSUFFICIENT_EVIDENCE", "confidence": 0.0, "coordinate_space": "NORMALIZED_IMAGE", "polygon": []}
    polygon = [{"x": float(x), "y": float(y)} for x, y in hull.exterior.coords[:-1]]
    confidence = min(1.0, len({item.image_index for item in items}) / 7.0) * min(1.0, len(items) / 10.0)
    return {"status": "ESTIMATED", "confidence": round(confidence, 4), "coordinate_space": "NORMALIZED_IMAGE", "polygon": polygon}


def _row_band(cluster: Sequence[AutoDetection], direction: np.ndarray, local_scale: float) -> tuple[list[dict[str, float]], list[dict[str, float]]]:
    points = np.array([[(item.x1 + item.x2) / 2, item.y2] for item in cluster], dtype=float)
    center = points.mean(axis=0)
    normal = np.array([-direction[1], direction[0]], dtype=float)
    along = (points - center) @ direction
    half_length = max(float(np.median([item.x2 - item.x1 for item in cluster])) * 0.75, local_scale)
    half_width = max(local_scale * 0.75, 0.008)
    start = center + direction * (float(along.min()) - half_length)
    end = center + direction * (float(along.max()) + half_length)
    corners = [start + normal * half_width, end + normal * half_width, end - normal * half_width, start - normal * half_width]
    polygon = [{"x": round(float(np.clip(point[0], 0, 1)), 6), "y": round(float(np.clip(point[1], 0, 1)), 6)} for point in corners]
    centerline = [{"x": round(float(np.clip(start[0], 0, 1)), 6), "y": round(float(np.clip(start[1], 0, 1)), 6)}, {"x": round(float(np.clip(end[0], 0, 1)), 6), "y": round(float(np.clip(end[1], 0, 1)), 6)}]
    return polygon, centerline


def infer_rows(items: Sequence[AutoDetection]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not items:
        return [], []
    ordered = sorted(items, key=lambda item: ((item.x1 + item.x2) / 2, item.y2))
    typical_height = float(np.median([item.y2 - item.y1 for item in ordered]))
    threshold = max(0.012, typical_height * 1.35)
    clusters: list[list[AutoDetection]] = []
    rejected: list[dict[str, Any]] = []
    for item in sorted(ordered, key=lambda current: current.y2):
        if not clusters or item.y2 - float(np.median([member.y2 for member in clusters[-1]])) > threshold:
            clusters.append([item])
        else:
            clusters[-1].append(item)
    rows: list[dict[str, Any]] = []
    for cluster in clusters:
        points = np.array([[(item.x1 + item.x2) / 2, item.y2] for item in cluster], dtype=float)
        if len(cluster) < 2:
            rejected.extend(item.as_dict() | {"rejection_reason": "INSUFFICIENT_SUPPORT"} for item in cluster)
            continue
        direction_values = _principal_direction(points)
        direction = np.array([direction_values["x"], direction_values["y"]], dtype=float)
        local_scale = float(np.median([item.y2 - item.y1 for item in cluster]))
        polygon, centerline = _row_band(cluster, direction, local_scale)
        spread = float(np.std(points @ np.array([-direction[1], direction[0]])))
        compactness = max(0.0, 1.0 - min(1.0, spread / max(threshold, 1e-9)))
        distinct_images = len({item.image_index for item in cluster})
        confidence = min(1.0, len(cluster) / 5.0) * min(1.0, distinct_images / 2.0) * (0.5 + 0.5 * compactness)
        rows.append({"points": points, "cluster": cluster, "row": {"status": "SUPPORTED" if len(cluster) >= 3 and distinct_images >= 2 else "WEAK_EVIDENCE", "confidence": round(confidence, 4), "observation_count": len(cluster), "distinct_image_count": distinct_images, "support_points": len(cluster), "support_images": distinct_images, "coordinate_space": "NORMALIZED_IMAGE", "direction": direction_values, "centerline": centerline, "polygon": polygon, "local_scale": round(local_scale, 6)}})
    rows.sort(key=lambda item: (sum(point["y"] for point in item["row"]["polygon"]) / 4, sum(point["x"] for point in item["row"]["polygon"]) / 4))
    for index, item in enumerate(rows, 1):
        item["row"]["row_id"] = f"row_{index}"
    return [item["row"] for item in rows], rejected


def estimate_rows(items: Sequence[AutoDetection]) -> list[dict[str, Any]]:
    return infer_rows(items)[0]


def _principal_direction(points: np.ndarray) -> dict[str, float]:
    centered = points - points.mean(axis=0)
    if len(points) < 2 or not np.any(centered):
        return {"x": 1.0, "y": 0.0}
    _, _, vectors = np.linalg.svd(centered, full_matrices=False)
    direction = vectors[0]
    norm = hypot(float(direction[0]), float(direction[1])) or 1.0
    if direction[0] < 0:
        direction = -direction
    return {"x": round(float(direction[0] / norm), 6), "y": round(float(direction[1] / norm), 6)}


def analyze_detections(responses: Sequence[tuple[str, DetectionResponse]]) -> dict[str, Any]:
    items = [item for index, (name, response) in enumerate(responses) for item in detections_from_response(response, index, name)]
    aggregate = aggregate_detections(items)
    rows, rejected = infer_rows(items)
    return {
        "analysis_mode": "AUTO",
        "status": "READY" if items else "INSUFFICIENT_EVIDENCE",
        "image_count": len(responses),
        "detection_summary": {"total_detections": len(items), "detections_per_image": aggregate["detections_per_image"]},
        "detections": aggregate["detections"],
        "bbox_statistics": aggregate["bbox_statistics"],
        "heatmap": {"coordinate_space": "NORMALIZED_IMAGE", "bins": 64, "values": density_heatmap(items)},
        "parking_regions": [estimate_parking_region(items)],
        "rows": rows,
        "rejected_observations": rejected,
        "warnings": [] if items else ["No motorcycle detections support an estimated parking structure."],
    }

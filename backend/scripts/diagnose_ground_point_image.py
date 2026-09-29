"""Render an image-space audit of canonical R5 ground-point anchors."""
from __future__ import annotations

import argparse
import json
import mimetypes
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app.main import app

HIGHLIGHT = {5, 11, 12, 16, 18, 27, 41, 42, 46, 47, 53, 59}


def project(point: dict, inverse: list[list[float]]) -> tuple[float, float] | None:
    x, y = point["x_m"], point["y_m"]
    q = [inverse[0][0] * x + inverse[0][1] * y + inverse[0][2], inverse[1][0] * x + inverse[1][1] * y + inverse[1][2], inverse[2][0] * x + inverse[2][1] * y + inverse[2][2]]
    return None if abs(q[2]) < 1e-12 else (q[0] / q[2], q[1] / q[2])


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("image", type=Path); parser.add_argument("--output", type=Path, default=Path("debug_output/ground_point_r5_audit.png")); args = parser.parse_args()
    content_type = mimetypes.guess_type(args.image.name)[0] or "application/octet-stream"
    with args.image.open("rb") as handle:
        response = TestClient(app).post("/api/detection/analyze", files={"image": (args.image.name, handle, content_type)})
    response.raise_for_status(); payload = response.json(); analysis = payload["parking_analysis"]; source_detections = {item.get("detection_index", index): item for index, item in enumerate(payload.get("detections", []))}
    homography = json.loads(Path(__file__).resolve().parents[1].joinpath("config/ground_plane_homography.json").read_text(encoding="utf-8")); inverse = homography["inverse_matrix"]
    image = Image.open(args.image).convert("RGB"); draw = ImageDraw.Draw(image)
    width, height = image.size
    row = next(item for item in analysis["physical_map"]["rows"] if item["row_id"] == "row_5")
    row_pixels = [project({"x_m": point["x_m"], "y_m": point["y_m"]}, inverse) for point in row["polygon"]]
    row_pixels = [(int(x * width), int(y * height)) for x, y in row_pixels if x is not None]
    if len(row_pixels) >= 3: draw.line(row_pixels + [row_pixels[0]], fill=(0, 180, 255), width=6)
    print("Detection | Image Ground X | Image Ground Y | Metric X | Metric Y | Outside Row Area")
    for item in analysis["detections"]:
        if item.get("row_assignment_v2", {}).get("assigned_row_id") != "row_5" and "row_5" not in item.get("row_assignment_v2", {}).get("matching_rows", []): continue
        index = item["detection_index"] + 1; bbox = source_detections.get(item["detection_index"], {}).get("bbox")
        if not bbox:
            print(f"{item['detection_id']} | Unavailable | Unavailable | {item.get('metric_ground_point', {}).get('x_m', 0):.3f} | {item.get('metric_ground_point', {}).get('y_m', 0):.3f} | Unavailable")
            continue
        gx = bbox["x"] + bbox["width"] / 2; gy = bbox["y"] + bbox["height"]
        point = item.get("metric_ground_point", {}); overlap = next((entry.get("intersection_area_m2", 0) for entry in item.get("row_overlaps", []) if entry.get("row_id") == "row_5"), None); outside = item.get("footprint_area_m2", 0) - overlap if overlap is not None else None
        px, py = int(gx * width), int(gy * height); color = (255, 40, 40) if index in HIGHLIGHT else (255, 190, 0)
        draw.rectangle((int(bbox["x"] * width), int(bbox["y"] * height), int((bbox["x"] + bbox["width"]) * width), int((bbox["y"] + bbox["height"]) * height)), outline=color, width=4)
        draw.ellipse((px - 8, py - 8, px + 8, py + 8), fill=color, outline=(255, 255, 255), width=2); draw.text((px + 10, py - 12), f"#{index} {item['detection_id']}", fill=color)
        footprint = item.get("canonical_footprint", {}).get("polygons", [])
        if footprint:
            fp = [project({"x_m": p["x_m"], "y_m": p["y_m"]}, inverse) for p in footprint[0][0]]; fp = [(int(x * width), int(y * height)) for x, y in fp if x is not None];
            if len(fp) >= 3: draw.line(fp + [fp[0]], fill=(255, 80, 180), width=3)
        print(f"{item['detection_id']} | {gx:.6f} | {gy:.6f} | {point.get('x_m', 0):.3f} | {point.get('y_m', 0):.3f} | {outside if outside is not None else 'Unavailable'}")
    args.output.parent.mkdir(parents=True, exist_ok=True); image.save(args.output); print(f"Annotated output: {args.output.resolve()}"); return 0


if __name__ == "__main__": raise SystemExit(main())

"""Run Auto Mode V1 against a directory of same-camera images."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from app.services.auto_parking_service import analyze_detections
from app.services.cv_service import cv_service


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("image_directory", type=Path)
    parser.add_argument("--output", type=Path, default=Path("auto-parking-debug"))
    args = parser.parse_args()
    paths = sorted(path for path in args.image_directory.iterdir() if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"})
    if not paths:
        raise SystemExit("No supported images found.")
    responses = [(path.name, cv_service.analyze_image(path.read_bytes())) for path in paths]
    result = analyze_detections(responses)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "auto_parking_result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    reference = Image.open(paths[0]).convert("RGB")
    draw = ImageDraw.Draw(reference, "RGBA")
    def pixel(point: dict[str, float]) -> tuple[int, int]:
        return round(point["x"] * reference.width), round(point["y"] * reference.height)
    for detection in result["detections"]:
        point = pixel(detection["bottom_center"])
        draw.ellipse((point[0] - 5, point[1] - 5, point[0] + 5, point[1] + 5), fill=(255, 80, 80, 220))
    for detection in result.get("rejected_observations", []):
        point = pixel(detection["bottom_center"])
        draw.line((point[0] - 6, point[1] - 6, point[0] + 6, point[1] + 6), fill=(255, 255, 255, 220), width=2)
        draw.line((point[0] - 6, point[1] + 6, point[0] + 6, point[1] - 6), fill=(255, 255, 255, 220), width=2)
    region = result["parking_regions"][0]["polygon"]
    if len(region) >= 3:
        draw.line([pixel(point) for point in region + [region[0]]], fill=(255, 220, 0, 220), width=3)
    reference.save(args.output / "auto_detection_overlay.png")
    rows_image = Image.open(paths[0]).convert("RGB")
    rows_draw = ImageDraw.Draw(rows_image, "RGBA")
    for row in result["rows"]:
        polygon = row["polygon"]
        rows_draw.line([pixel(point) for point in polygon + [polygon[0]]], fill=(60, 220, 255, 220), width=3)
        centerline = [pixel(point) for point in row["centerline"]]
        rows_draw.line(centerline, fill=(255, 80, 220, 255), width=4)
        label_point = centerline[0]
        rows_draw.text(label_point, f'{row["row_id"]} n={row["observation_count"]} img={row["distinct_image_count"]}', fill=(255, 255, 255, 255))
    for detection in result.get("rejected_observations", []):
        point = pixel(detection["bottom_center"])
        rows_draw.line((point[0] - 6, point[1] - 6, point[0] + 6, point[1] + 6), fill=(255, 255, 255, 220), width=2)
        rows_draw.line((point[0] - 6, point[1] + 6, point[0] + 6, point[1] - 6), fill=(255, 255, 255, 220), width=2)
    rows_image.save(args.output / "auto_rows.png")
    heatmap = np.array(result["heatmap"]["values"], dtype=float) if result["heatmap"]["values"] else np.zeros((64, 64))
    Image.fromarray((np.clip(heatmap, 0, 1) * 255).astype("uint8"), mode="L").resize(reference.size).save(args.output / "auto_heatmap.png")
    print(json.dumps({"image_count": len(paths), "status": result["status"], "rows": len(result["rows"]), "output": str(args.output)}, indent=2))


if __name__ == "__main__":
    main()

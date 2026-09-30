"""Render evidence-backed supported segments over the reference image."""
from pathlib import Path
import json
import cv2

root = Path(__file__).resolve().parents[1]
artifact_dir = root / "auto-parking-experimental"
state = json.loads((artifact_dir / "current_state.json").read_text(encoding="utf-8"))
image_path = sorted((root / "test-data" / "auto-parking").glob("*"))[0]
image = cv2.imread(str(image_path))
if image is None:
    raise SystemExit(f"Unable to read reference image: {image_path}")
h, w = image.shape[:2]
for row in state["rows"]:
    color = (0, 220, 255)
    points = row.get("centerline") or []
    if len(points) >= 2:
        cv2.line(image, (int(points[0]["x"] * w), int(points[0]["y"] * h)),
                 (int(points[1]["x"] * w), int(points[1]["y"] * h)), (120, 120, 120), 2)
    for segment in row.get("supported_segments") or []:
        a, b = segment["start"], segment["end"]
        cv2.line(image, (int(a["x"] * w), int(a["y"] * h)),
                 (int(b["x"] * w), int(b["y"] * h)), color, 8)
    if points:
        cv2.putText(image, row.get("display_id", row["row_id"]),
                    (int(points[0]["x"] * w), max(20, int(points[0]["y"] * h) - 8)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
    for anchor_id in row.get("anchor_ids", []):
        anchor = next((a for a in state["anchors"] if a["anchor_id"] == anchor_id), None)
        if anchor:
            cv2.circle(image, (int(anchor["x"] * w), int(anchor["y"] * h)), 7, (0, 255, 0), -1)
output = artifact_dir / "supported_segment_geometry_diagnostic.png"
cv2.imwrite(str(output), image)
print(output)

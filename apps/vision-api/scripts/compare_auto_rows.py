"""Compare baseline V2 rows with the experimental perspective-aware axes."""
from __future__ import annotations
import argparse, json
from pathlib import Path
from PIL import Image, ImageDraw
from app.services.cv_service import cv_service
from app.services.auto_parking_service import detections_from_response, infer_rows
from app.services.experimental_auto_rows import infer_rows_experimental, infer_rows_experimental_v2, infer_rows_experimental_v3, infer_rows_experimental_v4

def main() -> None:
    ap = argparse.ArgumentParser(); ap.add_argument("image_directory", type=Path); ap.add_argument("--output", type=Path, default=Path("auto-parking-experimental")); args = ap.parse_args()
    paths = sorted(p for p in args.image_directory.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"})
    responses = [(p.name, cv_service.analyze_image(p.read_bytes())) for p in paths]
    items = [d for i, (name, response) in enumerate(responses) for d in detections_from_response(response, i, name)]
    v2, v2_rejected = infer_rows(items); experimental, experimental_rejected = infer_rows_experimental(items); experimental_v2, experimental_v2_rejected = infer_rows_experimental_v2(items); experimental_v3, experimental_v3_rejected, graph_diag = infer_rows_experimental_v3(items); experimental_v4, experimental_v4_rejected, graph_v4 = infer_rows_experimental_v4(items)
    args.output.mkdir(parents=True, exist_ok=True)
    result = {"image_count": len(paths), "detection_count": len(items), "v2": {"rows": v2, "rejected_count": len(v2_rejected)}, "experimental_v1": {"rows": experimental, "rejected_count": len(experimental_rejected)}, "experimental_v2": {"rows": experimental_v2, "rejected_count": len(experimental_v2_rejected)}, "experimental_v3": {"rows": experimental_v3, "rejected_count": len(experimental_v3_rejected), "graph": graph_diag}, "experimental_v4": {"rows": experimental_v4, "rejected_count": len(experimental_v4_rejected), "graph": graph_v4}}
    (args.output / "comparison.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    reference = Image.open(paths[0]).convert("RGB")
    def px(point): return (round(point["x"] * reference.width), round(point["y"] * reference.height))
    for name, rows, rejected, filename, color in (("v2", v2, v2_rejected, "auto_rows_v2.png", (60,220,255,255)), ("experimental", experimental, experimental_rejected, "auto_rows_experimental.png", (255,120,40,255)), ("experimental_v2", experimental_v2, experimental_v2_rejected, "auto_rows_experimental_v2.png", (80,255,100,255)), ("experimental_v3", experimental_v3, experimental_v3_rejected, "auto_rows_experimental_v3.png", (180,80,255,255))):
        image = reference.copy(); draw = ImageDraw.Draw(image, "RGBA")
        for d in items:
            p = px(d.as_dict()["bottom_center"]); draw.ellipse((p[0]-4,p[1]-4,p[0]+4,p[1]+4), fill=(255,80,80,180))
        for d in rejected:
            p = px(d["bottom_center"]); draw.line((p[0]-7,p[1]-7,p[0]+7,p[1]+7), fill=(255,255,255,255), width=2); draw.line((p[0]-7,p[1]+7,p[0]+7,p[1]-7), fill=(255,255,255,255), width=2)
        for row in rows:
            line = [px(p) for p in row["centerline"]]; draw.line(line, fill=color, width=5); count=row.get("observation_count", row.get("raw_observation_count", 0)); draw.text(line[0], f'{row["row_id"]} n={count} img={row["distinct_image_count"]}', fill=(255,255,255,255))
        image.save(args.output / filename)
    print(json.dumps({"v2_rows": len(v2), "experimental_v1_rows": len(experimental), "experimental_v2_rows": len(experimental_v2), "experimental_v3_rows": len(experimental_v3), "v2_rejected": len(v2_rejected), "experimental_v1_rejected": len(experimental_rejected), "experimental_v2_rejected": len(experimental_v2_rejected), "experimental_v3_rejected": len(experimental_v3_rejected), "output": str(args.output)}, indent=2))

if __name__ == "__main__": main()

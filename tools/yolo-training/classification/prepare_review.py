"""Stage a new source in the existing N/M gallery without creating training data."""

import argparse
import hashlib
import io
import json
import math
import re
import zipfile
from collections import Counter, defaultdict
from pathlib import Path, PurePosixPath

import PIL
import shapely
import yaml
from gallery import render_gallery
from PIL import Image, ImageDraw
from prepare import (
    IMAGE_EXTENSIONS,
    MAX_IMAGE_BYTES,
    SAFE_NAME,
    Groups,
    difference_hash,
    digest,
    duplicate_groups,
    find_similar,
    json_bytes,
    load_review,
    parse_label,
    pixel_hash,
    write_json,
)
from shapely.geometry import Polygon


def source_key(name):
    name = re.sub(r"\.rf\.[^.]+(?=\.[^.]+$)", "", PurePosixPath(name).name).rsplit(".", 1)[0].lower()
    return re.sub(r"(?:_(?:jpg|jpeg|png|webp|bmp))+$", "", name)


def parse_source_labels(text, names, defaults):
    rows = []
    for line, raw in enumerate(text.splitlines(), 1):
        if not raw.strip():
            continue
        fields = raw.split()
        if len(fields) == 5:
            row = parse_label(raw, names, defaults)[0]
            row.update(annotation_format="bbox", polygon_points=None)
            if row["bbox_normalized"]:
                x, y, w, h = row["bbox_normalized"]
                row["bbox_xyxy_normalized"] = [x - w / 2, y - h / 2, x + w / 2, y + h / 2]
        else:
            row = {"original_class": None, "original_class_id": None, "canonical_class": None,
                   "bbox_normalized": None, "polygon_points": None, "annotation_format": "polygon", "issues": []}
            try:
                cid = int(fields[0])
                if str(cid) != fields[0] or not 0 <= cid < len(names):
                    raise ValueError
                row.update(original_class_id=cid, original_class=names[cid], canonical_class=defaults[names[cid]])
            except ValueError:
                row["issues"].append("invalid_class_id")
            try:
                coords = list(map(float, fields[1:]))
                if len(coords) < 6 or len(coords) % 2 or not all(math.isfinite(v) and 0 <= v <= 1 for v in coords):
                    raise ValueError
                points = list(zip(coords[0::2], coords[1::2], strict=True))
                polygon = Polygon(points)
                row["polygon_points"] = points
                if not polygon.is_valid or polygon.area <= 0:
                    raise ValueError
                left, top, right, bottom = polygon.bounds
                row["bbox_normalized"] = [(left + right) / 2, (top + bottom) / 2, right - left, bottom - top]
                row["bbox_xyxy_normalized"] = [left, top, right, bottom]
            except ValueError:
                row["issues"].append("invalid_polygon")
        row.update(line_number=line, raw_label=raw)
        rows.append(row)
    return rows


def validate_workspace_review(review, rows):
    for row in rows:
        decision = review.get("annotations", {}).get(row["annotation_id"], {})
        if row["requires_class_selection"] and decision.get("confirmed") and not decision.get("exclude") and not decision.get("canonical_class"):
            raise ValueError(f"Explicit canonical_class required for {row['annotation_id']} ({row['original_class']})")


def verify_workspace(root):
    root = Path(root)
    if not (root / "WORKSPACE_COMPLETE").is_file():
        raise ValueError("Review workspace is incomplete")
    hashes = json.loads((root / "integrity.json").read_text(encoding="utf-8"))
    actual = {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()} - {"integrity.json", "WORKSPACE_COMPLETE"}
    if actual != set(hashes) or any(digest((root / relative).read_bytes()) != value for relative, value in hashes.items()):
        raise ValueError("Review workspace files changed; keep decisions in an external review JSON")


def publish_workspace(output, run, workspace):
    write_json(output / "latest.json", {"workspace": workspace, "run": run.name, "review_only": True})
    (output / "index.html").write_text(f'<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url={run.name}/index.html"><a href="{run.name}/index.html">Open review workspace</a>', encoding="utf-8")


def build_workspace(config_path, output=None, review_path=None, archive_path=None):
    config_path = Path(config_path).resolve()
    config = json.loads(config_path.read_text(encoding="utf-8"))
    workspace = config["workspace"]
    source, mapping = config["source"], config["mapping"]
    if not SAFE_NAME.fullmatch(workspace) or not SAFE_NAME.fullmatch(source["id"]):
        raise ValueError("Workspace/source IDs must be safe names")
    if any(not source.get("license", {}).get(key) for key in ("name", "credit", "url")):
        raise ValueError("Source license, credit and URL required")
    for folder in source["splits"].values():
        if PurePosixPath(folder).is_absolute() or ".." in PurePosixPath(folder).parts:
            raise ValueError("Unsafe source folder")
    catalog = json.loads((config_path.parent / config["canonical_config"]).read_text(encoding="utf-8"))
    classes = sorted({value for item in catalog["sources"] for value in item["class_map"].values()})
    for policy in mapping.values():
        if policy["default_class"] is not None and policy["default_class"] not in classes:
            raise ValueError("Unknown default canonical class")
        if set(policy["candidates"]) - set(classes):
            raise ValueError("Unknown candidate canonical class")
    archive_path = Path(archive_path).resolve() if archive_path else (config_path.parent / source["archive"]).resolve()
    with archive_path.open("rb") as stream:
        archive_hash = hashlib.file_digest(stream, "sha256").hexdigest()
    review_path = Path(review_path).resolve() if review_path else None
    review_bytes = review_path.read_bytes() if review_path else b"{}"
    code_hash = digest(Path(__file__).read_bytes() + Path(__file__).with_name("gallery.py").read_bytes())
    fingerprint = digest(json_bytes([config, classes, archive_hash, digest(review_bytes), code_hash, PIL.__version__, shapely.__version__, yaml.__version__]))
    output = Path(output).resolve() if output else config_path.parent / "prepared" / ("review-" + workspace)
    run = output / ("workspace-" + fingerprint[:20])
    if run.exists():
        verify_workspace(run)
        publish_workspace(output, run, workspace)
        return run
    run.mkdir(parents=True)
    for folder in ("review-crops", "images", "credits"):
        (run / folder).mkdir()
    images, rows = [], []
    defaults = {name: policy["default_class"] for name, policy in mapping.items()}
    with zipfile.ZipFile(archive_path) as archive:
        members = [entry.filename for entry in archive.infolist() if not entry.is_dir()]
        for member, count in Counter(members).items():
            if count > 1:
                entries = [entry for entry in archive.infolist() if entry.filename == member]
                if len({digest(archive.read(entry)) for entry in entries}) != 1:
                    raise ValueError(f"Conflicting duplicate archive member: {member}")
        members = list(dict.fromkeys(members))
        metadata = yaml.safe_load(archive.read(source["yaml"]))
        names = metadata["names"]
        if not isinstance(names, list) or len(set(names)) != len(names) or metadata.get("nc", len(names)) != len(names) or set(names) != set(mapping):
            raise ValueError("Explicit mapping must cover exactly the YAML class names")
        for member in members:
            if PurePosixPath(member).name.startswith("README") and archive.getinfo(member).file_size < 1_000_000:
                (run / "credits" / (digest(member.encode())[:8] + "-" + PurePosixPath(member).name)).write_bytes(archive.read(member))
        for split, folder in source["splits"].items():
            filenames = sorted(n for n in members if n.startswith(folder + "/images/") and PurePosixPath(n).suffix.lower() in IMAGE_EXTENSIONS)
            for filename in filenames:
                image_id = digest(f"{source['id']}/{filename}".encode())[:24]
                record = {"image_id": image_id, "source_dataset": source["id"], "source_image": filename, "original_split": split,
                          "license": source["license"], "issues": [], "size": None, "byte_sha256": None, "pixel_sha256": None,
                          "source_filename_group": source_key(filename), "assigned_split": None}
                decoded = None
                try:
                    if archive.getinfo(filename).file_size > MAX_IMAGE_BYTES:
                        raise ValueError("Image too large")
                    raw = archive.read(filename)
                    record["byte_sha256"] = digest(raw)
                    with Image.open(io.BytesIO(raw)) as opened:
                        if opened.width * opened.height > Image.MAX_IMAGE_PIXELS:
                            raise ValueError("Image dimensions too large")
                        opened.load()
                        if opened.getexif().get(274, 1) != 1:
                            record["issues"].append("orientation_requires_review")
                        decoded = opened.convert("RGB")
                    record.update(size=list(decoded.size), pixel_sha256=pixel_hash(decoded), dhash=difference_hash(decoded))
                except (OSError, ValueError, Image.DecompressionBombError):
                    record["issues"].append("unreadable_image")
                relative = PurePosixPath(filename).relative_to(folder + "/images")
                label = str(PurePosixPath(folder) / "labels" / relative.with_suffix(".txt"))
                text = ""
                if label not in members:
                    record["issues"].append("missing_label")
                else:
                    try:
                        text = archive.read(label).decode("utf-8-sig")
                    except UnicodeDecodeError:
                        record["issues"].append("invalid_label_encoding")
                annotation_rows = parse_source_labels(text, names, defaults)
                overlay = decoded.copy() if decoded is not None else None
                for row in annotation_rows:
                    policy = mapping.get(row["original_class"], {})
                    row.update({key: record[key] for key in ("image_id", "source_dataset", "source_image", "original_split", "license")})
                    row.update(annotation_id=f"{image_id}:{row['line_number']}", mapped_class=row["canonical_class"],
                               requires_class_selection=row["canonical_class"] is None,
                               class_candidates=policy.get("candidates", []), mapping_note=policy.get("note", ""),
                               source_size=record["size"], source_byte_sha256=record["byte_sha256"], source_pixel_sha256=record["pixel_sha256"],
                               crop=None, review_flags=[], split=None, classification_path=None, label_confirmed=False)
                    row["issues"] += record["issues"]
                    if not row["issues"] and decoded is not None:
                        left, top, right, bottom = row["bbox_xyxy_normalized"]
                        iw, ih = decoded.size
                        bounds = [max(0, math.floor(left * iw)), max(0, math.floor(top * ih)), min(iw, math.ceil(right * iw)), min(ih, math.ceil(bottom * ih))]
                        crop = decoded.crop(bounds)
                        path = f"review-crops/{image_id}-{row['line_number']}.png"
                        crop.save(run / path)
                        row["crop"] = {"path": path, "xyxy_pixels": bounds, "width": crop.width, "height": crop.height,
                                       "pixel_sha256": pixel_hash(crop), "byte_sha256": digest((run / path).read_bytes()),
                                       "policy": "containing_bbox_native_pixels_no_resize"}
                        draw = ImageDraw.Draw(overlay)
                        if row["polygon_points"]:
                            points = [(x * iw, y * ih) for x, y in row["polygon_points"]]
                            draw.line([*points, points[0]], fill="red", width=2)
                        else:
                            draw.rectangle(bounds, outline="red", width=2)
                    rows.append(row)
                record["annotation_count"] = len(annotation_rows)
                if overlay is not None:
                    overlay.thumbnail((480, 480))
                    record["preview"] = f"images/{image_id}.jpg"
                    overlay.save(run / record["preview"], quality=85)
                images.append(record)
    review = load_review(review_path, images, rows, classes)
    validate_workspace_review(review, rows)
    grouping = Groups(i["image_id"] for i in images)
    filename_groups = defaultdict(list)
    for image in images:
        filename_groups[image["source_filename_group"]].append(image["image_id"])
    for ids in filename_groups.values():
        grouping.union(ids)
    for field in ("byte_sha256", "pixel_sha256"):
        for ids in duplicate_groups(images, field):
            grouping.union(ids)
    by_annotation = {a["annotation_id"]: a for a in rows}
    for ids in review.get("same_vehicle_groups", []):
        grouping.union([by_annotation[key]["image_id"] for key in ids])
    for image in images:
        image["group_id"] = "group-" + grouping.find(image["image_id"])
        image["review"] = review.get("images", {}).get(image["image_id"], {})
    lookup = {i["image_id"]: i for i in images}
    for row in rows:
        decision = review.get("annotations", {}).get(row["annotation_id"], {})
        excluded = decision.get("exclude") or lookup[row["image_id"]]["review"].get("exclude")
        row.update(review=decision, canonical_class=decision.get("canonical_class", row["mapped_class"]),
                   group_id=lookup[row["image_id"]]["group_id"], label_confirmed=bool(decision.get("confirmed") and not excluded))
        row["disposition"] = "invalid" if row["issues"] else "excluded_by_review" if excluded else "review_confirmed" if row["label_confirmed"] else "review_pending"
    similar = find_similar(images, 6)
    pixel_duplicates = duplicate_groups(images, "pixel_sha256")
    signatures = defaultdict(list)
    for row in rows:
        signatures[row["image_id"]].append((row["original_class"], row["raw_label"]))
    conflicts = [{"images": ids, "reason": "duplicate pixels with different annotations; all retained for review"}
                 for ids in pixel_duplicates if len({json.dumps(sorted(signatures[key])) for key in ids}) > 1]
    before = {"totals": {"images": len(images), "annotation_lines": len(rows)}, "annotation_conflicts": conflicts,
              "crop_label_conflicts": [], "byte_duplicate_groups": duplicate_groups(images, "byte_sha256"),
              "pixel_duplicate_groups": pixel_duplicates, "source_filename_groups": dict(filename_groups),
              "issues": dict(Counter(issue for row in rows for issue in row["issues"])),
              "original_split_annotations": dict(Counter(row["original_split"] for row in rows))}
    info = {"id": workspace, "title": config.get("title", workspace), "review_filename": f"review-{workspace}.json",
            "preview_annotations": sum(bool(a["crop"]) for a in rows), "requires_selection": sum(a["requires_class_selection"] for a in rows),
            "archive_sha256": archive_hash, "review_only": True}
    after = {"status": "provisional_review_workspace", "classification_crops": 0, "classes": {name: {} for name in classes},
             "review_workspace": info, "unconfirmed_included_annotations": sum(not a["label_confirmed"] for a in rows),
             "dispositions": dict(Counter(a["disposition"] for a in rows))}
    write_json(run / "audit_before.json", before)
    write_json(run / "audit_after.json", after)
    write_json(run / "images.json", images)
    write_json(run / "review_applied.json", review)
    write_json(run / "similar_pairs.json", similar)
    write_json(run / "workspace.json", {**info, "config": config, "fingerprint": fingerprint, "code_sha256": code_hash,
                                       "versions": {"pillow": PIL.__version__, "shapely": shapely.__version__, "pyyaml": yaml.__version__}})
    (run / "manifest.jsonl").write_text("".join(json.dumps(a, ensure_ascii=False) + "\n" for a in rows), encoding="utf-8")
    render_gallery(run, images, rows, before, after, similar)
    write_json(run / "integrity.json", {p.relative_to(run).as_posix(): digest(p.read_bytes()) for p in run.rglob("*") if p.is_file()})
    (run / "WORKSPACE_COMPLETE").write_text(fingerprint + "\n", encoding="utf-8")
    verify_workspace(run)
    publish_workspace(output, run, workspace)
    return run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("honda2.review.json"))
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--review", type=Path)
    args = parser.parse_args()
    run = build_workspace(args.config, args.output, args.review, args.archive)
    print(json.dumps({"workspace": str(run), "gallery": str(run / "index.html"), "review_only": True}, indent=2))


if __name__ == "__main__":
    main()

"""Auditable YOLO detection ZIP -> provisional model-family classification crops.

No inference, training, downloads or source extraction. Python 3.12, Pillow, PyYAML.
"""

import argparse
import copy
import hashlib
import io
import json
import math
import random
import re
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path, PurePosixPath

import PIL
import yaml
from PIL import Image, ImageDraw, UnidentifiedImageError

SPLITS = ("train", "val", "test")
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
SAFE_NAME = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}\Z")
MAX_IMAGE_BYTES = 50 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 40_000_000


def digest(value):
    return hashlib.sha256(value).hexdigest()


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_jsonl(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def pixel_hash(image):
    return digest(json_bytes(image.size) + image.convert("RGB").tobytes())


def difference_hash(image):
    pixels = list(image.convert("L").resize((9, 8), Image.Resampling.LANCZOS).getdata())
    value = 0
    for y in range(8):
        for x in range(8):
            value = (value << 1) | (pixels[y * 9 + x] > pixels[y * 9 + x + 1])
    return value


class Groups:
    def __init__(self, keys):
        self.parent = {key: key for key in keys}

    def find(self, key):
        while self.parent[key] != key:
            self.parent[key] = self.parent[self.parent[key]]
            key = self.parent[key]
        return key

    def union(self, keys):
        roots = sorted({self.find(key) for key in keys})
        for root in roots[1:]:
            self.parent[root] = roots[0]


def duplicate_groups(records, field):
    buckets = defaultdict(list)
    for record in records:
        if record.get(field):
            buckets[record[field]].append(record["image_id"])
    return [sorted(ids) for _, ids in sorted(buckets.items()) if len(ids) > 1]


def parse_label(text, names, mapping):
    """Keep every nonempty annotation line, including invalid ones, for audit."""
    result = []
    for number, raw in enumerate(text.splitlines(), 1):
        if not raw.strip():
            continue
        record = {"line_number": number, "raw_label": raw, "issues": [],
                  "original_class": None, "canonical_class": None, "bbox_normalized": None}
        fields = raw.split()
        if len(fields) != 5:
            record["issues"].append("malformed_label")
        else:
            try:
                class_id = int(fields[0])
                if str(class_id) != fields[0] or not 0 <= class_id < len(names):
                    raise ValueError
                record["original_class_id"] = class_id
                record["original_class"] = names[class_id]
                record["canonical_class"] = mapping[names[class_id]]
            except (ValueError, KeyError):
                record["issues"].append("class_id_out_of_range_or_invalid")
            try:
                x, y, w, h = map(float, fields[1:])
                if not all(math.isfinite(v) for v in (x, y, w, h)):
                    raise ValueError
                record["bbox_normalized"] = [x, y, w, h]
                if w <= 0 or h <= 0:
                    record["issues"].append("box_without_area")
                elif min(x - w / 2, y - h / 2) < -1e-9 or max(x + w / 2, y + h / 2) > 1 + 1e-9:
                    record["issues"].append("box_outside_image")
            except ValueError:
                record["issues"].append("invalid_box_coordinates")
        result.append(record)
    return result


def validate_config(config):
    if not isinstance(config.get("seed"), int) or not isinstance(config.get("similar_dhash_max_distance", 6), int) or not 0 <= config.get("similar_dhash_max_distance", 6) <= 64:
        raise ValueError("seed must be an integer; similarity distance must be an integer 0..64")
    if not isinstance(config.get("sources"), list) or not config["sources"]:
        raise ValueError("Config needs at least one source")
    ratios = config.get("ratios", {})
    if set(ratios) != set(SPLITS) or any(not isinstance(v, (float, int)) or not math.isfinite(v) or v <= 0 for v in ratios.values()) or not math.isclose(sum(ratios.values()), 1):
        raise ValueError("ratios must contain positive train/val/test fractions summing to 1")
    ids = set()
    for source in config["sources"]:
        source_id = source["id"]
        if not SAFE_NAME.fullmatch(source_id) or source_id in ids:
            raise ValueError("Source IDs must be unique safe directory names")
        ids.add(source_id)
        if set(source["splits"]) != set(SPLITS):
            raise ValueError("Each source needs explicit train/val/test folder mapping")
        for folder in source["splits"].values():
            if PurePosixPath(folder).is_absolute() or ".." in PurePosixPath(folder).parts:
                raise ValueError("Unsafe ZIP split folder")
        if not source.get("class_map") or any(not SAFE_NAME.fullmatch(v) for v in source["class_map"].values()):
            raise ValueError("Explicit class_map with safe canonical directory names required")
        if any(not source.get("license", {}).get(key) for key in ("name", "credit", "url")):
            raise ValueError("Each source needs license name, credit, url")


def audit_counts(images, annotations):
    counts = {}
    for source in sorted({image["source_dataset"] for image in images}):
        for split in SPLITS:
            subset = [i for i in images if i["source_dataset"] == source and i["original_split"] == split]
            ids = {i["image_id"] for i in subset}
            rows = [a for a in annotations if a["image_id"] in ids]
            classes = {}
            for name in sorted({a["original_class"] for a in annotations if a["source_dataset"] == source and a["original_class"] is not None}):
                matches = [a for a in rows if a["original_class"] == name]
                classes[name] = {"images": len({a["image_id"] for a in matches}), "boxes": len(matches),
                                 "valid_boxes": sum(not a["issues"] for a in matches)}
            counts[f"{source}/{split}"] = {"images": len(subset), "annotation_lines": len(rows),
                                          "valid_boxes": sum(not a["issues"] for a in rows), "classes": classes}
    return counts


def scan_sources(config, archives, work):
    images, annotations, sources, file_issues = [], [], [], []
    for source in sorted(config["sources"], key=lambda item: item["id"]):
        source_id = source["id"]
        with zipfile.ZipFile(archives[source_id]) as archive:
            members = [item.filename for item in archive.infolist() if not item.is_dir()]
            if len(set(members)) != len(members):
                raise ValueError(f"{source_id}: duplicate ZIP member paths")
            yaml_member = source["yaml"]
            if archive.getinfo(yaml_member).file_size > 1024 * 1024:
                raise ValueError("data.yaml too large")
            metadata = yaml.safe_load(archive.read(yaml_member))
            names = metadata["names"]
            if isinstance(names, dict):
                names = [names[i] for i in range(len(names))]
            if not isinstance(names, list) or len(set(names)) != len(names) or metadata.get("nc", len(names)) != len(names):
                raise ValueError(f"{source_id}: invalid YAML class names/nc")
            if set(source["class_map"]) != set(names):
                raise ValueError(f"{source_id}: class_map must explicitly cover exactly the YAML names")
            credits_dir = work / "credits" / source_id
            credits_dir.mkdir(parents=True)
            for name in members:
                if PurePosixPath(name).name.startswith("README") and archive.getinfo(name).file_size < 1024 * 1024:
                    (credits_dir / (digest(name.encode())[:8] + "-" + PurePosixPath(name).name)).write_bytes(archive.read(name))
            with archives[source_id].open("rb") as stream:
                archive_hash = hashlib.file_digest(stream, "sha256").hexdigest()
            sources.append({"id": source_id, "archive_name": archives[source_id].name,
                            "archive_sha256": archive_hash,
                            "yaml": metadata, "class_map": source["class_map"], "license": source["license"],
                            "known_preprocessing": source.get("known_preprocessing", [])})
            for split, folder in source["splits"].items():
                image_members = sorted(name for name in members if name.startswith(folder.rstrip("/") + "/images/") and PurePosixPath(name).suffix.lower() in IMAGE_EXTENSIONS)
                expected_labels = set()
                for name in image_members:
                    relative = PurePosixPath(name).relative_to(folder + "/images")
                    label_name = str(PurePosixPath(folder) / "labels" / relative.with_suffix(".txt"))
                    expected_labels.add(label_name)
                    image_id = digest(f"{source_id}/{name}".encode())[:24]
                    record = {"image_id": image_id, "source_dataset": source_id, "source_image": name,
                              "original_split": split, "source_label": label_name, "issues": [],
                              "license": source["license"], "size": None, "byte_sha256": None, "pixel_sha256": None}
                    image = None
                    try:
                        if archive.getinfo(name).file_size > MAX_IMAGE_BYTES:
                            raise ValueError("image_file_too_large")
                        raw = archive.read(name)
                        record["byte_sha256"] = digest(raw)
                        with Image.open(io.BytesIO(raw)) as opened:
                            if opened.width * opened.height > Image.MAX_IMAGE_PIXELS:
                                raise ValueError("image_dimensions_too_large")
                            opened.load()
                            if opened.getexif().get(274, 1) != 1:
                                record["issues"].append("exif_orientation_needs_annotation_review")
                            image = opened.convert("RGB")
                        record["size"] = list(image.size)
                        record["pixel_sha256"] = pixel_hash(image)
                        record["dhash"] = difference_hash(image)
                    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
                        record["issues"].append("unreadable_image:" + type(exc).__name__)
                    label_text = ""
                    if label_name not in members:
                        record["issues"].append("missing_label")
                    elif archive.getinfo(label_name).file_size > 2 * 1024 * 1024:
                        record["issues"].append("label_too_large")
                    else:
                        try:
                            label_text = archive.read(label_name).decode("utf-8-sig")
                        except UnicodeDecodeError:
                            record["issues"].append("label_encoding_error")
                    rows = parse_label(label_text, names, source["class_map"])
                    overlay = image.copy() if image is not None else None
                    for row in rows:
                        row.update({key: record[key] for key in ("image_id", "source_dataset", "source_image", "original_split", "license")})
                        row.update({"source_size": record["size"], "source_byte_sha256": record["byte_sha256"],
                                    "source_pixel_sha256": record["pixel_sha256"], "mapped_class": row["canonical_class"]})
                        row["annotation_id"] = image_id + f":{row['line_number']}"
                        row["issues"] += record["issues"]
                        row["crop"] = None
                        row["review_flags"] = []
                        if not row["issues"] and image is not None:
                            x, y, w, h = row["bbox_normalized"]
                            iw, ih = image.size
                            bounds = [max(0, math.floor((x - w / 2) * iw)), max(0, math.floor((y - h / 2) * ih)),
                                      min(iw, math.ceil((x + w / 2) * iw)), min(ih, math.ceil((y + h / 2) * ih))]
                            crop = image.crop(bounds)
                            crop_path = f"review-crops/{image_id}-{row['line_number']}.png"
                            crop.save(work / crop_path)
                            row["crop"] = {"path": crop_path, "xyxy_pixels": bounds, "width": crop.width, "height": crop.height,
                                           "pixel_sha256": pixel_hash(crop), "byte_sha256": digest((work / crop_path).read_bytes()),
                                           "policy": "floor-left-top_ceil-right-bottom_no-resize"}
                            if min(crop.size) < 24:
                                row["review_flags"].append("small_crop")
                            if max(crop.width / crop.height, crop.height / crop.width) > 4:
                                row["review_flags"].append("extreme_aspect_ratio")
                            if w * h > 0.95:
                                row["review_flags"].append("nearly_full_image_box")
                            draw = ImageDraw.Draw(overlay)
                            draw.rectangle(bounds, outline="red", width=2)
                            draw.text((bounds[0], bounds[1]), f"{row['line_number']} {row['original_class']}", fill="red")
                        annotations.append(row)
                    record["annotation_count"] = len(rows)
                    if overlay is not None:
                        overlay.thumbnail((480, 480))
                        record["preview"] = f"images/{image_id}.jpg"
                        overlay.save(work / record["preview"], quality=85)
                    images.append(record)
                for name in members:
                    if name.startswith(folder + "/labels/") and name.endswith(".txt") and name not in expected_labels:
                        file_issues.append({"source_dataset": source_id, "file": name, "issue": "orphan_label"})
    return images, annotations, sources, file_issues


def load_review(path, images, annotations, classes):
    review = json.loads(path.read_text(encoding="utf-8")) if path else {}
    if not isinstance(review, dict) or review.get("version", 1) != 1:
        raise ValueError("Unsupported review version")
    if set(review) - {"version", "annotations", "images", "same_vehicle_groups", "similar_pairs"}:
        raise ValueError("Unknown review keys; check review schema in README")
    image_ids = {i["image_id"] for i in images}
    annotation_ids = {a["annotation_id"] for a in annotations}
    for key, allowed in (("images", image_ids), ("annotations", annotation_ids)):
        if not isinstance(review.get(key, {}), dict) or set(review.get(key, {})) - allowed:
            raise ValueError(f"Review {key} contains stale or unknown IDs")
        for decision in review.get(key, {}).values():
            keys = {"exclude", "reason"} if key == "images" else {"exclude", "reason", "confirmed", "canonical_class"}
            if set(decision) - keys:
                raise ValueError(f"Unknown {key} review fields")
            for boolean in ("exclude", "confirmed"):
                if boolean in decision and not isinstance(decision[boolean], bool):
                    raise ValueError("Review flags must be booleans")
            if decision.get("exclude") and not decision.get("reason"):
                raise ValueError("Exclusions need a reason")
            if "canonical_class" in decision and (decision["canonical_class"] not in classes or not decision.get("confirmed") or not decision.get("reason")):
                raise ValueError("Label corrections need an existing canonical class, confirmed=true and reason")
    for group in review.get("same_vehicle_groups", []):
        if not isinstance(group, list) or len(group) < 2 or set(group) - annotation_ids:
            raise ValueError("same_vehicle_groups must list at least two known annotation IDs")
    for pair in review.get("similar_pairs", []):
        if set(pair) != {"images", "decision", "reason"} or len(pair["images"]) != 2 or set(pair["images"]) - image_ids or pair["decision"] not in {"distinct", "same_vehicle_grouped", "uncertain"} or not pair["reason"]:
            raise ValueError("Invalid similar-pair review")
    return review


def annotation_signature(rows):
    return sorted(json.dumps([a["canonical_class"], a["bbox_normalized"], sorted(a["issues"]), a["raw_label"] if a["issues"] else None], sort_keys=True) for a in rows)


def reconcile(images, annotations, review):
    by_image = defaultdict(list)
    image_lookup = {i["image_id"]: i for i in images}
    annotation_lookup = {a["annotation_id"]: a for a in annotations}
    grouping = Groups(image_lookup)
    for field in ("byte_sha256", "pixel_sha256"):
        for ids in duplicate_groups(images, field):
            grouping.union(ids)
    for group in review.get("same_vehicle_groups", []):
        grouping.union([annotation_lookup[key]["image_id"] for key in group])
    for a in annotations:
        decision = review.get("annotations", {}).get(a["annotation_id"], {})
        a["review"] = decision
        a["canonical_class"] = decision.get("canonical_class", a["canonical_class"])
        a["label_confirmed"] = decision.get("confirmed", False)
        a["disposition"] = "invalid" if a["issues"] else "candidate"
        if decision.get("exclude") or review.get("images", {}).get(a["image_id"], {}).get("exclude"):
            a["disposition"] = "excluded_by_review"
        by_image[a["image_id"]].append(a)
    conflicts, deduplications = [], []
    # Byte duplicates are necessarily decoded-pixel duplicates for readable images.
    for ids in duplicate_groups(images, "pixel_sha256"):
        active = [key for key in ids if not review.get("images", {}).get(key, {}).get("exclude")]
        signatures = {key: annotation_signature([a for a in by_image[key] if a["disposition"] != "excluded_by_review"]) for key in ids}
        conflict = len({json.dumps(signatures[key]) for key in ids}) > 1
        unresolved = len({json.dumps(signatures[key]) for key in active}) > 1
        if conflict:
            conflicts.append({"images": ids, "signatures": signatures, "unresolved": unresolved,
                              "action": "quarantine_active_annotations" if unresolved else "resolved_by_explicit_review"})
        if unresolved:
            for key in active:
                for a in by_image[key]:
                    if a["disposition"] == "candidate":
                        a["disposition"] = "quarantined_duplicate_annotation_conflict"
        elif active:
            keeper = min(active, key=lambda key: (image_lookup[key]["source_dataset"], image_lookup[key]["source_image"]))
            keep_rows = [a for a in by_image[keeper] if a["disposition"] != "excluded_by_review"]
            for key in active:
                if key == keeper:
                    continue
                deduplications.append({"image_id": key, "kept_image_id": keeper, "reason": "identical_pixels_and_annotation_multiset"})
                for a in by_image[key]:
                    if a["disposition"] == "candidate":
                        a["disposition"] = "duplicate_annotation"
                        a["duplicate_of"] = next(b["annotation_id"] for b in keep_rows if annotation_signature([a]) == annotation_signature([b]))
    crop_buckets = defaultdict(list)
    for a in annotations:
        if a["crop"]:
            crop_buckets[a["crop"]["pixel_sha256"]].append(a)
    crop_conflicts = []
    for rows in crop_buckets.values():
        grouping.union([a["image_id"] for a in rows])
        candidates = [a for a in rows if a["disposition"] == "candidate"]
        if len({a["canonical_class"] for a in candidates}) > 1:
            crop_conflicts.append([a["annotation_id"] for a in candidates])
            for a in candidates:
                a["disposition"] = "quarantined_crop_label_conflict"
    for image in images:
        image["group_id"] = "group-" + grouping.find(image["image_id"])
        image["review"] = review.get("images", {}).get(image["image_id"], {})
    for a in annotations:
        a["group_id"] = image_lookup[a["image_id"]]["group_id"]
    return conflicts, deduplications, crop_conflicts


def assign_splits(rows, ratios, seed):
    """Deterministic group-level greedy stratification with coverage preference.

    Never split a group to achieve ratios. Coverage is best effort, reported below.
    """
    groups = defaultdict(Counter)
    for a in rows:
        groups[a["group_id"]][a["canonical_class"]] += 1
    totals = Counter(a["canonical_class"] for a in rows)
    independent = {name: sum(name in counts for counts in groups.values()) for name in totals}
    rng = random.Random(seed)
    keys = sorted(groups)
    rng.shuffle(keys)
    # Scarce classes first, then larger groups. Random shuffle deterministically breaks ties.
    keys.sort(key=lambda key: (min(independent[c] for c in groups[key]), -sum(groups[key].values())))
    counts = {split: Counter() for split in SPLITS}
    group_counts = Counter()
    assignments = {}
    remaining = Counter(independent)
    for key in keys:
        current = groups[key]
        scores = {}
        for split in SPLITS:
            score = 0.0
            for name, amount in current.items():
                target = totals[name] * ratios[split]
                score += ((counts[split][name] + amount - target) ** 2 - (counts[split][name] - target) ** 2) / max(target, 1)
                # Prefer train for single independent group; with >=3 aim for all splits.
                wanted = SPLITS if independent[name] >= 3 else ("train",)
                missing = [s for s in wanted if counts[s][name] == 0]
                if split in missing:
                    score -= 10_000 if remaining[name] <= len(missing) else 1
            target_groups = len(keys) * ratios[split]
            score += 0.2 * ((group_counts[split] + 1 - target_groups) ** 2 - (group_counts[split] - target_groups) ** 2) / max(target_groups, 1)
            scores[split] = score
        chosen = min(SPLITS, key=lambda split: scores[split])
        assignments[key] = chosen
        counts[chosen].update(current)
        group_counts[chosen] += 1
        remaining.subtract(current.keys())
    return assignments


def find_similar(images, threshold):
    result = []
    valid = [i for i in images if i.get("pixel_sha256")]
    for position, first in enumerate(valid):
        for second in valid[position + 1:]:
            if first["pixel_sha256"] == second["pixel_sha256"]:
                continue
            distance = (first["dhash"] ^ second["dhash"]).bit_count()
            if distance <= threshold:
                result.append({"images": sorted([first["image_id"], second["image_id"]]), "dhash_distance": distance,
                               "meaning": "heuristic_candidate_only_not_identity_evidence"})
    return sorted(result, key=lambda pair: (pair["dhash_distance"], pair["images"]))


def leakage_report(rows, images):
    lookup = {i["image_id"]: i for i in images}
    fields = {key: defaultdict(set) for key in ("group", "source_image", "source_byte", "source_pixel", "crop_byte", "crop_pixel")}
    for a in rows:
        image = lookup[a["image_id"]]
        values = {"group": a["group_id"], "source_image": a["image_id"], "source_byte": image["byte_sha256"],
                  "source_pixel": image["pixel_sha256"], "crop_byte": a["crop"]["byte_sha256"], "crop_pixel": a["crop"]["pixel_sha256"]}
        for key, value in values.items():
            fields[key][value].add(a["split"])
    return {key + "_cross_split": sum(len(splits) > 1 for splits in buckets.values()) for key, buckets in fields.items()}


def verify_output(root):
    root = Path(root)
    integrity = json.loads((root / "integrity.json").read_text(encoding="utf-8"))
    actual = {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()} - {"integrity.json", "COMPLETE"}
    if actual != set(integrity):
        raise ValueError("Existing run has missing/extra files; use a new output directory")
    for relative, expected in integrity.items():
        if digest((root / relative).read_bytes()) != expected:
            raise ValueError(f"Existing output changed: {relative}; put edits in an external review file")
    images = json.loads((root / "images.json").read_text(encoding="utf-8"))
    rows = [a for a in read_jsonl(root / "manifest.jsonl") if a["disposition"] == "included"]
    leakage = leakage_report(rows, images)
    if any(leakage.values()):
        raise ValueError(f"Leakage found: {leakage}")
    return leakage


def publish_latest(output, run):
    write_json(output / "latest.json", {"run": run.name, "status": "provisional", "gallery": f"{run.name}/index.html"})
    (output / "index.html").write_text(f'<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url={run.name}/index.html"><a href="{run.name}/index.html">Open latest provisional review</a>', encoding="utf-8")


def prepare(config_path, output, review_path=None, overrides=None):
    config_path, output = Path(config_path).resolve(), Path(output).resolve()
    config = json.loads(config_path.read_text(encoding="utf-8"))
    validate_config(config)
    overrides = overrides or {}
    if set(overrides) - {s["id"] for s in config["sources"]}:
        raise ValueError("Unknown source override")
    archives = {s["id"]: Path(overrides.get(s["id"], config_path.parent / s["archive"])).expanduser().resolve() for s in config["sources"]}
    source_hashes = {}
    for key, path in archives.items():
        with path.open("rb") as stream:
            source_hashes[key] = hashlib.file_digest(stream, "sha256").hexdigest()
    review_path = Path(review_path).resolve() if review_path else None
    review_raw = review_path.read_bytes() if review_path else b"{}"
    # A content-addressed immutable run: exact reruns verify and reuse, never append crops.
    code_hash = digest(Path(__file__).read_bytes() + Path(__file__).with_name("gallery.py").read_bytes())
    fingerprint = digest(json_bytes([config, source_hashes, digest(review_raw), code_hash, PIL.__version__, yaml.__version__]))
    run = output / ("run-" + fingerprint[:20])
    if run.exists():
        if not (run / "COMPLETE").is_file():
            raise ValueError(f"Incomplete previous run: {run}; choose a new --output directory")
        verify_output(run)
        publish_latest(output, run)
        return run
    run.mkdir(parents=True)
    for folder in ("review-crops", "images", "classification/train", "classification/val", "classification/test"):
        (run / folder).mkdir(parents=True)
    images, annotations, sources, file_issues = scan_sources(config, archives, run)
    before_rows = copy.deepcopy(annotations)
    original_conflicts, _, original_crop_conflicts = reconcile(copy.deepcopy(images), copy.deepcopy(annotations), {})
    class_names = sorted({name for s in config["sources"] for name in s["class_map"].values()})
    review = load_review(review_path, images, annotations, class_names)
    conflicts, deduplications, crop_conflicts = reconcile(images, annotations, review)
    similar = find_similar(images, config.get("similar_dhash_max_distance", 6))
    reviewed_pairs = {tuple(sorted(p["images"])): p for p in review.get("similar_pairs", [])}
    for pair in similar:
        pair["review"] = reviewed_pairs.get(tuple(pair["images"]), {})
        if pair["review"].get("decision") == "same_vehicle_grouped":
            groups = {i["group_id"] for i in images if i["image_id"] in pair["images"]}
            if len(groups) > 1:
                raise ValueError("Pair marked same_vehicle_grouped without a linking same_vehicle_groups entry")
    candidates = [a for a in annotations if a["disposition"] == "candidate"]
    assignments = assign_splits(candidates, config["ratios"], config["seed"])
    for image in images:
        image["assigned_split"] = assignments.get(image["group_id"])
    for a in annotations:
        a["split"] = None
        a["classification_path"] = None
        if a["disposition"] == "candidate":
            a["split"] = assignments[a["group_id"]]
            a["disposition"] = "included"
            filename = a["annotation_id"].replace(":", "-") + ".png"
            relative = f"classification/{a['split']}/{a['canonical_class']}/{filename}"
            (run / relative).parent.mkdir(parents=True, exist_ok=True)
            (run / relative).write_bytes((run / a["crop"]["path"]).read_bytes())
            a["classification_path"] = relative
    included = [a for a in annotations if a["disposition"] == "included"]
    byte_groups, pixel_groups = duplicate_groups(images, "byte_sha256"), duplicate_groups(images, "pixel_sha256")
    image_lookup = {i["image_id"]: i for i in images}
    def crosses(ids):
        return len({image_lookup[key]["original_split"] for key in ids}) > 1
    before = {"totals": {"images": len(images), "annotation_lines": len(annotations), "valid_boxes": sum(not a["issues"] for a in before_rows),
                          "yaml_classes": sum(len(s["class_map"]) for s in sources),
                          "classes_with_annotations": len({a["original_class"] for a in before_rows if a["original_class"] is not None})},
              "sources": sources, "original_counts": audit_counts(images, before_rows),
              "byte_duplicate_groups": byte_groups, "pixel_duplicate_groups": pixel_groups,
              "original_byte_duplicate_groups_cross_split": sum(crosses(g) for g in byte_groups),
              "original_pixel_duplicate_groups_cross_split": sum(crosses(g) for g in pixel_groups),
              "annotation_conflicts": original_conflicts, "crop_label_conflicts": original_crop_conflicts, "file_issues": file_issues,
              "image_issues": [{"image_id": i["image_id"], "issues": i["issues"]} for i in images if i["issues"]],
              "annotation_issues": [{"annotation_id": a["annotation_id"], "issues": a["issues"]} for a in before_rows if a["issues"]],
              "image_sizes": dict(Counter(str(i["size"]) for i in images))}
    classes = {}
    observed = {a[key] for a in annotations for key in ("canonical_class", "mapped_class") if a[key]}
    for name in sorted(observed):
        rows = [a for a in included if a["canonical_class"] == name]
        groups = {a["group_id"] for a in rows}
        counts = {s: {"crops": sum(a["split"] == s for a in rows),
                      "source_images": len({a["image_id"] for a in rows if a["split"] == s}),
                      "groups": len({a["group_id"] for a in rows if a["split"] == s})} for s in SPLITS}
        classes[name] = {"independent_groups_known": len(groups), "splits": counts,
                         "limitation": "fewer_than_three_independent_groups" if len(groups) < 3 else ("missing_split_coverage" if any(v["crops"] == 0 for v in counts.values()) else None)}
        # Every observed class remains visible, including empty/quarantined classes.
        for split in SPLITS:
            (run / "classification" / split / name).mkdir(exist_ok=True)
    leakage = leakage_report(included, images)
    if any(leakage.values()):
        raise ValueError(f"Internal split error: {leakage}")
    limitations = ["PROVISIONAL: original model-family labels are unverified unless individually confirmed in review.",
                   "Different-angle images of the same physical motorcycle are not automatically identifiable. Known-group leakage is zero, not proof of physical-identity independence.",
                   "dHash proposes similar-image pairs only; it misses some similarities and produces false positives. Pairs are never automatically removed or grouped.",
                   "Source may already be stretched; crops preserve supplied pixels without resizing and cannot recover original proportions.",
                   "Class names are source labels, not verified manufacturer/model-year identities or measured dimensions.",
                   "Group-stratified ratios are approximate. No augmentation, oversampling, or training is performed.",
                   "Public-source images do not establish performance on the ParkMap camera or parking-space safety."]
    after = {"status": "provisional", "ready_for_production": False, "seed": config["seed"], "target_ratios": config["ratios"],
             "classification_crops": len(included), "unique_source_images_included": len({a["image_id"] for a in included}),
             "known_groups_included": len(assignments), "classes": classes,
             "split_counts": {s: {"crops": sum(a["split"] == s for a in included), "groups": sum(v == s for v in assignments.values())} for s in SPLITS},
             "dispositions": dict(Counter(a["disposition"] for a in annotations)),
             "quarantined_annotations": sum(a["disposition"].startswith("quarantined") for a in annotations),
             "unconfirmed_included_annotations": sum(not a["label_confirmed"] for a in included),
             "similar_pairs_proposed": len(similar), "similar_pairs_pending": sum(p["review"].get("decision") not in {"distinct", "same_vehicle_grouped"} for p in similar),
             "similar_pairs_cross_split_proposed": sum(len({image_lookup[key]["assigned_split"] for key in p["images"]} - {None}) > 1 for p in similar),
             "effective_duplicate_annotation_conflicts": conflicts, "effective_crop_label_conflicts": crop_conflicts,
             "deduplications": deduplications, "leakage": leakage, "limitations": limitations}
    write_json(run / "audit_before.json", before)
    write_json(run / "audit_after.json", after)
    write_json(run / "images.json", images)
    write_json(run / "similar_pairs.json", similar)
    write_json(run / "review_applied.json", review)
    write_json(run / "review.template.json", {"version": 1, "annotations": {}, "images": {}, "same_vehicle_groups": [], "similar_pairs": []})
    write_json(run / "reproducibility.json", {"fingerprint": fingerprint, "source_sha256": source_hashes, "config": config,
                                             "review_sha256": digest(review_raw), "pipeline_sha256": code_hash,
                                             "python": sys.version, "pillow": PIL.__version__, "pyyaml": yaml.__version__})
    (run / "manifest.jsonl").write_text("".join(json.dumps(a, ensure_ascii=False) + "\n" for a in annotations), encoding="utf-8")
    from gallery import render_gallery, write_report

    render_gallery(run, images, annotations, before, after, similar)
    write_report(run, before, after)
    integrity = {p.relative_to(run).as_posix(): digest(p.read_bytes()) for p in sorted(run.rglob("*")) if p.is_file()}
    write_json(run / "integrity.json", integrity)
    (run / "COMPLETE").write_text(fingerprint + "\n", encoding="utf-8")
    verify_output(run)
    publish_latest(output, run)
    return run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("config.json"))
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("prepared"))
    parser.add_argument("--review", type=Path)
    parser.add_argument("--source", action="append", default=[], metavar="ID=ZIP", help="Override source ZIP path; repeat for multiple sources")
    parser.add_argument("--verify", type=Path, help="Verify an existing run's file hashes and leakage without rebuilding")
    args = parser.parse_args()
    if args.verify:
        print(json.dumps(verify_output(args.verify), indent=2))
        return
    overrides = {}
    for item in args.source:
        key, separator, path = item.partition("=")
        if not separator or not path or key in overrides:
            parser.error("--source must be a unique ID=ZIP")
        overrides[key] = path
    result = prepare(args.config, args.output, args.review, overrides)
    print(json.dumps({"output": str(result), "status": "provisional", "audit": str(result / "REPORT.md"), "gallery": str(result / "index.html")}, indent=2))


if __name__ == "__main__":
    main()

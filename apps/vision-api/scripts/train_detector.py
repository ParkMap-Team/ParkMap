"""Train, evaluate, and export a detector using detector-experiment.yaml.

Usage: python scripts/train_detector.py [--config detector-experiment.yaml]
Ultralytics prints epoch and batch progress in the terminal.
"""

import argparse
import csv
import hashlib
import json
import os
import shutil
import sys
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services.detection_evaluation import (  # noqa: E402
    Box,
    Prediction,
    evaluate_frame,
    motorcycle_class_id,
    read_yolo_labels,
    summarize,
)

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}


def resolve_path(value: str, base: Path) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else (base / path).resolve()


def load_config(path: Path) -> dict:
    config = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(config, dict):
        raise ValueError("configuration must be a YAML mapping")
    for section in ("train", "evaluate", "export"):
        if not isinstance(config.get(section), dict):
            raise ValueError(f"missing configuration section: {section}")
    if not isinstance(config.get("model"), str) or not config["model"].strip():
        raise ValueError("model must name a YOLO architecture or weights file")
    if not isinstance(config.get("name"), str) or not config["name"].strip():
        raise ValueError("name must be a nonempty run name")
    if Path(config["name"]).name != config["name"] or config["name"] in {".", ".."}:
        raise ValueError("name must be a simple directory name")
    dataset = resolve_path(config["dataset"], path.parent)
    data_file = dataset / "data.yaml"
    if not data_file.is_file():
        raise ValueError(f"dataset data.yaml not found: {data_file}")
    class_id = motorcycle_class_id(data_file)
    data = yaml.safe_load(data_file.read_text(encoding="utf-8"))
    if len(data["names"]) != 1 or class_id != 0:
        raise ValueError("this experiment expects a single motorcycle class at index 0")
    splits = {}
    for split in ("train", "valid", "test"):
        images, labels = dataset / split / "images", dataset / split / "labels"
        if not images.is_dir() or not labels.is_dir():
            raise ValueError(f"missing {split} images or labels under {dataset}")
        image_files = sorted(p for p in images.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
        if not image_files or any(not (labels / f"{p.stem}.txt").is_file() for p in image_files):
            raise ValueError(f"{split} has no images or has images without labels")
        splits[split] = (images, labels, image_files)
    if len(set().union(*(set(p.name for p in files) for _, _, files in splits.values()))) != sum(
        len(files) for _, _, files in splits.values()
    ):
        raise ValueError("image filenames overlap across train, valid, and test")
    train = config["train"]
    for key in ("epochs", "imgsz", "batch", "workers"):
        if not isinstance(train.get(key), int) or train[key] < (0 if key == "workers" else 1):
            raise ValueError(f"train.{key} must be a valid integer")
    evaluate = config["evaluate"]
    for key in ("confidence", "nms_iou", "match_iou"):
        if not isinstance(evaluate.get(key), (int, float)) or not 0 < evaluate[key] <= 1:
            raise ValueError(f"evaluate.{key} must be in (0, 1]")
    if evaluate["match_iou"] != 0.5:
        raise ValueError("evaluate.match_iou must be 0.5 to match the project evaluation protocol")
    return config, dataset, splits


def column_name(index):
    result = ""
    while index:
        index, digit = divmod(index - 1, 26)
        result = chr(65 + digit) + result
    return result


def cell(value, reference):
    if value is None:
        return f'<c r="{reference}" t="inlineStr"><is><t></t></is></c>'
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f'<c r="{reference}"><v>{value}</v></c>'
    return f'<c r="{reference}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>'


def worksheet(rows, widths, filter_rows=False):
    last_column = column_name(max(len(row) for row in rows))
    columns = "".join(f'<col min="{i}" max="{i}" width="{width}" customWidth="1"/>'
                      for i, width in enumerate(widths, 1))
    body = "".join(
        f'<row r="{index}">' + "".join(cell(value, f"{column_name(column)}{index}")
            for column, value in enumerate(row, 1)) + "</row>"
        for index, row in enumerate(rows, 1)
    )
    freeze = ('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" '
              'activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>') if filter_rows else ""
    auto_filter = f'<autoFilter ref="A1:{last_column}{len(rows)}"/>' if filter_rows else ""
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            f'<dimension ref="A1:{last_column}{len(rows)}"/>{freeze}'
            f"<cols>{columns}</cols><sheetData>{body}</sheetData>{auto_filter}</worksheet>")


def write_excel(path: Path, summary: list[list], frames: list[list], training: list[list] | None = None) -> None:
    """Write a small, dependency-free Excel workbook with typed numeric cells."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(path, "w", ZIP_DEFLATED) as book:
        book.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '<Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '</Types>')
        book.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            '</Relationships>')
        book.writestr("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="Summary" sheetId="1" r:id="rId1"/>'
            '<sheet name="Frames" sheetId="2" r:id="rId2"/>'
            '<sheet name="Training" sheetId="3" r:id="rId3"/></sheets></workbook>')
        book.writestr("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
            '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>'
            '</Relationships>')
        book.writestr("xl/worksheets/sheet1.xml", worksheet(summary, [34, 72, 18]))
        book.writestr("xl/worksheets/sheet2.xml", worksheet(frames, [16, 54, 18, 18, 12, 12, 12], True))
        book.writestr("xl/worksheets/sheet3.xml", worksheet(training or [["Epoch"]], [18] * 15, True))


def read_training_history(path: Path) -> list[list]:
    with path.open(newline="", encoding="utf-8") as file:
        source = csv.reader(file)
        return [[float(value) if row_number and value else value.strip()
                 for value in row]
                for row_number, row in enumerate(source)]


def evaluate_split(model, split, images, labels, settings, class_id=0):
    frame_rows = []
    results = []
    for index, image in enumerate(images, 1):
        prediction = model.predict(source=str(image), imgsz=settings["imgsz"],
            conf=settings["confidence"], iou=settings["nms_iou"],
            device=settings["device"], classes=[class_id], verbose=False)[0]
        width, height = prediction.orig_shape[1], prediction.orig_shape[0]
        detected = [Prediction(Box(float(x1) / width, float(y1) / height,
            float(x2 - x1) / width, float(y2 - y1) / height), float(confidence))
            for (x1, y1, x2, y2), confidence in zip(prediction.boxes.xyxy.cpu().tolist(), prediction.boxes.conf.cpu().tolist())]
        annotations = read_yolo_labels(labels / f"{image.stem}.txt", class_id)
        result = evaluate_frame(detected, annotations)
        results.append(result)
        frame_rows.append([split, image.name, len(annotations), len(detected), result.true_positives,
                           result.false_positives, result.false_negatives])
        if index % 25 == 0 or index == len(images):
            print(f"Evaluate {split}: {index}/{len(images)} images", flush=True)
    return summarize(results), frame_rows


def run(config_path: Path) -> Path:
    config, dataset, splits = load_config(config_path)
    export = config["export"]
    runs_dir = resolve_path(export["runs_dir"], ROOT)
    model_path = resolve_path(export["model_path"], ROOT)
    excel_path = resolve_path(export["excel_path"], ROOT)
    run_dir = runs_dir / config["name"]
    if run_dir.exists() or any(p.exists() for p in (model_path, excel_path)):
        raise ValueError("run or export already exists; choose a new name and export paths to preserve prior results")
    run_dir.mkdir(parents=True)
    normalized_data = run_dir / "data.yaml"
    normalized_data.write_text(yaml.safe_dump({
        "train": str(splits["train"][0]), "val": str(splits["valid"][0]),
        "test": str(splits["test"][0]), "nc": 1, "names": ["motorcycle"],
    }), encoding="utf-8")
    settings_dir = runs_dir / "ultralytics-config"
    (settings_dir / "Ultralytics").mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("YOLO_CONFIG_DIR", str(settings_dir))
    from ultralytics import YOLO

    selected_model = config["model"]
    if selected_model.endswith(".pt") and not Path(selected_model).is_file():
        selected_model = str(resolve_path(selected_model, config_path.parent))
        if not Path(selected_model).is_file():
            raise ValueError(f"pretrained weights not found: {selected_model}")
    model = YOLO(selected_model)
    train = config["train"]
    print(f"Training {selected_model} on {dataset}; progress follows", flush=True)
    model.train(data=str(normalized_data), project=str(runs_dir), name=config["name"],
        exist_ok=True, **train)
    best = run_dir / "weights" / "best.pt"
    if not best.is_file():
        raise ValueError(f"training did not produce {best}")
    trained = YOLO(str(best))
    settings = {"imgsz": train["imgsz"], "device": train["device"], **config["evaluate"]}
    summary = [["ParkMap detector baseline", config["name"]],
               ["Dataset", str(dataset)], ["Model source", config["model"]],
               ["Weights SHA-256", hashlib.sha256(best.read_bytes()).hexdigest()],
               ["Run (UTC)", datetime.now(timezone.utc).isoformat()],
               ["Metric", "Validation", "Test"]]
    frames = [["Split", "Image", "Annotations", "Predictions", "TP", "FP", "FN"]]
    metrics = {}
    for split in ("valid", "test"):
        metrics[split], rows = evaluate_split(trained, split, splits[split][2], splits[split][1], settings)
        frames.extend(rows)
    for label, key in (("Frames", "frames"), ("TP", "true_positives"), ("FP", "false_positives"),
                       ("FN", "false_negatives"), ("Precision", "precision"), ("Recall", "recall")):
        summary.append([label, getattr(metrics["valid"], key), getattr(metrics["test"], key)])
    summary.extend([["Match IoU", settings["match_iou"]], ["Confidence", settings["confidence"]],
                    ["NMS IoU", settings["nms_iou"]], ["Image size", settings["imgsz"]],
                    ["Epochs", train["epochs"]], ["Batch", train["batch"]],
                    ["Note", "Public stand-in dataset; not real-lot accuracy"]])
    model_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(best, model_path)
    write_excel(excel_path, summary, frames, read_training_history(run_dir / "results.csv"))
    (run_dir / "baseline.json").write_text(json.dumps({
        "config": config, "dataset": str(dataset), "weights": str(model_path),
        "metrics": {key: asdict(value) for key, value in metrics.items()},
    }, indent=2), encoding="utf-8")
    print(f"Validation: {metrics['valid']}", flush=True)
    print(f"Test: {metrics['test']}", flush=True)
    print(f"Excel: {excel_path}\nModel: {model_path}", flush=True)
    return excel_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=ROOT / "detector-experiment.yaml")
    args = parser.parse_args()
    try:
        run(args.config.resolve())
    except (OSError, ValueError, yaml.YAMLError) as exc:
        print(f"Experiment failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

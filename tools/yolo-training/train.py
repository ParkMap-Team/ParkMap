"""Run local YOLO training from VS Code Terminal. Never modifies the API's weights."""

import argparse
import hashlib
import importlib.metadata
import json
from datetime import UTC, datetime
from pathlib import Path

from dataset_check import validate_dataset


def positive(value):
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("must be positive")
    return number


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", required=True, type=Path, help="Export directory containing train/val/test and sessions.json")
    parser.add_argument("--validate-only", action="store_true", help="Check data without loading YOLO or training")
    parser.add_argument("--model", default="yolo11s.pt")
    parser.add_argument("--epochs", type=positive, default=150)
    parser.add_argument("--imgsz", type=positive, default=960)
    parser.add_argument("--batch", type=positive, default=1)
    parser.add_argument("--device", default="cpu", help="cpu or CUDA device number, e.g. 0")
    parser.add_argument("--evaluate-test", action="store_true", help="Use held-out test only after choosing a checkpoint using val")
    parser.add_argument("--checkpoint", type=Path, help="With --evaluate-test: evaluate an existing checkpoint instead of training")
    args = parser.parse_args()
    try:
        summary = validate_dataset(args.dataset)
    except (TypeError, ValueError, OSError) as error:
        parser.exit(2, f"Dataset rejected: {error}\n")
    print(json.dumps(summary, indent=2))
    if args.validate_only:
        return 0
    if args.checkpoint and not args.evaluate_test:
        parser.error("--checkpoint requires --evaluate-test; use val for model selection")
    # Import expensive dependencies only after validation and explicit training invocation.
    import yaml
    from ultralytics import YOLO

    output = Path(__file__).resolve().parent / "runs"
    run = output / f"{Path(args.model).stem}_{datetime.now(UTC):%Y%m%dT%H%M%S%fZ}"
    output.mkdir(exist_ok=True)
    yaml_path = output / f"{run.name}.data.yaml"
    yaml_path.write_text(yaml.safe_dump({"path": str(args.dataset.resolve()), "train": "train/images", "val": "val/images", "test": "test/images", "names": {0: "motorcycle"}}), encoding="utf-8")
    if args.checkpoint:
        checkpoint = args.checkpoint.resolve()
        if not checkpoint.is_file():
            parser.error("Checkpoint does not exist")
        model = YOLO(str(checkpoint))
    else:
        source = Path(args.model)
        if source.name == str(source):
            source = Path(__file__).resolve().parent / "weights" / source.name
            source.parent.mkdir(exist_ok=True)
        model = YOLO(str(source))
        model.train(data=str(yaml_path), epochs=args.epochs, imgsz=args.imgsz, batch=args.batch,
                    device=args.device, seed=42, deterministic=True, patience=30, workers=2,
                    project=str(output), name=run.name, exist_ok=False, verbose=True,
                    degrees=3.0, translate=0.08, scale=0.25, fliplr=0.5, mosaic=0.5, close_mosaic=10)
        checkpoint = Path(model.trainer.best)
        model = YOLO(str(checkpoint))
    names = model.names if isinstance(model.names, dict) else dict(enumerate(model.names))
    if set(names) != {0} or str(names[0]).strip().lower() != "motorcycle":
        parser.error("Expected one class: 0 = motorcycle")
    with checkpoint.open("rb") as stream:
        checkpoint_hash = hashlib.file_digest(stream, "sha256").hexdigest()
    report = {"dataset": summary, "checkpoint": str(checkpoint), "weights_sha256": checkpoint_hash,
              "ultralytics": importlib.metadata.version("ultralytics"), "imgsz": args.imgsz, "device": args.device,
              "test_evaluated": args.evaluate_test}
    if args.evaluate_test:
        metrics = model.val(data=str(yaml_path), split="test", imgsz=args.imgsz, device=args.device,
                            conf=0.25, iou=0.5, project=str(output), name=run.name + "_test", exist_ok=False)
        report["test"] = {"map50": float(metrics.box.map50), "map50_95": float(metrics.box.map)}
    (output / f"{run.name}.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Checkpoint: {checkpoint}\nSHA-256: {checkpoint_hash}\nAPI weights unchanged.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

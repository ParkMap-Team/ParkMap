"""Train the model-family classifier in Terminal; test evaluation is explicit."""

import argparse
import json
import math
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from classifier_data import sha256, validate_run


def read_options(config_path, args):
    config_path = config_path.resolve()
    options = json.loads(config_path.read_text(encoding="utf-8"))
    expected = {"dataset", "output", "architecture", "image_size", "epochs", "batch_size", "learning_rate", "seed",
                "device", "threads", "workers", "fine_tune", "augment", "allow_provisional"}
    if set(options) != expected:
        raise ValueError(f"Training config requires exactly: {sorted(expected)}")
    dataset = Path(args.dataset).resolve() if args.dataset else (config_path.parent / options["dataset"]).resolve()
    output = Path(args.output).resolve() if args.output else (config_path.parent / options["output"]).resolve()
    for key in ("epochs", "batch_size", "image_size", "device", "learning_rate", "architecture"):
        value = getattr(args, key)
        if value is not None:
            options[key] = value
    if args.fine_tune:
        options["fine_tune"] = True
    if args.no_augment:
        options["augment"] = False
    if args.patience < 0:
        raise ValueError("patience must be nonnegative; zero disables early stopping")
    options["patience"] = args.patience
    if options["architecture"] not in {"resnet18", "efficientnet_b0", "yolo11n_cls"}:
        raise ValueError("Use architecture=resnet18, efficientnet_b0 or yolo11n_cls")
    if not isinstance(options["device"], str):
        raise TypeError("device must be auto, cpu, cuda[:N] or mps")
    for name in ("epochs", "batch_size", "threads"):
        if type(options[name]) is not int or options[name] <= 0:
            raise ValueError(f"{name} must be a positive integer")
    if type(options["image_size"]) is not int or not 64 <= options["image_size"] <= 1024:
        raise ValueError("image_size must be 64..1024")
    if type(options["workers"]) is not int or options["workers"] < 0 or type(options["seed"]) is not int:
        raise ValueError("workers must be nonnegative and seed must be an integer")
    if not isinstance(options["learning_rate"], (int, float)) or not math.isfinite(options["learning_rate"]) or options["learning_rate"] <= 0:
        raise ValueError("learning_rate must be finite and positive")
    for key in ("fine_tune", "augment", "allow_provisional"):
        if not isinstance(options[key], bool):
            raise TypeError(f"{key} must be a boolean")
    if output.is_relative_to(dataset):
        raise ValueError("Training output must be outside the immutable dataset snapshot")
    options.update(dataset=str(dataset), output=str(output))
    return options


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("training.json"))
    parser.add_argument("--dataset", type=Path, help="Prepared run directory, not classification/ and not latest.json")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--validate-only", action="store_true", help="Verify data without importing Torch, downloading weights or training")
    parser.add_argument("--epochs", type=int)
    parser.add_argument("--batch-size", type=int)
    parser.add_argument("--image-size", type=int)
    parser.add_argument("--learning-rate", type=float)
    parser.add_argument("--device", help="auto, cpu, cuda[:N] or mps")
    parser.add_argument("--architecture", choices=("resnet18", "efficientnet_b0", "yolo11n_cls"))
    parser.add_argument("--fine-tune", action="store_true", help="Update the whole network instead of just its classifier head")
    parser.add_argument("--no-augment", action="store_true")
    parser.add_argument("--patience", type=int, default=0, help="Stop after this many epochs without better validation Macro F1; 0 disables")
    parser.add_argument("--warm-start", type=Path, help="Verified parent ParkMap best.pt for an incoming-only transfer snapshot")
    parser.add_argument("--continue-from", type=Path, help="Continue weights on the exact same snapshot with a fresh optimizer in a new run")
    parser.add_argument("--initial-weights", type=Path, help="Optional original torchvision ImageNet state_dict matching --architecture for offline training")
    parser.add_argument("--evaluate-test", action="store_true", help="Explicit held-out test evaluation, after val-based model selection")
    parser.add_argument("--checkpoint", type=Path, help="ParkMap classifier best.pt; only with --evaluate-test")
    args = parser.parse_args(argv)
    if args.continue_from and (args.warm_start or args.initial_weights or args.evaluate_test):
        parser.error("--continue-from cannot be combined with --warm-start, --initial-weights or --evaluate-test")
    if args.evaluate_test != bool(args.checkpoint):
        parser.error("--evaluate-test and --checkpoint must be supplied together")
    if args.initial_weights and args.evaluate_test:
        parser.error("--initial-weights is for training, not test evaluation")
    if args.warm_start and (args.initial_weights or args.evaluate_test):
        parser.error("--warm-start cannot be combined with --initial-weights or --evaluate-test")
    try:
        options = read_options(args.config, args)
        summary, samples = validate_run(options["dataset"], options["allow_provisional"], warm_start=args.warm_start, evaluation_only=args.evaluate_test)
        if args.initial_weights and not args.initial_weights.is_file():
            raise ValueError("Initial weights file does not exist")
        console_summary = {key: value for key, value in summary.items() if key not in {"class_coverage", "classes", "warm_start_parent", "missing_training_classes"}}
        console_summary["class_count"] = len(summary["classes"])
        console_summary["missing_training_class_count"] = len(summary["missing_training_classes"])
        print(json.dumps({"dataset": console_summary, "options": options, "validate_only": args.validate_only}, indent=2), flush=True)
        if args.validate_only:
            return 0
        # Heavy imports and any weight downloads occur only after an explicit training command.
        from classifier_engine import (
            build_model,
            evaluate_test,
            fit,
            initial_weights_metadata,
            load_checkpoint,
            seed_everything,
            select_device,
        )

        seed_everything(options["seed"], options["threads"])
        options["device"] = str(select_device(options["device"]))
        run = Path(options["output"]) / f"{'test' if args.evaluate_test else 'train'}-{datetime.now(UTC):%Y%m%dT%H%M%SZ}-{uuid4().hex[:8]}"
        print(f"Dataset status: {summary['status']} | {summary['similar_pairs_cross_split_proposed']} proposed similar pairs cross splits; results are exploratory.", flush=True)
        if args.evaluate_test:
            metrics = evaluate_test(args.checkpoint.resolve(), summary, samples, options, run)
            print(f"Test top1: {metrics['top1']:.3f} | macro F1: {metrics['macro_f1']:.3f}\nReport: {run}", flush=True)
        else:
            weights_dir = Path(__file__).with_name("weights")
            if args.warm_start or args.continue_from:
                starting_path = (args.warm_start or args.continue_from).resolve()
                checkpoint = load_checkpoint(starting_path, summary["warm_start_parent"] if args.warm_start else summary)
                if checkpoint["architecture"] != options["architecture"]:
                    raise ValueError("Warm-start architecture must match the parent checkpoint")
                if checkpoint["image_size"] != options["image_size"]:
                    raise ValueError("Warm-start image size must match the parent checkpoint")
                model = build_model(summary["classes"], weights_dir=None, fine_tune=options["fine_tune"], pretrained=False, architecture=options["architecture"])
                model.load_state_dict(checkpoint["state_dict"], strict=True)
                options.update(initial_weights=str(starting_path), initial_weights_source="ParkMap classifier",
                               initial_weights_sha256=sha256(starting_path))
                if args.warm_start:
                    options["warm_start_checkpoint"] = str(starting_path)
                else:
                    options.update(continued_from_checkpoint=str(starting_path), continued_from_epoch=checkpoint["epoch"], optimizer_restored=False)
            else:
                model = build_model(summary["classes"], weights_dir, options["fine_tune"], args.initial_weights, architecture=options["architecture"])
                options.update(initial_weights_metadata(weights_dir, args.initial_weights, architecture=options["architecture"]))
            print(f"Training {len(summary['classes'])} classes | {'full network' if options['fine_tune'] else 'classifier head only'} | device {options['device']}", flush=True)
            fit(model, samples, summary, options, run)
            print(f"Finished. Best classifier: {run / 'best.pt'}\nValidation mistakes: {run / 'val/mistakes.html'}\nHeld-out test was not evaluated.", flush=True)
        return 0
    except (OSError, TypeError, ValueError, RuntimeError) as error:
        parser.exit(2, f"Classifier command failed: {error}\n")
    except KeyboardInterrupt:
        parser.exit(130, "Training interrupted; completed-epoch checkpoints/history remain in the run directory.\n")


if __name__ == "__main__":
    raise SystemExit(main())

"""Train the model-family classifier in Terminal; test evaluation is explicit."""

import argparse
import csv
import json
import math
import re
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import yaml
from architectures import SUPPORTED_TEXT, has_pretrained, is_supported
from classifier_data import sha256, validate_run

REQUIRED = {"dataset", "output", "architecture", "image_size", "epochs", "batch_size", "learning_rate", "seed",
            "device", "threads", "workers", "fine_tune", "augment", "allow_provisional"}
OPTIONAL = {"patience", "experiment", "augmentation", "weight_decay", "label_smoothing", "sampling"}
SUMMARY_FIELDS = ["finished", "run", "model", "architecture", "best_epoch", "epochs_planned", "patience", "batch_size",
                  "learning_rate", "fine_tune", "augmentation", "weight_decay", "label_smoothing", "sampling",
                  "val_top1", "val_macro_f1", "val_loss"]


def run_name(kind, architecture, now, token):
    """Readable local-time run folder; time first keeps name order chronological for the Parking UI."""
    # Hyphens only: the Vision API lists runs matching train-[A-Za-z0-9-]+.
    return f"{kind}-{now:%Y%m%d-%H%M%S}-{architecture.replace('_', '-')}-{token}"


def load_config(config_path):
    """experiments.yaml (commented) or an older JSON config; both give the same plain dictionary."""
    text = Path(config_path).read_text(encoding="utf-8")
    config = yaml.safe_load(text) if Path(config_path).suffix.lower() in {".yaml", ".yml"} else json.loads(text)
    if not isinstance(config, dict):
        raise TypeError(f"{Path(config_path).name} must contain key: value settings at the top level")
    return config


def model_names(config_path):
    models = load_config(config_path).get("models")
    if not isinstance(models, dict) or not models:
        raise ValueError("This config has no 'models' section; use a models config such as experiments.yaml")
    return list(models)


def merge_model(raw, name):
    """One flat option set: shared top-level keys, then 'defaults', then the model's own block."""
    models = raw["models"]
    if name is None:
        raise ValueError(f"Choose a model with --model: {', '.join(models)} (or 'all')")
    if name not in models:
        raise ValueError(f"Unknown model '{name}'. Choose one of: {', '.join(models)}")
    if name == "all" or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,39}", name):
        raise ValueError("Model names use letters, digits, '-' or '_' (up to 40 characters) and cannot be 'all'")
    shared = {key: value for key, value in raw.items() if key not in {"defaults", "models"}}
    merged = {**shared, **raw.get("defaults", {}), **models[name], "experiment": name}
    merged.pop("note", None)  # A free-text hint shown in the menu; not a training option.
    return merged


def read_options(config_path, args, model=None):
    config_path = config_path.resolve()
    options = load_config(config_path)
    model = model or args.model
    if "models" in options:
        # A test report only needs the shared settings (batch size, device); the checkpoint decides the model.
        model = model or (next(iter(options["models"]), None) if args.evaluate_test else None)
        options = merge_model(options, model)
    elif model:
        raise ValueError("--model needs a config with a 'models' section")
    if not REQUIRED <= set(options) <= REQUIRED | OPTIONAL:
        raise ValueError(f"Training config requires {sorted(REQUIRED)} and may add {sorted(OPTIONAL - {'experiment'})}")
    options.setdefault("augmentation", "basic")
    options.setdefault("weight_decay", 0.01)  # AdamW's own default, so older configs train exactly as before
    options.setdefault("label_smoothing", 0.0)
    options.setdefault("sampling", "shuffle")  # plain shuffled epochs, exactly as before
    if options["sampling"] not in {"shuffle", "balanced"}:
        raise ValueError('sampling must be "shuffle" or "balanced"')
    if options["augmentation"] not in {"basic", "strong"}:
        raise ValueError('augmentation must be "basic" or "strong"')
    if not isinstance(options["weight_decay"], (int, float)) or isinstance(options["weight_decay"], bool) or not 0 <= options["weight_decay"] < 1:
        raise ValueError("weight_decay must be a number from 0 up to (not including) 1")
    if not isinstance(options["label_smoothing"], (int, float)) or isinstance(options["label_smoothing"], bool) or not 0 <= options["label_smoothing"] < 1:
        raise ValueError("label_smoothing must be a number from 0 up to (not including) 1")
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
    patience = args.patience if args.patience is not None else options.get("patience", 0)
    if type(patience) is not int or patience < 0:
        raise ValueError("patience must be a nonnegative integer; zero disables early stopping")
    options["patience"] = patience
    if not is_supported(options["architecture"]):
        raise ValueError(f"Use architecture={SUPPORTED_TEXT}")
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
    if not has_pretrained(options["architecture"]) and not options["fine_tune"]:
        raise ValueError(f"{options['architecture']} has no pretrained weights, so training only its last layer is meaningless; "
                         'set "fine_tune": true for this model (or pass --fine-tune) to train the whole network from scratch')
    if output.is_relative_to(dataset):
        raise ValueError("Training output must be outside the immutable dataset snapshot")
    options.update(dataset=str(dataset), output=str(output))
    return options


def summary_rows(path):
    if not path.is_file():
        return []
    with path.open(encoding="utf-8", newline="") as stream:
        return list(csv.DictReader(stream))


def record_summary(path, run, options):
    """One row per finished training run, so every model can be compared in a single file."""
    meta = json.loads((run / "run.json").read_text(encoding="utf-8"))
    val = json.loads((run / "val/metrics.json").read_text(encoding="utf-8"))
    row = {"finished": datetime.now(UTC).astimezone().strftime("%Y-%m-%d %H:%M:%S"), "run": run.name,
           "model": options.get("experiment", options["architecture"]), "architecture": options["architecture"],
           "best_epoch": meta.get("best_epoch"), "epochs_planned": options["epochs"], "patience": options["patience"],
           "batch_size": options["batch_size"], "learning_rate": options["learning_rate"], "fine_tune": options["fine_tune"],
           "augmentation": options["augmentation"] if options["augment"] else "off", "weight_decay": options["weight_decay"],
           "label_smoothing": options["label_smoothing"], "sampling": options.get("sampling", "shuffle"), "val_top1": round(val["top1"], 4), "val_macro_f1": round(val["macro_f1"], 4), "val_loss": round(val.get("loss", math.nan), 4)}
    # Older files lack the newer columns: rewrite them once with blanks rather than append misaligned rows.
    rows = summary_rows(path) + [row]
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=SUMMARY_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def check_all(args):
    """Validate every model's settings and the dataset once per distinct snapshot; trains nothing."""
    checked = set()
    for name in model_names(args.config):
        options = read_options(args.config, args, name)
        if options["dataset"] not in checked:
            checked.add(options["dataset"])
            summary, _ = validate_run(options["dataset"], options["allow_provisional"])
            crops = summary["split_crops"]
            print(f"Dataset {Path(options['dataset']).name}: {summary['status']} | {len(summary['classes'])} classes | "
                  f"train {crops['train']} / val {crops['val']} / test {crops['test']} crops")
        augmentation = options["augmentation"] if options["augment"] else "off"
        print(f"  {name:<18}{options['architecture']:<20}epochs {options['epochs']:<5}patience {options['patience']:<4}"
              f"batch {options['batch_size']:<4}lr {options['learning_rate']:<8}{'full network' if options['fine_tune'] else 'head only':<13}"
              f"aug {augmentation:<7}wd {options['weight_decay']:<6}smooth {options['label_smoothing']:<5}sampling {options['sampling']}")
    return 0


def choose_models(config_path):
    """Menu of the config's models; returns the chosen names in menu order."""
    models = load_config(config_path)["models"]
    names = model_names(config_path)
    print("Choose a model to train:")
    for number, name in enumerate(names, start=1):
        print(f"  {number:>2}) {name:<16}{models[name].get('architecture', ''):<20}{models[name].get('note', '')}")
    print("   a) all of them, one after another")
    try:
        answer = input("Number or name (several allowed, e.g. 1 3), a = all: ")
    except EOFError:
        raise ValueError("No model was chosen; pass --model NAME") from None
    chosen = []
    for token in re.split(r"[,\s]+", answer.strip().lower()):
        if not token:
            continue
        if token in {"a", "all"}:
            chosen = list(names)
            break
        picked = names[int(token) - 1] if token.isdigit() and 1 <= int(token) <= len(names) else next((n for n in names if n.lower() == token), None)
        if picked is None:
            raise ValueError(f"'{token}' is not on the list; type a number, a model name, or a")
        if picked not in chosen:
            chosen.append(picked)
    if not chosen:
        raise ValueError("No model was chosen")
    return [name for name in names if name in chosen]


def train_all(args, argv, names=None):
    """Train each model in its own process, one after another, then print the batch ranked by val macro-F1."""
    names = names or model_names(args.config)
    first = read_options(args.config, args, names[0])
    summary_path = Path(first["output"]) / "summary.csv"
    before = len(summary_rows(summary_path))
    passthrough, skip = [], False
    for item in argv:
        if skip:
            skip = False
        elif item == "--model":
            skip = True
        elif item != "--choose" and not item.startswith("--model="):
            passthrough.append(item)
    failed = []
    for number, name in enumerate(names, start=1):
        print(f"\n===== {name} ({number}/{len(names)}) =====", flush=True)
        code = subprocess.run([sys.executable, str(Path(__file__).resolve()), *passthrough, "--model", name], check=False).returncode
        if code == 130:
            return 130
        if code:
            failed.append(name)
    rows = sorted(summary_rows(summary_path)[before:], key=lambda row: float(row["val_macro_f1"]), reverse=True)
    if rows:
        print("\nThis batch, best val macro-F1 first:")
        print(f"  {'model':<16}{'best epoch':<12}{'val top-1':<11}{'val macro-F1':<14}run")
        for row in rows:
            print(f"  {row['model']:<16}{row['best_epoch']:<12}{row['val_top1']:<11}{row['val_macro_f1']:<14}{row['run']}")
        print(f"All runs are in {summary_path}")
    if failed:
        print(f"Failed: {', '.join(failed)}", file=sys.stderr)
    return 1 if failed else 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("experiments.yaml"))
    parser.add_argument("--model", help="Model name from the config's 'models' section, or 'all' to train each in turn")
    parser.add_argument("--choose", action="store_true", help="Pick the model(s) from a menu instead of naming one")
    parser.add_argument("--dataset", type=Path, help="Prepared run directory, not classification/ and not latest.json")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--validate-only", action="store_true", help="Verify data without importing Torch, downloading weights or training")
    parser.add_argument("--epochs", type=int)
    parser.add_argument("--batch-size", type=int)
    parser.add_argument("--image-size", type=int)
    parser.add_argument("--learning-rate", type=float)
    parser.add_argument("--device", help="auto, cpu, cuda[:N] or mps")
    parser.add_argument("--architecture", help=SUPPORTED_TEXT)
    parser.add_argument("--fine-tune", action="store_true", help="Update the whole network instead of just its classifier head")
    parser.add_argument("--no-augment", action="store_true")
    parser.add_argument("--patience", type=int, help="Stop after this many epochs without better validation Macro F1; 0 disables (default: the config's value)")
    parser.add_argument("--continue-from", type=Path, help="Continue weights on the exact same snapshot with a fresh optimizer in a new run")
    parser.add_argument("--initial-weights", type=Path, help="Optional original torchvision ImageNet state_dict matching --architecture for offline training")
    parser.add_argument("--evaluate-test", action="store_true", help="Explicit held-out test evaluation, after val-based model selection")
    parser.add_argument("--checkpoint", type=Path, help="ParkMap classifier best.pt; only with --evaluate-test")
    args = parser.parse_args(argv)
    if args.continue_from and (args.initial_weights or args.evaluate_test):
        parser.error("--continue-from cannot be combined with --initial-weights or --evaluate-test")
    if args.evaluate_test != bool(args.checkpoint):
        parser.error("--evaluate-test and --checkpoint must be supplied together")
    if args.initial_weights and args.evaluate_test:
        parser.error("--initial-weights is for training, not test evaluation")
    if args.model == "all" and (args.evaluate_test or args.continue_from):
        parser.error("--model all trains every model from its pretrained weights; it cannot be combined with --evaluate-test or --continue-from")
    if args.choose and (args.model or args.validate_only or args.evaluate_test or args.continue_from):
        parser.error("--choose picks models to train; it cannot be combined with --model, --validate-only, --evaluate-test or --continue-from")
    try:
        if args.choose:
            chosen = choose_models(args.config)
            if len(chosen) > 1:
                return train_all(args, list(sys.argv[1:] if argv is None else argv), chosen)
            args.model = chosen[0]
        if args.model == "all":
            return check_all(args) if args.validate_only else train_all(args, list(sys.argv[1:] if argv is None else argv))
        options = read_options(args.config, args)
        summary, samples = validate_run(options["dataset"], options["allow_provisional"], evaluation_only=args.evaluate_test)
        if args.initial_weights and not args.initial_weights.is_file():
            raise ValueError("Initial weights file does not exist")
        console_summary = {key: value for key, value in summary.items() if key not in {"class_coverage", "classes", "missing_training_classes"}}
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
        # A training run carries its model's name; a test report is named for the evaluated checkpoint's architecture.
        label = load_checkpoint(args.checkpoint.resolve(), summary)["architecture"] if args.evaluate_test else options.get("experiment", options["architecture"])
        run = Path(options["output"]) / run_name("test" if args.evaluate_test else "train", label,
                                                  datetime.now(UTC).astimezone(), uuid4().hex[:6])
        print(f"Dataset status: {summary['status']} | {summary['similar_pairs_cross_split_proposed']} proposed similar pairs cross splits; results are exploratory.", flush=True)
        if args.evaluate_test:
            metrics = evaluate_test(args.checkpoint.resolve(), summary, samples, options, run)
            print(f"Test top1: {metrics['top1']:.3f} | macro F1: {metrics['macro_f1']:.3f}\nReport: {run}", flush=True)
        else:
            weights_dir = Path(__file__).with_name("weights")
            if args.continue_from:
                starting_path = args.continue_from.resolve()
                checkpoint = load_checkpoint(starting_path, summary)
                if checkpoint["architecture"] != options["architecture"]:
                    raise ValueError("--continue-from architecture must match the checkpoint")
                if checkpoint["image_size"] != options["image_size"]:
                    raise ValueError("--continue-from image size must match the checkpoint")
                model = build_model(summary["classes"], weights_dir=None, fine_tune=options["fine_tune"], pretrained=False, architecture=options["architecture"])
                model.load_state_dict(checkpoint["state_dict"], strict=True)
                options.update(initial_weights=str(starting_path), initial_weights_source="ParkMap classifier",
                               initial_weights_sha256=sha256(starting_path))
                options.update(continued_from_checkpoint=str(starting_path), continued_from_epoch=checkpoint["epoch"], optimizer_restored=False)
            else:
                model = build_model(summary["classes"], weights_dir, options["fine_tune"], args.initial_weights, architecture=options["architecture"])
                options.update(initial_weights_metadata(weights_dir, args.initial_weights, architecture=options["architecture"]))
            print(f"Training {len(summary['classes'])} classes | {'full network' if options['fine_tune'] else 'classifier head only'} | device {options['device']}", flush=True)
            fit(model, samples, summary, options, run)
            record_summary(Path(options["output"]) / "summary.csv", run, options)
            print(f"Finished. Best classifier: {run / 'best.pt'}\nValidation mistakes: {run / 'val/mistakes.html'}\nHeld-out test was not evaluated.", flush=True)
        return 0
    except (OSError, TypeError, ValueError, RuntimeError) as error:
        parser.exit(2, f"Classifier command failed: {error}\n")
    except KeyboardInterrupt:
        parser.exit(130, "Training interrupted; completed-epoch checkpoints/history remain in the run directory.\n")


if __name__ == "__main__":
    raise SystemExit(main())

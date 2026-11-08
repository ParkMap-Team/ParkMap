"""Train or test YOLO motorcycle detectors and segmenters. Every setting comes from config.yaml; the API's weights are never touched.

  python train.py                      menu: pick model(s), then train each
  python train.py --model yolo26s      skip the menu (repeat --model for several, or --model all)
  python train.py --check              validate the dataset and list models; trains nothing
  python train.py --test               menu: pick a finished run and evaluate it once on the held-out test split
"""

import argparse
import csv
import hashlib
import importlib.metadata
import json
import platform
import re
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path

import yaml

from dataset_check import validate_dataset

HERE = Path(__file__).resolve().parent
ROUND = re.compile(r"^round-(\d+)_")
TASKS = {"detect": "dataset", "segment": "segment_dataset"}  # model task -> config key of its dataset


class Tee:
    """Mirror a stream into the active run log. Installed once, before Ultralytics is imported,
    because Ultralytics binds its logger to the stdout object that exists at import time."""

    log = None  # file of the run currently logging, shared by stdout and stderr

    def __init__(self, stream):
        self.stream = stream

    def write(self, text):
        self.stream.write(text)
        if Tee.log:
            Tee.log.write(text)
            Tee.log.flush()
        return len(text)

    def flush(self):
        self.stream.flush()

    def isatty(self):
        return self.stream.isatty()

    def __getattr__(self, name):
        return getattr(self.stream, name)


def load_config(path):
    config = yaml.safe_load(path.read_text(encoding="utf-8"))
    for key in ("dataset", "output", "weights_dir", "classes", "train", "test", "models"):
        if key not in config:
            raise ValueError(f"config is missing '{key}'")
    if not config["models"]:
        raise ValueError("config has no models")
    for name, entry in config["models"].items():
        task = entry.get("task", "detect")
        if task not in TASKS:
            raise ValueError(f"model '{name}': unknown task '{task}'; use {' or '.join(TASKS)}")
        if TASKS[task] not in config:
            raise ValueError(f"model '{name}' is a {task} model but config is missing '{TASKS[task]}'")
    base = path.parent
    config["_source"] = path
    config["_paths"] = {key: (base / config[key]).resolve()
                        for key in ("dataset", "segment_dataset", "output", "weights_dir") if key in config}
    return config


def model_task(entry):
    """'detect' (boxes) or 'segment' (boxes + masks); a summary.json written before tasks existed is detect."""
    return entry.get("task", "detect")


def dataset_path(config, task):
    return config["_paths"][TASKS[task]]


def model_settings(config, name):
    entry = config["models"][name]
    return {**config["train"], **entry.get("train", {})}


def choose(options, prompt, allow_all):
    """Numbered menu; returns the chosen keys in menu order."""
    keys = list(options)
    for index, key in enumerate(keys, 1):
        print(f"  {index}. {key:<12} {options[key]}")
    if not sys.stdin.isatty():
        raise SystemExit("No terminal for the menu; pass --model <name> instead.")
    hint = "number(s) separated by spaces" + (", or a = all" if allow_all else "")
    while True:
        answer = input(f"{prompt} ({hint}): ").strip().lower()
        if allow_all and answer == "a":
            return keys
        picks = answer.split()
        if picks and all(p.isdigit() and 1 <= int(p) <= len(keys) for p in picks):
            return list(dict.fromkeys(keys[int(p) - 1] for p in picks))
        print("Not a valid choice, try again.")


def next_run_dir(output, model):
    """runs/<model>/round-NN_<date>_<time>: round counts every earlier run of that model."""
    folder = output / model
    rounds = [int(m.group(1)) for d in folder.glob("round-*") if (m := ROUND.match(d.name))] if folder.is_dir() else []
    return folder / f"round-{max(rounds, default=0) + 1:02d}_{datetime.now():%Y-%m-%d_%H-%M}"


def load_model(entry_or_summary, source):
    """YOLO or RT-DETR, chosen by the model's 'family' in the config."""
    from ultralytics import RTDETR, YOLO  # expensive; imported only when a run starts

    family = entry_or_summary.get("family", "yolo")
    if family not in ("yolo", "rtdetr"):
        raise ValueError(f"unknown family '{family}'; use yolo or rtdetr")
    return (RTDETR if family == "rtdetr" else YOLO)(str(source))


def weights_source(config, entry):
    """A .pt file is pretrained weights kept in weights_dir; a .yaml is an untrained architecture Ultralytics ships."""
    name = entry["weights"]
    if name.endswith((".yaml", ".yml")):
        return name
    path = config["_paths"]["weights_dir"] / name
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def resolve_device(device):
    if device != "auto":
        return device
    import torch

    return 0 if torch.cuda.is_available() else "cpu"


def environment():
    import torch

    gpu = torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
    return {"python": platform.python_version(), "platform": platform.platform(), "torch": torch.__version__,
            "cuda": torch.version.cuda, "gpu": gpu, "ultralytics": importlib.metadata.version("ultralytics")}


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False, default=str), encoding="utf-8")


def with_log(run_dir, log_name, work):
    """Run work() with everything printed (including failures) also written to run_dir/log_name."""
    run_dir.mkdir(parents=True, exist_ok=True)
    Tee.log = (run_dir / log_name).open("a", encoding="utf-8")
    try:
        print(f"=== {log_name} started {datetime.now():%Y-%m-%d %H:%M:%S} ===")
        return work()
    except BaseException:
        traceback.print_exc()
        raise
    finally:
        print(f"=== {log_name} ended {datetime.now():%Y-%m-%d %H:%M:%S} ===")
        Tee.log.close()
        Tee.log = None


def data_yaml(config, run_dir, task):
    path = run_dir / "data.yaml"
    names = {int(k): v for k, v in config["classes"].items()}
    path.write_text(yaml.safe_dump({"path": str(dataset_path(config, task)), "train": "train/images",
                                    "val": "val/images", "test": "test/images", "names": names}), encoding="utf-8")
    return path


def append_history(output, row):
    path = output / "history.csv"
    new = not path.exists()
    with path.open("a", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(row))
        if new:
            writer.writeheader()
        writer.writerow(row)


def update_history(output, run, test_map50):
    path = output / "history.csv"
    if not path.exists():
        return
    with path.open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream))
    for row in rows:
        if row["run"] == run:
            row["test_map50"] = test_map50
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def best_val(run_dir):
    """Best epoch by val mAP50-95 from Ultralytics results.csv."""
    path = run_dir / "results.csv"
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as stream:
        rows = [{k.strip(): v for k, v in row.items()} for row in csv.DictReader(stream)]
    if not rows:
        return {}
    best = max(rows, key=lambda r: float(r["metrics/mAP50-95(B)"]))  # box metric, so detect and segment runs compare
    result = {"best_epoch": int(float(best["epoch"])), "epochs_run": len(rows),
              "val_map50": float(best["metrics/mAP50(B)"]), "val_map50_95": float(best["metrics/mAP50-95(B)"]),
              "val_precision": float(best["metrics/precision(B)"]), "val_recall": float(best["metrics/recall(B)"])}
    if "metrics/mAP50-95(M)" in best:  # segment runs also report mask metrics at the same epoch
        result.update(val_mask_map50=float(best["metrics/mAP50(M)"]), val_mask_map50_95=float(best["metrics/mAP50-95(M)"]))
    return result


def train_one(config, name, dataset_summary):
    output = config["_paths"]["output"]
    run_dir = next_run_dir(output, name)
    settings = model_settings(config, name)
    entry = config["models"][name]
    task = model_task(entry)

    def work():
        settings["device"] = resolve_device(settings["device"])
        summary = {"model": name, "task": task, "description": entry.get("description", ""), "run": run_dir.name,
                   "status": "running", "started": f"{datetime.now():%Y-%m-%d %H:%M:%S}",
                   "environment": environment(), "dataset": {"path": str(dataset_path(config, task)), **dataset_summary},
                   "weights": entry["weights"], "family": entry.get("family", "yolo"),
                   "pretrained": not entry["weights"].endswith((".yaml", ".yml")), "train": settings}
        (run_dir / "config_used.yaml").write_text(config["_source"].read_text(encoding="utf-8"), encoding="utf-8")
        write_json(run_dir / "summary.json", summary)
        print(json.dumps(summary, indent=2, default=str))
        started = time.time()
        try:
            model = load_model(entry, weights_source(config, entry))
            model.train(data=str(data_yaml(config, run_dir, task)), project=str(run_dir.parent), name=run_dir.name,
                        exist_ok=True, **settings)
            best = Path(model.trainer.best)
            summary.update(status="complete", checkpoint=str(best), checkpoint_sha256=sha256(best))
        except KeyboardInterrupt:
            summary["status"] = "interrupted"
            raise
        except Exception:
            summary["status"] = "failed"
            raise
        finally:
            summary.update(ended=f"{datetime.now():%Y-%m-%d %H:%M:%S}",
                           minutes=round((time.time() - started) / 60, 1), **best_val(run_dir))
            write_json(run_dir / "summary.json", summary)
            append_history(output, {"run": f"{name}/{run_dir.name}", "status": summary["status"],
                                    "started": summary["started"], "minutes": summary["minutes"],
                                    "epochs": settings["epochs"], "imgsz": settings["imgsz"], "batch": settings["batch"],
                                    "best_epoch": summary.get("best_epoch"), "val_map50": summary.get("val_map50"),
                                    "val_map50_95": summary.get("val_map50_95"), "test_map50": None})
            print(f"Run folder: {run_dir}\nStatus: {summary['status']}  API weights unchanged.")

    return with_log(run_dir, "train.log", work)


def finished_runs(output):
    runs = {}
    for summary in sorted(output.glob("*/round-*/summary.json")):
        data = json.loads(summary.read_text(encoding="utf-8"))
        if data.get("status") == "complete":
            label = f"val mAP50-95 {data.get('val_map50_95', 0):.3f}" + ("  [test already done]" if "test" in data else "")
            runs[f"{data['model']}/{summary.parent.name}"] = label
    return runs


def test_one(config, key, datasets):
    run_dir = config["_paths"]["output"] / key
    summary = json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))
    dataset_summary = datasets(model_task(summary))
    if "test" in summary:
        raise SystemExit(f"{key} was already tested; the held-out split is used once per run.")

    def work():
        used = summary["train"]
        args = {**config["test"], "imgsz": used["imgsz"], "device": resolve_device(used["device"])}
        print(json.dumps({"run": key, "test": args}, indent=2, default=str))
        metrics = load_model(summary, summary["checkpoint"]).val(data=str(run_dir / "data.yaml"), project=str(run_dir), name="test",
                                                    exist_ok=True, **args)
        summary["test"] = {"map50": float(metrics.box.map50), "map50_95": float(metrics.box.map),
                           "precision": float(metrics.box.mp), "recall": float(metrics.box.mr),
                           "dataset": dataset_summary["test"], "args": args, "at": f"{datetime.now():%Y-%m-%d %H:%M:%S}"}
        if model_task(summary) == "segment":
            summary["test"].update(mask_map50=float(metrics.seg.map50), mask_map50_95=float(metrics.seg.map))
        write_json(run_dir / "summary.json", summary)
        update_history(config["_paths"]["output"], key, summary["test"]["map50"])
        print(json.dumps(summary["test"], indent=2, default=str))

    with_log(run_dir, "test.log", work)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", type=Path, default=HERE / "config.yaml")
    parser.add_argument("--model", action="append", help="model name from config.yaml, or 'all'; skips the menu")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="validate dataset and config only")
    mode.add_argument("--test", action="store_true", help="evaluate a finished run on the held-out test split")
    args = parser.parse_args()
    if not isinstance(sys.stdout, Tee):
        sys.stdout, sys.stderr = Tee(sys.stdout), Tee(sys.stderr)
    checked = {}

    def datasets(task):
        """Validate the dataset of a task once, when a model of that task is first needed."""
        if task not in checked:
            try:
                checked[task] = validate_dataset(dataset_path(config, task), config["classes"], task)
            except (TypeError, ValueError, OSError, KeyError) as error:
                parser.exit(2, f"Rejected {task} dataset: {error}\n")
            print(json.dumps({"task": task, "dataset": str(dataset_path(config, task)), **checked[task]}, indent=2))
        return checked[task]

    try:
        config = load_config(args.config)
    except (TypeError, ValueError, OSError, KeyError) as error:
        parser.exit(2, f"Rejected: {error}\n")
    models = config["models"]
    if args.check:
        for task in dict.fromkeys(model_task(m) for m in models.values()):
            datasets(task)
        for name in models:
            settings = model_settings(config, name)
            print(f"  {name:<16} {model_task(models[name]):<7} epochs={settings['epochs']} imgsz={settings['imgsz']} batch={settings['batch']}  {models[name].get('description', '')}")
        print("Check passed.")
        return 0
    if args.test:
        runs = finished_runs(config["_paths"]["output"])
        if not runs:
            parser.exit(1, "No finished run to test.\n")
        for key in choose(runs, "Test which run", allow_all=False):
            test_one(config, key, datasets)
        return 0
    if args.model:
        names = list(models) if args.model == ["all"] else args.model
        unknown = [n for n in names if n not in models]
        if unknown:
            parser.error(f"unknown model(s) {unknown}; choose from {list(models)}")
    else:
        print("Models in config.yaml:")
        names = choose({n: m.get("description", "") for n, m in models.items()}, "Train which model", allow_all=True)
    for task in dict.fromkeys(model_task(models[n]) for n in names):  # reject a bad dataset before any run starts
        datasets(task)
    for name in names:
        train_one(config, name, datasets(model_task(models[name])))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

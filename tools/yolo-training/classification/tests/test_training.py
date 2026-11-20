"""Classifier checks use synthetic datasets and never download pretrained weights."""

import importlib.util
import io
import itertools
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
# One flat training config (formerly training.json), for tests that call fit() directly or read a flat config.
BASE_OPTIONS = {"dataset": "data", "output": "runs", "architecture": "resnet18", "image_size": 224, "epochs": 10, "batch_size": 16,
                "learning_rate": 0.001, "seed": 20261102, "device": "auto", "threads": 2, "workers": 0, "fine_tune": False,
                "augment": True, "allow_provisional": True}


class ClassifierTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def dataset(self, source="fixture", color_offset=0, reviewed=False, one_class=False):
        from prepare import prepare

        archive = self.root / "source.zip"
        with zipfile.ZipFile(archive, "w") as z:
            z.writestr("data.yaml", "nc: 2\nnames: [a, b]\n")
            for index in range(12):
                stream = io.BytesIO()
                Image.new("RGB", (40, 20), (index * 20 + color_offset, 30, 50)).save(stream, "PNG")
                z.writestr(f"train/images/{index}.png", stream.getvalue())
                z.writestr(f"train/labels/{index}.txt", f"{0 if one_class else index % 2} 0.5 0.5 1 1")
        config = {"seed": 42, "ratios": {"train": .7, "val": .15, "test": .15}, "sources": [{
            "id": source, "archive": str(archive), "yaml": "data.yaml", "splits": {"train": "train", "val": "valid", "test": "test"},
            "class_map": {"a": "a", "b": "b"}, "license": {"name": "test", "credit": "synthetic", "url": "local"}}]}
        path = self.root / "config.json"
        path.write_text(json.dumps(config))
        run = prepare(path, self.root / "prepared")
        if reviewed:
            from prepare import read_jsonl

            review = self.root / f"review-{source}.json"
            review.write_text(json.dumps({"annotations": {r["annotation_id"]: {"confirmed": True} for r in read_jsonl(run / "manifest.jsonl")}}))
            run = prepare(path, self.root / "prepared", review)
        return run

    def flat_config(self):
        path = self.root / "flat-training.json"
        path.write_text(json.dumps(BASE_OPTIONS), encoding="utf-8")
        return path

    def module(self, name):
        spec = importlib.util.spec_from_file_location(name, ROOT / f"{name}.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_00_validate_provisional_snapshot_and_detect_tampering(self):
        data = self.module("classifier_data")
        run = self.dataset()
        with self.assertRaisesRegex(ValueError, "provisional"):
            data.validate_run(run, allow_provisional=False)
        summary, samples = data.validate_run(run, allow_provisional=True)
        self.assertEqual(summary["classes"], ["a", "b"])
        self.assertEqual(sum(len(rows) for rows in samples.values()), 12)
        self.assertTrue(all(samples[split] for split in ("train", "val", "test")))
        crop = run / samples["train"][0]["classification_path"]
        crop.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "changed"):
            data.validate_run(run, allow_provisional=True)

    def test_01_validate_only_cli_does_not_load_ml_or_create_runs(self):
        run = self.dataset()
        blocker = self.root / "blocker"
        blocker.mkdir()
        (blocker / "torch.py").write_text("raise RuntimeError('validate-only must not import Torch')")
        output = self.root / "runs"
        result = subprocess.run([sys.executable, str(ROOT / "train.py"), "--config", str(self.flat_config()), "--validate-only", "--dataset", str(run), "--output", str(output)],
                                env={**os.environ, "PYTHONPATH": str(blocker)}, capture_output=True, text=True, timeout=30, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads(result.stdout)
        self.assertTrue(summary["validate_only"])
        self.assertEqual(summary["dataset"]["class_count"], 2)
        self.assertFalse(output.exists())

    def test_09b_classes_option_trains_a_subset_without_moving_crops_between_splits(self):
        from classifier_data import validate_run
        from prepare import prepare
        from train import read_options

        archive = self.root / "three.zip"
        with zipfile.ZipFile(archive, "w") as z:
            z.writestr("data.yaml", "nc: 3\nnames: [a, b, c]\n")
            for index in range(24):
                stream = io.BytesIO()
                Image.new("RGB", (40, 20), (index * 10, 30, 50)).save(stream, "PNG")
                z.writestr(f"train/images/{index}.png", stream.getvalue())
                z.writestr(f"train/labels/{index}.txt", f"{index % 3} 0.5 0.5 1 1")
        config = {"seed": 42, "ratios": {"train": .7, "val": .15, "test": .15}, "sources": [{
            "id": "three", "archive": str(archive), "yaml": "data.yaml", "splits": {"train": "train", "val": "valid", "test": "test"},
            "class_map": {"a": "a", "b": "b", "c": "c"}, "license": {"name": "test", "credit": "synthetic", "url": "local"}}]}
        path = self.root / "three.json"
        path.write_text(json.dumps(config))
        run = prepare(path, self.root / "prepared-three")
        full, full_samples = validate_run(run, True)
        subset, samples = validate_run(run, True, classes=["c", "a"])
        self.assertEqual((full["classes"], subset["classes"]), (["a", "b", "c"], ["a", "c"]))
        self.assertEqual(subset["snapshot_class_count"], 3)
        self.assertEqual(sorted(subset["class_coverage"]), ["a", "c"])
        for split in samples:  # same crops in the same split, only family b removed
            self.assertEqual([r["annotation_id"] for r in samples[split]],
                             [r["annotation_id"] for r in full_samples[split] if r["canonical_class"] != "b"])
        with self.assertRaisesRegex(ValueError, "not in this dataset"):
            validate_run(run, True, classes=["a", "zzz"])
        for bad in (["a"], ["a", "a"], "a,b", ["a", ""]):
            with self.subTest(classes=bad), self.assertRaisesRegex(ValueError, "classes must"):
                read_options(self.experiments(models={"x": {"architecture": "resnet18"}}, classes=bad), self.cli_args(model="x"))
        config = self.experiments(models={"x": {"architecture": "resnet18"}})
        self.assertNotIn("classes", read_options(config, self.cli_args(model="x")))  # absent = every family

    def imagefolder(self, duplicate_across_splits=False):
        import csv

        root = self.root / "folder"
        rows = []
        for split, count in (("train", 3), ("val", 1), ("test", 1)):
            for family in ("a", "b", "c"):
                for index in range(count):
                    relative = f"{split}/{family}/team-{split}{family}{index}.png"
                    (root / split / family).mkdir(parents=True, exist_ok=True)
                    shade = 7 if duplicate_across_splits and family == "a" and index == 0 else len(rows) * 9
                    Image.new("RGB", (30, 20), (shade, 40, 60)).save(root / relative)
                    rows.append({"path": relative, "split": split, "class": family, "source": "team", "studio": "0", "id": f"{split}{family}{index}"})
        with (root / "manifest.csv").open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
        return root

    def test_09c_imagefolder_with_manifest_trains_like_a_snapshot(self):
        from classifier_data import balanced_weights, validate_run

        root = self.imagefolder()
        summary, samples = validate_run(root, True)
        self.assertEqual((summary["classes"], summary["split_crops"]), (["a", "b", "c"], {"train": 9, "val": 3, "test": 3}))
        self.assertEqual(samples["val"][0]["classification_path"], "val/a/team-vala0.png")
        self.assertEqual(len(balanced_weights(samples["train"])), 9)
        again, _ = validate_run(root, True)
        self.assertEqual(again["fingerprint"], summary["fingerprint"])  # stable: test evaluation matches the checkpoint
        subset, _ = validate_run(root, True, classes=["a", "c"])
        self.assertEqual((subset["classes"], subset["split_crops"]["train"]), (["a", "c"], 6))
        with self.assertRaisesRegex(ValueError, "allow_provisional"):
            validate_run(root, False)
        (root / "train" / "a" / "stray.png").write_bytes((root / "train" / "a" / "team-traina0.png").read_bytes())
        with self.assertRaisesRegex(ValueError, "differ by 1 files"):
            validate_run(root, True)
        for path in root.rglob("*"):
            if path.is_file():
                path.unlink()
        duplicated = self.imagefolder(duplicate_across_splits=True)
        with self.assertRaisesRegex(ValueError, "two splits"):
            validate_run(duplicated, True)

    def test_09c_check_all_validates_each_models_class_selection(self):
        from train import main

        folder = self.imagefolder()
        config = self.experiments(models={
            "good": {"architecture": "resnet18", "classes": ["a", "b"]},
            "bad": {"architecture": "resnet18", "classes": ["a", "missing"]},
        }, dataset=str(folder))
        with self.assertRaises(SystemExit) as error:
            main(["--config", str(config), "--model", "all", "--validate-only"])
        self.assertEqual(error.exception.code, 2)

    def test_09d_latest_checkpoint_ignores_unfinished_and_invalid_runs(self):
        from train import latest_checkpoint

        for day, state in ((1, "complete"), (2, "failed"), (3, "running"), (4, "interrupted")):
            run = self.root / f"train-202611{day:02d}-090000-demo-abcdef"
            run.mkdir()
            (run / "best.pt").write_bytes(b"synthetic")
            (run / "run.json").write_text(json.dumps({"run_state": state}))
        for day, metadata in ((5, None), (6, "not json"), (7, "[]")):
            run = self.root / f"train-202611{day:02d}-090000-demo-abcdef"
            run.mkdir()
            (run / "best.pt").write_bytes(b"synthetic")
            if metadata is not None:
                (run / "run.json").write_text(metadata)
        self.assertEqual(latest_checkpoint(self.root, "demo").parent.name, "train-20261101-090000-demo-abcdef")

    def test_09d_latest_checkpoint_picks_the_newest_run_of_exactly_that_model(self):
        from train import latest_checkpoint

        for name in ("train-20261101-090000-convnext-tiny-aaaaaa", "train-20261102-090000-convnext-tiny-bbbbbb",
                     "train-20261103-090000-r1-convnext-tiny-cccccc", "train-20261104-090000-convnext-tiny-dddddd"):
            (self.root / "out" / name).mkdir(parents=True)
            if not name.endswith("dddddd"):  # newest run never finished an epoch
                (self.root / "out" / name / "best.pt").write_bytes(b"x")
                (self.root / "out" / name / "run.json").write_text(json.dumps({"run_state": "complete"}))
        self.assertEqual(latest_checkpoint(self.root / "out", "convnext_tiny").parent.name, "train-20261102-090000-convnext-tiny-bbbbbb")
        with self.assertRaisesRegex(ValueError, "No finished training run of 'yolo26n'"):
            latest_checkpoint(self.root / "out", "yolo26n")

    def test_09e_evaluate_folder_scores_own_photos_without_a_dataset_snapshot(self):
        from classifier_engine import build_model, save_checkpoint
        from train import main

        model = build_model(["a", "b", "c"], None, fine_tune=False, pretrained=False, architecture="resnet18")
        run = self.root / "runs" / "train-20261112-090000-x-abcdef"
        run.mkdir(parents=True)
        (run / "run.json").write_text(json.dumps({"run_state": "complete"}))
        save_checkpoint(run / "best.pt", model, {"architecture": "resnet18", "image_size": 64},
                        {"classes": ["a", "b", "c"], "fingerprint": "f", "manifest_sha256": "m"}, 1, {})
        photos = self.root / "photos" / "test"
        for folder, count in (("a", 2), ("c", 1), ("_other", 1)):
            (photos / folder).mkdir(parents=True)
            for index in range(count):
                Image.new("RGB", (50, 30), (index * 40, 90, 20)).save(photos / folder / f"p{index}.jpg")
        (photos / "a" / "notes.txt").write_text("not an image")
        config = self.experiments(models={"x": {"architecture": "resnet18"}})
        self.assertEqual(main(["--config", str(config), "--model", "x", "--output", str(self.root / "runs"),
                               "--evaluate-folder", str(photos.parent)]), 0)
        report = next((self.root / "runs").glob("evaluate-*-x-*"))
        metrics = json.loads((report / "metrics.json").read_text())
        self.assertEqual((metrics["samples"], metrics["macro_f1_supported_classes"], metrics["split"]), (3, 2, "own-images"))
        self.assertEqual(len((report / "other_predictions.jsonl").read_text().splitlines()), 1)
        (photos / "filano").mkdir()
        from classifier_engine import folder_rows

        with self.assertRaisesRegex(ValueError, "not classes of this model.*filano"):
            folder_rows(photos.parent, ["a", "b", "c"])
        with self.assertRaises(SystemExit):  # one named model is required
            main(["--config", str(config), "--evaluate-folder", str(photos.parent)])

    def test_10_letterbox_and_metrics_preserve_shape_and_include_missed_classes(self):
        data = self.module("classifier_data")
        image = data.PadResize(64)(Image.new("RGB", (40, 20), "red"))
        self.assertEqual(image.size, (64, 64))
        self.assertEqual(image.getpixel((32, 0)), tuple(data.PREPROCESSING["padding_rgb"]))
        self.assertEqual(image.getpixel((0, 32)), (255, 0, 0))
        self.assertEqual(image.getpixel((63, 32)), (255, 0, 0))
        metrics = data.classification_metrics([0, 1], [0, 0], ["a", "b", "unsupported"])
        self.assertEqual(metrics["top1"], .5)
        self.assertAlmostEqual(metrics["macro_f1"], 1 / 3)
        self.assertEqual(metrics["per_class"]["b"]["f1"], 0)
        self.assertIsNone(metrics["per_class"]["unsupported"]["recall"])

    def test_20_real_resnet_synthetic_epoch_checkpoint_and_explicit_test(self):
        import copy

        import torch
        from classifier_data import validate_run
        from classifier_engine import (
            build_model,
            evaluate_test,
            fit,
            load_checkpoint,
            seed_everything,
        )

        run = self.dataset()
        summary, samples = validate_run(run, allow_provisional=True)
        options = dict(BASE_OPTIONS)
        options.update(epochs=1, image_size=64, batch_size=2, seed=42, threads=1, device="cpu")
        seed_everything(42, 1)
        model = build_model(summary["classes"], weights_dir=None, pretrained=False)
        before_bn = model.bn1.running_mean.clone()
        self.assertTrue(model.fc.weight.requires_grad)
        self.assertFalse(model.conv1.weight.requires_grad)
        poisoned = copy.deepcopy(samples)
        poisoned["test"] = [{"classification_path": "MUST_NOT_BE_READ", "canonical_class": "a"}]
        output = fit(model, poisoned, summary, options, self.root / "trained")
        metadata = json.loads((output / "run.json").read_text())
        self.assertEqual(metadata["run_state"], "complete")
        self.assertFalse(metadata["test_evaluated"])
        self.assertEqual(metadata["completed_epochs"], 1)
        self.assertTrue(torch.equal(before_bn, model.bn1.running_mean))
        self.assertEqual(len((output / "history.csv").read_text().splitlines()), 2)
        self.assertTrue((output / "val/mistakes.html").is_file())
        checkpoint = load_checkpoint(output / "best.pt", summary)
        self.assertEqual(checkpoint["classes"], ["a", "b"])
        with self.assertRaisesRegex(ValueError, "different dataset"):
            load_checkpoint(output / "best.pt", {**summary, "fingerprint": "different"})
        with self.assertRaisesRegex(ValueError, "class order"):
            load_checkpoint(output / "best.pt", {**summary, "classes": ["b", "a"]})
        metrics = evaluate_test(output / "best.pt", summary, samples, options, self.root / "test-evaluation")
        self.assertTrue(metrics["test_evaluated"])
        self.assertEqual(metrics["samples"], len(samples["test"]))
        self.assertTrue((self.root / "test-evaluation/confusion_matrix.csv").is_file())

    def test_30_training_cli_runs_offline_and_records_initial_weights(self):
        import torch
        from classifier_data import sha256
        from torchvision.models import resnet18

        run = self.dataset()
        initial = self.root / "synthetic-initial-weights.pth"
        weights_before = {p.relative_to(ROOT / "weights").as_posix(): (p.stat().st_size, p.stat().st_mtime_ns)
                          for p in (ROOT / "weights").rglob("*") if p.is_file()}
        torch.save(resnet18(weights=None).state_dict(), initial)
        output = self.root / "cli-runs"
        result = subprocess.run([sys.executable, str(ROOT / "train.py"), "--config", str(self.flat_config()), "--dataset", str(run), "--output", str(output),
                                 "--initial-weights", str(initial), "--epochs", "1", "--image-size", "64", "--batch-size", "2", "--device", "cpu"],
                                capture_output=True, text=True, timeout=120, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        directories = [path for path in output.iterdir() if path.is_dir()]  # summary.csv sits beside the run folders
        self.assertEqual(len(directories), 1)
        metadata = json.loads((directories[0] / "run.json").read_text())
        self.assertEqual(metadata["options"]["initial_weights_sha256"], sha256(initial))
        self.assertEqual(metadata["run_state"], "complete")
        self.assertFalse(metadata["test_evaluated"])
        self.assertIn("Epoch 1/1", result.stdout)
        weights_after = {p.relative_to(ROOT / "weights").as_posix(): (p.stat().st_size, p.stat().st_mtime_ns)
                         for p in (ROOT / "weights").rglob("*") if p.is_file()}
        self.assertEqual(weights_before, weights_after, "Synthetic/offline training does not download or replace weights")
        self.assertRegex(directories[0].name, r"^train-\d{8}-\d{6}-resnet18-[0-9a-f]{6}$")
        # The test report is named for the checkpoint's model even when the config requests another one.
        evaluated = subprocess.run([sys.executable, str(ROOT / "train.py"), "--config", str(self.flat_config()), "--dataset", str(run), "--output", str(output),
                                    "--evaluate-test", "--checkpoint", str(directories[0] / "best.pt"), "--architecture", "efficientnet_b0",
                                    "--batch-size", "2", "--device", "cpu"],
                                   capture_output=True, text=True, timeout=120, check=False)
        self.assertEqual(evaluated.returncode, 0, evaluated.stderr)
        reports = [d for d in output.iterdir() if d.name.startswith("test-")]
        self.assertEqual(len(reports), 1)
        self.assertRegex(reports[0].name, r"^test-\d{8}-\d{6}-resnet18-[0-9a-f]{6}$")

    def test_41_early_stopping_counts_ties_and_resets_on_improvement(self):
        from training_control import EarlyStopping

        stop = EarlyStopping(3)
        self.assertFalse(stop.update(.4))
        self.assertFalse(stop.update(.4))
        self.assertFalse(stop.update(.5))
        self.assertFalse(stop.update(.49))
        self.assertFalse(stop.update(.5))
        self.assertTrue(stop.update(.5))
        disabled = EarlyStopping(0)
        self.assertFalse(any(disabled.update(.5) for _ in range(20)))

    def test_50_efficientnet_trains_offline_and_keeps_backbone_frozen(self):
        import torch
        from classifier_data import validate_run
        from classifier_engine import build_model, fit, load_checkpoint, seed_everything

        snapshot = self.dataset()
        summary, samples = validate_run(snapshot, True)
        options = dict(BASE_OPTIONS)
        options.update(architecture="efficientnet_b0", epochs=1, image_size=64, batch_size=2, threads=1, seed=42, device="cpu")
        seed_everything(42, 1)
        model = build_model(summary["classes"], None, pretrained=False, architecture="efficientnet_b0")
        self.assertFalse(model.features[0][0].weight.requires_grad)
        self.assertTrue(model.classifier[-1].weight.requires_grad)
        before = model.features[0][1].running_mean.clone()
        output = fit(model, samples, summary, options, self.root / "efficientnet")
        checkpoint = load_checkpoint(output / "best.pt", summary)
        self.assertEqual(checkpoint["architecture"], "efficientnet_b0")
        self.assertTrue(torch.equal(before, model.features[0][1].running_mean))
        self.assertEqual(checkpoint["state_dict"]["classifier.1.weight"].shape[0], 2)
        from classifier_data import sha256

        digest = sha256(output / "last.pt")
        continued = self.root / "continued-runs"
        result = subprocess.run([sys.executable, str(ROOT / "train.py"), "--config", str(self.flat_config()), "--dataset", str(snapshot), "--output", str(continued),
                                 "--architecture", "efficientnet_b0", "--continue-from", str(output / "last.pt"),
                                 "--epochs", "1", "--image-size", "64", "--batch-size", "2", "--device", "cpu"],
                                capture_output=True, text=True, timeout=120, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        resumed = next(path for path in continued.iterdir() if path.is_dir())
        metadata = json.loads((resumed / "run.json").read_text())
        self.assertEqual(metadata["options"]["initial_weights_sha256"], digest)
        self.assertEqual(metadata["options"]["continued_from_epoch"], 1)
        self.assertEqual(metadata["options"]["optimizer_restored"], False)
        self.assertFalse(metadata["test_evaluated"])
        self.assertTrue((resumed / "initial_val/metrics.json").is_file())
        self.assertEqual(sha256(output / "last.pt"), digest)


    def test_60_yolo_classifier_roundtrip_keeps_logits_and_backbone_statistics(self):
        import torch
        from classifier_data import validate_run
        from classifier_engine import build_model, fit, load_checkpoint, seed_everything

        snapshot = self.dataset()
        summary, samples = validate_run(snapshot, True)
        options = dict(BASE_OPTIONS)
        options.update(architecture="yolo11n_cls", epochs=1, image_size=64, batch_size=2, threads=1, seed=42, device="cpu")
        seed_everything(42, 1)
        model = build_model(summary["classes"], None, pretrained=False, architecture="yolo11n_cls")
        self.assertFalse(model.network.model[0].conv.weight.requires_grad)
        self.assertTrue(model.classifier.weight.requires_grad)
        before = model.network.model[0].bn.running_mean.clone()
        output = fit(model, samples, summary, options, self.root / "yolo")
        checkpoint = load_checkpoint(output / "best.pt", summary)
        self.assertEqual(checkpoint["preprocessing"]["mean"], [0., 0., 0.])
        self.assertEqual(checkpoint["architecture"], "yolo11n_cls")
        self.assertTrue(torch.equal(before, model.network.model[0].bn.running_mean))
        restored = build_model(summary["classes"], None, pretrained=False, architecture="yolo11n_cls")
        restored.load_state_dict(checkpoint["state_dict"], strict=True)
        model.eval()
        restored.eval()
        inputs = torch.zeros(2, 3, 64, 64)
        with torch.inference_mode():
            expected, actual = model(inputs), restored(inputs)
        self.assertEqual(actual.shape, (2, 2))
        self.assertTrue(torch.equal(expected, actual))

    def test_02_run_names_are_readable_chronological_and_api_listable(self):
        import re
        from datetime import datetime, timedelta, timezone

        from train import run_name

        bangkok = timezone(timedelta(hours=7))
        earlier = run_name("train", "yolo11n_cls", datetime(2026, 11, 2, 23, 4, 15, tzinfo=bangkok), "a1b2c3")
        later = run_name("train", "efficientnet_b0", datetime(2026, 11, 3, 8, 0, 0, tzinfo=bangkok), "000000")
        self.assertEqual(earlier, "train-20261102-230415-yolo11n-cls-a1b2c3")
        self.assertEqual(run_name("test", "resnet18", datetime(2026, 11, 2, 9, 5, 0, tzinfo=bangkok), "ffffff"), "test-20261102-090500-resnet18-ffffff")
        self.assertLess(earlier, later)  # The Parking UI picks the last name as the most recent run.
        self.assertRegex(later, r"^train-[A-Za-z0-9-]+$")  # Vision API only lists names matching this.
        self.assertIsNone(re.search(r"[_:]", earlier))

    def cli_args(self, **overrides):
        import argparse

        values = {"model": None, "evaluate_test": False, "dataset": None, "output": None, "epochs": None, "batch_size": None,
                  "image_size": None, "device": None, "learning_rate": None, "architecture": None, "fine_tune": False,
                  "no_augment": False, "patience": None}
        return argparse.Namespace(**{**values, **overrides})

    def experiments(self, models=None, **defaults):
        settings = {"image_size": 64, "epochs": 3, "patience": 4, "batch_size": 2, "learning_rate": 0.01, "seed": 1, "device": "cpu",
                    "threads": 1, "workers": 0, "fine_tune": False, "augment": False, "allow_provisional": True, **defaults}
        models = models or {"fast": {"architecture": "resnet18"}, "slow-net": {"architecture": "efficientnet_b0", "patience": 0, "epochs": 9}}
        path = self.root / "experiments.json"
        path.write_text(json.dumps({"dataset": "data", "output": "runs", "defaults": settings, "models": models}), encoding="utf-8")
        return path

    def test_03_one_config_file_holds_every_model_and_patience(self):
        from train import model_names, read_options

        config = self.experiments()
        self.assertEqual(model_names(config), ["fast", "slow-net"])
        fast = read_options(config, self.cli_args(model="fast"))
        self.assertEqual((fast["architecture"], fast["epochs"], fast["patience"], fast["experiment"]), ("resnet18", 3, 4, "fast"))
        slow = read_options(config, self.cli_args(model="slow-net"))
        self.assertEqual((slow["architecture"], slow["epochs"], slow["patience"]), ("efficientnet_b0", 9, 0))  # model block beats defaults
        overridden = read_options(config, self.cli_args(model="fast", patience=1, epochs=2))
        self.assertEqual((overridden["patience"], overridden["epochs"]), (1, 2))  # a command-line option beats the file
        with self.assertRaisesRegex(ValueError, "Unknown model 'nope'.*fast, slow-net"):
            read_options(config, self.cli_args(model="nope"))
        with self.assertRaisesRegex(ValueError, "Choose a model"):
            read_options(config, self.cli_args())
        self.assertEqual(read_options(config, self.cli_args(evaluate_test=True))["experiment"], "fast")  # a test report needs shared settings only
        with self.assertRaisesRegex(ValueError, "cannot be 'all'"):
            read_options(self.experiments(models={"all": {"architecture": "resnet18"}}), self.cli_args(model="all"))
        flat = self.root / "training.json"  # One-experiment JSON configs keep working.
        flat.write_text(json.dumps(BASE_OPTIONS), encoding="utf-8")
        self.assertEqual(read_options(flat, self.cli_args())["patience"], 0)
        with self.assertRaisesRegex(ValueError, "models"):
            read_options(flat, self.cli_args(model="fast"))

    def test_03b_commented_yaml_config_matches_json_and_the_real_file_is_valid(self):
        from train import model_names, read_options

        json_config = self.experiments(models={"a": {"architecture": "resnet18"}, "b": {"architecture": "resnet18", "dataset": "other"}})
        yaml_config = self.root / "experiments.yaml"
        yaml_config.write_text("""# comment
dataset: data   # shared snapshot
output: runs
defaults:
  image_size: 64
  epochs: 3          # inline comment
  patience: 4
  batch_size: 2
  learning_rate: 0.01
  seed: 1
  device: cpu
  threads: 1
  workers: 0
  fine_tune: false
  augment: false
  allow_provisional: true
models:
  a:
    architecture: resnet18
  b:
    architecture: resnet18
    dataset: &other other   # anchor reused below
    note: *other
""", encoding="utf-8")
        self.assertEqual(model_names(yaml_config), model_names(json_config))
        for name in ("a", "b"):
            self.assertEqual(read_options(yaml_config, self.cli_args(model=name)), read_options(json_config, self.cli_args(model=name)))
        real = ROOT / "experiments.yaml"  # The file train-classifier.bat uses: every model's options must validate.
        for name in model_names(real):
            with self.subTest(model=name):
                self.assertEqual(read_options(real, self.cli_args(model=name))["experiment"], name)

    def test_04_supported_architectures_and_scratch_models_need_full_training(self):
        from architectures import has_pretrained, is_supported, yolo_asset
        from train import read_options

        for name in ("resnet18", "resnet50", "efficientnet_b0", "mobilenet_v3_large", "convnext_tiny", "vit_small", "yolo11n_cls",
                     "yolo12s_cls", "yolo26x_cls"):
            self.assertTrue(is_supported(name), name)
        for name in ("resnet34", "vit_base", "yolo13n_cls", "yolo11z_cls", "yolo11n", "yolo26n-cls", "../yolo11n_cls", None):
            self.assertFalse(is_supported(name), name)
        self.assertEqual(yolo_asset("yolo26s_cls"), "yolo26s-cls")
        self.assertEqual([has_pretrained(name) for name in ("yolo11n_cls", "yolo12n_cls", "yolo26n_cls", "convnext_tiny")], [True, False, True, True])
        config = self.experiments(models={"scratch": {"architecture": "yolo12n_cls"}, "scratch-full": {"architecture": "yolo12n_cls", "fine_tune": True}})
        with self.assertRaisesRegex(ValueError, "no pretrained weights"):
            read_options(config, self.cli_args(model="scratch"))
        self.assertTrue(read_options(config, self.cli_args(model="scratch-full"))["fine_tune"])
        self.assertTrue(read_options(config, self.cli_args(model="scratch", fine_tune=True))["fine_tune"])
        hinted = self.experiments(models={"x": {"architecture": "resnet18", "note": "shown in the menu only"}})
        self.assertNotIn("note", read_options(hinted, self.cli_args(model="x")))
        with self.assertRaisesRegex(ValueError, "Use architecture="):
            read_options(self.experiments(models={"x": {"architecture": "yolo13n_cls"}}), self.cli_args(model="x"))

    def test_05_every_architecture_builds_offline_and_scores_each_class(self):
        import torch
        from classifier_engine import (
            build_model,
            initial_weights_metadata,
            preprocessing_for,
        )

        for name in ("resnet18", "resnet50", "efficientnet_b0", "mobilenet_v3_large", "convnext_tiny", "vit_small",
                     "yolo11n_cls", "yolo12n_cls", "yolo26n_cls"):
            with self.subTest(architecture=name):
                if name == "vit_small" and importlib.util.find_spec("timm") is None:
                    self.skipTest("timm is not installed")
                model = build_model(["a", "b", "c"], None, fine_tune=True, pretrained=False, architecture=name).eval()
                with torch.no_grad():
                    self.assertEqual(tuple(model(torch.zeros(2, 3, 64, 64)).shape), (2, 3))
        self.assertEqual(preprocessing_for("yolo26n_cls")["mean"], [0., 0., 0.])
        self.assertEqual(preprocessing_for("convnext_tiny"), preprocessing_for("resnet18"))
        metadata = initial_weights_metadata(self.root, None, "yolo12n_cls")
        self.assertIsNone(metadata["initial_weights"])
        self.assertIn("random initialization", metadata["initial_weights_source"])

    def test_05b_vit_small_trains_only_its_new_head_and_records_its_normalization(self):
        if importlib.util.find_spec("timm") is None:
            self.skipTest("timm is not installed")
        import torch
        from classifier_engine import build_model, classifier_head, preprocessing_for

        model = build_model(["a", "b"], None, fine_tune=False, pretrained=False, architecture="vit_small")
        self.assertIs(classifier_head(model), model.head)
        self.assertEqual(model.head.out_features, 2)
        self.assertTrue(all(p.requires_grad for p in model.head.parameters()))
        self.assertFalse(model.patch_embed.proj.weight.requires_grad)
        with torch.no_grad():  # any letterbox size works, not only the pretrained 224
            self.assertEqual(tuple(model.eval()(torch.zeros(1, 3, 96, 96)).shape), (1, 2))
        self.assertEqual(preprocessing_for("vit_small")["mean"], [0.5, 0.5, 0.5])
        resnet = build_model(["a", "b", "c"], None, fine_tune=False, pretrained=False, architecture="resnet50")
        self.assertEqual(resnet.fc.out_features, 3)
        self.assertTrue(resnet.fc.weight.requires_grad)
        self.assertFalse(resnet.conv1.weight.requires_grad)

    def test_05c_cosine_schedule_warms_up_then_decays_and_constant_is_the_default(self):
        from train import read_options
        from training_control import lr_factor

        self.assertEqual([lr_factor(e, 10) for e in (1, 5, 10)], [1.0, 1.0, 1.0])
        factors = [lr_factor(e, 10, "cosine", 2) for e in range(1, 11)]
        self.assertAlmostEqual(factors[0], 1 / 3)
        self.assertAlmostEqual(factors[1], 2 / 3)
        self.assertAlmostEqual(factors[2], 1.0)  # first epoch after warm-up uses the full rate
        self.assertTrue(all(a >= b for a, b in itertools.pairwise(factors[2:])))
        self.assertLess(factors[-1], 0.05)
        self.assertGreater(factors[-1], 0)  # never exactly zero, so the last epoch still learns
        plain = read_options(self.experiments(models={"x": {"architecture": "resnet18"}}), self.cli_args(model="x"))
        self.assertEqual((plain["scheduler"], plain["warmup_epochs"]), ("constant", 0))
        for key, bad in (("scheduler", "step"), ("warmup_epochs", 3), ("warmup_epochs", -1), ("warmup_epochs", 1.5)):
            with self.subTest(key=key, value=bad), self.assertRaises(ValueError):
                read_options(self.experiments(models={"x": {"architecture": "resnet18", key: bad}}), self.cli_args(model="x"))

    def test_06_regularization_options_default_to_old_behaviour_and_are_validated(self):
        from train import read_options

        plain = read_options(self.experiments(models={"x": {"architecture": "resnet18"}}), self.cli_args(model="x"))
        self.assertEqual((plain["augmentation"], plain["weight_decay"], plain["label_smoothing"]), ("basic", 0.01, 0.0))
        tuned = read_options(self.experiments(models={"x": {"architecture": "resnet18", "augmentation": "strong", "weight_decay": 0.05,
                                                            "label_smoothing": 0.1}}), self.cli_args(model="x"))
        self.assertEqual((tuned["augmentation"], tuned["weight_decay"], tuned["label_smoothing"]), ("strong", 0.05, 0.1))
        for key, bad in (("augmentation", "extreme"), ("weight_decay", -1), ("weight_decay", True), ("label_smoothing", 1), ("label_smoothing", "0.1")):
            with self.subTest(key=key, value=bad), self.assertRaises((ValueError, TypeError)):
                read_options(self.experiments(models={"x": {"architecture": "resnet18", key: bad}}), self.cli_args(model="x"))

    def test_07_strong_augmentation_changes_only_training_images(self):
        import torch
        from classifier_engine import image_transform

        image = Image.effect_noise((80, 40), 60).convert("RGB")
        plain = image_transform(64, augment=False)(image)
        self.assertEqual(tuple(plain.shape), (3, 64, 64))
        self.assertTrue(torch.equal(plain, image_transform(64, augment=False, level="strong")(image)))  # val/test never augment
        torch.manual_seed(1)
        strong = image_transform(64, augment=True, level="strong")(image)
        self.assertEqual(tuple(strong.shape), (3, 64, 64))
        self.assertFalse(torch.equal(plain, strong))

    def test_08_summary_csv_gains_new_columns_without_losing_old_rows(self):
        import csv

        from train import SUMMARY_FIELDS, record_summary

        path = self.root / "summary.csv"
        old = [name for name in SUMMARY_FIELDS if name not in {"augmentation", "weight_decay", "label_smoothing"}]
        with path.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=old)
            writer.writeheader()
            writer.writerow({**dict.fromkeys(old, ""), "run": "train-old", "model": "convnext_tiny", "val_top1": "0.8178"})
        run = self.root / "train-new"
        (run / "val").mkdir(parents=True)
        (run / "run.json").write_text(json.dumps({"best_epoch": 5}), encoding="utf-8")
        (run / "val/metrics.json").write_text(json.dumps({"top1": 0.9, "macro_f1": 0.8, "loss": 0.5}), encoding="utf-8")
        options = {"experiment": "convnext_aug", "architecture": "convnext_tiny", "epochs": 100, "patience": 0, "batch_size": 8, "learning_rate": 0.001,
                   "fine_tune": False, "augment": True, "augmentation": "strong", "weight_decay": 0.05, "label_smoothing": 0.1}
        record_summary(path, run, options)
        with path.open(encoding="utf-8", newline="") as stream:
            rows = list(csv.DictReader(stream))
        self.assertEqual([row["run"] for row in rows], ["train-old", "train-new"])
        self.assertEqual((rows[0]["val_top1"], rows[0]["augmentation"]), ("0.8178", ""))
        self.assertEqual((rows[1]["augmentation"], rows[1]["weight_decay"], rows[1]["label_smoothing"]), ("strong", "0.05", "0.1"))

    def test_09_balanced_sampling_equalizes_classes_and_groups_and_is_opt_in(self):
        from classifier_data import balanced_weights
        from train import read_options

        # Class "big": one 6-frame video group plus two single photos; class "rare": one photo.
        rows = ([{"canonical_class": "big", "group_id": "video"}] * 6 + [{"canonical_class": "big", "group_id": "p1"},
                {"canonical_class": "big", "group_id": "p2"}, {"canonical_class": "rare", "group_id": "p3"}])
        weights = balanced_weights(rows)
        mass = lambda test: sum(w for w, row in zip(weights, rows) if test(row))
        self.assertAlmostEqual(mass(lambda r: r["canonical_class"] == "big"), mass(lambda r: r["canonical_class"] == "rare"))
        self.assertAlmostEqual(mass(lambda r: r["group_id"] == "video"), mass(lambda r: r["group_id"] == "p1"))
        plain = read_options(self.experiments(models={"x": {"architecture": "resnet18"}}), self.cli_args(model="x"))
        self.assertEqual(plain["sampling"], "shuffle")  # older configs train exactly as before
        config = self.experiments(models={"x": {"architecture": "resnet18"}, "y": {"architecture": "resnet18", "dataset": "other"}},
                                  sampling="balanced")
        self.assertEqual(read_options(config, self.cli_args(model="x"))["sampling"], "balanced")
        self.assertEqual(Path(read_options(config, self.cli_args(model="y"))["dataset"]).name, "other")  # a model may use its own snapshot
        with self.assertRaisesRegex(ValueError, "sampling"):
            read_options(self.experiments(models={"x": {"architecture": "resnet18", "sampling": "oversample"}}), self.cli_args(model="x"))

    def test_33_choose_menu_trains_the_picked_models_and_rejects_bad_input(self):
        import csv

        import torch
        from torchvision.models import resnet18

        run = self.dataset()
        initial = self.root / "initial.pth"
        torch.save(resnet18(weights=None).state_dict(), initial)
        config = self.experiments(models={"tiny-a": {"architecture": "resnet18", "note": "first hint"}, "tiny-b": {"architecture": "resnet18"}}, epochs=1)

        def choose(answer, output):
            return subprocess.run([sys.executable, str(ROOT / "train.py"), "--config", str(config), "--choose", "--dataset", str(run),
                                   "--output", str(output), "--initial-weights", str(initial)],
                                  input=answer, capture_output=True, text=True, timeout=240, check=False)

        def trained(output):
            with (output / "summary.csv").open(encoding="utf-8", newline="") as stream:
                return sorted(row["model"] for row in csv.DictReader(stream))

        single = choose("tiny-b\n", self.root / "pick-one")
        self.assertEqual(single.returncode, 0, single.stderr)
        for expected in ("1) tiny-a", "first hint", "2) tiny-b", "a) all of them"):
            self.assertIn(expected, single.stdout)
        self.assertEqual(trained(self.root / "pick-one"), ["tiny-b"])
        several = choose("1, 2\n", self.root / "pick-two")  # Children must not ask again, so --choose is not passed on.
        self.assertEqual(several.returncode, 0, several.stderr + several.stdout[-400:])
        self.assertEqual(trained(self.root / "pick-two"), ["tiny-a", "tiny-b"])
        unknown = choose("9\n", self.root / "pick-none")
        self.assertEqual(unknown.returncode, 2)
        self.assertIn("'9' is not on the list", unknown.stderr)
        silent = choose("", self.root / "pick-none")
        self.assertEqual(silent.returncode, 2)
        self.assertIn("No model was chosen", silent.stderr)
        self.assertFalse((self.root / "pick-none").exists())

    def test_31_model_all_trains_each_model_and_records_one_summary(self):
        import csv

        import torch
        from torchvision.models import resnet18

        run = self.dataset()
        initial = self.root / "initial.pth"
        torch.save(resnet18(weights=None).state_dict(), initial)
        config = self.experiments(models={"tiny-a": {"architecture": "resnet18"}, "tiny-b": {"architecture": "resnet18", "learning_rate": 0.02}}, epochs=1)
        output = self.root / "all-runs"
        result = subprocess.run([sys.executable, str(ROOT / "train.py"), "--config", str(config), "--model", "all", "--dataset", str(run),
                                 "--output", str(output), "--initial-weights", str(initial)],
                                capture_output=True, text=True, timeout=240, check=False)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout[-600:])
        folders = sorted(path.name for path in output.iterdir() if path.is_dir())
        self.assertEqual(len(folders), 2)
        self.assertTrue(any("-tiny-a-" in name for name in folders) and any("-tiny-b-" in name for name in folders))
        with (output / "summary.csv").open(encoding="utf-8", newline="") as stream:
            rows = list(csv.DictReader(stream))
        self.assertEqual(sorted(row["model"] for row in rows), ["tiny-a", "tiny-b"])
        self.assertEqual({row["patience"] for row in rows}, {"4"})  # Patience comes from the file, not the command line.
        self.assertTrue(all(row["run"] in folders and 0 <= float(row["val_macro_f1"]) <= 1 for row in rows))
        self.assertIn("This batch, best val macro-F1 first", result.stdout)
        recorded = json.loads((output / next(name for name in folders if "-tiny-b-" in name) / "run.json").read_text(encoding="utf-8"))
        self.assertEqual((recorded["options"]["experiment"], recorded["options"]["learning_rate"]), ("tiny-b", 0.02))

    def test_32_check_lists_every_model_and_unknown_models_fail_clearly(self):
        run = self.dataset()
        base = [sys.executable, str(ROOT / "train.py"), "--config", str(self.experiments()), "--dataset", str(run), "--validate-only"]
        checked = subprocess.run([*base, "--model", "all"], capture_output=True, text=True, timeout=60, check=False)
        self.assertEqual(checked.returncode, 0, checked.stderr)
        self.assertEqual(checked.stdout.count("Dataset "), 1)  # One snapshot is validated once for all models.
        for expected in ("fast", "resnet18", "slow-net", "efficientnet_b0", "patience 4", "patience 0"):
            self.assertIn(expected, checked.stdout)
        unknown = subprocess.run([*base, "--model", "nope"], capture_output=True, text=True, timeout=60, check=False)
        self.assertEqual(unknown.returncode, 2)
        self.assertIn("Unknown model 'nope'", unknown.stderr)
        missing = subprocess.run(base, capture_output=True, text=True, timeout=60, check=False)
        self.assertEqual(missing.returncode, 2)
        self.assertIn("Choose a model", missing.stderr)


if __name__ == "__main__":
    unittest.main()

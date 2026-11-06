"""Classifier checks use synthetic datasets and never download pretrained weights."""

import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import unittest.mock
import zipfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class ClassifierTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def dataset(self, names=("a", "b")):
        from prepare import prepare

        archive = self.root / "source.zip"
        with zipfile.ZipFile(archive, "w") as z:
            z.writestr("data.yaml", f"nc: {len(names)}\nnames: [{', '.join(names)}]\n")
            for index in range(12):
                stream = io.BytesIO()
                Image.new("RGB", (40, 20), (index * 20, 30, 50)).save(stream, "PNG")
                z.writestr(f"train/images/{index}.png", stream.getvalue())
                z.writestr(f"train/labels/{index}.txt", f"{index % len(names)} 0.5 0.5 1 1")
        config = {"seed": 42, "ratios": {"train": .7, "val": .15, "test": .15}, "sources": [{
            "id": "fixture", "archive": str(archive), "yaml": "data.yaml", "splits": {"train": "train", "val": "valid", "test": "test"},
            "class_map": {name: name for name in names}, "license": {"name": "test", "credit": "synthetic", "url": "local"}}]}
        path = self.root / "config.json"
        path.write_text(json.dumps(config))
        return prepare(path, self.root / "prepared")

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

    def test_02_class_subset_keeps_snapshot_checks_and_drops_other_classes(self):
        data = self.module("classifier_data")
        run = self.dataset(("a", "b", "c"))
        summary, samples = data.validate_run(run, allow_provisional=True, classes=["c", "a"])
        self.assertEqual((summary["classes"], summary["excluded_classes"]), (["a", "c"], ["b"]))
        self.assertEqual(set(summary["class_coverage"]), {"a", "c"})
        kept = [row["canonical_class"] for rows in samples.values() for row in rows]
        self.assertEqual((sorted(set(kept)), len(kept)), (["a", "c"], 8))
        self.assertEqual(summary["split_crops"], {split: len(rows) for split, rows in samples.items()})
        for bad in (["a", "zzz"], ["a", "a"], ["a"]):
            with self.assertRaises(ValueError, msg=bad):
                data.validate_run(run, allow_provisional=True, classes=bad)

    def test_01_validate_only_cli_does_not_load_ml_or_create_runs(self):
        run = self.dataset()
        blocker = self.root / "blocker"
        blocker.mkdir()
        (blocker / "torch.py").write_text("raise RuntimeError('validate-only must not import Torch')")
        output = self.root / "runs"
        result = subprocess.run([sys.executable, str(ROOT / "train.py"), "--validate-only", "--dataset", str(run), "--output", str(output)],
                                env={**os.environ, "PYTHONPATH": str(blocker)}, capture_output=True, text=True, timeout=30, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads(result.stdout)
        self.assertTrue(summary["validate_only"])
        self.assertEqual(summary["dataset"]["class_count"], 2)
        self.assertFalse(output.exists())

    def test_03_config_validates_augmentation_and_label_smoothing(self):
        train = self.module("train")
        run = self.dataset()
        config = json.loads((ROOT / "training.json").read_text())

        def validate(overrides, *flags):
            path = self.root / "training.json"
            path.write_text(json.dumps({**config, **overrides}))
            stdout = io.StringIO()
            with unittest.mock.patch("sys.stdout", stdout), unittest.mock.patch("sys.stderr", io.StringIO()):
                try:
                    code = train.main(["--validate-only", "--config", str(path), "--dataset", str(run), *flags])
                except SystemExit as error:
                    code = error.code
            return code, stdout.getvalue()

        code, output = validate({}, "--augment", "strong", "--label-smoothing", "0.1")
        self.assertEqual(code, 0)
        self.assertEqual({k: json.loads(output)["options"][k] for k in ("augment", "label_smoothing")}, {"augment": "strong", "label_smoothing": .1})
        for bad in ({"augment": True}, {"augment": "wild"}, {"label_smoothing": 1.0}, {"label_smoothing": -0.1}, {"label_smoothing": False},
                    {"pre_augmented_copies": 0}, {"pre_augmented_copies": 1.5}, {"pre_augmented_copies": True}):
            self.assertEqual(validate(bad)[0], 2, bad)

    def test_04_pre_augmented_copies_share_one_photo_weight_in_training_only(self):
        import torch
        from classifier_data import sampling_weights, validate_run
        from classifier_engine import loader

        run = self.dataset()
        summary, samples = validate_run(run, allow_provisional=True)
        self.assertEqual(summary["train_only_splits"], {"fixture": []})
        rows = [{"source_dataset": "copies", "original_split": "train"}, {"source_dataset": "copies", "original_split": "valid"},
                {"source_dataset": "plain", "original_split": "train"}]
        self.assertEqual(sampling_weights(rows, {"copies": ["train"], "plain": []}, 3), [1 / 3, 1.0, 1.0])
        options = {"image_size": 64, "augment": "none", "batch_size": 4, "workers": 0, "seed": 42}
        train = samples["train"]
        first, second = (loader(run, train, summary["classes"], options, training=True, weights=[1.0] + [0.0] * (len(train) - 1))
                         for _ in range(2))
        batches = list(first)
        self.assertEqual(sum(len(targets) for _, targets in batches), len(train))
        self.assertTrue(all(torch.equal(images, batches[0][0][:1].expand_as(images)) for images, _ in batches))
        self.assertTrue(all(torch.equal(a[0], b[0]) for a, b in zip(batches, second)))

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

    def test_11_multi_source_evaluation_reports_each_source(self):
        data = self.module("classifier_data")
        rows = [{"annotation_id": f"{index}", "classification_path": f"classification/test/a/{index}.png", "canonical_class": name,
                 "source_dataset": source} for index, (name, source) in enumerate([("a", "pinned"), ("b", "pinned"), ("a", "added"), ("b", "added")])]
        metrics = data.write_evaluation(self.root / "multi", self.root, "test", rows, [0, 1, 0, 0], [.9] * 4, ["a", "b"], {"status": "test"})
        self.assertEqual(metrics["top1"], .75)
        self.assertEqual({name: value["top1"] for name, value in metrics["by_source"].items()}, {"added": .5, "pinned": 1})
        self.assertIn("pinned: top-1 1.000", (self.root / "multi/mistakes.html").read_text(encoding="utf-8"))
        single = data.write_evaluation(self.root / "single", self.root, "test", [{k: v for k, v in row.items() if k != "source_dataset"} for row in rows],
                                       [0, 1, 0, 0], [.9] * 4, ["a", "b"], {"status": "lot"})
        self.assertNotIn("by_source", single)

    def test_15_strong_augmentation_keeps_shape_and_applies_only_to_training(self):
        import torch
        from classifier_data import validate_run
        from classifier_engine import loader

        run = self.dataset()
        summary, samples = validate_run(run, allow_provisional=True)
        options = {"image_size": 64, "augment": "strong", "batch_size": 2, "workers": 0, "seed": 42}
        torch.manual_seed(42)
        training = loader(run, samples["train"], summary["classes"], options, training=True).dataset
        evaluation = loader(run, samples["val"], summary["classes"], options).dataset
        self.assertEqual(tuple(training[0][0].shape), (3, 64, 64))
        self.assertFalse(torch.equal(training[0][0], training[0][0]))
        self.assertTrue(torch.equal(evaluation[0][0], evaluation[0][0]))

    def test_19_pooling_matches_adaptive_average_and_is_deterministic_on_each_device(self):
        import torch
        from classifier_engine import build_model, seed_everything
        from torch import nn

        seed_everything(42, 1)
        devices = ["cpu"] + (["cuda"] if torch.cuda.is_available() else [])
        for name in devices:
            model = build_model(["a", "b"], weights_dir=None, fine_tune=True, pretrained=False).to(name)
            features = torch.randn(2, 512, 7, 7, device=name)
            torch.testing.assert_close(model.avgpool(features), nn.AdaptiveAvgPool2d(1)(features))
            gradients = []
            for _ in range(2):
                model.zero_grad(set_to_none=True)
                model(torch.ones(2, 3, 64, 64, device=name)).sum().backward()  # AdaptiveAvgPool2d raises here on CUDA
                gradients.append(model.conv1.weight.grad.clone())
            self.assertTrue(torch.equal(*gradients))

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
        options = json.loads((ROOT / "training.json").read_text())
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
        torch.save(resnet18(weights=None).state_dict(), initial)
        output = self.root / "cli-runs"
        downloaded = lambda: sorted((ROOT / "weights").rglob("*"))
        before = downloaded()
        result = subprocess.run([sys.executable, str(ROOT / "train.py"), "--dataset", str(run), "--output", str(output),
                                 "--initial-weights", str(initial), "--epochs", "1", "--image-size", "64", "--batch-size", "2", "--device", "cpu"],
                                capture_output=True, text=True, timeout=120, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        directories = list(output.iterdir())
        self.assertEqual(len(directories), 1)
        metadata = json.loads((directories[0] / "run.json").read_text())
        self.assertEqual(metadata["options"]["initial_weights_sha256"], sha256(initial))
        self.assertEqual(metadata["run_state"], "complete")
        self.assertFalse(metadata["test_evaluated"])
        self.assertIn("Epoch 1/1", result.stdout)
        self.assertEqual(downloaded(), before, "Synthetic/offline training does not download weights")

    def test_40_lot_evaluation_scores_latest_model_labels_and_counts_the_rest(self):
        from classifier_data import sha256, validate_run
        from classifier_engine import build_model, fit, seed_everything

        evaluate_lot = self.module("evaluate_lot")
        summary, samples = validate_run(self.dataset(), allow_provisional=True)
        options = json.loads((ROOT / "training.json").read_text())
        options.update(epochs=1, image_size=64, batch_size=2, seed=42, threads=1, device="cpu")
        seed_everything(42, 1)
        trained = fit(build_model(summary["classes"], weights_dir=None, pretrained=False), samples, summary, options, self.root / "trained")
        lot = self.root / "lot"
        (lot / "crops").mkdir(parents=True)
        (lot / "labels").mkdir()
        crops, labels = [], []
        # crop_id: (split, label rows in order); the last row per crop wins.
        plan = {"v0": ("val", ["b", "a"]), "v1": ("val", ["ambiguous"]), "v2": ("val", ["zzz"]), "v3": ("val", []),
                "t0": ("test", ["b"]), "r0": ("train", ["a"]), "d0": (None, ["a"])}
        for index, (crop_id, (split, rows)) in enumerate(plan.items()):
            path = lot / "crops" / f"{crop_id}.png"
            Image.new("RGB", (40, 20), (index * 30, 30, 50)).save(path)
            crops.append({"crop_id": crop_id, "file_name": f"crops/{crop_id}.png", "split": split, "sha256": sha256(path)})
            labels += [{"crop_id": crop_id, "label": label} for label in rows]
        (lot / "crops.jsonl").write_text("".join(json.dumps(r) + "\n" for r in crops))
        (lot / "labels/tester.jsonl").write_text("".join(json.dumps(r) + "\n" for r in labels))
        (lot / "labels/other.jsonl").write_text(json.dumps({"crop_id": "v3", "label": "a"}) + "\n")
        output = self.root / "lot-runs"
        command = ["--checkpoint", str(trained / "best.pt"), "--lot", str(lot), "--labeler", "tester", "--output", str(output), "--device", "cpu"]
        with unittest.mock.patch("sys.stdout", new_callable=io.StringIO) as stdout:
            self.assertEqual(evaluate_lot.main(command), 0)
        report = json.loads(stdout.getvalue())["splits"]
        self.assertEqual(report["val"]["scored"], 1)
        self.assertEqual(report["val"]["excluded"], {"ambiguous": 1, "not_in_model_classes:zzz": 1, "unlabelled": 1})
        self.assertEqual((report["test"]["scored"], report["test"]["excluded"]), (1, {}))
        self.assertNotIn("train", report)
        (run,) = output.iterdir()
        predictions = [json.loads(line) for line in (run / "val/predictions.jsonl").read_text().splitlines()]
        self.assertEqual([(p["annotation_id"], p["true"]) for p in predictions], [("v0", "a")])
        self.assertTrue((run / "test/mistakes.html").is_file())
        (lot / "crops/t0.png").write_bytes(b"changed")
        with unittest.mock.patch("sys.stderr", new_callable=io.StringIO), self.assertRaises(SystemExit) as raised:
            evaluate_lot.main(command)
        self.assertEqual(raised.exception.code, 2)


if __name__ == "__main__":
    unittest.main()

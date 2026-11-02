"""Classifier checks use synthetic datasets and never download pretrained weights."""

import importlib.util
import io
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
        result = subprocess.run([sys.executable, str(ROOT / "train.py"), "--validate-only", "--dataset", str(run), "--output", str(output)],
                                env={**os.environ, "PYTHONPATH": str(blocker)}, capture_output=True, text=True, timeout=30, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads(result.stdout)
        self.assertTrue(summary["validate_only"])
        self.assertEqual(summary["dataset"]["class_count"], 2)
        self.assertFalse(output.exists())

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
        weights_before = {p.relative_to(ROOT / "weights").as_posix(): (p.stat().st_size, p.stat().st_mtime_ns)
                          for p in (ROOT / "weights").rglob("*") if p.is_file()}
        torch.save(resnet18(weights=None).state_dict(), initial)
        output = self.root / "cli-runs"
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
        weights_after = {p.relative_to(ROOT / "weights").as_posix(): (p.stat().st_size, p.stat().st_mtime_ns)
                         for p in (ROOT / "weights").rglob("*") if p.is_file()}
        self.assertEqual(weights_before, weights_after, "Synthetic/offline training does not download or replace weights")

    def test_40_warm_start_keeps_parent_classes_and_uses_incoming_only(self):
        from classifier_data import sha256, validate_run
        from classifier_engine import build_model, fit, seed_everything
        from prepare_transfer import build_transfer

        parent = self.dataset(reviewed=True)
        summary, samples = validate_run(parent, True)
        options = json.loads((ROOT / "training.json").read_text())
        options.update(epochs=1, image_size=64, batch_size=2, threads=1, seed=42, device="cpu")
        seed_everything(42, 1)
        trained = fit(build_model(summary["classes"], None, pretrained=False), samples, summary, options, self.root / "parent-model")
        checkpoint = trained / "best.pt"
        before = sha256(checkpoint)
        incoming = self.dataset(source="incoming", color_offset=1, reviewed=True, one_class=True)
        transfer = build_transfer(parent, incoming, checkpoint, "incoming", self.root / "transfer")
        with self.assertRaisesRegex(ValueError, "Classes without training"):
            validate_run(transfer, True)
        checked, selected = validate_run(transfer, True, warm_start=checkpoint)
        self.assertEqual(checked["classes"], ["a", "b"])
        self.assertEqual(checked["missing_training_classes"], ["b"])
        self.assertTrue(all(r["source_dataset"] == "incoming" for r in selected["train"]))
        output = self.root / "transfer-models"
        result = subprocess.run([sys.executable, str(ROOT / "train.py"), "--dataset", str(transfer), "--output", str(output),
                                 "--warm-start", str(checkpoint), "--epochs", "1", "--patience", "2", "--image-size", "64", "--batch-size", "2", "--device", "cpu"],
                                capture_output=True, text=True, timeout=120, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        run = next(output.iterdir())
        metadata = json.loads((run / "run.json").read_text())
        self.assertEqual(metadata["options"]["initial_weights_sha256"], before)
        self.assertEqual(metadata["dataset"]["classes"], ["a", "b"])
        self.assertTrue((run / "initial_val/metrics.json").is_file())
        self.assertFalse(metadata["test_evaluated"])
        self.assertEqual(sha256(checkpoint), before)

    def test_50_efficientnet_trains_offline_and_keeps_backbone_frozen(self):
        import torch
        from classifier_data import validate_run
        from classifier_engine import build_model, fit, load_checkpoint, seed_everything

        snapshot = self.dataset()
        summary, samples = validate_run(snapshot, True)
        options = json.loads((ROOT / "training.json").read_text())
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
        result = subprocess.run([sys.executable, str(ROOT / "train.py"), "--dataset", str(snapshot), "--output", str(continued),
                                 "--architecture", "efficientnet_b0", "--continue-from", str(output / "last.pt"),
                                 "--epochs", "1", "--image-size", "64", "--batch-size", "2", "--device", "cpu"],
                                capture_output=True, text=True, timeout=120, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        resumed = next(continued.iterdir())
        metadata = json.loads((resumed / "run.json").read_text())
        self.assertEqual(metadata["options"]["initial_weights_sha256"], digest)
        self.assertEqual(metadata["options"]["continued_from_epoch"], 1)
        self.assertEqual(metadata["options"]["optimizer_restored"], False)
        self.assertFalse(metadata["test_evaluated"])
        self.assertTrue((resumed / "initial_val/metrics.json").is_file())
        self.assertEqual(sha256(output / "last.pt"), digest)


if __name__ == "__main__":
    unittest.main()

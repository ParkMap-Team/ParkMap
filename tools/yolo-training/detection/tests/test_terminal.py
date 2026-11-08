import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import yaml
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("dataset_check", ROOT / "dataset_check.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
sys.path.insert(0, str(ROOT))
train_spec = importlib.util.spec_from_file_location("detection_train", ROOT / "train.py")
train = importlib.util.module_from_spec(train_spec)
train_spec.loader.exec_module(train)


class TerminalDatasetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "detect"
        self.seg = Path(self.temp.name) / "segment"
        self.make_dataset(self.root, "0 0.5 0.5 0.2 0.2\n")
        self.make_dataset(self.seg, "0 0.4 0.4 0.6 0.4 0.6 0.6 0.4 0.6\n")
        config = yaml.safe_load((ROOT / "config.yaml").read_text(encoding="utf-8"))
        config.update(dataset=str(self.root), segment_dataset=str(self.seg), output=str(self.root / "runs"),
                      weights_dir=str(self.root / "weights"))
        self.config = self.root / "config.yaml"
        self.config.write_text(yaml.safe_dump(config, allow_unicode=True), encoding="utf-8")

    @staticmethod
    def make_dataset(root, label):
        sessions = {}
        for index, split in enumerate(("train", "val", "test")):
            (root / split / "images").mkdir(parents=True)
            (root / split / "labels").mkdir()
            Image.new("RGB", (20, 20), (index * 60, 1, 1)).save(root / split / "images" / f"image-{index}.png")
            (root / split / "labels" / f"image-{index}.txt").write_text(label)
            sessions[f"image-{index}"] = f"session-{index}"
        (root / "sessions.json").write_text(json.dumps(sessions))

    def test_check_cli_does_not_load_yolo_or_train(self):
        result = subprocess.run([sys.executable, str(ROOT / "train.py"), "--config", str(self.config), "--check"],
                                capture_output=True, text=True, timeout=15, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Check passed.", result.stdout)
        self.assertFalse((self.root / "runs").exists())

    def test_shipped_config_has_described_models(self):
        config = train.load_config(ROOT / "config.yaml")
        self.assertGreaterEqual(len(config["models"]), 5)
        for name, entry in config["models"].items():
            self.assertTrue(entry.get("weights") and entry.get("description"), name)
            pretrained = not entry["weights"].endswith((".yaml", ".yml"))
            self.assertIn("[Pretrained" if pretrained else "[ไม่ Pretrain", entry["description"], name)
            self.assertIn(entry.get("family", "yolo"), ("yolo", "rtdetr"), name)
            self.assertIn("imgsz", train.model_settings(config, name))

    def test_untrained_architectures_are_not_looked_up_in_weights_dir(self):
        config = train.load_config(ROOT / "config.yaml")
        self.assertEqual(train.weights_source(config, {"weights": "yolo26s.yaml"}), "yolo26s.yaml")
        self.assertEqual(train.weights_source(config, {"weights": "yolo26s.pt"}).parent, config["_paths"]["weights_dir"])

    def test_run_folders_count_rounds_per_model(self):
        output = self.root / "runs"
        first = train.next_run_dir(output, "yolo26s")
        self.assertRegex(first.name, r"^round-01_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}$")
        first.mkdir(parents=True)
        (output / "yolo26s" / "round-07_2026-01-01_00-00").mkdir()
        self.assertTrue(train.next_run_dir(output, "yolo26s").name.startswith("round-08_"))
        self.assertTrue(train.next_run_dir(output, "yolo11n").name.startswith("round-01_"))

    def test_log_keeps_output_and_failures(self):
        run = self.root / "runs" / "m" / "round-01_x"
        old = sys.stdout, sys.stderr
        sys.stdout, sys.stderr = train.Tee(io.StringIO()), train.Tee(io.StringIO())
        try:
            train.with_log(run, "train.log", lambda: print("epoch 1"))
            with self.assertRaises(RuntimeError):
                train.with_log(run, "train.log", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
        finally:
            sys.stdout, sys.stderr = old
        log = (run / "train.log").read_text(encoding="utf-8")
        self.assertIn("epoch 1", log)
        self.assertIn("RuntimeError: boom", log)

    def test_shared_capture_session_or_missing_val_is_rejected(self):
        path = self.root / "sessions.json"
        sessions = json.loads(path.read_text())
        sessions["image-2"] = sessions["image-0"]
        path.write_text(json.dumps(sessions))
        with self.assertRaises(ValueError):
            module.validate_dataset(self.root)
        (self.root / "val").rename(self.root / "hidden-val")
        with self.assertRaises(ValueError):
            module.validate_dataset(self.root)

    def test_each_task_accepts_only_its_label_shape(self):
        self.assertEqual(module.validate_dataset(self.root)["train"]["boxes"], 1)
        self.assertEqual(module.validate_dataset(self.seg, task="segment")["train"]["boxes"], 1)
        with self.assertRaisesRegex(ValueError, "detect labels need"):
            module.validate_dataset(self.seg)
        with self.assertRaisesRegex(ValueError, "segment labels need"):
            module.validate_dataset(self.root, task="segment")
        with self.assertRaises(ValueError):
            module.validate_dataset(self.root, task="pose")

    def test_segment_models_use_seg_weights_and_their_own_dataset(self):
        config = train.load_config(self.config)
        segment = [n for n, e in config["models"].items() if train.model_task(e) == "segment"]
        self.assertGreaterEqual(len(segment), 1)
        for name in segment:
            self.assertTrue(config["models"][name]["weights"].endswith("-seg.pt"), name)
        run = self.root / "runs" / "m" / "round-01_x"
        run.mkdir(parents=True)
        self.assertEqual(yaml.safe_load(train.data_yaml(config, run, "segment").read_text())["path"], str(self.seg.resolve()))
        self.assertEqual(yaml.safe_load(train.data_yaml(config, run, "detect").read_text())["path"], str(self.root.resolve()))

    def test_config_rejects_unknown_task_or_missing_segment_dataset(self):
        config = yaml.safe_load(self.config.read_text(encoding="utf-8"))
        config["models"]["yolo26s"]["task"] = "pose"
        self.config.write_text(yaml.safe_dump(config, allow_unicode=True), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "unknown task"):
            train.load_config(self.config)
        del config["models"]["yolo26s"]["task"], config["segment_dataset"]
        self.config.write_text(yaml.safe_dump(config, allow_unicode=True), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "segment_dataset"):
            train.load_config(self.config)

    def test_best_val_keeps_mask_metrics_of_segment_runs(self):
        run = self.root / "runs" / "m" / "round-01_x"
        run.mkdir(parents=True)
        head = ["epoch", "metrics/precision(B)", "metrics/recall(B)", "metrics/mAP50(B)", "metrics/mAP50-95(B)",
                "metrics/mAP50(M)", "metrics/mAP50-95(M)"]
        (run / "results.csv").write_text(",".join(head) + "\n1,0.8,0.7,0.9,0.5,0.85,0.4\n2,0.8,0.8,0.9,0.6,0.86,0.45\n")
        best = train.best_val(run)
        self.assertEqual((best["best_epoch"], best["val_map50_95"], best["val_mask_map50_95"]), (2, 0.6, 0.45))

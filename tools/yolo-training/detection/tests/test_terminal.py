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
        self.root = Path(self.temp.name)
        sessions = {}
        for index, split in enumerate(("train", "val", "test")):
            (self.root / split / "images").mkdir(parents=True)
            (self.root / split / "labels").mkdir()
            Image.new("RGB", (20, 20), (index * 60, 1, 1)).save(self.root / split / "images" / f"image-{index}.png")
            (self.root / split / "labels" / f"image-{index}.txt").write_text("0 0.5 0.5 0.2 0.2\n")
            sessions[f"image-{index}"] = f"session-{index}"
        (self.root / "sessions.json").write_text(json.dumps(sessions))
        config = yaml.safe_load((ROOT / "config.yaml").read_text(encoding="utf-8"))
        config.update(dataset=str(self.root), output=str(self.root / "runs"), weights_dir=str(self.root / "weights"))
        self.config = self.root / "config.yaml"
        self.config.write_text(yaml.safe_dump(config, allow_unicode=True), encoding="utf-8")

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

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("dataset_check", ROOT / "dataset_check.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


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

    def test_validate_only_cli_does_not_load_yolo_or_train(self):
        result = subprocess.run([sys.executable, str(ROOT / "train.py"), "--dataset", str(self.root), "--validate-only"], capture_output=True, text=True, timeout=15, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["test"]["boxes"], 1)

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

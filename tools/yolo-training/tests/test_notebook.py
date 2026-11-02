"""Exercise notebook helpers without Colab, YOLO, private images or training."""

import ast
import hashlib
import json
import math
import tempfile
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def notebook_helpers():
    notebook = next((ROOT / "notebooks").glob("*.ipynb"))
    cells = json.loads(notebook.read_text(encoding="utf-8"))["cells"]
    names = {"get_images", "sha256", "read_yolo_labels", "validate_dataset", "box_iou", "evaluate_image"}
    scope = {"Path": Path, "Image": Image, "hashlib": hashlib, "json": json, "math": math,
             "IMAGE_EXTS": {".jpg", ".jpeg", ".png", ".webp"}}
    nodes = []
    for cell in cells:
        if cell["cell_type"] != "code":
            continue
        source = "".join(cell["source"])
        if any(line.lstrip().startswith(("!", "%")) for line in source.splitlines()):
            continue
        nodes.extend(node for node in ast.parse(source).body if isinstance(node, ast.FunctionDef) and node.name in names)
    # Compile only reviewed, named function definitions; never execute notebook setup/training cells.
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(notebook), "exec"), scope)  # noqa: S102
    return scope


class NotebookTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.helpers = notebook_helpers()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.dataset = Path(self.temp.name)
        self.images = {}
        sessions = {}
        for number, split in enumerate(("train", "val", "test")):
            image_dir = self.dataset / split / "images"
            label_dir = self.dataset / split / "labels"
            image_dir.mkdir(parents=True)
            label_dir.mkdir()
            self.images[split] = image_dir / f"photo-{number}.png"
            Image.new("RGB", (16, 16), color=(number * 70, 0, 0)).save(self.images[split])
            (label_dir / f"photo-{number}.txt").write_text("0 0.5 0.5 0.2 0.2\n", encoding="utf-8")
            sessions[f"photo-{number}"] = f"session-{number}"
        (self.dataset / "sessions.json").write_text(json.dumps(sessions), encoding="utf-8")

    def test_valid_dataset_requires_three_independent_splits(self):
        report = self.helpers["validate_dataset"](self.dataset)
        self.assertEqual(set(report), {"train", "val", "test"})
        self.assertEqual(report["test"]["boxes"], 1)

    def test_missing_label_is_an_error_instead_of_a_background_image(self):
        (self.dataset / "test/labels/photo-2.txt").unlink()
        with self.assertRaises(ValueError):
            self.helpers["validate_dataset"](self.dataset)

    def test_missing_val_is_not_replaced_by_test(self):
        (self.dataset / "val").rename(self.dataset / "validation-not-configured")
        with self.assertRaises(ValueError):
            self.helpers["validate_dataset"](self.dataset)

    def test_duplicate_image_under_another_name_is_rejected(self):
        self.images["test"].write_bytes(self.images["train"].read_bytes())
        with self.assertRaises(ValueError):
            self.helpers["validate_dataset"](self.dataset)

    def test_same_capture_session_cannot_cross_splits(self):
        manifest = self.dataset / "sessions.json"
        sessions = json.loads(manifest.read_text())
        sessions["photo-2"] = sessions["photo-0"]
        manifest.write_text(json.dumps(sessions))
        with self.assertRaises(ValueError):
            self.helpers["validate_dataset"](self.dataset)

    def test_bad_classes_nonfinite_coordinates_and_outside_boxes_are_rejected(self):
        path = self.dataset / "train/labels/photo-0.txt"
        for content in ("0.7 0.5 0.5 0.2 0.2", "0 nan 0.5 0.2 0.2", "0 0.95 0.5 0.2 0.2", "0 0.5 0.5 0 0.2"):
            with self.subTest(content=content):
                path.write_text(content)
                with self.assertRaises(ValueError):
                    self.helpers["read_yolo_labels"](path)
        path.write_text("")
        self.assertEqual(self.helpers["read_yolo_labels"](path), [])

    def test_matching_sorts_confidence_before_greedy_assignment(self):
        # Low confidence prefers GT1 but can match GT0. High confidence only matches GT1.
        # Processing low confidence first therefore loses one true positive.
        gt = [[0, 0, 0.6, 1], [0.3, 0, 0.9, 1]]
        predictions = [
            {"box": [0.15, 0, 0.85, 1], "confidence": 0.2},
            {"box": [0.3, 0, 0.9, 1], "confidence": 0.9},
        ]
        self.assertEqual(self.helpers["evaluate_image"](predictions, gt, 0.5), (2, 0, 0))
        self.assertEqual(self.helpers["evaluate_image"](list(reversed(predictions)), gt, 0.5), (2, 0, 0))


if __name__ == "__main__":
    unittest.main()

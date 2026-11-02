"""Review-only staging never creates train/val/test classification samples."""

import importlib.util
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class ReviewWorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / "source.zip"
        with zipfile.ZipFile(self.archive, "w") as z:
            z.writestr("data.yaml", "nc: 2\nnames: ['HONDA Forza', 'HONDA CB']\n")
            for index, filename in enumerate(("bike_jpg.rf.a.png", "bike_jpg.rf.b.png", "other_jpg.rf.c.png")):
                stream = io.BytesIO()
                Image.new("RGB", (100, 50), (index * 50, 10, 20)).save(stream, "PNG")
                z.writestr(f"train/images/{filename}", stream.getvalue())
                z.writestr(f"train/labels/{Path(filename).stem}.txt", f"{index % 2} 0.1 0.2 0.9 0.2 0.9 0.8 0.1 0.8")
        catalog = self.root / "catalog.json"
        catalog.write_text(json.dumps({"sources": [{"class_map": {"forza": "forza", "cb150": "cb150", "cb300": "cb300"}}]}))
        self.config = self.root / "review-config.json"
        self.config.write_text(json.dumps({"workspace": "honda2", "canonical_config": str(catalog),
                                          "source": {"id": "honda2-v2", "archive": str(self.archive), "yaml": "data.yaml",
                                                     "splits": {"train": "train", "val": "valid", "test": "test"},
                                                     "license": {"name": "test", "credit": "synthetic", "url": "local"}},
                                          "mapping": {"HONDA Forza": {"default_class": "forza", "candidates": ["forza"], "note": "name match"},
                                                      "HONDA CB": {"default_class": None, "candidates": ["cb150", "cb300"], "note": "choose variant"}}}))

    def module(self):
        spec = importlib.util.spec_from_file_location("prepare_review", ROOT / "prepare_review.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_polygon_crops_and_unresolved_classes_stay_out_of_training(self):
        module = self.module()
        original = self.archive.read_bytes()
        run = module.build_workspace(self.config, self.root / "review")
        rows = [json.loads(line) for line in (run / "manifest.jsonl").read_text().splitlines()]
        self.assertEqual(len(rows), 3)
        cb = next(row for row in rows if row["original_class"] == "HONDA CB")
        self.assertIsNone(cb["canonical_class"])
        self.assertTrue(cb["requires_class_selection"])
        self.assertTrue(all(not row["label_confirmed"] for row in rows))
        self.assertTrue(all(row["split"] is None for row in rows))
        self.assertEqual(rows[0]["group_id"], rows[1]["group_id"])
        self.assertEqual(rows[0]["crop"]["xyxy_pixels"], [10, 10, 90, 40])
        with Image.open(run / rows[0]["crop"]["path"]) as crop:
            self.assertEqual(crop.size, (80, 30))
        self.assertFalse((run / "classification").exists())
        self.assertFalse((run / "COMPLETE").exists())
        self.assertEqual(self.archive.read_bytes(), original)
        self.assertEqual(module.build_workspace(self.config, self.root / "review"), run)

    def test_ambiguous_confirmation_requires_explicit_class(self):
        module = self.module()
        row = {"annotation_id": "x", "requires_class_selection": True, "original_class": "HONDA CB"}
        with self.assertRaisesRegex(ValueError, "Explicit canonical_class"):
            module.validate_workspace_review({"annotations": {"x": {"confirmed": True}}}, [row])
        module.validate_workspace_review({"annotations": {"x": {"confirmed": True, "canonical_class": "cb150"}}}, [row])

    def test_invalid_polygon_is_reported(self):
        rows = self.module().parse_source_labels("0 0 0 1 1 0 1 1 0", ["HONDA CB"], {"HONDA CB": None})
        self.assertIn("invalid_polygon", rows[0]["issues"])


if __name__ == "__main__":
    unittest.main()

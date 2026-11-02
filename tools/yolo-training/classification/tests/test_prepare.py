"""Integration tests use tiny synthetic archives; never load/train a model."""

import importlib.util
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from PIL import Image
from PIL.PngImagePlugin import PngInfo

MODULE = Path(__file__).resolve().parents[1] / "prepare.py"
sys.path.insert(0, str(MODULE.parent))


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def module(self):
        spec = importlib.util.spec_from_file_location("classifier_prepare", MODULE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def config(self, sources):
        value = {"seed": 42, "ratios": {"train": 0.7, "val": 0.15, "test": 0.15}, "sources": []}
        for name, archive in sources:
            value["sources"].append({"id": name, "archive": str(archive), "yaml": "data.yaml",
                                     "splits": {"train": "train", "val": "valid", "test": "test"},
                                     "class_map": {"model_a": "model_a", "model_b": "model_b"},
                                     "license": {"name": "fixture", "credit": "test", "url": "local"}})
        path = self.root / "config.json"
        path.write_text(json.dumps(value))
        return path

    def png(self, color="red", metadata=None):
        stream = io.BytesIO()
        info = PngInfo()
        if metadata:
            info.add_text("Comment", metadata)
        Image.new("RGB", (40, 20), color).save(stream, "PNG", pnginfo=info)
        return stream.getvalue()

    def archive(self, name, records):
        path = self.root / name
        with zipfile.ZipFile(path, "w") as z:
            z.writestr("data.yaml", "nc: 2\nnames: [model_a, model_b]\n")
            for split, filename, raw, label in records:
                z.writestr(f"{split}/images/{filename}.png", raw)
                if label is not None:
                    z.writestr(f"{split}/labels/{filename}.txt", label)
        return path

    def test_original_counts_conflicting_duplicates_and_idempotent_output(self):
        stream = io.BytesIO()
        Image.new("RGB", (40, 20), "red").save(stream, "PNG")
        archive = self.root / "source.zip"
        with zipfile.ZipFile(archive, "w") as z:
            z.writestr("data.yaml", "nc: 2\nnames: [model_a, model_b]\n")
            for split, label in (("train", "0 0.5 0.5 0.5 0.5"), ("valid", "1 0.5 0.5 0.5 0.5")):
                z.writestr(f"{split}/images/a.png", stream.getvalue())
                z.writestr(f"{split}/labels/a.txt", label)
        config = {"seed": 42, "ratios": {"train": 0.7, "val": 0.15, "test": 0.15},
                  "sources": [{"id": "source", "archive": str(archive), "yaml": "data.yaml",
                               "splits": {"train": "train", "val": "valid", "test": "test"},
                               "class_map": {"model_a": "model_a", "model_b": "model_b"},
                               "license": {"name": "fixture", "credit": "test", "url": "local"}}]}
        config_path = self.root / "config.json"
        config_path.write_text(json.dumps(config))
        spec = importlib.util.spec_from_file_location("classifier_prepare", MODULE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        result = module.prepare(config_path, self.root / "output")
        before = json.loads((result / "audit_before.json").read_text())
        after = json.loads((result / "audit_after.json").read_text())
        self.assertEqual(before["totals"]["images"], 2)
        self.assertEqual(before["totals"]["valid_boxes"], 2)
        self.assertEqual(len(before["annotation_conflicts"]), 1)
        self.assertEqual(after["classification_crops"], 0)
        self.assertEqual(after["quarantined_annotations"], 2)
        self.assertEqual(after["leakage"]["group_cross_split"], 0)
        self.assertEqual(module.prepare(config_path, self.root / "output"), result)

    def test_decoded_pixel_duplicates_are_reconciled_without_stretching(self):
        archive = self.archive("source.zip", [("train", "a", self.png(), "0 0.5 0.5 0.5 0.5"),
                                               ("valid", "b", self.png(metadata="different bytes"), "0 0.5 0.5 0.5 0.5")])
        module = self.module()
        result = module.prepare(self.config([("source", archive)]), self.root / "out")
        before = json.loads((result / "audit_before.json").read_text())
        self.assertEqual(len(before["byte_duplicate_groups"]), 0)
        self.assertEqual(len(before["pixel_duplicate_groups"]), 1)
        manifest = module.read_jsonl(result / "manifest.jsonl")
        included = [a for a in manifest if a["disposition"] == "included"]
        self.assertEqual(len(included), 1)
        self.assertEqual(included[0]["crop"]["xyxy_pixels"], [10, 5, 30, 15])
        with Image.open(result / included[0]["classification_path"]) as image:
            self.assertEqual(image.size, (20, 10))
        self.assertTrue(all(a["license"]["credit"] == "test" for a in manifest))

    def test_validation_reports_bad_images_missing_labels_and_invalid_boxes(self):
        bad = "0 0.5\n9 0.5 0.5 0.2 0.2\n0 0.5 0.5 0 0.2\n0 0.95 0.5 0.2 0.2\n0 nan 0.5 0.2 0.2\n1 0.5 0.5 0.5 0.5\n"
        archive = self.archive("source.zip", [("train", "badlabels", self.png(), bad),
                                               ("valid", "missing", self.png("blue"), None),
                                               ("test", "corrupt", b"not an image", "0 0.5 0.5 0.5 0.5")])
        module = self.module()
        result = module.prepare(self.config([("source", archive)]), self.root / "out")
        before = json.loads((result / "audit_before.json").read_text())
        issues = {issue for row in before["annotation_issues"] for issue in row["issues"]}
        self.assertTrue({"malformed_label", "class_id_out_of_range_or_invalid", "box_without_area", "box_outside_image", "invalid_box_coordinates"} <= issues)
        self.assertEqual(before["totals"]["valid_boxes"], 1)
        self.assertTrue(any("missing_label" in i["issues"] for i in before["image_issues"]))
        self.assertEqual(len(list((result / "classification").rglob("*.png"))), 1)

    def test_multi_source_transitive_vehicle_and_duplicate_groups_do_not_leak(self):
        records = [("train", "a", self.png("red"), "0 0.3 0.5 0.2 0.5\n1 0.7 0.5 0.2 0.5"),
                   ("valid", "b", self.png("blue"), "0 0.5 0.5 0.5 0.5")]
        for index in range(8):
            records.append(("train", f"extra{index}", self.png((index * 20, 100, 50)), f"{index % 2} 0.5 0.5 0.5 0.5"))
        first = self.archive("first.zip", records)
        second = self.archive("second.zip", [("test", "c", self.png("blue"), "0 0.5 0.5 0.5 0.5")])
        config = self.config([("first", first), ("second", second)])
        module = self.module()
        original = module.prepare(config, self.root / "out")
        rows = module.read_jsonl(original / "manifest.jsonl")
        a = next(r for r in rows if r["source_image"] == "train/images/a.png" and r["original_class"] == "model_a")
        b = next(r for r in rows if r["source_image"] == "valid/images/b.png")
        review = {"annotations": {a["annotation_id"]: {"confirmed": True}}, "same_vehicle_groups": [[a["annotation_id"], b["annotation_id"]]]}
        review_path = self.root / "review.json"
        review_path.write_text(json.dumps(review))
        result = module.prepare(config, self.root / "out", review_path)
        rows = module.read_jsonl(result / "manifest.jsonl")
        linked = [r for r in rows if r["source_image"] in {"train/images/a.png", "valid/images/b.png", "test/images/c.png"}]
        self.assertEqual(len({r["group_id"] for r in linked}), 1)
        self.assertEqual(len({r["split"] for r in linked if r["disposition"] == "included"}), 1)
        self.assertTrue(all(value == 0 for value in module.verify_output(result).values()))
        rerun = module.prepare(config, self.root / "different-output", review_path)
        self.assertEqual((rerun / "manifest.jsonl").read_bytes(), (result / "manifest.jsonl").read_bytes())
        self.assertIn('"confirmed": true', (result / "index.html").read_text(encoding="utf-8"))

    def test_explicit_review_resolves_conflicts_and_rejects_unknown_ids(self):
        archive = self.archive("source.zip", [("train", "a", self.png(), "0 0.5 0.5 0.5 0.5"),
                                               ("valid", "b", self.png(), "1 0.5 0.5 0.5 0.5")])
        module = self.module()
        config = self.config([("source", archive)])
        original = module.prepare(config, self.root / "out")
        rows = module.read_jsonl(original / "manifest.jsonl")
        rejected = next(a for a in rows if a["original_class"] == "model_b")
        review_path = self.root / "review.json"
        review_path.write_text(json.dumps({"images": {rejected["image_id"]: {"exclude": True, "reason": "incorrect source annotation"}}}))
        result = module.prepare(config, self.root / "out", review_path)
        after = json.loads((result / "audit_after.json").read_text())
        self.assertEqual(after["classification_crops"], 1)
        self.assertEqual(after["quarantined_annotations"], 0)
        before = json.loads((result / "audit_before.json").read_text())
        self.assertEqual(len(before["annotation_conflicts"]), 1)
        review_path.write_text(json.dumps({"annotations": {"bogus": {"confirmed": True}}}))
        with self.assertRaisesRegex(ValueError, "unknown IDs"):
            module.prepare(config, self.root / "out", review_path)

    def test_rare_classes_are_retained_and_reported_without_filling_evaluation(self):
        archive = self.archive("source.zip", [("train", "a", self.png("red"), "0 0.5 0.5 0.5 0.5"),
                                               ("valid", "b", self.png("blue"), "1 0.5 0.5 0.5 0.5"),
                                               ("test", "c", self.png("green"), "1 0.5 0.5 0.5 0.5")])
        module = self.module()
        result = module.prepare(self.config([("source", archive)]), self.root / "out")
        after = json.loads((result / "audit_after.json").read_text())
        self.assertEqual(after["classification_crops"], 3)
        self.assertEqual(after["classes"]["model_a"]["limitation"], "fewer_than_three_independent_groups")
        self.assertEqual(after["classes"]["model_a"]["splits"]["train"]["crops"], 1)
        self.assertEqual(after["classes"]["model_a"]["splits"]["test"]["crops"], 0)
        self.assertTrue((result / "classification/test/model_a").is_dir())

    def test_mapping_is_explicit_and_output_tampering_is_detected(self):
        archive = self.archive("source.zip", [("train", "a", self.png(), "0 0.5 0.5 0.5 0.5")])
        module = self.module()
        config = self.config([("source", archive)])
        result = module.prepare(config, self.root / "out")
        crop = next((result / "classification").rglob("*.png"))
        crop.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "output changed"):
            module.prepare(config, self.root / "out")
        value = json.loads(config.read_text())
        del value["sources"][0]["class_map"]["model_b"]
        config.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, "explicitly cover"):
            module.prepare(config, self.root / "out")


if __name__ == "__main__":
    unittest.main()

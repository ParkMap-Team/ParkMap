"""Integration tests use tiny synthetic archives; never load/train a model."""

import importlib.util
import io
import json
import random
import sys
import tempfile
import unittest
import zipfile
from collections import Counter
from pathlib import Path

from PIL import Image, ImageOps
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

    def noise(self, seed, mirror=False):
        # Distinct textures keep dHash distances large, unlike solid-colour fixtures.
        image = Image.frombytes("RGB", (40, 20), random.Random(seed).randbytes(2400))
        stream = io.BytesIO()
        (ImageOps.mirror(image) if mirror else image).save(stream, "PNG")
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

    def edit_config(self, path, index, **fields):
        value = json.loads(path.read_text())
        value["sources"][index].update(fields)
        path.write_text(json.dumps(value))

    def test_null_class_map_excludes_annotations_without_creating_a_class(self):
        archive = self.archive("source.zip", [("train", f"i{n}", self.png((n * 30, 0, 0)), f"{n % 2} 0.5 0.5 0.5 0.5") for n in range(6)])
        module = self.module()
        config = self.config([("source", archive)])
        self.edit_config(config, 0, class_map={"model_a": "model_a", "model_b": None})
        result = module.prepare(config, self.root / "out")
        after = json.loads((result / "audit_after.json").read_text())
        self.assertEqual(after["dispositions"], {"included": 3, "excluded_by_class_map": 3})
        self.assertEqual(set(after["classes"]), {"model_a"})
        self.assertEqual(after["quarantined_annotations"], 0)
        self.assertFalse((result / "classification/train/model_b").exists())
        self.edit_config(config, 0, class_map={"model_a": None, "model_b": None})
        with self.assertRaisesRegex(ValueError, "class_map"):
            module.prepare(config, self.root / "out")

    def test_grouping_policy_keeps_augmented_copies_frames_and_mirrors_together(self):
        records = [("train", "a_jpg.rf.1", self.noise(1), "0 0.5 0.5 0.5 0.5"),
                   ("train", "a_jpg.rf.2", self.noise(2), "0 0.5 0.5 0.5 0.5"),
                   ("valid", "a_jpg.rf.3", self.noise(3), "0 0.5 0.5 0.5 0.5"),
                   ("valid", "frame-1_jpg.rf.4", self.noise(4), "1 0.5 0.5 0.5 0.5"),
                   ("test", "frame-2_jpg.rf.5", self.noise(5), "1 0.5 0.5 0.5 0.5"),
                   ("valid", "m_jpg.rf.6", self.noise(6), "0 0.5 0.5 0.5 0.5"),
                   ("test", "n_jpg.rf.7", self.noise(6, mirror=True), "0 0.5 0.5 0.5 0.5")]
        records += [("valid", f"x{n}_jpg.rf.{n}", self.noise(100 + n), f"{n % 2} 0.5 0.5 0.5 0.5") for n in range(8)]
        module = self.module()
        config = self.config([("source", self.archive("source.zip", records))])
        self.edit_config(config, 0, train_only_splits=["train"],
                         grouping={"roboflow_stem": True, "filename_patterns": ["^frame-"], "similar": True})
        result = module.prepare(config, self.root / "out")
        manifest = module.read_jsonl(result / "manifest.jsonl")
        rows = {r["source_image"].split("/")[-1].split(".rf.")[0]: r for r in manifest}
        stem = [r for r in manifest if "/a_jpg.rf." in r["source_image"]]
        self.assertEqual((len({r["group_id"] for r in stem}), {r["split"] for r in stem}), (1, {"train"}))
        self.assertEqual(rows["frame-1_jpg"]["group_id"], rows["frame-2_jpg"]["group_id"])
        self.assertEqual(rows["m_jpg"]["group_id"], rows["n_jpg"]["group_id"])
        pairs = json.loads((result / "similar_pairs.json").read_text())
        self.assertTrue(any(p.get("auto_linked") and p["dhash_distance"] == 0 for p in pairs))
        after = json.loads((result / "audit_after.json").read_text())
        self.assertEqual(after["similar_pairs_pending"], 0)
        self.assertEqual(after["split_constraints"]["forced_groups"], {"train": 1})
        self.assertNotIn('"auto_linked"', (result / "index.html").read_text())
        self.assertTrue(all(value == 0 for value in module.verify_output(result).values()))

    def test_pinned_splits_are_reused_and_added_sources_cannot_leak_into_them(self):
        pinned_records = [(("train", "valid", "test")[n % 3], f"p{n}", self.noise(n), f"{n % 2} 0.5 0.5 0.5 0.5") for n in range(12)]
        pinned_archive = self.archive("pinned.zip", pinned_records)
        module = self.module()
        config = self.config([("pinned", pinned_archive)])
        prior = module.prepare(config, self.root / "out")
        prior_rows = {r["annotation_id"]: r for r in module.read_jsonl(prior / "manifest.jsonl")}
        image_split = {r["source_image"].split("/")[-1]: r["split"] for r in prior_rows.values()}
        # "added" sorts first, so only the pinned preference keeps the pinned copy of p0.
        added = [("valid", "p0", self.noise(0), "0 0.5 0.5 0.5 0.5"),
                 ("valid", "p1", self.noise(1), "0 0.5 0.5 0.5 0.5")]
        added += [("train", f"t{n}_jpg.rf.{n}", self.noise(n, mirror=True), f"{n % 2} 0.5 0.5 0.5 0.5") for n in range(2, 12)]
        added += [("valid", f"e{n}", self.noise(200 + n), f"{n % 2} 0.5 0.5 0.5 0.5") for n in range(12)]
        value = json.loads(self.config([("added", self.archive("added.zip", added)), ("pinned", pinned_archive)]).read_text())
        value["sources"][0].update(train_only_splits=["train"], grouping={"roboflow_stem": True, "similar": True})
        value["sources"][1]["pinned_splits"] = str(prior)
        config.write_text(json.dumps(value))
        result = module.prepare(config, self.root / "out")
        rows = module.read_jsonl(result / "manifest.jsonl")
        for row in rows:
            if row["source_dataset"] == "pinned":
                self.assertEqual((row["disposition"], row["split"]), (prior_rows[row["annotation_id"]]["disposition"], prior_rows[row["annotation_id"]]["split"]))
        by_name = {Path(r["source_image"]).stem.split("_jpg")[0]: r for r in rows if r["source_dataset"] == "added"}
        self.assertEqual(by_name["p0"]["disposition"], "duplicate_annotation")
        self.assertEqual(by_name["p1"]["disposition"], "quarantined_duplicate_annotation_conflict")
        for n in range(2, 12):
            mirrored = by_name[f"t{n}"]
            if image_split[f"p{n}.png"] == "train":
                self.assertEqual((mirrored["disposition"], mirrored["split"]), ("included", "train"))
            else:
                self.assertEqual(mirrored["disposition"], "quarantined_pinned_split_link")
        self.assertTrue(any(by_name[f"e{n}"]["split"] in {"val", "test"} for n in range(12)))
        self.assertEqual({by_name[f"t{n}"]["disposition"] for n in range(2, 12)}, {"included", "quarantined_pinned_split_link"})
        self.assertTrue(all(value == 0 for value in module.verify_output(result).values()))
        gallery = (result / "index.html").read_text()
        self.assertIn(by_name["t2"]["image_id"], gallery)
        quarantined = next(f"t{n}" for n in range(2, 12) if by_name[f"t{n}"]["disposition"] == "quarantined_pinned_split_link")
        pinned_image = next(r["image_id"] for r in rows if r["source_image"].endswith(f"/p{quarantined[1:]}.png"))
        review = self.root / "review.json"
        review.write_text(json.dumps({"similar_pairs": [{"images": [by_name[quarantined]["image_id"], pinned_image],
                                                         "decision": "distinct", "reason": "different vehicle"}]}))
        reviewed = {Path(r["source_image"]).stem.split("_jpg")[0]: r for r in module.read_jsonl(module.prepare(config, self.root / "out", review) / "manifest.jsonl")}
        self.assertEqual((reviewed[quarantined]["disposition"], reviewed[quarantined]["split"]), ("included", "train"))
        review.write_text(json.dumps({"images": {next(iter(prior_rows.values()))["image_id"]: {"exclude": True, "reason": "changed"}}}))
        with self.assertRaisesRegex(ValueError, "differ from its pinned run"):
            module.prepare(config, self.root / "out", review)
        self.archive("pinned.zip", pinned_records[:-1])
        with self.assertRaisesRegex(ValueError, "different archive"):
            module.prepare(config, self.root / "out")

    def test_train_only_sources_do_not_drain_other_sources_and_can_seed_a_pinned_run(self):
        main_records = [(("train", "valid", "test")[n % 3], f"m{n}", self.noise(n), f"{n % 2} 0.5 0.5 0.5 0.5") for n in range(20)]
        main_archive = self.archive("main.zip", main_records)
        extra = [("train", f"x{n}_jpg.rf.{n}", self.noise(300 + n), f"{n % 2} 0.5 0.5 0.5 0.5") for n in range(40)]
        extra.append(("train", "copy_jpg.rf.99", self.noise(0, mirror=True), "0 0.5 0.5 0.5 0.5"))
        # Exact copies of main images: "extra" sorts first, so only the authoritative flag keeps the main copies.
        extra += [("train", "same_jpg.rf.97", self.noise(1), "1 0.5 0.5 0.5 0.5"),
                  ("train", "relabelled_jpg.rf.98", self.noise(2), "1 0.5 0.5 0.5 0.5")]
        module = self.module()
        config = self.config([("extra", self.archive("extra.zip", extra)), ("main", main_archive)])
        self.edit_config(config, 0, train_only_splits=["train"], grouping={"roboflow_stem": True, "similar": True})
        self.edit_config(config, 1, authoritative=True)
        combined = module.prepare(config, self.root / "out")
        rows = module.read_jsonl(combined / "manifest.jsonl")
        main = {r["annotation_id"]: r for r in rows if r["source_dataset"] == "main"}
        linked = next(r for r in main.values() if r["source_image"].endswith("/m0.png"))
        self.assertEqual(linked["split"], "train")
        self.assertEqual({r["split"] for r in rows if r["source_dataset"] == "extra" and r["disposition"] == "included"}, {"train"})
        self.assertEqual({r["disposition"] for r in main.values()}, {"included"})
        copies = {Path(r["source_image"]).stem.split("_jpg")[0]: r["disposition"] for r in rows if r["source_dataset"] == "extra"}
        self.assertEqual((copies["same"], copies["relabelled"]), ("duplicate_annotation", "quarantined_duplicate_annotation_conflict"))
        # Ratios apply to the main source alone: the 40 train-only crops must not push it into val/test.
        counts = Counter(r["split"] for r in main.values())
        self.assertGreaterEqual(counts["train"], 12)
        self.assertGreater(min(counts["val"], counts["test"]), 0)
        after = json.loads((combined / "audit_after.json").read_text())
        self.assertEqual(after["split_constraints"]["forced_groups"], {"train": len({r["group_id"] for r in rows if r["source_dataset"] == "extra" and r["disposition"] == "included"})})
        # The single-source run pinned to the combined run reproduces its splits; its groups are a subset of the combined ones.
        alone = self.root / "alone.json"
        value = json.loads(self.config([("main", main_archive)]).read_text())
        value["sources"][0]["pinned_splits"] = str(combined)
        alone.write_text(json.dumps(value))
        pinned = module.prepare(alone, self.root / "out")
        self.assertEqual({r["annotation_id"]: r["split"] for r in module.read_jsonl(pinned / "manifest.jsonl")},
                         {key: r["split"] for key, r in main.items()})

    def test_forced_groups_keep_their_split_and_count_toward_ratios(self):
        module = self.module()
        rows = [{"group_id": f"g{n}", "canonical_class": "a"} for n in range(20)]
        free = module.assign_splits(rows, {"train": .7, "val": .15, "test": .15}, 1)
        self.assertEqual(module.assign_splits(rows, {"train": .7, "val": .15, "test": .15}, 1, {}), free)
        forced = module.assign_splits(rows, {"train": .7, "val": .15, "test": .15}, 1, {f"g{n}": "train" for n in range(14)})
        self.assertTrue(all(forced[f"g{n}"] == "train" for n in range(14)))
        self.assertNotIn("train", {forced[f"g{n}"] for n in range(14, 20)})


if __name__ == "__main__":
    unittest.main()

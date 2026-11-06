"""Curation audit tests on synthetic data; no encoder is downloaded and no classifier is trained."""

import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from itertools import pairwise
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import curate
import curate_browse
import curate_page
from prepare import load_review


def row(annotation, image, split, name, source="a", group=None, original="train", size=(80, 40)):
    return {"annotation_id": annotation, "image_id": image, "split": split, "canonical_class": name, "source_dataset": source,
            "group_id": group or image, "original_split": original, "source_image": f"{split}/{image}.jpg", "source_preview": None,
            "classification_path": f"classification/{split}/{name}/{annotation}.jpg", "crop": {"width": size[0], "height": size[1]}}


# The probe and cleanlab live in the curation environment (curation/pyproject.toml), not apps/vision-api.
NEEDS_AUDIT_ENV = unittest.skipUnless(importlib.util.find_spec("sklearn") and importlib.util.find_spec("cleanlab"),
                                      "run with --project tools/yolo-training/classification/curation")


def unit(vectors):
    vectors = np.asarray(vectors, dtype=np.float32)
    return vectors / np.linalg.norm(vectors, axis=1, keepdims=True)


class CurationTests(unittest.TestCase):
    def test_eda_counts_classes_groups_sources_and_pre_augmented_copies(self):
        rows = [row("a1", "i1", "train", "click", group="g1"), row("a2", "i2", "train", "click", group="g1"),
                row("a3", "i3", "val", "wave", source="b", original="train", size=(30, 90)),
                row("a4", "i4", "test", "click", source="b", original="valid", size=(100, 100))]
        result = curate.eda(rows, {"a": [], "b": ["train"]})
        self.assertEqual(result["totals"]["train"], {"crops": 2, "groups": 1})
        self.assertEqual(result["classes"]["click"]["crops"], {"train": 2, "val": 0, "test": 1})
        self.assertEqual(result["classes"]["click"]["groups"]["train"], 1)
        self.assertEqual(result["classes"]["click"]["sources"], {"a": 2, "b": 1})
        self.assertEqual(result["sources"]["b"]["pre_augmented_crops"], 1)
        self.assertEqual(result["crop_sizes"]["b"]["min_side_below_64"], 1)

    def test_cross_split_pairs_ignore_same_split_and_sort_by_similarity(self):
        embeddings = unit([[1, 0, 0], [1, 0.01, 0], [1, 0.2, 0], [0, 1, 0], [0, 1, 0.001]])
        pairs = curate.cross_split_pairs(embeddings, ["train", "val", "test", "train", "train"], 0.95, block=2)
        self.assertEqual([(i, j) for i, j, _ in pairs], [(0, 1), (1, 2), (0, 2)])
        self.assertTrue(all(a[2] >= b[2] for a, b in pairwise(pairs)))

    def test_similarity_reference_calibrates_on_the_most_similar_other_class_crop(self):
        embeddings = unit([[1, 0], [1, 0.05], [0.9, 0.5], [0, 1]])
        reference = curate.similarity_reference(embeddings, ["p", "p", "q", "r"], [0, 0, 1, 1], quantile=100, block=3)
        self.assertEqual(reference["copy_pairs"], 1)
        self.assertGreater(reference["copies"]["p50"], 0.99)
        closest_other_class = float(embeddings[1] @ embeddings[2])
        self.assertAlmostEqual(reference["nearest_different_class"]["p99.9"], closest_other_class, places=3)
        self.assertEqual(reference["calibrated_threshold"], np.ceil(closest_other_class * 1000) / 1000)

    def test_photo_groups_keep_roboflow_copies_together_and_split_large_groups(self):
        rows = [row("a1", "i1", "train", "click", source="r", group="big"), row("a2", "i2", "train", "click", source="r", group="big"),
                row("a3", "i3", "train", "click", source="r", group="big"), row("a4", "i4", "val", "click", source="s", group="g4")]
        rows[0]["source_image"] = "train/images/bike_jpg.rf.aaa.jpg"
        rows[1]["source_image"] = "train/images/bike_jpg.rf.bbb.jpg"
        rows[2]["source_image"] = "train/images/other_jpg.rf.ccc.jpg"
        rows[3]["source_image"] = "valid/images/bike_jpg.rf.ddd.jpg"
        photos = curate.photo_groups(rows, {"r": {"roboflow_stem": True}, "s": {}})
        self.assertEqual(photos[0], photos[1])
        self.assertNotEqual(photos[0], photos[2])
        self.assertEqual(photos[3], "g4")

    @NEEDS_AUDIT_ENV
    def test_probe_never_scores_a_row_with_its_own_group(self):
        # Each group has a unique feature and a random label; a probe that saw the group would memorize it.
        rng = np.random.default_rng(0)
        group_features = rng.normal(size=(60, 16))
        group_labels = np.array([0, 1, 2] * 20)
        rng.shuffle(group_labels)
        features = np.repeat(group_features, 4, axis=0) + rng.normal(scale=0.01, size=(240, 16))
        labels = np.repeat(group_labels, 4)
        groups = np.repeat(np.arange(60), 4)
        probabilities = curate.out_of_fold_probabilities(features, labels, groups, 3, folds=5, seed=1)
        self.assertEqual(probabilities.shape, (240, 3))
        np.testing.assert_allclose(probabilities.sum(axis=1), 1, atol=1e-6)
        self.assertLess((probabilities.argmax(axis=1) == labels).mean(), 0.6)

    @NEEDS_AUDIT_ENV
    def test_probe_leaves_zero_probability_for_a_class_missing_from_a_fold(self):
        # Class 0 exists in one group only, so the fold holding that group out never trains on class 0.
        features = np.array([[0.0], [0.1], [5.0], [5.2], [5.1], [10.0], [10.1], [10.2]])
        labels = np.array([0, 0, 1, 1, 1, 2, 2, 2])
        groups = np.array([1, 1, 2, 3, 4, 5, 6, 7])
        probabilities = curate.out_of_fold_probabilities(features, labels, groups, 3, folds=3, seed=0)
        np.testing.assert_array_equal(probabilities[labels == 0, 0], 0)
        np.testing.assert_allclose(probabilities.sum(axis=1), 1, atol=1e-6)

    @NEEDS_AUDIT_ENV
    def test_suspected_labels_rank_a_confidently_wrong_row(self):
        labels = [0] * 20 + [1] * 20
        probabilities = np.array([[0.95, 0.05]] * 20 + [[0.05, 0.95]] * 20)
        probabilities[3] = [0.02, 0.98]
        issues = curate.suspected_labels(labels, probabilities)
        self.assertEqual(issues[0]["index"], 3)
        self.assertEqual(issues[0]["suggested"], 1)

    def test_nearest_examples_skip_the_same_group(self):
        embeddings = unit([[1, 0], [1, 0.01], [1, 0.2], [0, 1]])
        self.assertEqual(curate.nearest_examples(embeddings, 0, [0, 1, 1, 1], ["g", "g", "h", "k"], 1, count=2), [2, 3])

    def test_pending_dhash_pairs_keep_only_unreviewed_cross_split_pairs(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            pairs = [{"images": ["i1", "i2"], "dhash_distance": 2, "review": {}},
                     {"images": ["i1", "i3"], "dhash_distance": 1, "review": {}},
                     {"images": ["i2", "i4"], "dhash_distance": 0, "review": {"decision": "distinct"}},
                     {"images": ["i2", "i5"], "dhash_distance": 0, "review": {}, "auto_linked": True},
                     {"images": ["i2", "excluded"], "dhash_distance": 0, "review": {}}]
            (root / "similar_pairs.json").write_text(json.dumps(pairs))
            rows = [row("a1", "i1", "train", "click"), row("a2", "i2", "val", "click"), row("a3", "i3", "train", "click"),
                    row("a4", "i4", "test", "click"), row("a5", "i5", "test", "click")]
            self.assertEqual(curate.pending_dhash_pairs(root, rows), [("i1", "i2", 2)])

    def queue(self):
        crop = lambda annotation, image, split, label, pinned=False: {
            "annotation_id": annotation, "image_id": image, "split": split, "label": label, "pinned": pinned}
        return [
            {"id": "pair:a1|a2", "kind": "pair", "crops": [crop("a1", "i1", "train", "click"), crop("a2", "i2", "val", "click")]},
            {"id": "dhash:i3|i4", "kind": "pair", "crops": [crop("a3", "i3", "train", "wave"), crop("a4", "i4", "test", "wave")]},
            {"id": "pair:a5|a6", "kind": "pair", "crops": [crop("a5", "i5", "train", "nmax", True), crop("a6", "i6", "val", "nmax", True)]},
            {"id": "label:a7", "kind": "label", "suggested": "wave", "crops": [crop("a7", "i7", "train", "click", True)]},
            {"id": "label:a8", "kind": "label", "suggested": "wave", "crops": [crop("a8", "i8", "train", "click")]},
            {"id": "label:a9", "kind": "label", "suggested": "wave", "crops": [crop("a9", "i9", "train", "click")]},
            {"id": "quality:a1", "kind": "quality", "crops": [crop("a1", "i1", "train", "click")]},
            {"id": "quality:a3", "kind": "quality", "crops": [crop("a3", "i3", "train", "wave")]},
        ]

    def test_exported_review_is_accepted_by_the_preparation_schema(self):
        node = shutil.which("node")
        if node is None:
            self.skipTest("Node.js is required to run the review page logic")
        items = self.queue()
        decisions = {"pair:a1|a2": {"action": "same", "reason": ""}, "dhash:i3|i4": {"action": "distinct", "reason": "ต่างคัน"},
                     "pair:a5|a6": {"action": "same"}, "label:a7": {"action": "relabel", "canonical_class": "wave"},
                     "label:a8": {"action": "keep"}, "label:a9": {"action": "exclude", "reason": ""},
                     "quality:a1": {"action": "quality_keep"}, "quality:a3": {"action": "quality_exclude"}}
        base = {"version": 1, "annotations": {"a8": {"exclude": False, "reason": "earlier"}}, "images": {},
                "same_vehicle_groups": [["a1", "a2"]], "similar_pairs": [{"images": ["i4", "i3"], "decision": "uncertain", "reason": "old"}]}
        script = curate_page.BUILD_REVIEW_JS + """
const input = JSON.parse(require("fs").readFileSync(0, "utf8"));
process.stdout.write(JSON.stringify({review: buildReview(input.base, input.items, input.decisions),
  resplit: input.items.filter((i) => needsResplit(i, input.decisions[i.id])).map((i) => i.id)}));
"""
        output = subprocess.run([node, "-e", script], input=json.dumps({"base": base, "items": items, "decisions": decisions}),
                                capture_output=True, text=True, check=True)
        result = json.loads(output.stdout)
        review = result["review"]
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "review.json"
            path.write_text(json.dumps(review, ensure_ascii=False), encoding="utf-8")
            ids = range(1, 10)
            load_review(path, [{"image_id": f"i{n}"} for n in ids], [{"annotation_id": f"a{n}"} for n in ids], ["click", "nmax", "wave"])
        self.assertEqual(review["same_vehicle_groups"], [["a1", "a2"], ["a5", "a6"]])
        self.assertEqual({tuple(p["images"]): p["decision"] for p in review["similar_pairs"]},
                         {("i3", "i4"): "distinct", ("i1", "i2"): "same_vehicle_grouped", ("i5", "i6"): "same_vehicle_grouped"})
        self.assertEqual(review["annotations"]["a7"]["canonical_class"], "wave")
        self.assertTrue(review["annotations"]["a8"]["confirmed"])
        self.assertEqual(review["annotations"]["a8"]["exclude"], False)
        self.assertTrue(review["annotations"]["a9"]["exclude"] and review["annotations"]["a9"]["reason"])
        self.assertTrue(review["annotations"]["a3"]["exclude"])
        self.assertNotIn("a1", review["annotations"])
        self.assertEqual(result["resplit"], ["pair:a5|a6", "label:a7"])

    def test_pinned_limitation_appears_only_with_pinned_sources(self):
        self.assertFalse(any("pinned" in text for text in curate.audit_limitations(set())))
        self.assertIn("Decisions about pinned sources (a, b)", curate.audit_limitations({"b", "a"})[-1])

    def test_browse_tags_name_every_flag_kind(self):
        tags, suggested = curate_browse.audit_tags(self.queue()[:1] + self.queue()[3:4] + [
            {"id": "quality:a1", "kind": "quality", "issues": ["dark"], "crops": [{"annotation_id": "a1"}]}])
        self.assertEqual(tags["a1"], ["cross_split_pair", "quality:dark", "quality_issue"])
        self.assertEqual(tags["a7"], ["label_suspect"])
        self.assertEqual(suggested, {"a7": "wave"})

    def test_review_page_embeds_payload_without_closing_its_script(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "review.html"
            items = [{"id": "label:x", "kind": "label", "suggested": "</script><b>", "crops": []}]
            curate_page.render_review(path, items, ["click"], {"dataset": {"fingerprint": "abc"}})
            text = path.read_text(encoding="utf-8")
        payload = re.search(r'<script type="application/json" id="payload">(.*?)</script>', text, re.DOTALL).group(1)
        self.assertEqual(json.loads(payload)["items"][0]["suggested"], "</script><b>")
        self.assertIn("function buildReview", text)


if __name__ == "__main__":
    unittest.main()

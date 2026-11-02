"""Reviewed snapshot merge keeps pending labels out and deduplicates across sources."""

import json
import sys
import unittest
from pathlib import Path

import test_prepare

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class MergeTests(unittest.TestCase):
    def test_only_confirmed_crops_and_cross_source_duplicates(self):
        from merge_reviewed import merge
        from prepare import prepare, read_jsonl, verify_output
        from prepare_review import build_workspace

        fixture = test_prepare.PreparationTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        archive = fixture.archive("base.zip", [("train", "a", fixture.png("red"), "0 0.5 0.5 0.5 0.5")])
        config = fixture.config([("base", archive)])
        initial = prepare(config, fixture.root / "initial")
        review = fixture.root / "base-review.json"
        review.write_text(json.dumps({"annotations": {r["annotation_id"]: {"confirmed": True} for r in read_jsonl(initial / "manifest.jsonl")}}))
        base = prepare(config, fixture.root / "base", review)
        incoming = fixture.archive("incoming.zip", [("train", name, fixture.png(color), "0 0.5 0.5 0.5 0.5")
                                                   for name, color in (("duplicate", "red"), ("pending", "blue"), ("confirmed", "green"))])
        source = json.loads(config.read_text())["sources"][0]
        source.update(id="incoming", archive=str(incoming))
        staging = fixture.root / "workspace.json"
        staging.write_text(json.dumps({"workspace": "incoming", "canonical_config": str(config), "source": source,
                                       "mapping": {name: {"default_class": name, "candidates": [name]} for name in source["class_map"]}}))
        workspace = build_workspace(staging, fixture.root / "workspace")
        decisions = fixture.root / "incoming-review.json"
        decisions.write_text(json.dumps({"annotations": {r["annotation_id"]: {"confirmed": True}
                                                          for r in read_jsonl(workspace / "manifest.jsonl") if "pending" not in r["source_image"]}}))
        workspace = build_workspace(staging, fixture.root / "workspace", decisions)
        result = merge(base, workspace, fixture.root / "merged")
        rows = read_jsonl(result / "manifest.jsonl")
        self.assertEqual(sum(r["disposition"] == "included" for r in rows), 2)
        pending = next(r for r in rows if "pending" in r["source_image"])
        self.assertEqual(pending["disposition"], "pending_review")
        self.assertIsNone(pending["classification_path"])
        self.assertTrue(all(r["label_confirmed"] for r in rows if r["disposition"] == "included"))
        self.assertFalse(any(verify_output(result).values()))
        self.assertEqual(merge(base, workspace, fixture.root / "merged"), result)


if __name__ == "__main__":
    unittest.main()

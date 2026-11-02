"""Transfer training preserves the parent's holdouts and output class catalog."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class TransferTests(unittest.TestCase):
    def test_only_incoming_training_and_parent_holdouts_are_selected(self):
        from prepare_transfer import select_rows

        parent = [{"annotation_id": f"old-{s}", "split": s, "source_dataset": "old", "disposition": "included"}
                  for s in ("train", "val", "test")]
        incoming = [{"annotation_id": f"new-{s}", "split": s, "source_dataset": "new", "disposition": "included"}
                    for s in ("train", "val", "test")]
        rows = select_rows(parent, parent + incoming, "new")
        self.assertEqual({r["annotation_id"] for r in rows}, {"old-val", "old-test", "new-train", "new-val", "new-test"})
        self.assertEqual([r["source_dataset"] for r in rows if r["split"] == "train"], ["new"])

    def test_early_stopping_counts_ties_and_resets_on_improvement(self):
        from training_control import EarlyStopping

        stop = EarlyStopping(3)
        self.assertFalse(stop.update(.4))
        self.assertFalse(stop.update(.4))
        self.assertFalse(stop.update(.5))
        self.assertFalse(stop.update(.49))
        self.assertFalse(stop.update(.5))
        self.assertTrue(stop.update(.5))
        disabled = EarlyStopping(0)
        self.assertFalse(any(disabled.update(.5) for _ in range(20)))

    def test_replay_adds_parent_training_without_changing_validation(self):
        from prepare_transfer import select_rows

        parent = [{"annotation_id": f"old-{s}", "split": s, "source_dataset": "old", "disposition": "included"}
                  for s in ("train", "val", "test")]
        incoming = [{"annotation_id": f"new-{s}", "split": s, "source_dataset": "new", "disposition": "included"}
                    for s in ("train", "val", "test")]
        without = select_rows(parent, parent + incoming, "new")
        replay = select_rows(parent, parent + incoming, "new", replay=True)
        self.assertEqual({r["annotation_id"] for r in replay if r["split"] == "train"}, {"old-train", "new-train"})
        self.assertEqual([r for r in replay if r["split"] != "train"], [r for r in without if r["split"] != "train"])
        with self.assertRaisesRegex(ValueError, "Incoming source"):
            select_rows(parent, parent + incoming, "missing", replay=True)


if __name__ == "__main__":
    unittest.main()

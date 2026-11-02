# Initial Thai Motorcycle export audit

Status: **PROVISIONAL**. No model was trained. Original labels have not been
human-confirmed, and same physical motorcycles viewed from different angles may
still be in different groups. Public-image results cannot establish real-camera
accuracy or safe parking availability.

Input: `Thai Motorcycle.v1-top1k.yolov8.zip` (read-only).
An identical copy is in ignored `inputs/` for running the default config; the
Downloads original remains unchanged.

- ZIP SHA-256: `0fc4e4ce133535f6b7f90f20a8e9bee163db8e52b5c8f6b58b6314d5bc261536`.
- 1,132 image files; all decoded at 416×416 pixels.
- 46 declared classes; all 46 have real annotation lines.
- 1,497 valid annotation boxes. This is **not** a count of distinct motorcycles.
- Original train: 793 images / 1,030 boxes.
- Original validation: 226 images / 306 boxes.
- Original test: 113 images / 161 boxes.
- No unreadable images, missing labels, malformed annotation lines, out-of-range
  class IDs, zero-area boxes or out-of-image boxes detected in this ZIP.
- Five exact-file duplicate groups, also five decoded-RGB-pixel duplicate groups;
  two originally cross train/validation. Duplicate groups have matching annotation
  multisets; no differing annotation version was silently discarded.
- Eight annotation copies in duplicate images are represented by selected
  equivalents; all copies and alias relationships remain in manifest.jsonl.

After grouping and exact-duplicate reconciliation, seed `20261102`:

- 1,489 classification crops from 1,127 selected source images / known groups.
- Train: 1,041 crops / 784 groups.
- Val: 225 crops / 176 groups.
- Test: 223 crops / 167 groups.
- All 46 classes retained, with nonempty coverage in all three splits. This is
  only a coverage check; it does not establish reliable per-class evaluation.
- Known group, source-image, source-byte, source-pixel, crop-byte and crop-pixel
  cross-split overlap counts are all **zero**.
- 298 dHash-similar image pairs proposed for human review; not automatically
  removed or merged. Of these, 142 pairs currently cross the new splits; similarity
  is not identity evidence. The zero-overlap result above applies to exact hashes
  and known groups only. Similar views and true vehicle identities remain unresolved.
- All 1,489 included labels still await individual human confirmation.

The smallest original classes have only 10 annotated boxes: `cbr500r`, `goldwing`,
`gtx125`, `nc750`, `wr155`, `xadv`. Their tiny validation/test support limits what
any later accuracy estimate could establish, even with coverage in each split.

README.dataset.txt and data.yaml declare **CC BY 4.0**, crediting a Roboflow user
and the Satayu Chunnawong workspace. The original READMEs and attribution metadata
are copied into generated results. Image-level ownership/rights have not been
independently verified.

README.roboflow.txt declares auto-orientation, EXIF stripping, **stretch resize to
416×416**, and no augmentation. Crop generation performs no further resizing,
but cannot recover the original aspect ratios from these already-stretched files.

The gallery also contains commercial-style images with price text and composite
layouts showing multiple motorcycles. These need human review for ambiguous
labels/scene context and may encourage shortcuts that do not transfer to the
ParkMap camera. The pipeline does not infer model identity or silently relabel
those examples.

Canonical mapping is explicit and preserves all semantic labels; only spaces in
`grand filano` and `super cub` become underscores for directory names. For example,
`razer` is not guessed to mean another model, and `adv` is not merged with `xadv`.

Generated per-class/per-original-split image and box counts, per-new-split crop
counts, full manifests, source credits and offline review pages are under the
ignored `prepared/` directory. Open `prepared/index.html` for the current run;
`prepared/latest.json` identifies its immutable folder. See [README.md](README.md)
for rerunning and applying review. This summary does not replace those detailed
audit files, or human model-family and identity review.

Verification: seven synthetic-archive tests and Ruff passed; running the real
ZIP twice reused the same completed snapshot after integrity verification.
Offline Edge checks passed for file:// rendering, image loading, class filtering,
pagination, pair-review decisions, same-vehicle grouping and unconfirmation.
Browser checks used temporary page-memory decisions, not saved human label
confirmations. Colab execution and model training were not run.

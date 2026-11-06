# Motorcycle model-family dataset preparation

For the reviewed dataset's **VS Code Terminal training command**, see
[TRAINING.md](TRAINING.md). Preparation and training are separate entry points;
the scripts below only prepare/review data. To audit a prepared snapshot (EDA,
image quality, cross-split near duplicates, suspected labels) and review the
findings in a keyboard queue before handoff, see [CURATION.md](CURATION.md).

This is a **separate classification experiment**, not the existing class-0 YOLO
detector dataset. It prepares annotation crops; it never trains, runs inference,
downloads weights, changes the API, or changes parking availability. Model-family
labels do not establish a motorcycle's real dimensions (ADR 0004).

## Run in VS Code

From the repository root, with the existing Vision API environment:

```powershell
uv run --project apps/vision-api --no-sync python tools/yolo-training/classification/prepare.py --source "thai-motorcycle-v1-top1k=C:\Users\user\Downloads\Thai Motorcycle.v1-top1k.yolov8.zip"
```

Or select that Python interpreter in VS Code and execute `prepare.py` with the
same arguments. Alternatively put the ZIP in `classification/inputs/` with the
filename in `config.json`; then omit `--source`. No extraction is necessary.
ZIP inputs are read-only; the original Downloads file is never edited or deleted.

In the current workspace the supplied ZIP has already been copied into ignored
`inputs/` and verified byte-identical to Downloads. The default command therefore
also works without path overrides:

```powershell
uv run --project apps/vision-api --no-sync python tools/yolo-training/classification/prepare.py
```

The only third-party dependencies are Pillow 11.3.0 and PyYAML 6.0.3, already in
the project's locked API environment. For a separate Python 3.12 environment:

```powershell
python -m pip install -r tools/yolo-training/classification/requirements.txt
python tools/yolo-training/classification/prepare.py --source "thai-motorcycle-v1-top1k=<absolute-path-to-zip>"
```

Open **`prepared/index.html`** in a browser (double-click, no server needed).
It opens the latest result, with class/search/status filters, paginated crops,
source-image previews with annotation boxes, unusual-box flags, duplicate
conflicts, and similar-image pairs. Every valid crop, including annotations held
out of classification, is reviewable. Images use `object-fit: contain` in the
gallery; saved crops are native-size PNG, with no resize or augmentation.

## Run in Colab

Upload the `classification/` source folder and the ZIP to private Colab storage
or mount your private Drive. Keep all of `prepare.py`, `gallery.py`, `config.json`,
and `requirements.txt` together. No Windows-specific path is embedded in code.

```python
%pip install -r /content/classification/requirements.txt
!python /content/classification/prepare.py --source "thai-motorcycle-v1-top1k=/content/Thai Motorcycle.v1-top1k.yolov8.zip" --output /content/prepared
```

Download the **whole run folder**, not just index.html, to review locally, since
HTML uses relative image paths. Colab runtimes are temporary; preserve outputs
and review decisions privately before disconnecting. Colab execution itself has
not been verified in this change; the same Python entry point runs locally.

## Outputs and reruns

Each `prepared/run-<fingerprint>/` is an immutable snapshot containing:

```text
classification/train/<canonical_class>/*.png
classification/val/<canonical_class>/*.png
classification/test/<canonical_class>/*.png
review-crops/              # all valid annotation crops, including quarantined copies
images/                    # annotated source-image previews
manifest.jsonl             # every nonempty annotation line, including invalid/excluded
images.json                # every source image, including bad/negative images
audit_before.json          # original split/class image counts and box counts; conflicts
audit_after.json           # actual split/class crop and group counts; pending work/leakage
REPORT.md                  # human-readable audit and per-class coverage
similar_pairs.json
review.template.json
review_applied.json
credits/                   # original archive README copies
reproducibility.json        # source hashes, config, seed, dependencies, code fingerprint
integrity.json             # hashes of every generated artifact
COMPLETE
index.html
```

Input bytes, config, review bytes, pipeline code and dependency versions determine
the fingerprint. Identical reruns verify and reuse the completed run; they never
append duplicate crops. Different inputs/review/code create a separate snapshot
and update `prepared/index.html` and `latest.json`. Old snapshots are not mixed
into the current classification folder and are never automatically removed.
Interrupted runs lack COMPLETE and are not reused; choose a new `--output` root
to retry. Do not edit generated snapshots in place: edit an external review file.

```powershell
uv run --project apps/vision-api --no-sync python tools/yolo-training/classification/prepare.py --verify "tools/yolo-training/classification/prepared/run-<fingerprint>"
```

`--verify` verifies all output file hashes and checks leakage again. Empty class
directories remain for observed classes that have no eligible crops in a split;
consult coverage before using an ImageFolder loader, which may reject empties.

## What is audited

- Images: decoding, dimensions, EXIF orientation, missing/undecodable labels,
  orphan labels, original image size and SHA-256 hashes.
- Annotations: exactly five YOLO fields; integer in-range class ID; finite
  coordinates; positive box area; full box inside the image. Invalid records are
  reported and excluded, never silently clipped into valid training examples.
- Counts: image files and annotation boxes **separately**, by source, original
  split and original class. Images containing multiple classes count once per
  class; class image counts therefore need not sum to total images. Neither box
  nor crop counts claim distinct physical motorcycles.
- Duplicates: SHA-256 of original bytes and of decoded RGB pixels plus dimensions
  (not EXIF metadata). All readable pixel duplicates are compared by annotation
  **multiset**: canonical label and normalized box, retaining multiplicity and
  ignoring line order. A keeper is selected only when active annotation sets agree.
  All rejected copies, aliases and original conflicts remain in manifest/audits.
- Conflicts: differing annotation sets quarantine active copies until explicit
  review reconciles them; identical crops with differing active class labels are
  also quarantined. Original conflicts stay in audit_before after review, with
  effective post-review conflicts in audit_after. Label-free images remain in
  audit, not in the positive-image classifier dataset.
- Similarity: 64-bit dHash distance <= 6 proposes image pairs. It does **not**
  establish duplicate/vehicle identity, detect every near-duplicate, remove an
  image, or merge a group. Search and review those pairs in the HTML gallery.
- Unusual crops: small dimensions, extreme aspect ratio and nearly-full-image
  boxes are review flags, not automatic label corrections or exclusions.
- Crops: normalized source box, source dimensions/hashes, floor/ceil pixel box,
  output dimensions/hashes, source filename, source dataset, original/canonical
  class, annotation ID, group, disposition, split, credit and declared license.

The supplied export was **already stretched to 416x416** according to its README.
The pipeline preserves the supplied crop proportions; it cannot reverse that
earlier distortion without the original unresized images. Any later network
input resizing should preserve aspect ratio with padding. Augmentation, if added
later, must apply **only to train**, never to val/test, with evaluation transforms
deterministic and documented.

## Human review

The gallery opens in **ตรวจทีละรูป** (one crop at a time). Use:

- **N**: explicitly confirm the currently selected class in page memory and advance one crop.
- **M**: exclude this crop in page memory and advance. A blank reason becomes
  `ผู้ตรวจเลือกไม่ใช้ภาพนี้`; a reason you typed is kept.
- **Left / Right arrows**: visit the previous/next crop without making a decision.
  Go back and use the buttons or N/M to correct an earlier decision.
- **ดูหลายรูป / จับกลุ่ม**: return to the grid for comparisons and grouping.

Keyboard shortcuts apply only to single-crop review, never while typing in a
field, selecting a class, composing text, holding a key, or using Ctrl/Alt/Meta.
Physical N/M keys also work on a Thai keyboard layout. N/M never open a file picker
or write a file, including after a save file was selected earlier. Filtered queues use
annotation IDs to advance without skipping when a decision removes the current
crop from the filter. The final crop stops instead of repeating decisions.
Use the explicit save/download button before closing, as described below.

Use explicit buttons in the gallery instead of review checkboxes:

- **บันทึกรุ่นนี้**: confirm the selected model-family label for this annotation.
  Changing the dropdown alone is an uncommitted draft, never human confirmation.
  Correcting the original label requires a reason before this button can save.
- **ตัดออก**: exclude this annotation with a required reason.
- **ยกเลิกผลตรวจ**: clear this annotation's review decision and return to its
  original mapped class. It does not claim that the original label was verified.
- **เลือกเพื่อจับกลุ่ม**, then **บันทึกกลุ่มที่เลือก**: group confirmed views of
  the same physical motorcycle. Merely selecting cards does not change review.
- Source-image exclusions and similar-pair decisions also use explicit buttons.

The similar-pair panel records `distinct`,
`same_vehicle_grouped` or `uncertain`; marking a pair as the same vehicle also
requires selecting the actual matching annotation cards and grouping them.
Images may contain several vehicles, so a similarity pair alone never identifies
which vehicles match.

Decision buttons, grouping and pair review only update page memory. They never
open a save dialog or write automatically. The notice states when results have
not been saved to disk, and the unsaved-change warning remains active.

On browsers supporting the [native save-file picker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker),
click **บันทึกไฟล์ review.json** when ready. The first explicit save asks where to
save; later explicit saves reuse that file for the page session. The page reports
success only after closing the writable stream. A failed or cancelled explicit
save retains pending decisions and the unsaved-change warning. Click the save
button again to retry; it does not change the currently displayed crop.

On browsers without that picker, decision buttons record the result in page
memory. **บันทึกไฟล์ review.json** downloads the JSON; **ดาวน์โหลดสำเนา** always
offers the download fallback. Check the downloaded file before closing. Native
save-picker support varies by browser; no server or uploads are introduced.

Input drafts survive switching tabs/filters, but only a decision button commits
them to review JSON. The page warns before closing with uncommitted drafts. On
an existing reviewed run the page starts with all prior applied decisions. To
continue from a separately saved review.json after reopening the page, import
that file first, then choose the save file again. Importing and saving review do
not modify the immutable dataset snapshot; rerun preparation to apply decisions.

Alternatively copy review.template.json **outside the immutable run** into
ignored `reviews/` and edit:

```json
{
  "version": 1,
  "annotations": {
    "<image-id>:1": {"confirmed": true},
    "<other-image-id>:2": {"exclude": true, "reason": "model cannot be identified"},
    "<third-image-id>:1": {
      "canonical_class": "click", "confirmed": true,
      "reason": "human checked the original image and reference"
    }
  },
  "images": {
    "<duplicate-image-id>": {"exclude": true, "reason": "incorrect duplicate annotation version"}
  },
  "same_vehicle_groups": [["<image-id>:1", "<fourth-image-id>:1"]],
  "similar_pairs": [
    {"images": ["<image-id>", "<fourth-image-id>"], "decision": "same_vehicle_grouped", "reason": "verified matching physical vehicle"}
  ]
}
```

IDs are in the manifest and gallery. Unknown/stale IDs and malformed decisions
fail validation. Correcting a label requires an explicit existing canonical
class, `confirmed: true` and a reason. No automatic unknown class is created.

Apply review with the original source argument and:

```powershell
uv run --project apps/vision-api --no-sync python tools/yolo-training/classification/prepare.py --source "thai-motorcycle-v1-top1k=C:\Users\user\Downloads\Thai Motorcycle.v1-top1k.yolov8.zip" --review "tools/yolo-training/classification/reviews/review.json"
```

## Grouping and splitting

Before assigning any split, union together all annotations from one source
image, byte/pixel duplicate images, identical crop pixels, and explicit
same-vehicle review relationships. These relationships are transitive, including
across datasets; excluding one annotation never splits its source image group.

Seeded greedy group stratification aims for 70/15/15, balancing class crop counts
and group counts with a coverage preference. It never breaks a group or makes
copies to fill val/test. Reported actual ratios may differ from targets, especially
for multi-class groups and rare classes. Classes with fewer than three known
groups or missing split coverage are retained and flagged, not silently dropped.
There is no guarantee that different unknown vehicles/views are independent.

Post-audit must have **zero known cross-split group, source-image, source-byte,
source-pixel, crop-byte and crop-pixel overlaps**; otherwise preparation fails.
This is not a claim of zero leakage from unrecognized physical vehicle identity
or all visually similar views. Pending proposed similar pairs are reported
separately, including the number crossing new splits.

## Add another source later

Add an entry to `config.json.sources` with a unique ID, ZIP path, YAML member,
explicit split folder names, credit/license and a complete class_map. Then use
another `--source ID=ZIP` if overriding its configured path. Sources are checked
together for duplicates and grouped together before splitting.

Every original YAML class needs an explicit mapping, including classes with zero
annotations. The initial mapping is identity except directory-safe spaces:
`grand filano -> grand_filano`, `super cub -> super_cub`. Spellings such as `razer`,
`gtx125`, `rock`, `adv`, and `xadv` are preserved exactly and **not semantically
corrected or merged**. A new source's apparently similar names must remain separate
unless a person explicitly establishes the intended meaning and updates mapping.
Do not turn remaining classes or ambiguous crops into an unknown catch-all.

A `null` mapping excludes a source class explicitly: its annotations are kept in
the manifest as `excluded_by_class_map`, never cropped or turned into a class.

### Extra sources with pinned splits

`config.external.json` adds four public Roboflow sets (arfah, elcy, box-m9ziu,
box-3-class) to the reviewed Thai Motorcycle source. Colour classes are merged
(`Honda_Vario_*` -> `click`, `Yamaha_NMAX_*` -> `nmax`, ...); Vario is sold as
Click in Thailand. Classes without a ParkMap equivalent are `null`. Optional
per-source fields:

- `pinned_splits`: a complete earlier run (relative to the config). It is
  verified, must have been prepared from the same archive, and the source's
  dispositions/classes must match it exactly (use that run's
  `review_applied.json` as `--review`); its splits are reused unchanged so its
  test stays comparable with earlier models. Ratios apply only to the other
  sources. A pinned source is also authoritative.
- `authoritative`: this source's annotations win over other sources'
  identical-pixel copies; a copy with different labels is quarantined. Its
  dispositions are then the same as when it is prepared alone, so the run can
  seed its pinned single-source snapshot.
- `train_only_splits`: original splits whose images may only go to train.
  Roboflow augments only its train split, so its augmented copies never enter
  val/test. Groups containing them stay in train and do not count toward the
  ratios, so they never drain another source's train split.
- `grouping`: `roboflow_stem` groups images sharing the name before `.rf.`
  (augmented copies), `filename_patterns` groups every match of each regex
  (e.g. video frames), and `similar` treats dHash pairs, including horizontally
  mirrored ones, as same-group links. These pairs are marked `auto_linked` and
  are not pending review. Grouping is conservative, not proof of identity.

Pinned images are never merged with added images by similarity; a similar
added image must take the pinned image's split. Added rows that cannot
(train-only rows linked to a pinned val/test image, or links to several pinned
splits) become `quarantined_pinned_split_link`. Because links are transitive,
one false dHash match can force a whole group, so check `pinned_split_links` in
`audit_after.json`. The gallery lists these pinned links (not the many
auto-linked pairs between added images); a `distinct` similar-pair review
removes the link. `external.review.json` holds every decision for the current
archives (see [CURATION.md](CURATION.md)); `satayu.review.json` is its subset
that touches only Thai Motorcycle IDs. After a review, prepare all sources
together (the Thai source is `authoritative`, not pinned, so links to the other
sources group it correctly), then pin the Thai-only snapshot to that run so both
share one Thai test split:

```powershell
uv run --project apps/vision-api --no-sync python tools/yolo-training/classification/prepare.py --config tools/yolo-training/classification/config.external.json --review tools/yolo-training/classification/external.review.json
# set pinned_splits in config.json to the run printed above, then:
uv run --project apps/vision-api --no-sync python tools/yolo-training/classification/prepare.py --config tools/yolo-training/classification/config.json --review tools/yolo-training/classification/satayu.review.json
```

Pinning the Thai source first would not work: its own run cannot see links to
the other sources, so one other-source group can link two of its splits.

Evaluation reports of a multi-source snapshot add `by_source` metrics.

The archive declares CC BY 4.0 and a Roboflow workspace credit. This is recorded
as source metadata, not an independent verification of rights to every image.
Original READMEs, source URL, license URL and transformation credits accompany
every run. Keep data, crops, reviews and outputs private and out of Git.

## Focused checks

```powershell
uv run --project apps/vision-api --no-sync python -m unittest discover -s tools/yolo-training/classification/tests -v
uv run --project apps/vision-api --no-sync ruff check tools/yolo-training/classification
```

Checks use synthetic archives, not private source images. Training checks also
run tiny synthetic ResNet18 epochs without downloading pretrained weights.
`test_curation.py` skips its probe/cleanlab checks in the API environment; run
it fully in the curation environment:

```powershell
uv run --project tools/yolo-training/classification/curation --no-sync python tools/yolo-training/classification/tests/test_curation.py -v
```

For the offline button/file workflow, using Node 22+ and the installed Edge:

```powershell
node tools/yolo-training/classification/tests/test_gallery.mjs
```

This creates a tiny synthetic dataset in a temporary folder and uses a hidden
headless browser. Set `PARKMAP_TEST_BROWSER` and `PARKMAP_TEST_PYTHON` for other
local Chromium/Python paths. It checks real DOM clicks, correction/exclusion
validation, valid pipeline-compatible JSON, grouping/pairs, cancellation/retry,
and an actual download. The native OS file-picker boundary is replaced by a
controlled file-handle adapter; its dialog/permission flow still needs a manual
check. No test decision is written to the actual motorcycle dataset.
# Review an additional HONDA 2 source

Open `prepared/review-honda2/index.html` locally after generating it. This is a
separate provisional review workspace, not a training snapshot. It does not
change `prepared/latest.json`, existing reviews, or `training.json`.

```powershell
apps\vision-api\.venv\Scripts\python.exe tools/yolo-training/classification/prepare_review.py --archive "C:\Users\user\Downloads\HONDA 2.v2i.yolov8.zip"
```

For a separate Python environment (including Colab), install
`requirements-review.txt`. Source policies are explicit in `honda2.review.json`;
the original ZIP remains unchanged. Polygon annotations are cropped using their
enclosing rectangle at native resolution, with no extra stretching. Existing
stretch in the source export cannot be undone.

- **N** confirms the displayed selected family and moves forward; **M** excludes
  the annotation and moves forward. Arrow keys navigate without a decision.
- Ambiguous source names start with a blank selection. Choose a known family
  before N; exclude a picture if you cannot identify it. Candidate names in the
  config are suggestions only, never automatic alias corrections.
- N/M retain decisions in page memory. Click the save button explicitly to save
  **review-honda2.json** before closing. Import that file to resume later.
- To rebuild with saved decisions, repeat the command with
  `--review "C:\path\review-honda2.json"`. Immutable fingerprinted workspaces
  preserve earlier versions; repeated identical input reuses the same output.
- Exact duplicates and filename-derived augmentation relationships are grouped
  conservatively, without dropping any annotation. Inspect source images and
  similar-image pairs too. Filename groups do not prove physical vehicle identity.

No train/val/test folders are created here. After human review, a separate merge
must reconcile labels and duplicates against the existing dataset before new
splits or training. Model-family accuracy, unrecognized same-vehicle views,
source image rights, and heuristic similar pairs remain unverified.

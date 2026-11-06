# Dataset curation log (handoff to modeling)

Scope: find data, EDA, audit and split the motorcycle **model-family** dataset, then
hand a verified snapshot to the teammate who chooses and trains models. Curation
never trains a classifier, never changes the immutable snapshot, and never edits
labels/groups automatically. Every finding is a candidate for a human decision.

## 1. Tools installed and why

A separate locked environment, `curation/pyproject.toml` + `curation/uv.lock`
(Python 3.12). It is separate from `apps/vision-api` because FiftyOne needs
Pillow >= 12.2 while the API pins Pillow < 12.

| tool | version | license | used for |
|---|---|---|---|
| FiftyOne + FiftyOne Brain | 1.22.1 / 0.25.0 | Apache-2.0 | visual browsing, embedding map (UMAP), filtering by audit tag |
| CleanVision | 0.3.7 | Apache-2.0 | image-quality flags: dark, light, blurry, low information, grayscale, odd aspect ratio |
| cleanlab | 2.9.0 | Apache-2.0 | confident-learning ranking of suspected label errors |
| DINOv2 small (`facebook/dinov2-small`, revision `ed25f3a`) | via Transformers 5.22.1 | Apache-2.0 | frozen image embeddings for near-duplicate and label audits |
| scikit-learn, umap-learn | 1.9.1, 0.5.12 | BSD-3-Clause, BSD | group-aware cross-validation probe, 2D map |
| FiftyOne MCP server + 4 FiftyOne skills | 0.1.16 | Apache-2.0 | let Claude Code query the FiftyOne dataset in a later session |

Not installed: **fastdup** (non-commercial license, no Windows support). FiftyOne
and the embedding pass cover the same near-duplicate work. Telemetry is disabled
with `FIFTYONE_DO_NOT_TRACK=true`.

Setup on another machine (Windows PowerShell, from the repository root):

```powershell
uv sync --project tools/yolo-training/classification/curation --locked
```

## 2. What the audit does

`curate.py` reads a prepared run (default `prepared/run-c2809f621c207077a0a7`)
and the handoff class list in `training.top10-external.json`:

1. **Integrity**: the same `validate_run` check training uses (file hashes,
   manifest/crop alignment, known exact-image and group leakage).
2. **EDA**: crops and known groups per class/source/split, crop-size quantiles,
   crops under 64 px, Roboflow pre-augmented copies. For handoff classes and,
   as an appendix, every snapshot class.
3. **Image quality** with CleanVision.
4. **Embeddings**: each whole crop is letterboxed to 224 px (no stretching or
   center crop) and encoded by frozen DINOv2; vectors are L2-normalized.
5. **Cross-split near duplicates**: crop pairs in different splits whose cosine
   reaches a calibrated threshold, plus unreviewed dHash pairs from preparation
   whose crops sit in different splits. The default threshold is the p99.9 of
   each crop's most similar crop of **another class** (rounded up), so at most
   about 1 in 1000 matches is a different model. It is reported next to the
   similarity of known Roboflow augmented copies of one photo.
   `--near-duplicate-threshold` overrides it.
6. **Suspected labels**: a logistic-regression probe on the frozen embeddings,
   5-fold `StratifiedGroupKFold` by source photo (Roboflow copies of one photo
   share a fold), so a crop is never scored by a probe that saw its own photo.
   cleanlab ranks crops whose given label is unlikely. This is an audit signal,
   not a classifier for handoff.

Outputs (ignored by Git, `runs/curation-<UTC>-<id>/`): `AUDIT.md`, `audit.json`
(options, versions, seed, thresholds, limitations), `queue.json`, `review.html`,
`embeddings.npy` + `embedding_rows.json`.

```powershell
uv run --project tools/yolo-training/classification/curation --no-sync python tools/yolo-training/classification/curate.py
```

## 3. Results

### Current handoff: run-c2809f621c207077a0a7

Two review rounds on 2026-11-06 are applied (`external.review.json`: 344
same-vehicle groups, 425 similar-pair decisions, 49 annotation decisions; 9
satayu crops excluded). All sources were re-split together as in section 5, and
the satayu-only snapshot `run-b3119d538da84aefcf5b` (`training.top10.json`) is
pinned to it: every satayu crop has the same split in both. Integrity and
leakage checks pass (0 known cross-split groups, images or crops).

| split | crops (10 classes) | satayu crops | known groups |
|---|---:|---:|---:|
| train | 8463 | 677 | 1091 |
| val | 182 | 129 | 136 |
| test | 185 | 136 | 141 |

- satayu is close to its own 70/15/15. External val/test now hold only crops
  from the sources' original valid/test splits (arfah 53 / 49); the earlier
  snapshots had more because pre-augmented train crops counted toward the
  ratios.
- Smallest satayu val/test classes: nmax 4 / 3 (val/test crops in total
  14 / 15 with arfah), xmax 5 / 5, super_cub 7 / 7. Per-class val/test metrics
  for these are noisy.
- Test splits differ from every earlier snapshot, so earlier test scores are
  not comparable.

Audit `runs/curation-20261106T042612Z-4ca1ba82` (seed 20261105, "satayu" is
`thai-motorcycle-v1-top1k`): 36 cross-split embedding pairs (20 already decided
D in earlier rounds, 16 new), 8 pending cross-split dHash pairs (6 queued
separately, the rest overlap embedding pairs), 21 suspected labels (4 without an
earlier decision), 4 quality flags (kept earlier). The new pairs come from the
reshuffle (section 5). Probe out-of-fold top-1 0.980.

### Baseline before review: run-b59a0ba61dc9f30406a3

Audit run `runs/curation-20261105T111401Z-b05d5ef2` (2026-11-05, seed 20261105,
DINOv2 on Apple MPS). Integrity check passed; snapshot status `provisional`.
This snapshot and its audit were deleted after the review; the numbers below are
kept for comparison.

**Dataset (10 handoff classes, 8840 crops)**

| split | crops | known groups |
|---|---:|---:|
| train | 8214 | 1008 |
| val | 314 | 271 |
| test | 312 | 271 |

- Source names: "satayu" is `thai-motorcycle-v1-top1k` (splits pinned), "arfah" is
  `arfah-merk-dan-warna-motor-v19`.
- Imbalance: click 2966, aerox 2149, nmax 2060 train crops, almost all from
  arfah; fino 48, grand_filano 33, super_cub 32, xmax 25 come only from
  `thai-motorcycle-v1-top1k`.
- 6187 of arfah's 6751 train crops are Roboflow pre-augmented copies, so the
  number of distinct photos is far lower than the crop count.
- 52 `thai-motorcycle-v1-top1k` crops have a side under 64 px; external sources
  have none.

**Findings for human review**

| finding | count | notes |
|---|---:|---|
| cross-split embedding pairs (cosine >= 0.95) | 352 | 351 share a class |
| pending cross-split dHash pairs | 39 | from preparation, not yet reviewed |
| suspected labels (cleanlab) | 31 | 23 satayu, 8 arfah; 24 train, 4 val, 3 test |
| image-quality flags | 11 | all `odd_aspect_ratio` |

Embedding pairs by source and split: arfah test/train 116, arfah train/val 71,
arfah test/val 49, satayu train/val 41, satayu test/train 34, arfah train /
satayu test 17, satayu test/val 11, arfah val / satayu train 7, arfah train /
satayu val 3, three more combinations with 1 each.

**What this means for the handoff**

- arfah's own val/test overlap its train, and arfah train contains near
  duplicates of satayu val/test. Validation and test scores on this snapshot can
  be optimistic until these pairs are reviewed. Example: an exploratory training
  run on this snapshot (HF job, top10-external, 20 epochs) reached val macro F1
  0.952 / top-1 0.965 at epoch 4; treat that as an upper bound, and its test split
  was not evaluated.
- Calibration: DINOv2 cannot separate augmented copies of one photo from
  different bikes. Known copy pairs have median cosine 0.728 (p25 0.632), while
  each crop's most similar other-class crop has median 0.848 (p99.9 0.949). The
  0.95 threshold keeps different-class matches rare, so the pair queue is a
  **lower bound** on duplicates, not a full list.
- Probe out-of-fold top-1 is 0.980 (audit signal only).

**Lesson from the first attempt** (superseded run, deleted): a fixed 0.90 threshold and probe folds by preparation `group_id`
gave 8813 pairs and 2258 label flags, almost all arfah. arfah's grouping rules
put 5054 of its 6751 train crops in one group, so the probe held out the whole
arfah domain and flagged it as mislabeled. Folding by source photo and
calibrating the threshold removed that artifact.

## 4. How to review (human step)

Open `runs/curation-.../review.html` in a browser (offline; it reads crops from
the snapshot through relative links, so keep the folders in place).

- Tabs: **รูปซ้ำข้าม split**, **label น่าสงสัย**, **คุณภาพรูป**, each with a
  remaining/total counter and an "undecided only" filter.
- Pairs: **S** same vehicle (must share a split), **D** different vehicles,
  **U** uncertain. Same model in a similar pose is still **D**.
- Labels: **K** label is correct, **A** accept the suggested class, **X** exclude,
  or choose another class from the dropdown. The page shows the most similar
  crops of both classes from other photos for comparison.
- Quality: **K** keep, **X** exclude only if the model cannot be recognized.
- Arrow keys move between items. A blank reason uses a Thai default reason.
- Decisions autosave in that browser. **Export decisions log** backs them up or
  moves them to another machine (**นำเข้า log**).
- **Export review.json**: first choose the base review (`external.review.json`),
  so earlier decisions are kept. The export is in the schema `prepare.py --review`
  accepts (tested against `prepare.load_review`).

Optional visual exploration for presentations:

```powershell
uv run --project tools/yolo-training/classification/curation --no-sync python tools/yolo-training/classification/curate_browse.py "tools/yolo-training/classification/runs/curation-..."
```

This opens the FiftyOne App with every audited crop tagged by split and audit
flag, and an embedding map (brain key `dinov2_umap`) colored by class. The
first launch computes UMAP once (18 to 40 minutes for 8840 crops on an M-series
Mac) and caches it as `umap_points.npy` in the audit folder; later launches reuse
it and load in under a minute.

## 5. Applying decisions

Save the exported file over `external.review.json` (keep the old one in Git
history), regenerate `satayu.review.json` (its decisions whose IDs are all
satayu) and rerun preparation as in README "Extra sources with pinned splits".
Preparation creates a **new** snapshot with a new fingerprint; the old one is not
modified. Then rerun `curate.py` on it and update the training configs' `dataset`
to the new run.

**Order**: all sources are prepared together first, unpinned, so same-vehicle
links between satayu and the external sources group them before splitting.
satayu is `authoritative`: its copy wins an exact duplicate across sources, and
an external copy with different labels is quarantined. External train-only
(pre-augmented) groups stay in train outside the 70/15/15 ratios, so satayu keeps
close to 70/15/15 of its own crops. The satayu-only snapshot (`config.json`) is
then pinned to that combined run, so models trained on satayu alone and on all
sources share one satayu test split.

The reverse order (re-split satayu alone, then pin the combined run to it) fails:
satayu alone cannot see links through external photos, so one external group can
join satayu crops in two splits.

**Each re-split reshuffles satayu.** Merging one group changes the greedy
assignment of many others, so test scores are comparable only between models
trained on the same run. A reshuffle can also put a near-duplicate pair that was
in one split into two splits; the next audit queues it.

## 6. Limitations

- A high embedding or dHash similarity does not prove the same physical vehicle.
- The probe also flags crops whose source style differs; a flag is not proof of
  a wrong label. Probe top-1 is not classifier accuracy.
- Counts are crops (annotation boxes), not distinct motorcycles.
- Public-image results do not establish accuracy on the ParkMap camera.

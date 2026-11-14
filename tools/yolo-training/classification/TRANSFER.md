# Incoming-only transfer from the first motorcycle classifier

This experiment starts from the first ParkMap classifier `best.pt`, not from
ImageNet and not from the second classifier. It updates only the classification
head, retaining the backbone and its BatchNorm statistics as in the prior runs.
The 46 output units and their order are retained. HONDA 2 supplies training examples
for nine classes; the other 37 have no new positive training examples and can be
forgotten. This is an experiment, not a replacement of either existing model.

The combined round-two split cannot be used directly for transfer evaluation:
some of its validation images belonged to the first model's training split.
`prepare_transfer.py` keeps the original parent's val/test roles and takes only
the incoming source from the combined snapshot. It unions known image/crop hashes
and source groups across both full inputs, including the parent's training history,
and refuses cross-role groups. Only an original parent snapshot is supported;
chaining transfer snapshots requires accumulated historical exposure handling.

For the current files the new immutable snapshot is
`prepared/transfer-honda2/run-2e715c42361e3d88dc94`:

- Train: 134 confirmed HONDA 2 crops only.
- Validation: 222 original-parent crops plus 29 HONDA 2 crops (251 total).
- Test: 220 original-parent crops plus 27 HONDA 2 crops (247 total), not evaluated.
- Known hash/group leakage and parent-history role conflicts: zero.
- 308 heuristic near-image pairs remain pending, including 151 across exposure
  roles. Counts include historical training images; they are not proof of identity.

Prepare reproducibly from the repository root:

```powershell
apps\vision-api\.venv\Scripts\python.exe tools/yolo-training/classification/prepare_transfer.py --parent tools/yolo-training/classification/prepared/run-4cb0b6637def7634bde2 --incoming tools/yolo-training/classification/prepared/combined-honda2/run-a38f82ba9eebc8f5b871 --checkpoint tools/yolo-training/classification/runs/train-20261102T055712Z-00fecda9/best.pt --source honda2-v2 --output tools/yolo-training/classification/prepared/transfer-honda2
```

Run the transfer experiment (append `--validate-only` to check without Torch or training):

```powershell
apps\vision-api\.venv\Scripts\python.exe tools/yolo-training/classification/train.py --config tools/yolo-training/classification/training.honda2.json --dataset tools/yolo-training/classification/prepared/transfer-honda2/run-2e715c42361e3d88dc94 --warm-start tools/yolo-training/classification/runs/train-20261102T055712Z-00fecda9/best.pt --epochs 50 --patience 8 --learning-rate 0.0001
```

`--warm-start` requires the snapshot's hash-verified parent classifier, matching
class order, preprocessing, image size and parent dataset identity. It starts a
new optimizer; it is not an exact interrupted-training resume. Without the parent,
missing training classes remain an error. Other cold-start configs are unchanged.

The run first saves predictions and metrics under `initial_val/`, before any
updates. Epoch 0 is eligible as the best checkpoint, so `best_epoch=0` means the
unchanged parent was retained. Maximum epochs is 50; patience 8 stops after eight
epochs without strictly better validation Macro F1. Ties count toward patience;
checkpoint ties use lower validation loss. `last.pt` preserves the last actually
updated weights even when the parent remains `best.pt`. Run metadata records the
parent SHA, stopping decision, completed epochs and initial metrics. Existing
checkpoints are never overwritten and no weights are downloaded for warm starts.

Compare `initial_val` and final `val` on identical annotations, including per-source
and per-class results to detect forgetting. Validation is used for model selection,
not an independent test. Data remains provisional; unknown different-angle vehicle
identity, unreviewed near-duplicate relationships, source stretch and real-camera
generalization remain limitations. No physical dimensions or parking availability
are inferred. Training is terminal-only; uploads and LIFF behavior do not change.

## Recorded local experiment

Run `runs/train-20261102T115156Z-1ec5130e` completed eight update epochs and stopped
on patience. The original 222 validation predictions before updates exactly
matched the parent's saved predictions (zero disagreements), and the parent
checkpoint hash remained unchanged.

- On the same 251 validation crops: 163 correct before updates, 124 at the last
  update; Macro F1 0.581607 to 0.214520.
- Original validation: 150/222 before, 101/222 after the last update.
- HONDA 2 validation: 13/29 before, 23/29 after the last update; this subset
  supports only six classes, so it does not establish coverage of all nine trained
  incoming classes.
- The original 37 families absent from new training fell from 62/109 to 13/109
  correct on their original validation crops.

The initial parent remains the selected `best.pt` (`best_epoch=0`). Actual updated
weights are in `last.pt`; their validation predictions/metrics are recorded under
`last_val/`. `transfer-comparison.json` contains the before/after subgroup counts.
No test-set evaluation was run. These observations indicate specialization and
forgetting for this specific head-only setup, not that every transfer strategy
fails. A replay experiment should retain old training examples and preserve both
sources' held-out identities.

## Replay experiment

`prepare_transfer.py --replay` adds the original parent's training crops back once,
without oversampling. The current replay snapshot is
`prepared/replay-honda2/run-78d89431d9ccbc234b0d`: 1,019 original training crops plus
134 HONDA 2 training crops, 251 validation crops, and 247 untouched test crops.
All 498 held-out annotation IDs, class labels and crop pixel hashes match the
incoming-only experiment. Source files and previous models are preserved.

```powershell
apps\vision-api\.venv\Scripts\python.exe tools/yolo-training/classification/prepare_transfer.py --parent tools/yolo-training/classification/prepared/run-4cb0b6637def7634bde2 --incoming tools/yolo-training/classification/prepared/combined-honda2/run-a38f82ba9eebc8f5b871 --checkpoint tools/yolo-training/classification/runs/train-20261102T055712Z-00fecda9/best.pt --source honda2-v2 --replay --output tools/yolo-training/classification/prepared/replay-honda2
```

Start again from the first model, not the degraded incoming-only `last.pt`. Keep
the same learning rate, seed, augmentations, batch size, frozen backbone and stopping
policy so that replay data is the intended difference:

```powershell
apps\vision-api\.venv\Scripts\python.exe tools/yolo-training/classification/train.py --config tools/yolo-training/classification/training.honda2.json --dataset tools/yolo-training/classification/prepared/replay-honda2/run-78d89431d9ccbc234b0d --warm-start tools/yolo-training/classification/runs/train-20261102T055712Z-00fecda9/best.pt --epochs 50 --patience 8 --learning-rate 0.0001
```

The CLI verifies snapshot hashes and the parent checkpoint before training. New
code/reviews produce a new snapshot fingerprint; inspect its audit and update the
explicit pin deliberately. Do not evaluate either test split while tuning replay.

### Recorded replay result

Run `runs/train-20261102T122913Z-d6c7baaa` stopped after 30 update epochs, selecting
epoch 22 by validation Macro F1. Its initial predictions matched the incoming-only
experiment's initial predictions on all 251 validation annotations.

- Identical combined validation: 163/251 to 182/251 correct (64.94% to 72.51%);
  Macro F1 0.581607 to 0.639468.
- Original validation: 150/222 to 158/222 correct (67.57% to 71.17%).
- HONDA 2 validation: 13/29 to 24/29 correct (44.83% to 82.76%).
- The original 37 families without HONDA 2 training examples: 62/109 to 64/109
  correct; they were replayed in this experiment.

`best.pt` is the selected epoch-22 replay classifier; `last.pt` is epoch 30.
`replay-comparison.json` stores subgroup counts and `val/` stores predictions,
metrics and the confusion matrix. Parent weights were hash-verified unchanged.
The result improves both source subsets in this validation experiment, but the
HONDA subset has only 29 crops in six supported classes, and validation was used
for selection. No held-out test was evaluated and no production accuracy is claimed.

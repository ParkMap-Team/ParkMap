# Vision model evaluation

## Issue #5: fine-tuned detector acceptance

Compare the fine-tuned detector with the baseline from issue #4 on the same held-out test set from the planned Sripatum camera angle. Report the test sample size, precision, recall, and missed annotated motorcycles whose ground point lies within the calibrated `Parking ROI`. These misses are a conservative proxy for detections that could affect an `AVAILABLE` result. On the same test frames, the fine-tuned model passes only if this miss count does not increase and at least one outcome improves: fewer such misses, higher precision, or higher recall. A precision gain with more misses in the `Parking ROI` is insufficient.

Issue #7 separately measures the published state's false-green rate in the real lot during M3. It does not replace the held-out comparison for issue #5.

Report results separately for rain, low light, and dense parking. Do not release the new weights if the missed-motorcycle count within the `Parking ROI` increases against the baseline in any tested condition, even if the aggregate gate passes. If the locked test set lacks any of these conditions, keep the current weights and collect independent clips for the missing condition. Label and lock those clips as additional held-out test evidence before using them to decide a release. A condition without test evidence is unverified and must not be reported as passing.

Issue #4 defines and locks the held-out test set before training for issue #5 begins. Split by whole clip or recording session, so adjacent frames from one recording cannot appear in both training and test sets. The owner of issue #4 and issue #5 must agree on annotation and detection matching rules before either model is evaluated.

Select the model confidence and NMS IoU thresholds using a validation set separate from training and the locked test set. Record and freeze the chosen thresholds before evaluating the held-out test set.

Published `analysis_version` values identify both the parking-analysis revision and a fingerprint of the deployed weights and inference settings, including confidence and NMS IoU. See [ADR 0003](adr/0003-fingerprint-published-analysis-configuration.md).

## M2 model release

For the single worker machine, transfer weights through a private channel controlled by the team, outside Git. Verify the file's SHA-256 checksum on the worker machine, keep a versioned filename, update `PARKMAP_MODEL_PATH` to that file, and restart the worker. Keep the previous weights and settings available for rollback. This is a manual release process for M2.

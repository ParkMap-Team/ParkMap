# Detector evaluation protocol

Shared by the #4 baseline and the #5 fine-tune so both are measured the same way. Stand-in results never count as real-lot accuracy (ADR 0004).

## Annotation

- Every visible motorcycle gets an axis-aligned box, including partly hidden ones.
- Real-angle frames also get a ground point, the wheel-ground contact nearest the camera, and an `occluded` flag. Stand-in frames need boxes only, because they have no calibrated Parking ROI.
- Instance masks or oriented boxes wait for the free-space evidence method decision (roadmap); they are added to existing boxes, not a relabel.

## M1 stand-in baseline (#4)

- Evaluate the current weights on about 150 to 300 images from a public dataset of dense, partly occluded parked motorcycles that was not used to train them. Record the dataset, its licence, and the image count.
- The current `models/best.pt` (SHA-256 `e80f9dacb525398cff8b739a16ecabf0dd32ecc6a916749818d3bec66b620633`) is COCO-pretrained YOLO11n fine-tuned on 27 Sep 2026 for 150 epochs at 960 px on team photos of the Sripatum lot: 5 training and 2 validation images. Its own validation precision (0.79) and recall (0.70) come from 2 images and are not a baseline. The evaluation set must not contain COCO images.
- The real-angle photos in `apps/vision-api/test-data/auto-parking/` likely overlap those training photos, so they are a qualitative sanity check of failure cases only, with no metrics (ADR 0004).

## Real-angle split (#4, then #5)

- A recording session is one visit on one day in one time block. Every session belongs to exactly one of train, validation, or test, and the test set is locked before any #5 training.
- Starting targets: the test set has at least two sessions on different days, covering morning and afternoon and at least one dense session; frames are sampled about every 5 seconds to avoid near-duplicates; the test set has at least 300 labelled motorcycles.
- These targets may be adjusted to the time the team can spend in the lot, which depends on when it becomes accessible. Any change and its reason go in the results note, and the session rule does not change.
- Rain, low light, and dense parking are counted separately as #5 requires; a condition without a test session is unverified.

## Tooling and storage

- Labelling uses Label Studio self-hosted on the team's Coolify, with one account per member. Images, labels, and exports stay there and out of Git and issues.
- Real-angle footage is uploaded only after #16 permits it, and its access and deletion follow #16.

## Matching

- Class `motorcycle` only. Predictions are matched greedily in descending confidence to the unmatched annotation with the highest IoU, counting a match at IoU ≥ 0.5.
- Precision and recall are reported with the sample size and the confidence and NMS IoU used.
- A Parking ROI miss is an unmatched annotation whose ground point lies inside the calibrated Parking ROI. Occluded annotations are reported separately as well as in the totals.

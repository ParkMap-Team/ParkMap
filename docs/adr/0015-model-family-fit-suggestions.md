# 0015: Model-family fit suggestions

Status: proposed, 2026-11-02. Amends ADR 0014 (classifier predictions may now feed
an advisory LIFF layer) and CONTEXT target-flow item 4. Builds on ADR 0004.

ParkMap is also the team's machine-learning course project, which requires
classification as a core component. The motorcycle-family classifier from ADR 0014
therefore gets a product role: for each candidate space, suggest which motorcycle
families fit.

## Decision

The suggestion is attached to the candidate space, not to a student. LIFF shows,
for example, "fits: click, wave, scoopy · uncertain: pcx". The student finds their
own family. No entrance camera, plate handoff or student vehicle identity is
needed, so the unresolved entrance-to-student matching in CONTEXT stays out of
scope.

Python owns the pipeline. LIFF only renders the result.

1. The YOLO detector finds parked motorcycles as it does today.
2. The classifier ranks the family of each native crop. Scores are calibrated on
   the validation split with temperature scaling before they drive any decision.
3. A documented table maps each family to nominal dimensions: length and width
   from manufacturer specifications, with the source recorded. Where a family has
   several variants, the table uses the largest. The table is a separate
   deliverable and does not exist yet.
4. A prediction below the rejection threshold, chosen on validation data, uses
   the largest nominal dimensions of any family, or the standard footprint if
   that is larger. A missing or unavailable classifier does the same.
5. Each parked motorcycle's footprint is placed on the ground plane with the
   existing homography. Gaps along a virtual row are measured in metres with
   their propagated uncertainty.
6. Each family gets one of three verdicts for each gap:
   - `FITS` when the gap minus its uncertainty is at least that family's width
     plus clearance.
   - `DOES_NOT_FIT` when the gap plus its uncertainty is smaller than that.
   - `UNCERTAIN` otherwise.

## Safety rules

- Family fit is a separate advisory field. It never changes `AVAILABLE`,
  `ALMOST_AVAILABLE`, `UNKNOWN` or `UNMONITORED`.
- Availability keeps using the documented standard footprint until per-family
  footprints are validated against the locked proxy reference set (CONTEXT,
  Motorcycle proxy).
- Only `AVAILABLE` candidate spaces carry fit suggestions. A gap bounded by
  occluded, stale, uncalibrated or `UNKNOWN` evidence carries none. Empty space
  is never inferred behind an occlusion.
- Under estimated calibration, every verdict carries `ESTIMATED` provenance.
  LIFF labels it as a demo estimate, never as a measurement.
- Suggestions are closed-set. A family absent from the table is never claimed to
  fit, and LIFF says so.

## Evaluation

The project reports these classifier metrics:

- accuracy, macro-F1, top-3 accuracy and the confusion matrix
- expected calibration error before and after temperature scaling
- the rejection rate at the chosen threshold

Public-dataset crops and real-angle crops from the Sripatum camera are evaluated
and reported separately. Only real-angle results describe the real lot (ADR 0004).
The real-angle test set is labelled in the Label workspace, which needs a
per-box family field for this. Real-angle crops never enter training data used
for that test.

An ablation compares fit verdicts made with the standard footprint for every
motorcycle against verdicts made with classified nominal dimensions. Both are
scored against gaps measured by hand on reference images. A `FITS` verdict for a
gap that cannot hold the family is reported as the costliest error, the
counterpart of a false green.

## Rejected

- **Identifying the student's motorcycle at the entrance**: plate or vehicle
  handoff to a LIFF user is unresolved.
- **The student selecting their family as the only input**: it removes the
  classification component the course requires. It may later serve as a LIFF
  filter over the same suggestions.
- **Raw softmax scores as confidence**: they are not calibrated.
- **Brand or family name alone as a dimension**: CONTEXT records that it cannot
  establish physical size without a sourced specification table.

## Consequences

The following are follow-up work, each with focused tests:

- the specification table
- a Label family field
- backend gap measurement and verdicts
- an API schema field
- LIFF rendering

Until they exist, LIFF shows no family suggestions.

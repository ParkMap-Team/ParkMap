# Detector baseline, phase 1 (stand-in data)

Results for #4 phase 1, measured on 5 Oct 2026 under `docs/detector-evaluation-protocol.md`. **These are stand-in results on public images, not accuracy in the Sripatum lot (ADR 0004).** The real-angle baseline is phase 2.

## Setup

- Script: `apps/vision-api/scripts/evaluate_detector.py`, greedy matching at IoU ≥ 0.5, class motorcycle only.
- Inference: 960 px, confidence 0.25, NMS IoU 0.5, CPU.
- Models:
  - **ParkMap weights** `best.pt` (SHA-256 `e80f9dac…620633`): YOLO11n fine-tuned on 5 Sripatum photos (2 validation), model class 0.
  - **COCO YOLO11n** `yolo11n.pt` from Ultralytics (SHA-256 `0ebbc80d…644ee1`), model class 3 (`motorcycle`).
- Data: only the valid and test splits, because Roboflow augmented the train splits (flips and rotations duplicate images). Both datasets are CC BY 4.0.
  - **Primary:** [Kepadatan Parkir Motor](https://universe.roboflow.com/skripsi-lcybh/kepadatan-parkir-motor) v9 by Skripsi, 200 images at 640×480, 2,362 annotated motorcycles. Dense, elevated views of parking areas in Indonesia. A sample of labels was complete, including partly hidden motorcycles.
  - **Secondary:** [Deteksi Parkir Motor 4](https://universe.roboflow.com/akhmads-workspace-dqkne/deteksi-parkir-motor-4) v3 by Akhmads Workspace, 305 images stretched to 320×320, 4,395 annotated motorcycles. Fixed CCTV views. Labels miss some back-row and edge motorcycles, so precision here is understated.

## Results

| Model | Set | Frames | TP | FP | FN | Precision | Recall |
|---|---|---|---|---|---|---|---|
| ParkMap `best.pt` | Kepadatan | 200 | 0 | 248 | 2,362 | 0.0% | 0.0% |
| COCO YOLO11n | Kepadatan | 200 | 1,383 | 581 | 979 | 70.4% | 58.6% |
| ParkMap `best.pt` | Deteksi | 305 | 5 | 520 | 4,390 | 1.0% | 0.1% |
| COCO YOLO11n | Deteksi | 305 | 4 | 5 | 4,391 | 44.4% | 0.1% |

## Failure cases

- **ParkMap weights only fit one scale.** Their boxes land on real motorcycles but cover a helmet, seat, or tail, never the whole vehicle, so none reach IoU 0.5. Trained on 5 high, distant photos, the model learned a motorcycle's size from one camera and does not generalize to closer or other views. The pipeline itself works: the same weights find 21 motorcycles in a Sripatum photo.
- **COCO YOLO11n misses about 4 in 10** motorcycles in dense rows, mostly heavily overlapped ones.
- **COCO YOLO11n calls low-resolution scooters "bicycle".** On 20 Deteksi images at 640 px it predicted 112 bicycles and 21 motorcycles, which explains its near-zero Deteksi recall.

## Implications

- The current ParkMap weights must not be relied on beyond their original camera view; a changed demo angle would show almost no detections, and missed motorcycles risk false greens.
- #5 should start from COCO-pretrained weights and train on far more varied scale and viewpoint data than 5 photos, then compare against both rows above.
- If #5 trains on Kepadatan or Deteksi, it uses only their train splits, and these valid and test images stay out of training so this comparison remains valid.
- Deteksi is unreliable as an evaluation set (stretched 320 px images, incomplete labels); use Kepadatan for comparisons.

Not run: the real-angle baseline (phase 2), per-condition results, and Parking ROI misses, which need real footage under the footage policy.

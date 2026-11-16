# Local segmentation primary analysis

In Calibration UI Parking, choose an image, select **YOLO26n Seg · Round 8**,
and press Analyze. A single Seg inference supplies image boxes, masks, physical-map
references and the rectangular gap analysis. The gap check uses the standard
0.66 m reference width plus the operator's lateral clearance margin. Selecting
**YOLO26n Detect · Round 10** displays the detection boxes. Inference time may
include loading on the first request.

Detected image uses the normalized Seg preview with cyan mask polygons and
dashed yellow box fallback when a mask is missing. For videos, use the separate
[capture and detection flow](classifier-parking-experiment.md).

The cyan polygons are normalized image masks of visible motorcycle appearance,
not ground footprints, measurements, recovered occluded shape or empty-space
evidence. A dashed yellow box means detection without a usable mask. Masks are
not projected through the ground homography and never enter classification
crops, parking geometry, reference-size analysis, worker or LIFF. Model outputs
are not paired across detectors simply by their list index.

The default [gap/clearance analysis](segmentation-gaps.md) returns rectangular
width candidates from calibrated reference footprints. It uses
image masks/boxes to withhold potentially occluded ground, not as ground shapes.

For the configured worker or legacy operator API, install the official model
from the repository root:

```powershell
apps/vision-api/.venv/Scripts/python.exe apps/vision-api/scripts/download_segmentation_weights.py
```

It downloads the official Ultralytics v8.4.0 `yolo11m-seg.pt` release asset into
ignored `apps/vision-api/models/yolo11m-seg.pt`, without overwriting existing files.
No HTTP request downloads weights automatically. The detector's `best.pt` is
unchanged. For a manually configured alternative, set these in the API `.env`
and restart the API:

```dotenv
PARKMAP_SEGMENTATION_MODEL_PATH=models/yolo11m-seg.pt
PARKMAP_SEGMENTATION_CLASS_ID=3
# Optional; otherwise uses PARKMAP_MODEL_IMGSZ (default 960).
PARKMAP_SEGMENTATION_IMGSZ=960
```

The official COCO model uses motorcycle class 3, distinct from ParkMap's custom
single-class detector. Loading checks both segmentation task and class name.
Confidence, NMS IoU and device use the existing detector settings. Inference is
serialized per model. Increasing the image size or model complexity adds CPU work.

The existing private `/api/operator/classifier/analyze` endpoint accepts optional
multipart `include_segmentation=true`; default is false. It returns `segmentation`
and `segmentation_error` separately. Upload limits, EXIF normalization, loopback
operator proxy/authentication and no-store handling remain. Missing/failed
segmentation preserves the normal analysis. Uploaded frames/masks stay in memory
and are not persisted or published.

Focused checks cover mask/box identity and class filtering, missing/invalid masks,
missing weights without downloads, opt-in inference, independent results and
failure recovery. The real browser smoke test can additionally require masks:

```powershell
cd tools/calibration-ui
node scripts/test-classifier-ui.mjs http://127.0.0.1:3000 ../../apps/vision-api/test-data/auto-parking/20260925_0931.jpeg yolo11n_cls --segmentation
```

Model/task background: [Ultralytics YOLO11](https://docs.ultralytics.com/models/yolo11/)
and [instance segmentation](https://docs.ultralytics.com/tasks/segment/).

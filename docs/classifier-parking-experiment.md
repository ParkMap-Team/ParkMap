# Test motorcycle-family classifiers in Parking

Start local development with `start-dev.bat`, open Calibration UI at
`http://localhost:3000`, and choose **Parking**. After updating the proxy code,
restart the Calibration UI terminal if it was already running.

1. Choose a JPEG, PNG or WebP with the existing **Choose file** button.
2. Under **จำแนกรุ่นรถ · ทดลอง**, choose the classifier model. The most recent
   completed run is selected initially.
3. Choose a completed model run. The menu shows chronological run number, architecture, run ID
   and best epoch. Incomplete training runs are not listed.
4. Press the main **Analyze** button once. Python runs YOLO once, computes parking
   analysis when configured, then classifies native crops from those same boxes.
5. Click a detection box or crop thumbnail to see the
   corresponding native crop and top-three family scores.
6. Select another model and run the same image again for a visual comparison.

Detection and classification do not require parking calibration. Calibration
failures are reported separately, as are missing or unavailable classifiers;
successful detection results remain visible. Analyze also starts the existing
five-second video-frame workflow with classification for each analyzed frame.
The standalone operator `/predict` API still supports pre-cropped images, while
the Parking UI uses detection followed by classification. A YOLO miss is not evidence that
the image contains no motorcycles. The classifier always ranks known families;
it has no trained unknown class and its softmax scores are not calibrated
certainty. It predicts neither dimensions nor parking availability. Different
training runs can have different validation sets; their validation numbers are
not a controlled comparison.

For a side-by-side image-mask comparison, enable the optional
[YOLO11m-seg experiment](segmentation-experiment.md) before Analyze. It adds
another inference and does not replace classifier crops or parking geometry.

The local [reference-size experiment](motorcycle-reference-sizes.md) maps the
predicted family to editable width/length references. It returns separate local
parking geometry and lets the UI compare it with the standard result. These are
not measured dimensions; worker, persisted states and LIFF retain standard sizes.

New test images should be independent of training, validation and test datasets
if used to assess generalization. Human-confirmed truth is needed to count correct
predictions. No truth labels or evaluation scores are saved by this panel. Use
Label/review as a separate explicit workflow if an image should later join a dataset.

The operator API is `/api/operator/classifier/models`, `/api/operator/classifier/analyze`
and `/api/operator/classifier/predict`. Browser requests pass through `/api/classifier`
on the existing same-origin loopback proxy. It forwards the server-only editor
token; built/public deployments fail closed. The API validates upload size, image
format, dimensions and decoding, normalizes EXIF, and creates metadata-free
previews in memory. No upload or classifier result is written to disk.

Models are discovered under ignored `tools/yolo-training/classification/runs/`.
Supported architectures are ResNet18, EfficientNet-B0 and YOLO11n-cls. All use the recorded
ParkMap letterbox preprocessing, preserving the crop aspect ratio, rather than
the original ImageNet center-crop evaluation recipe.
YOLO11n-cls uses its recorded RGB 0..1 normalization and logits; its softmax scores
are computed once, matching training evaluation. Selecting it changes the crop
classifier, while YOLO detection and parking geometry use the existing pipeline.
They must have `run_state=complete`, evaluation metadata and `best.pt` matching
the hash recorded in `run.json`. No checkpoint paths are accepted from the browser.
Only the latest selected checkpoint is cached in memory; inference runs on CPU.

An opt-in real-browser smoke test is available, requiring an already running
local UI/API, YOLO weights, and at least two completed classifier runs:

```powershell
cd tools/calibration-ui
node scripts/test-classifier-ui.mjs http://127.0.0.1:3000
```

It uses the repository's test image and verifies real model selection, top-three
output, crop rendering, multiple YOLO boxes and clearing results. It does not train
or write labels and is deliberately excluded from ordinary unit tests.

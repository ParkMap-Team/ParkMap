# Test motorcycle-family classifiers in Parking

Start local development with `start-dev.bat`, open Calibration UI at
`http://localhost:3000`, and choose **Parking**. After updating the proxy code,
restart the Calibration UI terminal if it was already running.

1. Choose a JPEG, PNG or WebP with the existing **Choose file** button.
2. Under the camera preview, enable **จำแนกรุ่นรถ · ทดลอง**.
3. Choose a completed model run. The menu shows chronological run number, run ID
   and best epoch. Incomplete training runs are not listed.
4. Choose full image with YOLO, or an already cropped single motorcycle without YOLO.
5. Press **ทดสอบจำแนกรุ่น**. Click a detection box or crop thumbnail to see the
   corresponding native crop and top-three family scores.
6. Select another model and run the same image again for a visual comparison.

This panel does not require parking calibration or the main Analyze action. It
does not automatically classify video frames. A YOLO miss is not evidence that
the image contains no motorcycles. The classifier always ranks known families;
it has no trained unknown class and its softmax scores are not calibrated
certainty. It predicts neither dimensions nor parking availability. Different
training runs can have different validation sets; their validation numbers are
not a controlled comparison.

New test images should be independent of training, validation and test datasets
if used to assess generalization. Human-confirmed truth is needed to count correct
predictions. No truth labels or evaluation scores are saved by this panel. Use
Label/review as a separate explicit workflow if an image should later join a dataset.

The operator API is `/api/operator/classifier/models` and
`/api/operator/classifier/predict`. Browser requests pass through `/api/classifier`
on the existing same-origin loopback proxy. It forwards the server-only editor
token; built/public deployments fail closed. The API validates upload size, image
format, dimensions and decoding, normalizes EXIF, and creates metadata-free
previews in memory. No upload or classifier result is written to disk.

Models are discovered under ignored `tools/yolo-training/classification/runs/`.
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

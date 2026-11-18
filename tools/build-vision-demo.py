"""Build the ParkMap operator image with the configured local best checkpoints."""

import argparse
import subprocess
import sys
from pathlib import Path
from shutil import copyfile
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
API = ROOT / "apps/vision-api"
sys.path.insert(0, str(API))

from app.parking_inference_settings import (
    BOX_WEIGHTS,
    CLASSIFIER_RUNS,
    MODEL_ID,
    SEGMENTATION_WEIGHTS,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", default="parkmap-vision-demo:demo-v1")
    parser.add_argument("--platform", choices=("linux/amd64", "linux/arm64"))
    args = parser.parse_args()

    classifier = CLASSIFIER_RUNS.with_name("runs-class-project") / MODEL_ID / "best.pt"
    if not classifier.is_file():
        classifier = CLASSIFIER_RUNS / MODEL_ID / "best.pt"
    checkpoints = {
        "detect_weight": BOX_WEIGHTS,
        "seg_weight": SEGMENTATION_WEIGHTS,
        "convnext_weight": classifier,
    }
    missing = [
        str(checkpoint)
        for checkpoint in checkpoints.values()
        if not checkpoint.is_file()
    ]
    if missing:
        parser.error("Missing checkpoints:\n" + "\n".join(missing))

    command = [
        "docker",
        "buildx",
        "build",
        "--load",
        "--target",
        "demo",
        "--tag",
        args.tag,
    ]
    if args.platform:
        command.extend(["--platform", args.platform])
    with TemporaryDirectory(prefix="parkmap-demo-weights-") as staging:
        for context, checkpoint in checkpoints.items():
            folder = Path(staging) / context
            folder.mkdir()
            copyfile(checkpoint, folder / "best.pt")
            command.extend(["--build-context", f"{context}={folder}"])
        return subprocess.call([*command, str(API)], cwd=ROOT)


if __name__ == "__main__":
    sys.exit(main())

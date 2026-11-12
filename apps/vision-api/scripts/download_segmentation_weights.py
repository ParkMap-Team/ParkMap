"""Download the fixed official YOLO11m-seg asset for the local comparison."""

import hashlib
from pathlib import Path

import torch

URL = "https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo11m-seg.pt"
DESTINATION = Path(__file__).resolve().parents[1] / "models/yolo11m-seg.pt"


def main():
    if not DESTINATION.exists():
        DESTINATION.parent.mkdir(parents=True, exist_ok=True)
        temporary = DESTINATION.with_suffix(".download")
        torch.hub.download_url_to_file(URL, str(temporary), progress=False)
        temporary.replace(DESTINATION)
    with DESTINATION.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    print(f"Local segmentation weights: {DESTINATION.name}\nSHA256: {digest}")


if __name__ == "__main__":
    main()

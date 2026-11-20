"""Verify the local ParkMap checkpoint; never download or replace weights."""

import hashlib
from pathlib import Path

DESTINATION = Path(__file__).resolve().parents[1] / "models/yolo26n-seg_round-08_best.pt"
EXPECTED_SHA256 = "9f835c67849593cafc423414161d44b8377deaf221348b4929213544715ca1af"


def main():
    if not DESTINATION.is_file():
        raise SystemExit(f"Restore the local YOLO26n Seg Round 8 checkpoint to {DESTINATION}")
    with DESTINATION.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != EXPECTED_SHA256:
        raise SystemExit("Local segmentation checkpoint does not match YOLO26n Seg Round 8")
    print(f"Verified local segmentation weights: {DESTINATION.name}")


if __name__ == "__main__":
    main()

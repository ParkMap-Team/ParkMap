"""Ultralytics YOLO classification architectures (YOLO11, YOLO12, YOLO26) with logits and state-dict checkpoints."""

from pathlib import Path

import torch
from architectures import yolo_asset
from torch import nn

RELEASE_URL = "https://github.com/ultralytics/assets/releases/download/v8.4.0/{asset}.pt"


def official_url(architecture):
    return RELEASE_URL.format(asset=yolo_asset(architecture))


def initial_weights_path(directory, architecture="yolo11n_cls"):
    return Path(directory) / "checkpoints" / f"{yolo_asset(architecture)}-imagenet-state.pth"


def prepare_pretrained(directory, architecture="yolo11n_cls"):
    """Convert only the fixed official release asset; never unpickle user uploads."""
    from ultralytics import YOLO

    destination = initial_weights_path(directory, architecture)
    if not destination.exists():
        destination.parent.mkdir(parents=True, exist_ok=True)
        original = destination.with_name(f"{yolo_asset(architecture)}.pt")
        if not original.exists():
            temporary = original.with_suffix(".download")
            torch.hub.download_url_to_file(official_url(architecture), str(temporary), progress=False)
            temporary.replace(original)
        network = YOLO(str(original), task="classify").model.float()
        temporary = destination.with_suffix(".tmp")
        torch.save(network.state_dict(), temporary)
        temporary.replace(destination)
    return destination


class YoloClassifier(nn.Module):
    def __init__(self, architecture, classes, fine_tune=False, initial_weights=None):
        super().__init__()
        from ultralytics.nn.tasks import ClassificationModel

        self.network = ClassificationModel(f"{yolo_asset(architecture)}.yaml", nc=1000, verbose=False)
        if initial_weights:
            self.network.load_state_dict(torch.load(initial_weights, map_location="cpu", weights_only=True), strict=True)
        for parameter in self.network.parameters():
            parameter.requires_grad = fine_tune
        head = self.network.model[-1]
        head.linear = nn.Linear(head.linear.in_features, len(classes))

    @property
    def classifier(self):
        # Train the final linear layer only; keep the head convolution/BN frozen too.
        return self.network.model[-1].linear

    def forward(self, images):
        output = self.network(images)
        return output[1] if isinstance(output, tuple) else output

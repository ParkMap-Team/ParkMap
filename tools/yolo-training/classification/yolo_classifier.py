"""YOLO11n classification architecture with logits and state-dict checkpoints."""

from pathlib import Path

import torch
from torch import nn

OFFICIAL_URL = "https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo11n-cls.pt"


def initial_weights_path(directory):
    return Path(directory) / "checkpoints" / "yolo11n-cls-imagenet-state.pth"


def prepare_pretrained(directory):
    """Convert only the fixed official release asset; never unpickle user uploads."""
    from ultralytics import YOLO

    destination = initial_weights_path(directory)
    if not destination.exists():
        destination.parent.mkdir(parents=True, exist_ok=True)
        original = destination.with_name("yolo11n-cls.pt")
        if not original.exists():
            temporary = original.with_suffix(".download")
            torch.hub.download_url_to_file(OFFICIAL_URL, str(temporary), progress=False)
            temporary.replace(original)
        network = YOLO(str(original), task="classify").model.float()
        temporary = destination.with_suffix(".tmp")
        torch.save(network.state_dict(), temporary)
        temporary.replace(destination)
    return destination


class YoloClassifier(nn.Module):
    def __init__(self, classes, fine_tune=False, initial_weights=None):
        super().__init__()
        from ultralytics.nn.tasks import ClassificationModel

        self.network = ClassificationModel("yolo11n-cls.yaml", nc=1000, verbose=False)
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

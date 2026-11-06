"""Supported classifier architectures. Torch-free, so validating a config never imports PyTorch."""

import re

TORCHVISION = ("resnet18", "efficientnet_b0", "mobilenet_v3_large", "convnext_tiny")
YOLO_PATTERN = re.compile(r"yolo(11|12|26)([nsmlx])_cls")
# Ultralytics publishes ImageNet classification weights for YOLO11 and YOLO26 but none for YOLO12.
YOLO_WITHOUT_PRETRAINED = {"12"}
SUPPORTED_TEXT = "resnet18, efficientnet_b0, mobilenet_v3_large, convnext_tiny or yolo<11|12|26><n|s|m|l|x>_cls"


def is_yolo(architecture):
    return bool(YOLO_PATTERN.fullmatch(str(architecture)))


def is_supported(architecture):
    return architecture in TORCHVISION or is_yolo(architecture)


def yolo_asset(architecture):
    """Ultralytics model name, e.g. yolo26n_cls -> yolo26n-cls."""
    version, scale = YOLO_PATTERN.fullmatch(architecture).groups()
    return f"yolo{version}{scale}-cls"


def has_pretrained(architecture):
    """False only for a YOLO family with no official classification weights; such a model trains from scratch."""
    if not is_yolo(architecture):
        return True
    return YOLO_PATTERN.fullmatch(architecture).group(1) not in YOLO_WITHOUT_PRETRAINED

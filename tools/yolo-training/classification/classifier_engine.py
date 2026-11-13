"""Explicit PyTorch execution; imported only after lightweight dataset checks."""

import csv
import importlib.metadata
import json
import math
import os
import random
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import torch
from classifier_data import (
    PREPROCESSING,
    PadResize,
    classification_metrics,
    sampling_weights,
    sha256,
    write_evaluation,
)
from PIL import Image
from torch import nn
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler
from torchvision import models, transforms


def seed_everything(seed, threads):
    os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
    random.seed(seed)
    torch.manual_seed(seed)
    torch.set_num_threads(threads)
    torch.use_deterministic_algorithms(True)
    torch.backends.cudnn.benchmark = False


def select_device(name):
    if name == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    device = torch.device(name)
    if device.type == "cuda" and not torch.cuda.is_available():
        raise ValueError("CUDA is unavailable in this environment; use --device cpu or a CUDA PyTorch installation")
    if device.type == "cuda" and device.index is not None and device.index >= torch.cuda.device_count():
        raise ValueError("CUDA device index is unavailable")
    if device.type == "mps" and not torch.backends.mps.is_available():
        raise ValueError("MPS is unavailable on this machine")
    if device.type not in {"cpu", "cuda", "mps"}:
        raise ValueError("Use auto, cpu, cuda[:N] or mps")
    return device


class GlobalAveragePool(nn.Module):
    """Same output as AdaptiveAvgPool2d(1); its CUDA backward is deterministic, so seeded CUDA training runs."""

    def forward(self, x):
        return x.mean(dim=(2, 3), keepdim=True)


def build_model(classes, weights_dir, fine_tune=False, initial_weights=None, pretrained=True):
    if initial_weights:
        model = models.resnet18(weights=None)
        model.load_state_dict(torch.load(initial_weights, map_location="cpu", weights_only=True))
    else:
        if pretrained:
            Path(weights_dir).mkdir(parents=True, exist_ok=True)
            torch.hub.set_dir(str(weights_dir))
        model = models.resnet18(weights=models.ResNet18_Weights.IMAGENET1K_V1 if pretrained else None)
    for parameter in model.parameters():
        parameter.requires_grad = fine_tune
    model.avgpool = GlobalAveragePool()
    model.fc = nn.Linear(model.fc.in_features, len(classes))
    return model


def initial_weights_metadata(weights_dir, initial_weights=None):
    url = models.ResNet18_Weights.IMAGENET1K_V1.url
    path = Path(initial_weights).resolve() if initial_weights else Path(weights_dir) / "checkpoints" / Path(urlparse(url).path).name
    return {"initial_weights": str(path), "initial_weights_source": "local state_dict" if initial_weights else url,
            "initial_weights_sha256": sha256(path)}


def image_transform(size, augment="none"):
    steps = [PadResize(size)]
    tensor_steps = [transforms.ToTensor(), transforms.Normalize(PREPROCESSING["mean"], PREPROCESSING["std"])]
    if augment == "mild":
        steps += [transforms.RandomHorizontalFlip(0.5), transforms.ColorJitter(brightness=.1, contrast=.1, saturation=.05)]
    elif augment == "strong":
        # Square crops keep the aspect ratio; the down/up resize mimics the many low-resolution source crops.
        fill = tuple(PREPROCESSING["padding_rgb"])
        steps += [transforms.RandomResizedCrop(size, scale=(.7, 1), ratio=(1, 1)), transforms.RandomHorizontalFlip(0.5),
                  transforms.RandomAffine(10, translate=(.05, .05), fill=fill),
                  transforms.RandomApply([transforms.Resize(size // 3), transforms.Resize(size)], p=.3),
                  transforms.RandomApply([transforms.GaussianBlur(5, sigma=(.1, 1.5))], p=.2),
                  transforms.ColorJitter(brightness=.3, contrast=.3, saturation=.2, hue=.02)]
        tensor_steps.append(transforms.RandomErasing(p=.25, scale=(.02, .15)))
    return transforms.Compose([*steps, *tensor_steps])


class CropDataset(Dataset):
    def __init__(self, root, rows, classes, size, augment="none"):
        self.root, self.rows = Path(root), rows
        self.indices = {name: index for index, name in enumerate(classes)}
        self.transform = image_transform(size, augment)

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, index):
        row = self.rows[index]
        with Image.open(self.root / row["classification_path"]) as decoded:
            tensor = self.transform(decoded)
        return tensor, self.indices[row["canonical_class"]]


def loader(root, rows, classes, options, training=False, weights=None):
    dataset = CropDataset(root, rows, classes, options["image_size"], options["augment"] if training else "none")
    generator = torch.Generator().manual_seed(options["seed"])
    # Weighted epochs keep their length and only change the mix; sampling is with replacement.
    sampler = WeightedRandomSampler(weights, len(rows), replacement=True, generator=generator) if weights else None
    return DataLoader(dataset, batch_size=options["batch_size"], shuffle=training and sampler is None, sampler=sampler,
                      num_workers=options["workers"], generator=generator)


def train_epoch(model, batches, optimizer, device, fine_tune, epoch, epochs, label_smoothing=0.0):
    # Freeze backbone BN running statistics as well as its parameters for head-only training.
    model.train() if fine_tune else model.eval()
    model.fc.train()
    total_loss, correct, count = 0.0, 0, 0
    for index, (images, targets) in enumerate(batches, 1):
        images, targets = images.to(device), targets.to(device)
        optimizer.zero_grad(set_to_none=True)
        logits = model(images)
        loss = nn.functional.cross_entropy(logits, targets, label_smoothing=label_smoothing)
        if not torch.isfinite(loss):
            raise ValueError("Non-finite training loss")
        loss.backward()
        optimizer.step()
        total_loss += loss.item() * len(targets)
        correct += (logits.argmax(1) == targets).sum().item()
        count += len(targets)
        if index == 1 or index % 10 == 0 or index == len(batches):
            print(f"Epoch {epoch}/{epochs} | batch {index}/{len(batches)} | train loss {total_loss / count:.4f} | top1 {correct / count:.3f}", flush=True)
    return {"loss": total_loss / count, "top1": correct / count}


def evaluate(model, batches, device, classes):
    model.eval()
    targets_all, predicted_all, scores = [], [], []
    total_loss = 0.0
    with torch.inference_mode():
        for images, targets in batches:
            images, targets = images.to(device), targets.to(device)
            logits = model(images)
            loss = nn.functional.cross_entropy(logits, targets, reduction="sum")
            if not torch.isfinite(loss):
                raise ValueError("Non-finite validation loss")
            probabilities = logits.softmax(1)
            probability, prediction = probabilities.max(1)
            total_loss += loss.item()
            targets_all.extend(targets.cpu().tolist())
            predicted_all.extend(prediction.cpu().tolist())
            scores.extend(probability.cpu().tolist())
    metrics = classification_metrics(targets_all, predicted_all, classes)
    metrics["loss"] = total_loss / len(targets_all)
    return metrics, predicted_all, scores


def save_checkpoint(path, model, options, summary, epoch, metrics):
    checkpoint = {"format_version": 1, "architecture": options["architecture"], "classes": summary["classes"],
                  "preprocessing": PREPROCESSING, "image_size": options["image_size"],
                  "dataset_fingerprint": summary["fingerprint"], "manifest_sha256": summary["manifest_sha256"],
                  "epoch": epoch, "val": metrics,
                  "state_dict": {name: tensor.detach().cpu() for name, tensor in model.state_dict().items()}}
    temporary = path.with_suffix(".tmp")
    torch.save(checkpoint, temporary)
    temporary.replace(path)


def load_checkpoint(path, summary):
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    if checkpoint.get("format_version") != 1 or checkpoint.get("architecture") != "resnet18":
        raise ValueError("Expected a ParkMap ResNet18 classifier checkpoint, not detector weights")
    if checkpoint["classes"] != summary["classes"]:
        raise ValueError("Checkpoint classes differ from dataset class order")
    if checkpoint["dataset_fingerprint"] != summary["fingerprint"] or checkpoint["manifest_sha256"] != summary["manifest_sha256"]:
        raise ValueError("Checkpoint belongs to a different dataset snapshot")
    if checkpoint["preprocessing"] != PREPROCESSING or not 64 <= checkpoint["image_size"] <= 1024:
        raise ValueError("Checkpoint preprocessing is incompatible")
    return checkpoint


def run_metadata(summary, options, device):
    return {"dataset": summary, "options": options, "device": str(device), "status": summary["status"],
            "preprocessing": PREPROCESSING, "torch": str(torch.__version__),
            "torchvision": importlib.metadata.version("torchvision"), "python": sys.version,
            "pillow": importlib.metadata.version("pillow"), "test_evaluated": False,
            "selection": "highest val macro_f1 over supported classes; tie: lowest val loss",
            "limitations": ["Closed-set classifier; no trained unknown class or calibrated rejection threshold.",
                            "Provisional source labels/identity grouping are not real-camera accuracy evidence.",
                            "No individual vehicle dimensions or parking availability are inferred.",
                            *([f"Trained on a declared class subset; excluded {summary['excluded_classes']} are predicted as one of the kept classes."]
                              if summary["excluded_classes"] else [])]}


def fit(model, samples, summary, options, output):
    """Train/val only. The held-out test rows are never passed to a loader here."""
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    device = select_device(options["device"])
    model.to(device)
    metadata = run_metadata(summary, options, device)
    metadata["run_state"] = "running"
    def write_status():
        (output / "run.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    write_status()
    (output / "classes.json").write_text(json.dumps(dict(enumerate(summary["classes"])), indent=2) + "\n", encoding="utf-8")
    weights = None
    if options["pre_augmented_copies"] > 1:
        weights = sampling_weights(samples["train"], summary["train_only_splits"], options["pre_augmented_copies"])
        shares = {}
        for row, weight in zip(samples["train"], weights):
            shares[row["source_dataset"]] = shares.get(row["source_dataset"], 0) + weight
        print("Train sampling share by source: " + ", ".join(f"{name} {value / sum(weights):.1%}" for name, value in sorted(shares.items())), flush=True)
    train_loader = loader(summary["snapshot"], samples["train"], summary["classes"], options, training=True, weights=weights)
    val_loader = loader(summary["snapshot"], samples["val"], summary["classes"], options)
    optimizer = torch.optim.AdamW((p for p in model.parameters() if p.requires_grad), lr=options["learning_rate"])
    best = (-math.inf, -math.inf)
    started = time.monotonic()
    try:
        with (output / "history.csv").open("w", encoding="utf-8", newline="") as stream:
            fields = ["epoch", "train_loss", "train_top1", "val_loss", "val_top1", "val_macro_f1", "elapsed_seconds"]
            writer = csv.DictWriter(stream, fieldnames=fields)
            writer.writeheader()
            for epoch in range(1, options["epochs"] + 1):
                trained = train_epoch(model, train_loader, optimizer, device, options["fine_tune"], epoch, options["epochs"],
                                      options["label_smoothing"])
                metrics, _, _ = evaluate(model, val_loader, device, summary["classes"])
                writer.writerow({"epoch": epoch, "train_loss": trained["loss"], "train_top1": trained["top1"],
                                 "val_loss": metrics["loss"], "val_top1": metrics["top1"], "val_macro_f1": metrics["macro_f1"],
                                 "elapsed_seconds": round(time.monotonic() - started, 2)})
                stream.flush()
                print(f"Epoch {epoch}/{options['epochs']} | val loss {metrics['loss']:.4f} | val top1 {metrics['top1']:.3f} | val macro F1 {metrics['macro_f1']:.3f}", flush=True)
                score = (metrics["macro_f1"], -metrics["loss"])
                if score > best:
                    best = score
                    save_checkpoint(output / "best.pt", model, options, summary, epoch, metrics)
                    metadata["best_epoch"] = epoch
                save_checkpoint(output / "last.pt", model, options, summary, epoch, metrics)
                metadata["completed_epochs"] = epoch
                write_status()
        saved = torch.load(output / "best.pt", map_location=device, weights_only=True)
        model.load_state_dict(saved["state_dict"])
        metrics, predictions, scores = evaluate(model, val_loader, device, summary["classes"])
        metadata["best_checkpoint_sha256"] = sha256(output / "best.pt")
        write_evaluation(output / "val", summary["snapshot"], "val", samples["val"], predictions, scores, summary["classes"],
                         {"status": summary["status"], "checkpoint_sha256": metadata["best_checkpoint_sha256"],
                          "dataset_fingerprint": summary["fingerprint"], "loss": metrics["loss"]})
        metadata["run_state"] = "complete"
        write_status()
    except (Exception, KeyboardInterrupt) as error:
        metadata["run_state"] = "interrupted" if isinstance(error, KeyboardInterrupt) else "failed"
        metadata["error_type"] = type(error).__name__
        write_status()
        raise
    return output


def evaluate_test(checkpoint_path, summary, samples, options, output):
    checkpoint = load_checkpoint(checkpoint_path, summary)
    device = select_device(options["device"])
    model = build_model(summary["classes"], weights_dir=None, pretrained=False).to(device)
    model.load_state_dict(checkpoint["state_dict"])
    options = {**options, "image_size": checkpoint["image_size"]}
    batches = loader(summary["snapshot"], samples["test"], summary["classes"], options)
    metrics, predictions, scores = evaluate(model, batches, device, summary["classes"])
    return write_evaluation(output, summary["snapshot"], "test", samples["test"], predictions, scores, summary["classes"],
                            {"status": summary["status"], "checkpoint_sha256": sha256(checkpoint_path),
                             "dataset_fingerprint": summary["fingerprint"], "loss": metrics["loss"], "test_evaluated": True})

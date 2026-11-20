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
from architectures import TIMM, has_pretrained, is_supported, is_timm, is_yolo
from classifier_data import (
    PREPROCESSING,
    PadResize,
    balanced_weights,
    classification_metrics,
    sha256,
    write_evaluation,
)
from PIL import Image, ImageOps
from torch import nn
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler
from torchvision import models, transforms
from training_control import EarlyStopping, lr_factor


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


def model_spec(architecture):
    specs = {
        "resnet18": (models.resnet18, models.ResNet18_Weights.IMAGENET1K_V1),
        "resnet50": (models.resnet50, models.ResNet50_Weights.IMAGENET1K_V2),
        "efficientnet_b0": (models.efficientnet_b0, models.EfficientNet_B0_Weights.IMAGENET1K_V1),
        "mobilenet_v3_large": (models.mobilenet_v3_large, models.MobileNet_V3_Large_Weights.IMAGENET1K_V2),
        "convnext_tiny": (models.convnext_tiny, models.ConvNeXt_Tiny_Weights.IMAGENET1K_V1),
    }
    if architecture not in specs:
        raise ValueError("Unsupported classifier architecture")
    return specs[architecture]


def classifier_head(model):
    if hasattr(model, "fc"):
        return model.fc
    return model.classifier if hasattr(model, "classifier") else model.head  # timm ViT: head


def import_timm():
    try:
        import timm
    except ImportError as error:
        raise ValueError("vit_small needs the timm package; install it into the training environment: "
                         "uv pip install --python tools/yolo-training/.venv-gpu/Scripts/python.exe timm==1.0.31") from error
    return timm


def build_timm(classes, weights_dir, fine_tune, initial_weights, pretrained, architecture):
    """timm model with a new head; dynamic_img_size lets image_size differ from the pretrained 224."""
    if pretrained and not initial_weights and weights_dir:
        # Keep the Hugging Face download next to the other pretrained weights; read when huggingface_hub is first imported.
        os.environ.setdefault("HF_HUB_CACHE", str(Path(weights_dir).resolve() / "hf"))
    timm = import_timm()
    model = timm.create_model(TIMM[architecture], pretrained=pretrained and not initial_weights, dynamic_img_size=True)
    if initial_weights:
        model.load_state_dict(torch.load(initial_weights, map_location="cpu", weights_only=True))
    model.reset_classifier(len(classes))
    for parameter in model.parameters():
        parameter.requires_grad = fine_tune
    for parameter in model.head.parameters():
        parameter.requires_grad = True
    return model


def build_model(classes, weights_dir, fine_tune=False, initial_weights=None, pretrained=True, architecture="resnet18"):
    if is_yolo(architecture):
        from yolo_classifier import YoloClassifier, prepare_pretrained

        # A YOLO family without official classification weights (YOLO12) starts from random initialization.
        weights = initial_weights or (prepare_pretrained(weights_dir, architecture) if pretrained and has_pretrained(architecture) else None)
        return YoloClassifier(architecture, classes, fine_tune, weights)
    if is_timm(architecture):
        return build_timm(classes, weights_dir, fine_tune, initial_weights, pretrained, architecture)
    builder, weights = model_spec(architecture)
    if initial_weights:
        model = builder(weights=None)
        model.load_state_dict(torch.load(initial_weights, map_location="cpu", weights_only=True))
    else:
        if pretrained:
            Path(weights_dir).mkdir(parents=True, exist_ok=True)
            torch.hub.set_dir(str(weights_dir))
        model = builder(weights=weights if pretrained else None)
    for parameter in model.parameters():
        parameter.requires_grad = fine_tune
    if architecture.startswith("resnet"):
        model.fc = nn.Linear(model.fc.in_features, len(classes))
    else:
        model.classifier[-1] = nn.Linear(model.classifier[-1].in_features, len(classes))
    return model


def initial_weights_metadata(weights_dir, initial_weights=None, architecture="resnet18"):
    if is_yolo(architecture):
        from yolo_classifier import initial_weights_path, official_url

        if not initial_weights and not has_pretrained(architecture):
            return {"initial_weights": None, "initial_weights_sha256": None, "ultralytics": importlib.metadata.version("ultralytics"),
                    "initial_weights_source": "random initialization: Ultralytics publishes no pretrained classification weights for this architecture"}
        path = Path(initial_weights) if initial_weights else initial_weights_path(weights_dir, architecture)
        return {"initial_weights": str(path.resolve()), "initial_weights_source": "local state_dict" if initial_weights else official_url(architecture),
                "initial_weights_sha256": sha256(path), "ultralytics": importlib.metadata.version("ultralytics")}
    if is_timm(architecture):
        source = f"timm {TIMM[architecture]} (Hugging Face hub)"
        if initial_weights:
            return {"initial_weights": str(Path(initial_weights).resolve()), "initial_weights_source": "local state_dict",
                    "initial_weights_sha256": sha256(initial_weights), "timm": importlib.metadata.version("timm")}
        from huggingface_hub import try_to_load_from_cache

        cached = try_to_load_from_cache(f"timm/{TIMM[architecture]}", "model.safetensors")
        path = Path(cached) if isinstance(cached, str) else None
        return {"initial_weights": str(path) if path else None, "initial_weights_source": source,
                "initial_weights_sha256": sha256(path) if path else None, "timm": importlib.metadata.version("timm")}
    url = model_spec(architecture)[1].url
    path = Path(initial_weights).resolve() if initial_weights else Path(weights_dir) / "checkpoints" / Path(urlparse(url).path).name
    return {"initial_weights": str(path), "initial_weights_source": "local state_dict" if initial_weights else url,
            "initial_weights_sha256": sha256(path)}


def preprocessing_for(architecture):
    if is_yolo(architecture):
        return {**PREPROCESSING, "mean": [0., 0., 0.], "std": [1., 1., 1.]}
    if is_timm(architecture):  # augreg ViT weights were trained with mean/std 0.5
        return {**PREPROCESSING, "mean": [0.5, 0.5, 0.5], "std": [0.5, 0.5, 0.5]}
    return PREPROCESSING


def image_transform(size, augment=False, architecture="resnet18", level="basic"):
    steps = [PadResize(size)]
    if augment and level == "strong":
        # Small shifts, scale and tilt (padding colour fills the gaps) and stronger colour jitter: the same motorcycle
        # photographed a little off-centre, nearer or under other light. Applied to train only.
        steps += [transforms.RandomAffine(degrees=10, translate=(.08, .08), scale=(.85, 1.1), fill=tuple(PREPROCESSING["padding_rgb"])),
                  transforms.RandomHorizontalFlip(0.5), transforms.ColorJitter(brightness=.3, contrast=.3, saturation=.2, hue=.02)]
    elif augment:
        steps += [transforms.RandomHorizontalFlip(0.5), transforms.ColorJitter(brightness=.1, contrast=.1, saturation=.05)]
    preprocessing = preprocessing_for(architecture)
    return transforms.Compose([*steps, transforms.ToTensor(), transforms.Normalize(preprocessing["mean"], preprocessing["std"])])


class CropDataset(Dataset):
    def __init__(self, root, rows, classes, size, augment=False, architecture="resnet18", level="basic"):
        self.root, self.rows = Path(root), rows
        self.indices = {name: index for index, name in enumerate(classes)}
        self.transform = image_transform(size, augment, architecture, level)

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, index):
        row = self.rows[index]
        with Image.open(self.root / row["classification_path"]) as decoded:
            # Phone photos carry EXIF rotation; prepared crops are already upright, so this changes nothing for them.
            tensor = self.transform(ImageOps.exif_transpose(decoded))
        return tensor, self.indices[row["canonical_class"]]


def loader(root, rows, classes, options, training=False):
    dataset = CropDataset(root, rows, classes, options["image_size"], training and options["augment"], options["architecture"],
                          options.get("augmentation", "basic"))
    generator = torch.Generator().manual_seed(options["seed"])
    if training and options.get("sampling", "shuffle") == "balanced":
        # Same number of draws per epoch, with replacement, so rare classes and small groups are seen as often as large ones.
        sampler = WeightedRandomSampler(balanced_weights(rows), num_samples=len(rows), replacement=True, generator=generator)
        return DataLoader(dataset, batch_size=options["batch_size"], sampler=sampler, num_workers=options["workers"])
    return DataLoader(dataset, batch_size=options["batch_size"], shuffle=training, num_workers=options["workers"],
                      generator=generator)


def train_epoch(model, batches, optimizer, device, fine_tune, epoch, epochs, label_smoothing=0.0):
    # Freeze backbone BN running statistics as well as its parameters for head-only training.
    model.train() if fine_tune else model.eval()
    classifier_head(model).train()
    total_loss, correct, count = 0.0, 0, 0
    for index, (images, targets) in enumerate(batches, 1):
        images, targets = images.to(device), targets.to(device)
        optimizer.zero_grad(set_to_none=True)
        logits = model(images)
        # Smoothing applies to the training loss only; validation loss stays plain cross-entropy so runs remain comparable.
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
                  "preprocessing": preprocessing_for(options["architecture"]), "image_size": options["image_size"],
                  "dataset_fingerprint": summary["fingerprint"], "manifest_sha256": summary["manifest_sha256"],
                  "epoch": epoch, "val": metrics,
                  "state_dict": {name: tensor.detach().cpu() for name, tensor in model.state_dict().items()}}
    temporary = path.with_suffix(".tmp")
    torch.save(checkpoint, temporary)
    temporary.replace(path)


def load_checkpoint(path, summary):
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    if checkpoint.get("format_version") != 1 or not is_supported(checkpoint.get("architecture")):
        raise ValueError("Expected a supported ParkMap classifier checkpoint, not detector weights")
    if checkpoint["classes"] != summary["classes"]:
        raise ValueError("Checkpoint classes differ from dataset class order")
    if checkpoint["dataset_fingerprint"] != summary["fingerprint"] or checkpoint["manifest_sha256"] != summary["manifest_sha256"]:
        raise ValueError("Checkpoint belongs to a different dataset snapshot")
    if checkpoint["preprocessing"] != preprocessing_for(checkpoint["architecture"]) or not 64 <= checkpoint["image_size"] <= 1024:
        raise ValueError("Checkpoint preprocessing is incompatible")
    return checkpoint


def run_metadata(summary, options, device):
    return {"dataset": summary, "options": options, "device": str(device), "status": summary["status"],
            "preprocessing": preprocessing_for(options["architecture"]), "torch": str(torch.__version__),
            "torchvision": importlib.metadata.version("torchvision"), "python": sys.version,
            "pillow": importlib.metadata.version("pillow"), "test_evaluated": False,
            "selection": "highest val macro_f1 over supported classes; tie: lowest val loss",
            "limitations": ["Closed-set classifier; no trained unknown class or calibrated rejection threshold.",
                            "Provisional source labels/identity grouping are not real-camera accuracy evidence.",
                            "No individual vehicle dimensions or parking availability are inferred."]}


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
    train_loader = loader(summary["snapshot"], samples["train"], summary["classes"], options, training=True)
    val_loader = loader(summary["snapshot"], samples["val"], summary["classes"], options)
    optimizer = torch.optim.AdamW((p for p in model.parameters() if p.requires_grad), lr=options["learning_rate"],
                                  weight_decay=options.get("weight_decay", 0.01))  # 0.01 is AdamW's own default
    best = (-math.inf, -math.inf)
    stopper = EarlyStopping(options.get("patience", 0))
    metadata["early_stopping"] = {"metric": "val_macro_f1", "patience": stopper.patience, "stopped_early": False}
    started = time.monotonic()
    try:
        if options.get("continued_from_checkpoint"):
            initial, predictions, scores = evaluate(model, val_loader, device, summary["classes"])
            metadata["initial_validation"] = {"top1": initial["top1"], "macro_f1": initial["macro_f1"], "loss": initial["loss"]}
            metadata["selection"] += "; includes starting checkpoint at epoch 0 of this run"
            best = (initial["macro_f1"], -initial["loss"])
            stopper.update(initial["macro_f1"])
            metadata["best_epoch"] = 0
            save_checkpoint(output / "best.pt", model, options, summary, 0, initial)
            write_evaluation(output / "initial_val", summary["snapshot"], "val", samples["val"], predictions, scores, summary["classes"],
                             {"status": summary["status"], "checkpoint_sha256": options["initial_weights_sha256"],
                              "dataset_fingerprint": summary["fingerprint"], "loss": initial["loss"]})
            print(f"Starting checkpoint baseline | val top1 {initial['top1']:.3f} | val macro F1 {initial['macro_f1']:.3f}", flush=True)
        with (output / "history.csv").open("w", encoding="utf-8", newline="") as stream:
            fields = ["epoch", "learning_rate", "train_loss", "train_top1", "val_loss", "val_top1", "val_macro_f1", "elapsed_seconds"]
            writer = csv.DictWriter(stream, fieldnames=fields)
            writer.writeheader()
            for epoch in range(1, options["epochs"] + 1):
                rate = options["learning_rate"] * lr_factor(epoch, options["epochs"], options.get("scheduler", "constant"),
                                                            options.get("warmup_epochs", 0))
                for param_group in optimizer.param_groups:
                    param_group["lr"] = rate
                trained = train_epoch(model, train_loader, optimizer, device, options["fine_tune"], epoch, options["epochs"],
                                      options.get("label_smoothing", 0.0))
                metrics, _, _ = evaluate(model, val_loader, device, summary["classes"])
                writer.writerow({"epoch": epoch, "learning_rate": rate, "train_loss": trained["loss"], "train_top1": trained["top1"],
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
                stop = stopper.update(metrics["macro_f1"])
                metadata["early_stopping"].update(bad_epochs=stopper.bad_epochs, best_macro_f1=stopper.best, stopped_early=stop)
                write_status()
                if stop:
                    print(f"Early stopping: no improved validation Macro F1 for {stopper.patience} epochs.", flush=True)
                    break
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
    model = build_model(summary["classes"], weights_dir=None, pretrained=False, architecture=checkpoint["architecture"]).to(device)
    model.load_state_dict(checkpoint["state_dict"])
    options = {**options, "image_size": checkpoint["image_size"], "architecture": checkpoint["architecture"]}
    batches = loader(summary["snapshot"], samples["test"], summary["classes"], options)
    metrics, predictions, scores = evaluate(model, batches, device, summary["classes"])
    return write_evaluation(output, summary["snapshot"], "test", samples["test"], predictions, scores, summary["classes"],
                            {"status": summary["status"], "checkpoint_sha256": sha256(checkpoint_path),
                             "dataset_fingerprint": summary["fingerprint"], "loss": metrics["loss"], "test_evaluated": True})


IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def folder_rows(folder, classes):
    """Images in <folder>/<class>/ (or <folder>/test/<class>/). A folder starting with _ holds models the classifier does not know."""
    folder = Path(folder).resolve()
    if (folder / "test").is_dir():
        folder = folder / "test"
    if not folder.is_dir():
        raise ValueError(f"Not a folder: {folder}")
    known, other, strangers = [], [], []
    for directory in sorted(p for p in folder.iterdir() if p.is_dir()):
        if not (directory.name in classes or directory.name.startswith("_")):
            strangers.append(directory.name)
            continue
        for image in sorted(p for p in directory.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES):
            relative = image.relative_to(folder).as_posix()
            row = {"classification_path": relative, "annotation_id": relative, "folder": directory.name,
                   "canonical_class": directory.name if directory.name in classes else classes[0]}
            (known if directory.name in classes else other).append(row)
    if strangers:
        raise ValueError(f"Folders that are not classes of this model: {strangers}. Rename each to one of: {', '.join(classes)}; "
                         "or start its name with _ (e.g. _other) for motorcycles of models the classifier does not know")
    if not known and not other:
        raise ValueError(f"No images ({', '.join(sorted(IMAGE_SUFFIXES))}) in class folders under {folder}")
    return folder, known, other


def evaluate_folder(checkpoint_path, folder, options, output):
    """Score a trained checkpoint on an independent labelled image folder; never trains or writes into the folder."""
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    if checkpoint.get("format_version") != 1 or not is_supported(checkpoint.get("architecture")):
        raise ValueError("Expected a supported ParkMap classifier checkpoint, not detector weights")
    classes = checkpoint["classes"]
    folder, known, other = folder_rows(folder, classes)
    device = select_device(options["device"])
    model = build_model(classes, weights_dir=None, pretrained=False, architecture=checkpoint["architecture"]).to(device)
    model.load_state_dict(checkpoint["state_dict"])
    options = {**options, "image_size": checkpoint["image_size"], "architecture": checkpoint["architecture"]}
    result = {"folder": str(folder), "checkpoint": str(checkpoint_path), "classes": classes}
    if known:
        metrics, predictions, scores = evaluate(model, loader(folder, known, classes, options), device, classes)
        result["known"] = write_evaluation(output, folder, "own-images", known, predictions, scores, classes,
                                           {"status": "independent images, not part of the training dataset",
                                            "checkpoint_sha256": sha256(checkpoint_path), "loss": metrics["loss"],
                                            "image_folder": str(folder)})
        result["known_rows"] = [{"image": r["classification_path"], "true": r["canonical_class"], "predicted": classes[p], "score": s}
                                for r, p, s in zip(known, predictions, scores, strict=True)]
    else:
        Path(output).mkdir(parents=True, exist_ok=False)
    if other:
        _, predictions, scores = evaluate(model, loader(folder, other, classes, options), device, classes)
        rows = [{"image": r["classification_path"], "folder": r["folder"], "predicted": classes[p], "score": s}
                for r, p, s in zip(other, predictions, scores, strict=True)]
        (Path(output) / "other_predictions.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
        result["other_rows"] = rows
    return result

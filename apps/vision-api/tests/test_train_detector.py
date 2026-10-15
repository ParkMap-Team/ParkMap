import sys
from types import SimpleNamespace
from zipfile import ZipFile
from xml.etree import ElementTree

import pytest

from scripts.train_detector import load_config, run, write_excel


def test_experiment_uses_separate_splits_and_single_motorcycle_class(tmp_path):
    dataset = tmp_path / "dataset"
    (dataset / "data.yaml").parent.mkdir()
    (dataset / "data.yaml").write_text("names: [motorcycle]\n")
    for split in ("train", "valid", "test"):
        images, labels = dataset / split / "images", dataset / split / "labels"
        images.mkdir(parents=True)
        labels.mkdir()
        (images / f"{split}.jpg").write_bytes(b"image")
        (labels / f"{split}.txt").write_text("0 0.5 0.5 0.2 0.2\n")
    config = tmp_path / "experiment.yaml"
    config.write_text(f"""dataset: {dataset.as_posix()}
model: yolo11n.yaml
name: baseline
train: {{epochs: 1, imgsz: 640, batch: 1, workers: 0}}
evaluate: {{confidence: 0.25, nms_iou: 0.5, match_iou: 0.5}}
export: {{runs_dir: runs, model_path: model.pt, excel_path: results.xlsx}}
""")

    _, actual_dataset, splits = load_config(config)

    assert actual_dataset == dataset
    assert [len(splits[name][2]) for name in ("train", "valid", "test")] == [1, 1, 1]
    (dataset / "test" / "images" / "test.jpg").rename(dataset / "test" / "images" / "valid.jpg")
    (dataset / "test" / "labels" / "test.txt").rename(dataset / "test" / "labels" / "valid.txt")
    with pytest.raises(ValueError, match="overlap"):
        load_config(config)


def test_excel_export_contains_numeric_results_and_frame_detail(tmp_path):
    output = tmp_path / "baseline.xlsx"
    write_excel(output, [["Metric", "Test"], ["Recall", 0.5]],
                [["Image", "TP"], ["frame.jpg", 2]], [["Epoch", "Loss"], [1, 0.8]])

    with ZipFile(output) as archive:
        assert archive.testzip() is None
        summary = ElementTree.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        frames = ElementTree.fromstring(archive.read("xl/worksheets/sheet2.xml"))
        training = ElementTree.fromstring(archive.read("xl/worksheets/sheet3.xml"))
    namespace = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    assert summary.findall(".//x:v", namespace)[0].text == "0.5"
    assert frames.findall(".//x:v", namespace)[0].text == "2"
    assert training.findall(".//x:v", namespace)[0].text == "1"


def test_training_exports_results_without_creating_another_env_file(tmp_path, monkeypatch):
    dataset = tmp_path / "dataset"
    (dataset / "data.yaml").parent.mkdir()
    (dataset / "data.yaml").write_text("names: [motorcycle]\n")
    for split in ("train", "valid", "test"):
        images, labels = dataset / split / "images", dataset / split / "labels"
        images.mkdir(parents=True)
        labels.mkdir()
        (images / f"{split}.jpg").write_bytes(b"image")
        (labels / f"{split}.txt").write_text("")

    class EmptyTensor:
        def cpu(self):
            return self

        def tolist(self):
            return []

    class FakeYOLO:
        def __init__(self, model):
            self.model = model

        def train(self, **kwargs):
            output = tmp_path / "runs" / kwargs["name"]
            (output / "weights").mkdir()
            (output / "weights" / "best.pt").write_bytes(b"weights")
            (output / "results.csv").write_text("epoch,metric\n1,0.5\n")

        def predict(self, **kwargs):
            return [SimpleNamespace(orig_shape=(100, 100), boxes=SimpleNamespace(
                xyxy=EmptyTensor(), conf=EmptyTensor()))]

    monkeypatch.setitem(sys.modules, "ultralytics", SimpleNamespace(YOLO=FakeYOLO))
    config = tmp_path / "experiment.yaml"
    config.write_text(f"""dataset: {dataset.as_posix()}
model: yolo11n.yaml
name: baseline
train: {{epochs: 1, imgsz: 640, batch: 1, workers: 0, device: cpu}}
evaluate: {{confidence: 0.25, nms_iou: 0.5, match_iou: 0.5}}
export:
  runs_dir: {tmp_path.as_posix()}/runs
  model_path: {tmp_path.as_posix()}/model.pt
  excel_path: {tmp_path.as_posix()}/results.xlsx
""")

    result = run(config)

    assert result == tmp_path / "results.xlsx"
    assert (tmp_path / "model.pt").read_bytes() == b"weights"
    assert (tmp_path / "runs" / "baseline" / "baseline.json").is_file()
    assert not list(tmp_path.rglob("*.env"))

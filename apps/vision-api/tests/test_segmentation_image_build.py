import importlib.util
import sys
from pathlib import Path


def test_segmentation_build_packages_only_shared_26n_without_classifier_weights(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "dont_write_bytecode", True)
    script = Path(__file__).resolve().parents[3] / "tools/build-vision-demo.py"
    spec = importlib.util.spec_from_file_location("build_vision_demo", script)
    build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build)
    api = tmp_path / "api"
    models = api / "models"
    models.mkdir(parents=True)
    trained = models / "yolo26n-seg_round-08_best.pt"
    trained.write_bytes(b"trained-model")
    monkeypatch.setattr(build, "API", api)
    monkeypatch.setattr(build, "SEGMENTATION_WEIGHTS", trained)
    monkeypatch.setattr(build, "BOX_WEIGHTS", tmp_path / "missing-box.pt")
    monkeypatch.setattr(build, "CLASSIFIER_RUNS", tmp_path / "missing-classifier")
    monkeypatch.setattr(build.sys, "argv", [str(script), "--segmentation-only", "--tag", "test:seg"])

    def docker(command, **_):
        assert command[command.index("--target") + 1] == "segmentation"
        contexts = dict(command[i + 1].split("=", 1) for i, arg in enumerate(command) if arg == "--build-context")
        assert set(contexts) == {"seg_weight"}
        assert (Path(contexts["seg_weight"]) / "best.pt").read_bytes() == b"trained-model"
        return 0

    monkeypatch.setattr(build.subprocess, "call", docker)
    assert build.main() == 0

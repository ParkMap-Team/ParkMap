# One image for the API, operator commands, dev-state publisher, worker, and LINE bot;
# PARKMAP_PROCESS selects the process (see docker-start.sh).
# Build context: apps/vision-api.
FROM python:3.12.15-slim-trixie AS runtime

COPY --from=ghcr.io/astral-sh/uv:0.11.7 /uv /usr/local/bin/uv

# OpenCV needs libGL and GLib; curl serves the Coolify health check.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libgl1 libglib2.0-0t64 curl \
  && rm -rf /var/lib/apt/lists/*

ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
  UV_PYTHON_DOWNLOADS=never \
  UV_COMPILE_BYTECODE=1 \
  UV_LINK_MODE=copy \
  PATH=/opt/venv/bin:$PATH \
  PYTHONUNBUFFERED=1 \
  YOLO_CONFIG_DIR=/tmp/Ultralytics

WORKDIR /app
COPY pyproject.toml uv.lock ./
# The line-bot group lets Coolify run the settings process from this image too, so no server builds one.
RUN uv sync --locked --no-dev --group line-bot --no-install-project
COPY . .
COPY config/motorcycle_reference_sizes.json ./defaults/
RUN python -c 'from app.services.motorcycle_reference_sizes import PACKAGED_RULES_PATH, load_rules; load_rules(PACKAGED_RULES_PATH)'

# Linux sh must also be able to run the entrypoint after a Windows checkout.
RUN sed -i 's/\r$//' docker-start.sh \
  && useradd --system --uid 10001 parkmap
USER parkmap
EXPOSE 8000
CMD ["sh", "docker-start.sh"]

# The named contexts are supplied only for the local operator demo build.
FROM runtime AS demo
USER root
RUN --mount=type=bind,from=detect_weight,target=/checkpoints/detect \
    --mount=type=bind,from=seg_weight,target=/checkpoints/seg \
    --mount=type=bind,from=convnext_weight,target=/checkpoints/convnext <<'SH'
python - <<'PY'
from pathlib import Path
from shutil import copyfile

from app.parking_inference_settings import BOX_WEIGHTS, CLASSIFIER_RUNS, MODEL_ID, SEGMENTATION_WEIGHTS

for name, destination in (
    ("detect", BOX_WEIGHTS),
    ("seg", SEGMENTATION_WEIGHTS),
    ("convnext", CLASSIFIER_RUNS.with_name("runs-class-project") / MODEL_ID / "best.pt"),
):
    destination.parent.mkdir(parents=True, exist_ok=True)
    copyfile(Path("/checkpoints") / name / "best.pt", destination)
    destination.chmod(0o444)
PY
SH
USER parkmap

# Preserve the weight-free image as the implicit target for existing builds.
FROM runtime AS default

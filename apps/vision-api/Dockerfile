# One image for the API, the operator commands (`python -m app.manage`), and the dev-state publisher;
# PARKMAP_PROCESS selects the process (see docker-start.sh).
# Build context: apps/vision-api.
FROM python:3.12.15-slim-trixie

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
RUN uv sync --locked --no-dev --no-install-project
COPY . .

RUN useradd --system --uid 10001 parkmap
USER parkmap
EXPOSE 8000
CMD ["sh", "docker-start.sh"]

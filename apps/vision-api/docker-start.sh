#!/bin/sh
# Container entrypoint. PARKMAP_PROCESS selects what this container runs from the one API image.
set -eu

case "${PARKMAP_PROCESS:-api}" in
  api)
    # A single API instance runs, so migrations never race.
    python -m alembic upgrade head
    exec uvicorn app.main:app --host 0.0.0.0 --port 8000
    ;;
  worker)
    # Still-image loop or camera worker; configured only through environment variables.
    exec python -m app.worker \
      --parking-area-id "${PARKMAP_WORKER_PARKING_AREA_ID:?PARKMAP_WORKER_PARKING_AREA_ID is required}" \
      --source "${PARKMAP_WORKER_SOURCE:?PARKMAP_WORKER_SOURCE is required}" \
      --hold-s "${PARKMAP_WORKER_HOLD_S:-10}"
    ;;
  *)
    echo "Unknown PARKMAP_PROCESS: ${PARKMAP_PROCESS}" >&2
    exit 64
    ;;
esac

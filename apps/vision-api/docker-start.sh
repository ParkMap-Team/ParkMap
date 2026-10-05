#!/bin/sh
# Container entrypoint. PARKMAP_PROCESS selects what this container runs from the one API image.
set -eu

case "${PARKMAP_PROCESS:-api}" in
  api)
    # A single API instance runs, so migrations never race.
    python -m alembic upgrade head
    exec uvicorn app.main:app --host 0.0.0.0 --port 8000
    ;;
  dev-publisher)
    exec python -m app.manage publish-dev-state
    ;;
  *)
    echo "Unknown PARKMAP_PROCESS: ${PARKMAP_PROCESS}" >&2
    exit 64
    ;;
esac

# 0001: Workspace and service boundaries

Status: accepted for the current repository setup

ParkMap keeps `apps/web/` as a pnpm workspace and `apps/vision-api/` as a Python project in one repository. Turborepo coordinates JavaScript tasks; Python checks run through Python tooling and a separate CI job. This avoids pretending that pnpm manages Python dependencies.

The existing FastAPI pipeline remains the inference and geometry owner. A future live ingestion worker can share that Python domain code, but must publish timestamped results through durable infrastructure once camera ingestion is implemented. The web app consumes a documented API and does not recalculate parking availability. Do not extract a shared package until at least two real consumers need it.

At live-camera launch, deploy three processes: web/LIFF, FastAPI, and Python inference worker. The worker must not run long inference inside a web request. Use a bounded queue and durable latest-state storage so repeated student reads do not rerun the model. Select infrastructure after camera cadence, latency target, and hosting are measured.

LINE's rich menu can link directly to LIFF. A separate NestJS bot is deferred until message or postback flows justify a webhook and operational process.

The current vinext/Vite runtime stays in place. A migration to standard Next.js is a separate change with deployment and compatibility checks.

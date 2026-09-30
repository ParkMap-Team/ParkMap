# ParkMap agent rules

Read `CONTEXT.md` for product language and `docs/adr/` for architecture decisions before non-trivial changes. These rules apply throughout the repository.

## Engineering

- Choose the smallest correct solution; keep dependencies acyclic and package manifests explicit.
- Validate images, camera data, calibration, and LINE requests at trust boundaries. Do not trust browser-supplied availability.
- Parking has no fixed physical stalls. Virtual row IDs are internal geometry identifiers. Preserve `AVAILABLE`, `ALMOST_AVAILABLE`, and uncertainty semantics from the backend contract.
- Never infer empty space behind an occlusion or from a stale frame. Do not claim true 3D geometry from one camera image.
- Keep detection and fitting in Python. Keep display and LIFF interaction in the web app. Share API schemas deliberately; do not duplicate decision logic.
- Do not add a bot service or shared package until a concrete second consumer or webhook behavior exists.
- Keep credentials, LINE tokens, raw private footage, and local model weights out of Git and logs.

## Workflow

- Read files before editing; preserve existing conventions and unrelated changes.
- State success criteria for non-trivial work. Behavior changes need focused tests.
- Run affected checks one package at a time. Never run the full monorepo suite or resource-heavy suites in parallel without the user's explicit confirmation for that run.
- Report checks run, checks not run, and remaining verification gaps.
- Prefix shell commands with `rtk` per `/Users/crybabys/.codex/RTK.md`. Use `rtk gh` for GitHub operations. Use `rg` for searches.

## Agent skills

Repository skills are under `.agents/skills/`; see [catalog](docs/agents/skills.md). They are adapted from the Showcase repository. Use the narrowest relevant skill. `CLAUDE.md` points here and `.claude/skills` links to the same skills, so Claude follows the same rules and workflows.

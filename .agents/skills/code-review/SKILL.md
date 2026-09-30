---
name: code-review
description: Review ParkMap changes for correctness, safety, scope, and verification.
---

# Code Review

Read `AGENTS.md`, `CONTEXT.md`, relevant ADRs, and the governing request. Inspect the full diff including untracked files. Report only defects introduced by the change, with file, line, triggering case, impact, and smallest correct fix.

Check parking-state semantics, stale or occluded observations, calibrated geometry, API validation, privacy of footage and LINE data, package boundaries, tests, and deployment configuration. Confirm that green availability is supported by current evidence and yellow remains advisory. Do not infer a marked physical stall from a virtual row ID.

Run only focused checks needed to prove findings. Lead with findings by severity; then give verification and unresolved gaps. Review is read-only unless repair was requested.

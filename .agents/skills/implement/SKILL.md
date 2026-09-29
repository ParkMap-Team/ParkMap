---
name: implement
description: Deliver a defined ParkMap change through focused implementation, verification, and review.
---

# Implement

Read `AGENTS.md`, `CONTEXT.md`, and relevant ADRs. Inspect the affected code before editing. State the user-visible change, behavior that remains stable, and focused checks.

Build the smallest vertical slice through the relevant boundary. Keep camera inference and parking geometry in Python; keep LIFF presentation in the web app. Validate uploads and LINE input at trust boundaries. Never report a space as safely available when the evidence is stale or uncertain.

For behavior changes, use `$tdd` at a stable public seam. Run affected tests, lint, typecheck, and build one package at a time. Update docs when contracts, setup, or deployment change. Review the diff against the request and ParkMap rules, fix in-scope issues, and report exact checks and gaps.

Do not commit, push, open a PR, or deploy unless authorized by the user.

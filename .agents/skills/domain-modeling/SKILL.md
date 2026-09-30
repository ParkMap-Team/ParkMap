---
name: domain-modeling
description: Resolve ambiguous ParkMap domain terms, invariants, or conflicting domain decisions in authoritative docs.
---

# Domain Modeling

Maintain one precise language for product discussion, code, tests, issues, and operations.

## Load authority

Use existing context; consult only sources relevant to the domain question:

1. Root `AGENTS.md` and the nearest app `AGENTS.md` in scope.
2. `CONTEXT.md`.
3. `docs/adr/README.md` and relevant ADRs.
4. The relevant product document or implementation being discussed.

Use `CONTEXT.md` capitalization and avoid-list terms. Do not introduce a synonym when a canonical term already exists.

## Resolve the model

1. Identify the unclear concept, overloaded term, lifecycle, actor, ownership rule, or invariant.
2. State the existing definition and the conflict or missing edge.
3. Test it with concrete scenarios, including empty but occluded space, stale observations, motorcycles blocking an exit, uncertain detections, and concurrent camera updates when relevant.
4. Check current code and docs. Surface disagreement instead of choosing silently.
5. Ask one consequential question when user intent is required. Recommend the smallest model consistent with existing invariants.
6. Record the settled result immediately in the narrowest authoritative file.

Protect these established separations unless the user explicitly reopens them:

- A virtual row ID is an analysis identifier, never a physical numbered stall.
- `AVAILABLE`, `ALMOST_AVAILABLE`, and `UNKNOWN` communicate different evidence and actionability.
- Camera observation time differs from API response time.
- Vehicle brand, visible footprint, and measured dimensions are distinct evidence.

## Choose the artifact

- Update `CONTEXT.md` for canonical terms, relationships, lifecycle meaning, and invariants. Keep transport, schema, framework, and file-path details out.
- Update `docs/product/` when such a product document exists for scope and acceptance rules.
- Add an ADR only when a decision is hard to reverse, surprising without context, and based on a real tradeoff.
- Update `docs/rules/` or `docs/infrastructure/` for engineering or operational policy.

Use the compact ADR style indexed by `docs/adr/README.md`. Preserve superseded decisions as history; add a superseding ADR rather than rewriting the old decision.

## Verify and report

- Search changed terminology across docs and code for stale conflicting usage.
- Run formatting only for documentation changed by this skill.
- Report resolved terms, scenarios tested, files changed, and remaining contradictions.
- Do not implement application behavior unless the user separately authorized implementation.

---
name: codebase-design
description: Design a specific module interface or dependency seam before implementation; compare consequential alternatives.
---

# Codebase Design

Design deep modules: substantial domain behavior behind a small, explicit interface.

## Vocabulary

- **Module**: cohesive behavior with one caller-facing interface.
- **Interface**: everything callers must know, including types, invariants, errors, ordering, configuration, and performance.
- **Implementation**: behavior hidden inside a module.
- **Seam**: a place where behavior can vary without editing callers.
- **Adapter**: one implementation that satisfies an interface at a seam.
- **Depth**: useful behavior delivered per unit of interface callers must learn.
- **Locality**: related behavior, change, and verification stay together.

Use `boundary` only for a real trust, process, or domain boundary. Do not create an interface merely because a language supports one.

## Load context

Use loaded instructions and relevant domain/ADR sections; inspect the code on both sides of the proposed seam. Preserve these system boundaries:

- The web app consumes server-owned parking state and does not recompute availability.
- The Python boundary owns detection, calibration, uncertainty, and fitting.
- A future inference worker shares Python domain code and publishes timestamped state.
- Shared packages may depend on packages, never on apps.

## Design process

1. Define the caller and the behavior it needs, using canonical domain terms.
2. List current knowledge leaked to the caller: workflow order, provider details, duplicated validation, status branching, or persistence shape.
3. Apply the deletion test. If deleting a proposed module merely moves the same complexity into every caller, the module has value. If complexity disappears, it is likely pass-through structure.
4. Place the highest stable seam that keeps parking invariants inside the Python domain boundary.
5. Draft at least two materially different interfaces for a consequential design. Compare them with [interface-comparison.md](references/interface-comparison.md).
6. Choose the smallest interface that covers present requirements. One adapter is not evidence that provider abstraction is needed; add a seam only for a real trust boundary, testing need, or second implementation.
7. Define observable errors and performance constraints. Normal list paths require pagination, bounded queries, and indexable filters.
8. Define tests through the interface. If tests need private state or internal call assertions, redesign the seam.

## Review checklist

- Callers cannot bypass calibration or uncertainty rules.
- The interface uses domain values, not provider rows or framework objects.
- Multi-state workflows use explicit statuses, not coupled booleans.
- Dependencies point inward and the workspace graph remains acyclic.
- Side effects expose idempotency, timeout, retry, and failure semantics where applicable.
- No speculative hooks, generic repositories, or shared package extraction without demonstrated reuse.

Record a hard-to-reverse cross-application choice as an ADR. Otherwise keep the decision in the implementation spec or review notes.

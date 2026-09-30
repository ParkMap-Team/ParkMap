---
name: improve-codebase-architecture
description: Audit existing ParkMap architecture for evidenced coupling and testability problems; rank improvements before choosing a design.
---

# Improve Codebase Architecture

Find evidence-backed improvements. An architecture audit is read-only unless the user separately authorizes implementation.

## Load the model

Use loaded instructions. Consult domain definitions and ADRs for the affected boundaries; inspect relevant architecture sections, workspace dependencies, and tests as the audit requires. Use `$codebase-design` vocabulary: module, interface, implementation, seam, adapter, depth, leverage, and locality.

Do not reopen an ADR merely because another design is possible. Surface conflict only when current code provides concrete evidence that the accepted decision now causes material cost.

## Explore friction

Trace real domain journeys and dependency edges. Look for:

- one parking rule duplicated across API services or the web app;
- shallow pass-through modules whose deletion would remove complexity rather than concentrate it;
- understanding one behavior requiring hops through many tiny files;
- camera validation, privacy policy, or availability rules outside the Python boundary;
- persistence or camera-provider shapes leaking through application interfaces;
- tests that must mock internals because no stable public seam exists;
- feature modules coupled through implementation details or circular package dependencies;
- unrelated reasons to change concentrated in one module;
- normal reads without bounded pagination, indexable filters, or clear ownership;
- external side effects without an explicit failure/idempotency seam.

Confirm every candidate through callers, tests, and change history available locally. Do not turn style preference or hypothetical future scale into an architecture finding.

## Rank candidates

For each candidate provide:

- affected domain behavior and modules;
- present interface and leaked knowledge;
- concrete maintenance, correctness, testability, scale, or agent-navigation cost;
- proposed deeper module and seam, without detailed implementation;
- expected leverage and locality;
- migration risk and compatibility sequence;
- ADR interaction;
- recommendation strength: `Strong`, `Worth exploring`, or `Speculative`.

Apply the deletion test and reject candidates that only add a wrapper, generic repository, duplicate DTO layer, shared package without real reuse, or provider abstraction with no genuine variation.

## Present visually when useful

When three or more candidates or dependency relationships are difficult to compare in prose, create a self-contained HTML report in the OS temporary directory using [report-structure.md](references/report-structure.md). Use inline CSS and SVG or plain HTML; do not require remote scripts. Return its absolute path. Otherwise use a compact Markdown report.

Show before/after relationships, not decorative diagrams. End with one top recommendation and why it should precede the others.

## Deepen a selected candidate

After the user chooses a candidate:

1. Use `$codebase-design` to compare at least two interfaces.
2. Use `$domain-modeling` if terminology or invariants change.
3. Record a new or superseding ADR only when the decision meets ADR criteria.
4. Use `$to-spec` for production behavior and `$to-tickets` when work exceeds one safe slice.

Do not edit production code during the audit or design stage unless explicitly requested.

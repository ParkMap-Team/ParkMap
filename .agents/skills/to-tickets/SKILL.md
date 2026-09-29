---
name: to-tickets
description: Split an approved spec into dependency-aware vertical implementation tickets; publish only when authorized.
---

# To Tickets

Create tracer-bullet tickets that each deliver a narrow, complete, verifiable behavior.

## Load the source

Read the full approved spec or parent issue including comments. Reuse loaded instructions; consult relevant domain/ADR sections and `docs/agents/issue-tracker.md` for tracker operations. Inspect enough code to understand existing seams and migration constraints.

Do not ticket unresolved product ambiguity as implementation. Send it back to `$grill-with-docs`, `$research`, or `$prototype` first.

## Slice vertically

Each ticket must:

- fit one fresh agent session;
- deliver a demonstrable path through every layer required by that behavior;
- leave affected packages buildable and tests green;
- include security, privacy, error handling, and observability required by its path;
- avoid relying on an untracked conversation decision;
- declare every blocking ticket and no unnecessary blocker.

Prefer this progression when applicable:

1. walking skeleton through the real vision API and state-storage boundary;
2. first complete authorized user journey;
3. remaining state transitions and failure paths;
4. public discovery/read behavior;
5. operational hardening and rollout verification that cannot belong to an earlier slice.

Database-only, API-only, and UI-only tickets are usually horizontal and should be combined into a behavior slice. A wide mechanical migration may use expand-migrate-contract tickets when no vertical slice can remain compatible by itself.

## Draft ticket graph

Present a numbered draft before publishing. For each ticket show title, delivered behavior, acceptance criteria, verification seam, blockers, and intentionally excluded scope. Ask for approval when granularity or dependency order changes delivery strategy.

Use this issue body:

```md
## Parent

## What to deliver

## Acceptance criteria

- [ ] Observable criterion

## Verification

## Blocked by

- None, or issue references

## Out of scope
```

Use canonical domain terms. Do not include volatile file paths or implementation snippets unless a prototype established a precise state machine or contract that prose cannot preserve.

## Publish only when authorized

External issue creation requires explicit user authorization. Then:

1. Create blocker issues first using `rtk gh issue create --body-file ...`.
2. Create dependent issues with actual blocker references in their bodies.
3. Apply `ready-for-agent` only when a ticket has sufficient context and its unresolved blockers are represented.
4. Link every ticket to the parent spec issue when one exists.
5. Return a dependency-ordered list of titles and URLs.

Do not close, relabel, or rewrite the parent issue unless explicitly requested. Never place credentials, LINE identities, or private footage in tickets.

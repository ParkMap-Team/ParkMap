---
name: to-spec
description: Turn settled decisions into an implementation-ready ParkMap spec or PRD when requested.
---

# To Spec

Synthesize settled context. Do not restart the product interview or invent missing behavior.

## Gather authority

Reuse context already loaded and gather missing evidence:

1. Relevant domain, ADR, and product sections that constrain the spec.
2. The complete conversation context supplied to the session.
3. Referenced GitHub issue bodies and comments using `rtk gh`.
4. Relevant code, migrations, and tests to describe the true starting state.
5. Prototype or research artifacts that established a decision.

Ask only when an unresolved ambiguity would change user-visible behavior, authorization, privacy, data migration, or rollout. Otherwise state a bounded assumption.

## Draft the specification

Use canonical domain terms and this structure:

```md
## Problem

## Goal and measurable outcome

## Actors and authorization

## User journeys

## Domain behavior and invariants

## States and failure paths

## Data, privacy, and retention

## Interfaces and external providers

## Scale and operability

## Acceptance criteria

## Testing seams

## Migration, rollout, and rollback

## Out of scope and follow-ups

## Open questions
```

Requirements must be observable and testable. Cover invalid input, stale or occluded observations, camera failure, calibration gaps, provider failure, retry, and unavailable dependencies where relevant.

Do not prescribe fragile file paths or large code snippets. Name stable domain modules, interfaces, schemas, and contracts when they are part of the decision. Include exact media limits, state transitions, visibility rules, and privacy constraints when applicable.

## Define testing seams

Choose the smallest set of public seams that proves the acceptance criteria. Prefer Python geometry rules, focused FastAPI tests, persistence integration, and the smallest frontend interaction seam. Add browser E2E only for a critical journey not provable below it.

## Check readiness

A spec is implementation-ready only when:

- every acceptance criterion maps to a journey or invariant;
- actor identity and authorization source are explicit;
- state transitions and retained history are explicit;
- data ownership, public exposure, and sensitive fields are explicit;
- migrations and compatibility order are addressed;
- external failures and retry/idempotency expectations are addressed;
- out-of-scope follow-ups cannot be mistaken for current work;
- remaining open questions do not block safe implementation.

## Publish only when authorized

Present the draft first. If the user explicitly asks to publish, create one GitHub issue using the workflow in `docs/agents/issue-tracker.md` and apply `ready-for-agent` only when no blocking question remains. Otherwise save nowhere or update the repo document the user named. Never expose secrets or personal data in an issue.

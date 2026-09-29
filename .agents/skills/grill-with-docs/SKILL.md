---
name: grill-with-docs
description: Challenge an unsettled ParkMap plan one consequential question at a time and record agreed decisions.
---

# Grill With ParkMap Docs

Turn ambiguous plans into documented decisions without starting implementation.

## Load context

Use existing context; consult only sources relevant to the decision:

1. Root `AGENTS.md` and the nearest app `AGENTS.md` when an app is in scope.
2. `CONTEXT.md`.
3. Any relevant `docs/product/` document.
4. `docs/adr/README.md` and ADRs relevant to the plan.
5. Existing product or infrastructure docs named by the user.

Use the canonical capitalized terms from `CONTEXT.md`. Do not silently introduce synonyms.

## Grill

1. Restate the plan in at most five factual bullets and identify contradictions with existing docs.
2. Build an internal decision tree covering product behavior, roles, state transitions, data ownership, privacy, failure paths, scale, operations, and follow-ups.
3. Ask exactly one question at a time. Start with the choice that changes the most downstream decisions.
4. Give a concrete recommendation and tradeoff when the user lacks a preference. Do not offer false choices when one option violates an invariant.
5. Resolve the branch before moving on. Record accepted decisions immediately rather than saving a large documentation pass for the end.
6. Periodically state how many unresolved decision groups remain when the user asks.
7. Stop when remaining questions are implementation details already governed by repository rules, or when the user explicitly ends the grill.

Do not write application code, migrations, tickets, or deployment changes during the grill unless the user separately authorizes implementation.

## Update documentation

Choose the narrowest authoritative file:

- Update `CONTEXT.md` for a new or changed domain term, definition, relationship, or forbidden synonym.
- Update the relevant `docs/product/` document for scope, invariants, and follow-ups when one exists.
- Add an ADR for a cross-application architecture, security, data ownership, or delivery decision with meaningful alternatives and accepted cost.
- Update an existing infrastructure/rules document for an operational decision that does not warrant a new ADR.

Keep ADRs in this repository's compact format:

```md
# Imperative decision title

One paragraph: decision and boundary; rejected alternative and reason; accepted cost.
```

Never rewrite history to hide a superseded decision. Add a superseding ADR and update the index.

## Finish

Report:

- decisions made
- files updated
- remaining implementation questions, if any
- explicit follow-ups excluded from current phase

Run formatting only for files changed by the grill. Do not run application test suites for documentation-only changes.

---
name: wayfinder
description: Map an uncertain, multi-session effort into decision issues and resolve authorized work toward an implementation-ready spec.
---

# Wayfinder

Find the route to a defined destination. Do not implement the destination unless the map explicitly includes authorized execution work.

## Map model

The map is one GitHub issue containing:

```md
## Destination

## Standing constraints

## Decisions so far

## Open frontier

## Not yet specifiable

## Out of scope
```

Child issues hold one decision or investigation each. The map links to them but does not duplicate their evidence. Use issue titles in prose, with the issue number or URL attached, so humans can scan the map.

Ticket types:

- **Research**: answer from primary external sources using `$research`.
- **Prototype**: raise fidelity with a disposable artifact using `$prototype`.
- **Grill**: resolve a human product/domain decision using `$grill-with-docs` and `$domain-modeling`.
- **Task**: complete necessary preparation that unblocks a decision, such as obtaining a sanitized sample or local provider setup.

The frontier contains open, unblocked questions precise enough to work now. Keep vague downstream areas under `Not yet specifiable` until earlier answers make them concrete. Keep excluded work under `Out of scope`; it never graduates automatically.

## Chart a map

1. Reuse loaded instructions; consult domain, ADR, and product sections that constrain the destination, and tracker instructions for GitHub operations.
2. Use one-question-at-a-time grilling to define a measurable destination and scope boundary.
3. Explore breadth-first. Identify decisions that can be phrased now, their blocking edges, and remaining fog.
4. Present the proposed map and initial ticket graph to the user.
5. Create GitHub issues only after explicit authorization. Use `needs-info` for unresolved decision tickets and avoid inventing labels not listed in `docs/agents/triage-labels.md`.
6. If the request is mapping only, finish with the map. If resolution is authorized, continue with an unblocked frontier ticket.

## Work a map

Resolve authorized frontier work until the agreed outcome is reached, a consequential user decision is required, or access/authorization blocks progress:

1. Load the map and only the ticket needed now.
2. Confirm its blockers are closed or otherwise resolved.
3. Invoke the named research, prototype, grill, or task workflow.
4. Record the full resolution on the child issue and a one-line linked gist under `Decisions so far`.
5. Close or relabel the child issue only with explicit authorization.
6. Add newly visible tickets and move clarified fog to the frontier after user approval.
7. When no decision remains before implementation, invoke `$to-spec`; the map is complete when the resulting spec is implementation-ready.

Use `rtk gh` for all GitHub operations. Expect concurrent sessions: re-read issue state before every external mutation and never overwrite newer comments or body changes. Do not put credentials, LINE identities, or private footage in the map.

---
name: research
description: Verify external technical or provider facts using current primary sources; save cited findings when requested.
---

# Research

Produce durable evidence, not an uncited recommendation.

## Define the question

Use loaded instructions; consult domain/ADR sections only when they constrain the question and local dependency versions for version-specific behavior. State the exact decision or implementation question, scope, required freshness, and what evidence would change the answer.

Do not research facts already owned by current local code or lockfiles unless verifying external behavior.

## Use primary sources

Prefer, in order:

1. official specifications and security guidance;
2. official product or framework documentation matching installed versions;
3. provider API references, changelogs, and source code;
4. original research papers or first-party incident reports.

Use secondary sources only to locate a primary source. For OpenAI products use official OpenAI sources. For technical claims cite the exact official page or source location.

Separate:

- **Fact**: directly supported by a source.
- **Inference**: conclusion derived from cited facts and ParkMap constraints.
- **Recommendation**: chosen action and accepted tradeoff.
- **Unknown**: evidence missing or behavior requiring an experiment.

## Capture findings

When the user requests a repository artifact, write `docs/research/<topic>.md` with:

```md
# Question

## Conclusion

## Findings

## ParkMap implications

## Unknowns and verification plan

## Sources
```

Put citations beside the claims they support and record source publication/update dates when available. Avoid long quotations; paraphrase precisely. Never include credentials, private endpoints, account identifiers, or copied sensitive payloads.

## Verify usefulness

Cross-check recommendations against installed versions, `CONTEXT.md`, ADRs, and the Python-owned parking-state boundary. State when provider documentation does not guarantee the needed behavior and propose a focused local experiment.

Run formatting only for changed research docs. Research does not authorize dependency upgrades, code changes, account creation, provider configuration, or external writes.

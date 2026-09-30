---
name: prototype
description: Build a disposable logic or UI experiment to resolve a named product or architecture question.
---

# Prototype

A prototype answers one named question. It is evidence for a decision, not production implementation.

## Choose the experiment

Use loaded instructions and relevant domain/ADR sections; inspect surrounding code. State the question and success signal before editing.

- For workflow, state, authorization shape, or edge-case questions, follow [logic-prototype.md](references/logic-prototype.md).
- For layout, information hierarchy, interaction, or visual direction, follow [ui-prototype.md](references/ui-prototype.md).

If the question is genuinely ambiguous and the choice changes the artifact, ask. Otherwise state the low-risk assumption and proceed.

## Isolation rules

- Work on a dedicated prototype branch. Never merge prototype code into `main`.
- Place the artifact near the relevant app or feature and include `prototype` in its path or name.
- Use fake, synthetic, non-sensitive data. Never copy identifiable footage, LINE identities, or credentials.
- Keep state in memory unless persistence behavior is the question. Use disposable local persistence only when required and label it clearly.
- Reuse installed dependencies and existing app structure. Do not add production abstractions, migrations, providers, or deployment configuration for a prototype.
- Provide one command to run and one deterministic smoke check proving the artifact starts or executes.

This is not authorization to weaken production validation, tests, accessibility, or security. Production code derived from the decision must be implemented separately under normal repository rules.

## Make the decision visible

Expose the relevant state, transitions, errors, or variant name at all times. Include the difficult cases that motivated the prototype, not only the happy path.

For UI variants, keep content and data constant so layout and interaction are what changes. For logic experiments, keep an event history so the user can see why the current state exists.

## Close the experiment

1. Demonstrate the artifact and record the user's decision in the governing issue, spec, product doc, or ADR.
2. Record the prototype branch and run command as evidence.
3. Remove prototype code from the production implementation branch.
4. Implement the chosen behavior from the recorded decision with normal tests and validation.

Do not present prototype shortcuts as production recommendations.

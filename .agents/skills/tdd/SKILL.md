---
name: tdd
description: Implement behavior through focused red-green-refactor cycles when test-first work or a regression test is required.
---

# Test-Driven Development

Build one observable behavior at a time through a public seam.

## Prepare

Use loaded instructions and relevant domain/ADR sections; inspect the governing spec. State:

- behavior changing and behavior staying unchanged;
- public seam under test;
- focused command that will prove red and green;
- external dependencies replaced by a real test adapter or controlled integration.

Prefer existing seams. Ask only when multiple plausible seams would materially change product behavior or architecture.

## Cycle

1. **Red**: add one test for one requirement using an independently known expected result. Run only that test and confirm it fails for the intended reason.
2. **Green**: implement the smallest correct production behavior. Keep validation, authorization, error handling, and typing required by that slice.
3. **Verify**: rerun the focused test and confirm it passes.
4. **Refactor**: remove duplication or improve names without changing behavior. Rerun the focused test after each meaningful refactor.
5. Repeat for the next vertical slice.

Never write all tests before all implementation. Each cycle should leave a narrow, working path through the required layers.

## Choose the seam

Use [test-seams.md](references/test-seams.md) to choose the highest stable interface that gives a fast deterministic signal. Use [mocking.md](references/mocking.md) before replacing dependencies.

Common ParkMap seams:

- pure parking geometry, fitting, and uncertainty calculations;
- FastAPI request validation and response contracts with a controlled model adapter;
- calibration persistence with temporary files;
- frontend API contract, map state, or smallest interactive component;
- browser E2E for a critical LIFF journey that lower seams cannot prove.

## Test quality rules

- Assert observable behavior, not private methods, call order, or incidental markup.
- Name tests with canonical terms from `CONTEXT.md`.
- Include rejected uploads, stale camera state, and privacy behavior at trust boundaries.
- Use deterministic clocks, IDs, and synthetic camera data.
- Avoid snapshots for domain behavior and large UI trees.
- Do not mock code owned by the same module merely to make a test easy.
- A test must fail when the behavior is removed or inverted.

## Finish

Run affected lint, typecheck, and test commands one package at a time. Expand to broader suites only when justified; never run the full monorepo suite without explicit confirmation for that run. Report every red/green command, final checks, checks not run, and remaining integration gaps.

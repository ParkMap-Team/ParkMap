---
name: diagnosing-bugs
description: Investigate a reported failure or performance regression; reproduce the cause and repair it when requested.
---

# Diagnosing Bugs

Build evidence before changing production code. A diagnosis request alone does not authorize a fix.

## Load context and define symptom

Use loaded instructions and relevant domain/ADR sections; inspect the affected path. Record:

- exact observed behavior and expected behavior;
- environment, actor state, inputs, timestamps, and last known good state;
- security or privacy sensitivity of evidence;
- whether the user requested diagnosis only or diagnosis plus repair.

Never print tokens, passwords, LINE identities, camera credentials, raw private footage, cookies, or authorization headers. Sanitize captured requests and logs.

## Build the feedback loop

Create the smallest agent-runnable command that exercises the reported path and fails on the exact symptom. Prefer:

1. focused existing or new test;
2. HTTP request against a local service;
3. minimal CLI or function harness;
4. browser test for browser-owned behavior;
5. replay of a sanitized request, event, or fixture;
6. deterministic load or timing harness for intermittent/performance failures.

The loop must be red-capable, deterministic enough to compare changes, fast enough to repeat, and independent of manual clicking. If no loop can be built, report attempts and request the smallest missing artifact or access. Avoid collecting identifiable footage while instrumenting the system.

## Reproduce and minimize

Run the loop and verify it reproduces the user's symptom, not a nearby failure. Reduce inputs, dependencies, data, and steps one at a time until every remaining element is required.

For flaky behavior, raise reproduction frequency with deterministic scheduling, repeated runs, controlled concurrency, or fixed seeds. Do not claim a fix from one green run.

## Hypothesize and instrument

Create three to five ranked, falsifiable hypotheses. For each, state the observation that would support or reject it. Test one variable at a time.

Prefer debugger inspection, query plans, traces, or narrow boundary logs. Prefix temporary diagnostics with a unique marker such as `[DEBUG-a4f2]`. For performance, establish a numeric baseline before changing code.

Stop when one hypothesis explains all observed evidence and competing hypotheses are rejected. Report root cause with the path from input to symptom.

## Repair when authorized

1. Convert the minimized reproduction into a failing regression test at the real public seam.
2. Confirm red for the intended reason.
3. Apply the smallest correct fix without unrelated refactoring.
4. Confirm the regression test and original loop are green.
5. Run affected lint, typecheck, tests, and build one package at a time.
6. Remove every temporary debug marker and throwaway artifact.

If the current architecture has no seam capable of reproducing the bug, document that gap. Do not add a misleading shallow test.

## Report

Provide the reproduction command, root cause, evidence that rejected alternatives, changed behavior if repaired, regression coverage, exact checks, checks not run, and any external environment gap.

# Use axis-only motorcycle proxy headings

Status: accepted, 2026-10-03.

## Decision

Motorcycle proxies in the LIFF 3D view use the occupied footprint's
long axis without resolving front versus rear. The MVP keeps this
axis-only behavior even if future experiments attempt to infer a directed
heading. Directed heading may replace it only after validation against a
locked reference set.

## Rationale

Front/back inference from a single camera view is not reliably evidenced,
so the proxy heading represents an undirected longitudinal axis rather
than the motorcycle's true facing direction.

## Consequences

A proxy may appear 180 degrees opposite to the real motorcycle. This is
accepted because the proxy represents a detection, not a reconstruction
of the actual vehicle. A future front/back experiment must remain separate
from the current display behavior until it demonstrates sufficient evidence.

## Validation

Evaluation uses the existing recorded demo line with manually annotated
sample motorcycles.

The initial demo acceptance thresholds are:

- Ground-position error: at most 0.5 m
- Proxy length relative error: at most ±30%
- Proxy width relative error: at most ±30%
- Undirected long-axis angle error: at most 15°

These thresholds may be revised after evaluating the locked reference set.
They are not production accuracy targets, universal live-accuracy guarantees,
or evidence that a candidate space is `AVAILABLE`.

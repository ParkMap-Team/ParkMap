# Use axis-only motorcycle proxy headings

Status: accepted, 2026-10-03.

## Decision

Motorcycle proxies in the LIFF 3D view use the occupied footprint's
long axis without resolving front versus rear.

## Rationale

Front/back inference from a single camera view is not reliably evidenced,
so the proxy heading represents an undirected longitudinal axis rather
than the motorcycle's true facing direction.

## Consequences

A proxy may appear 180 degrees opposite to the real motorcycle. This is
accepted because the proxy represents a detection, not a reconstruction
of the actual vehicle.

## Validation

Evaluation uses the existing recorded demo line with manually annotated
sample motorcycles.

The demo acceptance criteria are:

- Ground-position error: at most 0.5 m
- Proxy length relative error: at most ±30%
- Proxy width relative error: at most ±30%
- Undirected long-axis angle error: at most 15°

These thresholds are demo acceptance criteria and are not universal
live-accuracy guarantees.
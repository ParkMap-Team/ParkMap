# Logic prototype

Build a small terminal or isolated module harness when the question concerns a state model or rule.

Required behavior:

- accept explicit events or commands;
- print the complete relevant state after every event;
- retain a readable event history;
- include reset and at least three preloaded scenarios;
- cover invalid transition, repeated request, and concurrent/stale update when relevant;
- run without network or permanent storage unless that dependency is the subject.

Useful ParkMap scenarios include stale camera frames, occluded space, false-green prevention, blocked exits, and incoming motorcycle fitting.

Do not model impossible states merely to make the prototype appear comprehensive. Record which domain invariants constrain the state space.

# Interface comparison

Compare consequential alternatives with the same facts.

| Criterion                | Alternative A | Alternative B | Alternative C |
| ------------------------ | ------------- | ------------- | ------------- |
| Caller knowledge         |               |               |               |
| Invariants hidden        |               |               |               |
| Authorization location   |               |               |               |
| Error surface            |               |               |               |
| Query and scale behavior |               |               |               |
| Test seam                |               |               |               |
| Migration cost           |               |               |               |
| Reversibility            |               |               |               |

Reject an alternative when it:

- lets a frontend or request body choose actor identity or authorization;
- exposes camera credentials or raw inference implementation details across the web/API interface;
- duplicates workflow state transitions across callers;
- requires tests to inspect private implementation details;
- introduces abstractions only for hypothetical future providers.

Finish with one recommendation, accepted costs, and why the rejected alternatives are worse for the current requirements.

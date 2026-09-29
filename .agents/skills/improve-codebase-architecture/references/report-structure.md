# Architecture report structure

Create one standalone HTML document with no remote assets.

## Page sections

1. **Scope**: commit/branch, directories inspected, domain journeys traced, and verification limits.
2. **System view**: small current dependency diagram using labeled boxes and arrows.
3. **Candidate cards**: one per finding with evidence, files, before/after diagrams, leverage, locality, risk, ADR interaction, and recommendation strength.
4. **Top recommendation**: first move, expected result, and why later candidates depend on or benefit from it.
5. **Rejected ideas**: plausible refactors rejected by the deletion test or current scope.

## Visual rules

- Use semantic HTML, readable contrast, system fonts, and a responsive single-column fallback.
- Use the same domain term and color for the same module in every diagram.
- Make before and after structurally comparable.
- Keep arrows labeled with data or control flow.
- Include a text equivalent for every diagram.
- Avoid animation, dashboards, scores without evidence, and decorative gradients.

Recommendation colors: red for `Strong`, amber for `Worth exploring`, gray for `Speculative`. Color must not be the only indicator.

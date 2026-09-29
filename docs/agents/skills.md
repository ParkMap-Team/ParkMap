# Agent skills

The workflow comes from `csi-spu/showcase/.agents/skills`, adapted to ParkMap. No Showcase product rules apply here.

| Skill | Use |
| --- | --- |
| `$implement`, `$tdd`, `$code-review` | Deliver and verify defined work |
| `$diagnosing-bugs`, `$improve-codebase-architecture`, `$codebase-design` | Diagnose and improve code boundaries |
| `$domain-modeling`, `$grill-with-docs`, `$research`, `$prototype`, `$wayfinder` | Resolve uncertain product or technical decisions |
| `$to-spec`, `$to-tickets` | Turn decisions into a spec and delivery slices |
| `$handoff` | Transfer unfinished work |

Each skill lives in `.agents/skills/<name>/SKILL.md`. Read only the skill relevant to the task.

Claude discovers the same files through the `.claude/skills` symlink; `CLAUDE.md` imports `AGENTS.md`. The CI validator checks skill frontmatter, metadata, links, and catalog entries.

The Supabase skills were deliberately excluded because ParkMap has not chosen Supabase.

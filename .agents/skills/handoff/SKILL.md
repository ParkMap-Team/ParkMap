---
name: handoff
description: Prepare a redacted continuation brief when transferring unfinished work to another agent session.
---

# Handoff

Create a fresh-agent brief without duplicating authoritative artifacts.

## Inspect current state

Reuse established context and link the governing plan/spec and relevant domain/ADR sections. Inspect current Git branch/status/log and changed-file summary. Do not alter the worktree.

Resolve the OS temporary directory and write a uniquely named Markdown file there. Keep handoffs out of the repository unless the user explicitly requests a durable repo artifact.

## Include

```md
# Objective

## Current state

- Repository and branch
- HEAD commit
- Staged, unstaged, and untracked work
- Completed outcome

## Authoritative context

- Specs, issues, ADRs, and docs by path or URL

## Decisions and assumptions

- Only decisions not already captured elsewhere

## Verification

- Exact checks run and results
- Checks not run and remaining gaps

## Remaining work

- Ordered next actions
- Blockers requiring user or external input

## Suggested skills

- Repo-local skills the next agent should invoke and why

## First command or file

- Safest concrete starting point
```

Reference existing docs, commits, issues, and diffs instead of pasting their content. Preserve exact commands, errors, identifiers, and file paths when needed to continue safely.

## Security

Redact credentials, cookies, tokens, authorization headers, LINE identities, camera credentials, private footage, and sensitive environment values. Name the secret variable or provider location without recording its value.

## Finish

Return the absolute handoff path and a one-line description of what the next session can do immediately. Do not commit, push, open issues, or clean the working tree.

# 0025: Store the Guard Booth clip's track evidence beside it

Accepted 2026-11-19 at the owner's request.

## Decision

The API stores the Guard Booth entrance clip's track evidence (per-track classifier scores, ground path and preview crop) as `<clip>.evidence.json` beside the clip, and loads it at startup instead of tracking the clip again.

- **Key.** The file records everything that decides the evidence: the clip's SHA-256, `MODEL_ID`, the video detector weights' SHA-256, its class id, image size, confidence and NMS IoU, the sample rate and `EVIDENCE_FORMAT`. A file whose key differs, or that cannot be read, is ignored; the clip is tracked again and the file replaced. A pipeline change that alters the evidence of an unchanged clip bumps `EVIDENCE_FORMAT`.
- **Writes.** The file is written atomically (temporary file, then rename) after tracking, and only if the clip still has the hash it was tracked under. A directory the API cannot write to logs a warning and keeps the evidence in memory, as before.
- **Off the server.** `python -m app.manage store-guard-booth-clip-evidence --clip <clip>` tracks a clip on any machine and stores the same file. Copied beside the server's clip, it is used only when the server's key matches.
- Rider rules (`MIN_OBSERVATIONS`, travel, booth zone) and reference sizes run on the stored evidence at request time, so changing them needs no new tracking.

## Why

Tracking the 143 s clip at 5 fps takes over an hour on the 2-vCPU server and holds the shared video lock, and the in-memory cache was lost on every deploy and restart, so each release spent an hour of CPU and left the booth without riders for that time. The clip and models change rarely; the evidence is a pure function of them.

## Consequences

- A deploy that changes none of the key's inputs shows riders as soon as the API starts.
- The clip's directory must be writable by the API user (uid 10001) for the server to store the file itself.
- A classifier checkpoint replaced under the same `MODEL_ID`, or a tracker or decoding change shipped without bumping `EVIDENCE_FORMAT`, reuses stale evidence until the file is deleted.
- Evidence tracked on another machine may differ slightly from the server's own run, since floating-point results vary by CPU; the clip is stand-in data and supports no accuracy claim either way.

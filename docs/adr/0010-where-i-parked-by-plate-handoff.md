# 0010: Where I parked by plate handoff

Status: proposed, 2026-10-09. Becomes accepted when the project advisor approves moving the entrance camera and LINE identity into the final's scope ([roadmap](../roadmap.md)). Once accepted it supersedes the "reads no LINE identity" rule of [0002](0002-live-state-pipeline-and-liff-app.md) and [0006](0006-liff-app-on-a-line-login-channel.md); the rest of both stands.

## Decision

The "where I parked" feature (#35) finds a student's motorcycle without the student marking it. A student binds one **registered plate** (characters, number, and province) to their LINE account. An **entrance camera** reads plates as motorcycles enter; a **plate handoff** links a matched read to the one new track that appears on the entrance side of the parking area's view; the motorcycle is tracked to where it stops, and a **parking record** is created. Terms are defined in `CONTEXT.md`.

- **Identity.** The LIFF app sends the LINE ID token; the API verifies it with LINE server-side and uses the verified user ID. The browser never asserts identity. A plate, a parking record, and an entrance sighting are visible only to the account they belong to.
- **Ownership.** One plate per account and one account per plate, first registration wins, ownership not verified. Disputes are fixed by the team directly in the database; there is no admin screen.
- **Processing.** A separate parking record worker replays the entrance video and the parking-area video on one clock (a synchronized replay), and does plate reading, tracking, and handoff in memory. It sends the API only parking records, failure reasons, and entrance sightings for registered plates. Reads of unregistered plates are discarded in the worker and never logged. The availability worker of 0002 is unchanged and keeps newest-frame processing. Tracking frame rate, tracker, and plate reader are chosen by a measured spike and recorded here before the worker is built.
- **Strictness.** A parking record exists only for an unambiguous handoff, one continuous track with no sign of a switch to another motorcycle, and a stationary stop inside a parking area. Anything else yields no record and a coarse reason. Plates are never fuzzy-matched; a read without a confident province matches only when exactly one registered plate shares its characters and number.
- **Retention.** One parking record and one entrance sighting per plate, replaced by the next and deleted after 24 hours; no history. A registered plate lasts until the student removes it (which deletes the record and sighting too) or the project ends. Plates and LINE user IDs never appear in logs, error reports, or analytics.

## Why

The team wants the feature to work without the student doing anything at parking time. The overhead camera cannot read plates and appearance re-identification is unreliable in a dense lot, so the plate read at the entrance is the identity key and tracking carries it to the stop. A wrong parking record sends a student to someone else's motorcycle, which is worse than none, so every ambiguity refuses rather than guesses, as `UNKNOWN` does for availability. A separate worker keeps a tracking failure from taking availability down, keeps tracks and unregistered plates inside one process, and gives both videos one clock.

## Considered options

- **Student marks the spot** (pin or GPS): rejected as the primary path because the student must act at parking time; it is also not offered as a fallback in the final.
- **Time-window matching without tracking**: fewer moving parts, but ambiguous whenever several motorcycles arrive together; the team chose tracking for accuracy.
- **Ownership verification** by registration document, by an operator allowlist, or by a camera confirmation step: rejected to avoid building an admin side in this project.
- **Tracking inside the availability worker** or **handoff in the API**: rejected for coupling availability to tracking, and for storing track events outside worker memory.

## Consequences

- **Accepted risk: tracking by a stranger.** Anyone who sees a plate can register it first and learn when that motorcycle enters and where it stops until the owner notices and contacts the team. The registration error is deliberately generic, so the owner is not told the plate is taken.
- **Limitation: no fallback.** Without a parking record the student sees only the reason and the entrance sighting. With one camera covering about a quarter of the lot, a student parked outside every parking area never gets a record, and busy arrival periods lower coverage.
- YOLO runs twice on the parking-area video (availability and parking record workers), raising compute on Coolify.
- The demo needs a synchronized two-view recording and a footage policy amendment (#16) that permits the entrance view; only team members or people who consented in writing hold registered plates in the demo.
- Accuracy is reported as the wrong-record rate (target zero) with coverage, on team-labelled ground truth; stand-in recordings never count as real-lot evidence (0004).

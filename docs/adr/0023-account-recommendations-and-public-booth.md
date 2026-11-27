# 0023: Restore account recommendations and expose the booth display

Accepted 2026-11-18 at the owner's request. Extends ADR 0020.

## Account and allocation

The LINE settings service verifies the existing session token and returns its
hashed account key and saved model to the Next server. Neither comes from the
browser's recommendation body. The key stays server-side and is stored as
`parking_holds.owner_key`; no raw LINE user ID or token enters the ledger.
The Vision API remains private behind the trusted Next server boundary.

A LINE account has at most one `HELD` or `AWAITING_CONFIRMATION` recommendation
per site. The existing site transaction lock and a partial unique database index
enforce this. New request UUIDs, refreshed pages, and reopened rich menus return
the same active request, point and original deadline. Existing anonymous ledger
rows remain blocking but cannot be claimed by an account. An occupied region is
not proof that the requesting rider parked there.

GET recommendation restores the account's latest status and reconciles evidence;
it never allocates. Only an explicit user action POSTs. Poll only active holds,
stop at terminal stages, and never reissue a recommendation automatically.
An explicit request after release or occupancy may allocate a new point.
The LIFF vehicle selector is locked while an account recommendation is `HELD`
or `AWAITING_CONFIRMATION`, including after returning to Settings or reloading.
The LIFF preference PUT route rechecks the verified owner's recommendation before
changing the model and returns 409 while active; an unavailable status check
returns 503. Released or occupied-confirmed recommendations allow changes again.
This guard applies to LIFF preference updates, not direct LINE OA settings edits.
All channel holds still block fitting and are subtracted from green in Python.

## Display and evidence

LINE receives only its own held frame and route. The booth receives all booth
holds, preserving the existing rider colours and numbered pins. The booth shows
no guidance route, including when only one rider is present; routes belong to
the LINE view. These numbered frames are recommendations, not physical stalls. LINE holds are
not blue booth overlays; other people's held space remains unavailable through
the shared backend map mask. Booth requests remain independent per rider,
without a LINE account.

Revalidate the original frame against current evidence. A changed photo never
silently relocates it. If it cannot currently be confirmed, hide the route and
explain that the original area remains held. Distinguish unavailable evidence
from no fitting space. Preserve the two-minute grace period and fresh empty
evidence required for release, including stale/occluded safeguards in ADR 0020.
The displayed countdown follows server time and is bounded to 0–120 seconds.

## Public booth boundary

Only `/sites/sripatum/guard-booth` bypasses the LINE UI gate. Its scoped state and
frame proxies expose only the configured Sripatum display when the existing
`PARKMAP_GUARD_BOOTH_FIT_PREVIEW=1` switch is enabled. Clip/classification, fitting,
and booth ledger proxies use the same site/feature gate; mutations retain the
bounded same-origin body check. Normal LINE pages, frame/state proxies and
account recommendation routes still require a verified session. This is the
public kiosk surface, not a general LINE authentication bypass.

## Delivery and checks

Run API migration `0008_line_hold_owner`, then deploy the matching API, LINE
settings service (`parkmap-bot`) and LIFF releases. Deploy the API and settings
endpoint before LIFF; old anonymous holds expire/reconcile through existing
lifecycle rules. No worker setting or new service is required. Do not deploy a
development login adapter as a substitute for LINE verification.

Focused tests cover account isolation, concurrent new UUIDs, database uniqueness,
restart recovery, immutable deadlines/points, explicit requests after release,
cross-channel overlap, public-booth scoping and authenticated Next proxies.
Actual LINE rich-menu reopening and the public display on deployed services
remain production acceptance checks.

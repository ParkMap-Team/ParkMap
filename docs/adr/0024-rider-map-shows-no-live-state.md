# 0024: A rider's map paints only free ground, softly

Accepted 2026-11-18 at the owner's request.

## Decision

The LINE rider's lot map (`/sites/[id]` in LIFF, 2D and 3D) paints no cells. Every monitored area is plain ground with the detected motorcycles on it, and the only live state drawn is free ground: `AVAILABLE` and `WIDTH_SUFFICIENT` regions show as one soft neon-green glow with no edge or outline (`FREE_SHADOW`), always, so the API's narrow cells never read as stalls. No `ALMOST_AVAILABLE`, `OCCUPIED` or `UNKNOWN` region is drawn, an area without a current state is not hatched and shows no free ground, a motorcycle has no red footprint, and other riders' holds are not drawn. The ground outside the cameras keeps its own treatment.

Amended 2026-11-18 at the owner's request: the first version painted no live state at all, including free ground.

**Free ground is the rider's model's free ground.** Where the parking guide recommends (the recorded preview area), the map glows only where the guide itself could place the model saved for the rider's LINE account: a free part of a width band, after motorcycles, uncertain ground and every held place are cut out, that is wide enough for that model plus clearance, in a row the guide routes to and left of the right-hand access. The API computes it with the guide's own band logic (`GET /api/sites/{site_id}/parking-state?family=`); the LIFF server adds the saved model when the page asks for the rider view, and the browser never supplies one. A model without a reference size, the Guard Booth, and live camera states keep the reported free ground. Amended 2026-11-18 at the owner's request, after riders saw green the guide then refused.

While the parking guide ([0020](0020-shared-recommendation-holds.md)) holds a place for the rider, that place is the only ground painted green, as one block with its route and "จอดตรงนี้" pin.

- **Display, plus one API filter.** The page builds the map from the API and keeps only free regions for drawing (`plainLotMap`). The only API change is the optional `family` filter above; the fitter, holds and the backend's `AVAILABLE`/`ALMOST_AVAILABLE` and uncertainty semantics do not change.
- **Card.** The headline still words the lot's state from the full map, without a colour swatch. The key names only what the map draws: free ground, motorcycles and the ground outside the cameras. A tap reports what the plain map shows, so a tap on the shadow names its free status.
- **Guard Booth.** `/sites/[id]/guard-booth` keeps every status colour.

## Why

The lot has no fixed spaces. Free ground painted as green cells reads as stalls a rider can pick, which the system does not offer; the guide's fitted place is the one place it does stand behind. A soft shadow still tells a rider where there is room without drawing a space.

Green that the guide then refuses ("ไม่มีที่ว่างที่ ... จอดได้พอดี") reads as a broken promise. Model-agnostic bands include gaps too narrow for the rider's model and rows the guide never routes to, so the glow follows the same fit the guide uses.

## Consequences

Amended 2026-11-20 at the owner's request: rider-map filtering now belongs to
`rider_map_fitting.py`, with its own `RIDER_CLEARANCE_M = 0.0` policy at the
owner's request: main-map width previews add no lateral clearance. Guard
Booth placement and routing stay in `guard_booth_fitting.py`, with independent
`GUARD_BOOTH_CLEARANCE_M = 0.0` and its existing row/access restrictions.
LINE recommendations independently use `rider_recommendation.py`, including
their own `AISLES`, `RIGHT_ACCESS_X`, `ENTRANCE_LANE_Y` and hold duration; they
use the rider's zero-clearance policy. Shared geometry and API transport types
do not own either channel's routing policy (see ADR 0020).
`width_band_fitting.py` owns shared geometry and requires the caller's clearance
explicitly. The shared module has no Guard Booth row or route policy. The
recommendation ledger and hold masking stay shared in `parking_holds.py`.
This extraction preserves existing map colours, filters, fit results and API
schemas; changing one caller's clearance does not change the other's.

Amended 2026-11-20 at the owner's request: map width-band display is independent
of routing. `free_ground_for` evaluates all calibrated rows, including `row_1`,
and does not apply the guide's right-access restriction. Model width, detected
occupancy, shared holds and freshness still apply. The guide retains its existing
supported rows and access rules; green width preview alone does not promise a route.

Amended 2026-11-20 at the owner's request: the recorded-photo width-only preview
does not reject a band solely for `GROUND_MAY_BE_OCCLUDED`. Both the rider's green
width bands and the recorded guide use this policy. The advisory remains in the
response; no region is promoted to `AVAILABLE`. Detected occupied polygons,
shared holds, model width, row/access rules and freshness gates still apply.
This is a width-only illustration and does not establish that hidden ground is empty.

- A rider sees where there is room for their own model, but not where ground is advisory or unknown, without asking the guide. The Guard Booth still does.
- Two riders with different models can see different green on the same lot, and green narrower than a model's width disappears when the rider changes model in settings.
- Each rider-map poll on the preview area runs the guide's frame search once per free band; it stays cheap while the preview is one lot.
- The parked screen ([0021](0021-rider-marked-parked-spot.md)) uses the same plain map.

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

- A rider sees where there is room for their own model, but not where ground is advisory or unknown, without asking the guide. The Guard Booth still does.
- Two riders with different models can see different green on the same lot, and green narrower than a model's width disappears when the rider changes model in settings.
- Each rider-map poll on the preview area runs the guide's frame search once per free band; it stays cheap while the preview is one lot.
- The parked screen ([0021](0021-rider-marked-parked-spot.md)) uses the same plain map.

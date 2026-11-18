# 0022: Nearby parking map

Accepted 2026-11-18 at the owner's request. It replaces the list-only plan for the LIFF `/nearby` page in CONTEXT, where the entry "Near-me site list" is now "Nearby parking map".

## Decision

The "nearby parking" tab is a street map with a pin for every place a rider can park a motorcycle within 2 km (`RADIUS_M`) of the campus, and no list or cards over it. The map always opens on the campus grounds (`CAMPUS_BOUNDS`, from the university's OpenStreetMap outline); it never moves to fit the pins or the rider, and places further out are a pan away. Tapping a pin opens a non-modal bottom sheet with the place's details and a button that opens Google Maps directions to it; the map stays live above it, so tapping another pin switches the sheet. The tab is always available; it does not wait for the main lot to fill.

- **Places.** Lots with cameras come from `/api/sites` and open their live map. Every other place is an entry the team checked on foot, typed in `apps/liff/src/lib/nearby/places.ts` with its photo in `apps/liff/public/nearby/`; a test checks each entry's id, coordinates and photo. No place is added to that list without the team checking it. OpenStreetMap fills in the rest: `pnpm nearby:osm` (`apps/liff/scripts/nearby-osm.ts`) asks the Overpass API once for motorcycle parking, and car parks that take motorcycles, within the radius, checks every element, and writes `osm-places.gen.ts`, which is reviewed and committed like code. A listed entry names the OpenStreetMap element it replaces, so a place is never pinned twice. Neither kind has a camera, so the page says it cannot tell whether there is room and shows no availability for it; an OpenStreetMap place also says where its data comes from and that it may be incomplete or out of date.
- **Map.** MapLibre GL JS draws OpenFreeMap's vector tiles, which need no key or account. The library loads only on this page. The bundler does not ship the worker the library looks for beside its own file, so the page names the worker file itself. If the map cannot start, such as without WebGL, the page lists the places instead, so every one stays reachable.
- **Location.** Unchanged from CONTEXT: asked for only on tap, with a 10-second limit, kept in page memory, never sent or stored. Distances are straight lines computed on the device and say so; the road route is Google Maps' to show.
- **Directions.** A Google Maps URL with only the destination, so Maps finds the start itself and the position never passes through ParkMap. Inside LINE it opens with `liff.openWindow({ external: true })`, so the Maps app can take over.

## Why

Riders need somewhere else to park when the main lot is full, and most of those places have no camera; beyond 2 km a place is no longer a fallback for the campus. The public Overpass instances are often at capacity, so the page reads a committed snapshot instead of asking Overpass on each visit, which also keeps the page off Overpass's load and makes each data change a reviewed diff. Places change rarely and their photos ship with the app, so one pull request can add both, with review, instead of a table, migration, admin screen and photo storage that would serve a list of a few entries. OpenFreeMap is free with no key to protect or quota to watch. Google's road distance needs a paid API and the rider's position on Google's servers before they ask for directions; the straight line on the device does not.

## Consequences

- Adding or changing a place, or refreshing OpenStreetMap's, needs a pull request and a deploy; the OpenStreetMap places are as current as the last refresh.
- The OpenStreetMap data is under the ODbL: the map and each OpenStreetMap place credit it.
- The page depends on OpenFreeMap's public servers; when they fail, the map has gaps or no tiles but the pins and their sheets still work.
- Tile requests reveal to OpenFreeMap which area the map shows, never the rider's position.
- A pin's fee, hours and roof are what the team saw on the day it checked them.

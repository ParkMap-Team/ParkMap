import type { components } from "./schema.gen.ts";

type Schemas = components["schemas"];

export type SiteSummary = Schemas["SiteSummary"];
export type LotModel = Schemas["LotModelResponse"];
export type LotLandmark = Schemas["LotLandmark"];
export type LandmarkKind = LotLandmark["kind"];
export type SiteParkingState = Schemas["SiteParkingStateResponse"];
export type ParkingAreaLiveState = Schemas["ParkingAreaLiveState"];
export type AreaLiveStatus = ParkingAreaLiveState["status"];
export type StateSourceKind = NonNullable<ParkingAreaLiveState["source"]>;
export type LiveRegion = Schemas["LiveRegion"];
export type MotorcycleProxy = Schemas["MotorcycleProxy"];
export type MetricPoint = Schemas["MetricGroundPoint"];
export type MetricPolygon = LiveRegion["polygon"];

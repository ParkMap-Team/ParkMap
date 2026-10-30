import type { components } from './api.gen.ts';

export type LotModelDefinition = components['schemas']['LotModelDefinition'];
export type LotLandmark = components['schemas']['LotLandmark'];
export type LandmarkKind = LotLandmark['kind'];
export type MetricPoint = components['schemas']['MetricGroundPoint'];
export type MetricPolygon = LotModelDefinition['outline'];
export type LotModelDraftState = components['schemas']['LotModelDraftState'];
export type SiteSummary = components['schemas']['SiteSummary'];

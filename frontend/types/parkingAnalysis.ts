import type { GroundPlaneMetricPoint } from './groundPlaneCalibration';
import type { MetricMotorcycle } from './metricMotorcycle';

export interface MetricMultiPolygon { polygons: GroundPlaneMetricPoint[][][]; }
export interface PhysicalMapRowResult { row_id: string; polygon: GroundPlaneMetricPoint[]; measured_length_m: number | null; measured_width_m: number | null; area_m2: number; }
export interface OccupiedRowResult { row_id: string; row_area_m2: number; occupied_union_area_m2: number; occupied_percent: number; occupied_geometry: MetricMultiPolygon; blocking_detection_ids?: string[]; contributions?: BlockingContributionResult[]; components?: OccupiedGeometryComponent[]; }
export interface FreeRowResult { row_id: string; row_area_m2: number; occupied_union_area_m2: number; free_geometry: MetricMultiPolygon; free_area_m2: number; free_component_count: number; hole_count: number; occupied_percent: number; free_percent: number; validation_status: 'VALID' | 'INVALID'; }
export interface VirtualFittingPlacement { placement_id: string; row_id: string; footprint_geometry: GroundPlaneMetricPoint[]; status: 'FIT' | 'NOT_FIT'; }
export interface VirtualFittingResult { canonical_width_m: number; canonical_length_m: number; orientation_rule: string; rows: { row_id: string; candidate_sample_count: number; fit_sample_count: number; not_fit_sample_count: number }[]; placements?: VirtualFittingPlacement[]; }
export interface BlockingContributionResult { detection_id: string; row_id: string; assignment_state: string; v2_row: string | null; intersection_area_m2: number; footprint_area_m2: number; intersection_ratio: number; block_reason: string; intersection_geometry: GroundPlaneMetricPoint[]; }
export interface OccupiedGeometryComponent { component_index: number; geometry: MetricMultiPolygon; area_m2: number; contributor_detection_ids: string[]; }
export interface OccupiedSpacePresentation { rows: Array<OccupiedRowResult & { blocking_motorcycle_count: number; assigned_block_count: number; cross_row_block_count: number; ambiguous_block_count: number; unassigned_block_count: number; raw_intersection_sum_m2: number; deduplicated_overlap_m2: number; remaining_geometric_area_m2: number; remaining_geometric_percent: number; contributions: BlockingContributionResult[]; components?: OccupiedGeometryComponent[] }>; included_without_row_block: string[]; }
export interface FreeSpacePresentation { rows: FreeRowResult[]; diagnostics: { valid: boolean; errors: string[] }; }
export interface ParkingAnalysisResponse {
  analysis_version: string; camera_id: string;
  image: { width: number; height: number };
  detection_summary: { detected: number; metric_projected: number; parking_included: number; parking_excluded: number };
  detections: MetricMotorcycle[];
  physical_map: { parking_roi: GroundPlaneMetricPoint[] | null; parking_roi_image_normalized?: MetricMultiPolygon | null; rows: PhysicalMapRowResult[] };
  occupied_space: { rows: OccupiedRowResult[] };
  free_space: { rows: FreeRowResult[] };
  fitting?: VirtualFittingResult | null;
  virtual_fitting?: { rows: Array<{ row_id: string; status: 'FIT' | 'NO_FIT'; feasible_component_count?: number; validation?: { valid: boolean } }> } | null;
  capacity?: { rows: Array<{ row_id: string; capacity: number; placements?: unknown[]; validation?: { valid: boolean } }> } | null;
  parking_state?: { rows: ParkingStateRow[]; validation: boolean } | null;
  uncertainty?: { rows: UncertaintyRow[]; validation: boolean } | null;
  witness_uncertainty_experiment?: WitnessUncertaintyExperiment | null;
  witness_safety?: WitnessSafety | null;
  placement_recommendation?: PlacementRecommendationResponse | null;
  rearrangement_plan?: { version: 'V1'; plans: RearrangementPlanRow[]; validation: boolean } | null;
  field_pitch_experiment?: FieldPitchExperiment | null;
  diagnostics?: Record<string, unknown>;
}
export type WitnessSafety = WitnessUncertaintyExperiment & { provenance: 'PRODUCTION_WITNESS_SAFETY_V1'; rows: Array<WitnessUncertaintyExperiment['rows'][number] & { safe_capacity: number; blocked_capacity: number; invalid_capacity: number }> };
export interface WitnessUncertaintyExperiment { status: 'EXPERIMENTAL'; provenance: string; rows: Array<{ row_id: string; row_state: ParkingState; capacity: number; clear_witness_count: number; blocked_witness_count: number; invalid_witness_count: number; witnesses: Array<{ witness_index: number; uncertainty_status: 'CLEAR' | 'BLOCKED_BY_UNCERTAINTY' | 'INVALID'; uncertainty_evidence_ids: string[]; overlaps: Array<{ detection_id: string; intersection_area_m2: number }> }>; validation: boolean }>; validation: boolean; }

export interface RearrangementPlanRow { version: 'V1'; status: 'READY' | 'NOT_APPLICABLE' | 'INVALID'; validation: boolean; row_id: string; source: 'REPACKING_WITNESS' | 'NONE'; current_load: number; current_additional_capacity: number; repacked_total_capacity: number; repacked_additional_capacity: number; repacking_gain: number; target_arrangement: { placement_count: number; placements: unknown[] }; movement_assignment: { status: 'NOT_COMPUTED' }; }
export interface UncertaintyEvidence { detection_id: string; reason: string; affected_row_id: string; intersection_area_m2: number; }
export interface UncertaintyRow { row_id: string; status: 'CLEAR' | 'UNCERTAIN'; affected_detection_ids: string[]; reasons: string[]; evidence: UncertaintyEvidence[]; validation: boolean; }
export interface FieldPitchPlacement { footprint_metric: MetricMultiPolygon; }
export interface FieldPitchRow { row_id: string; capacity: number; witness_count: number; placements: FieldPitchPlacement[]; validation: boolean; validation_details?: Record<string, boolean>; }
export interface FieldPitchExperiment { status: 'EXPERIMENTAL'; provenance: string; width_m: number; length_m: number; validation: boolean; rows: FieldPitchRow[]; }

export type ParkingState = 'AVAILABLE' | 'ADJUSTABLE' | 'UNAVAILABLE' | 'UNCERTAIN';
export interface ParkingStateRow {
  row_id: string;
  state: ParkingState;
  capacity: number;
  uncertainty: 'CLEAR' | 'UNCERTAIN';
  evidence_ids: string[];
  decision_reason: string;
  validation: boolean;
}
export interface PlacementRecommendationRow { row_id: string; status: 'PARK_HERE' | 'NOT_RECOMMENDED' | 'INVALID'; reason: string; parking_state: 'AVAILABLE' | 'ADJUSTABLE' | 'UNAVAILABLE' | 'UNCERTAIN' | null; current_capacity: number; recommended_placement: { source: string; witness_index: number; geometry: MetricMultiPolygon; anchor_metric?: GroundPlaneMetricPoint; width_m: number; length_m: number } | null; selection_policy?: string; validation: boolean; }
export interface PlacementRecommendationResponse { rows: PlacementRecommendationRow[]; validation: boolean; }

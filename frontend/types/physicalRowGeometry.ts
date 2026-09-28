import type { CalibrationPoint } from './calibration';
import type { GroundPlaneMetricPoint } from './groundPlaneCalibration';
import type { MetricMeasurementSource, MetricRowId } from './metricCalibration';

export interface PhysicalRowEndpoint { clicked_image: CalibrationPoint; effective_image: CalibrationPoint; snapped_to_roi_boundary: boolean; }
export interface PhysicalRowEndpointPair { start: PhysicalRowEndpoint | null; end: PhysicalRowEndpoint | null; }
export interface PhysicalRowGeometryConfig { schema_version: 1; camera_id: string; measurement_source_fingerprint: string; rows: Partial<Record<MetricRowId, PhysicalRowEndpointPair>>; }
export interface EndpointDiagnostic extends PhysicalRowEndpoint { roi_boundary_distance_normalized: number; near_roi_boundary: boolean; nearest_roi_boundary: CalibrationPoint; }
export interface PhysicalRowDiagnostic { row_id: MetricRowId; status: 'NOT_CALIBRATED' | 'CALIBRATED' | 'CHECK_MEASUREMENT'; measured_length_m: number | null; measured_width_m: number | null; provenance: MetricMeasurementSource | null; start: EndpointDiagnostic | null; end: EndpointDiagnostic | null; homography_distance_m: number | null; difference_m: number | null; absolute_error_m: number | null; relative_error_percent: number | null; start_metric: GroundPlaneMetricPoint | null; clicked_end_metric: GroundPlaneMetricPoint | null; measured_model_end_metric: GroundPlaneMetricPoint | null; endpoint_discrepancy_m: number | null; physical_polygon: GroundPlaneMetricPoint[] | null; }
export interface PhysicalRowGeometryResponse { config: PhysicalRowGeometryConfig; status: 'CURRENT' | 'STALE'; homography_current: boolean; measurement_source_current: boolean; warning_relative_percent: number; rows: PhysicalRowDiagnostic[]; }

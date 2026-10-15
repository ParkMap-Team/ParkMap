export type MetricMeasurementSource = 'MEASURED' | 'ESTIMATED';
export type MetricRowId = `row_${number}`;

/** ESTIMATED inputs need a positive uncertainty and an estimation basis; MEASURED inputs carry no basis. */
export interface GroundProvenance { provenance: MetricMeasurementSource; uncertainty_m?: number | null; estimation_basis?: string | null; }
export interface GroundControlPoint extends GroundProvenance { id: string; image_x: number; image_y: number; ground_x_m: number; ground_y_m: number; }
export interface GroundReferenceDistance { id: string; point_a: string; point_b: string; distance_m: number; provenance: MetricMeasurementSource; }
export interface GroundMeasuredRow extends GroundProvenance { length_m: number | null; width_m: number | null; }
export interface GroundPlaneCalibration { schema_version: 1; camera_id: string; reference_image: { width: number; height: number }; coordinate_system: { unit: 'meter'; description: string }; control_points: GroundControlPoint[]; reference_distances: GroundReferenceDistance[]; measured_rows: Partial<Record<MetricRowId, GroundMeasuredRow>>; }
export interface GroundPlaneCalibrationResponse { status: 'NOT_READY' | 'READY_FOR_HOMOGRAPHY'; control_point_count: number; measured_point_count: number; minimum_required: 4; provenance: MetricMeasurementSource; calibration: GroundPlaneCalibration; }
export type GroundPlaneHomographyStatus = 'INPUT_NOT_READY' | 'CALCULATED' | 'VALIDATED' | 'VALIDATION_WARNING' | 'INVALID' | 'STALE';
export interface GroundPlanePointDiagnostic { id: string; measured_x_m: number; measured_y_m: number; projected_x_m: number; projected_y_m: number; error_x_m: number; error_y_m: number; error_m: number; inlier: boolean; }
export interface GroundPlaneMetricPoint { x_m: number; y_m: number; }
export interface GroundPlaneMetricPolygon { id: string; points: GroundPlaneMetricPoint[]; longitudinal_extent_m: number; cross_extent_m: number; measured_length_m: number | null; measured_width_m: number | null; length_difference_m: number | null; width_difference_m: number | null; }
export interface GroundPlaneHomographyResult { schema_version: 1; camera_id: string; source_calibration_fingerprint: string; row_measurements_fingerprint: string; matrix: number[][]; inverse_matrix: number[][]; control_point_count: number; inlier_count: number; rmse_m: number; mean_error_m: number; median_error_m: number; max_error_m: number; warning_rmse_m: number; warning_max_error_m: number; status: GroundPlaneHomographyStatus; calculated_at: string; method: 'NORMALIZED_DLT_SVD'; ransac_used: false; point_diagnostics: GroundPlanePointDiagnostic[]; roi_metric: GroundPlaneMetricPolygon | null; rows_metric: GroundPlaneMetricPolygon[]; }
export interface GroundPlaneHomographyResponse { status: GroundPlaneHomographyStatus; current: boolean; row_validation_current: boolean; message: string; result: GroundPlaneHomographyResult | null; }

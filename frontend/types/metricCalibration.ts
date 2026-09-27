export type MetricCalibrationStatus = 'NOT_CALIBRATED' | 'PARTIALLY_CALIBRATED' | 'CALIBRATED';
export type MetricMeasurementSource = 'ESTIMATED' | 'MEASURED';
export type MetricRowId = `row_${1 | 2 | 3 | 4 | 5}`;

export interface MetricRowMeasurement { id: MetricRowId; length_m: number; }
export interface MetricReferenceSegment { id: string; label: string; distance_m: number; image_start: { x: number; y: number }; image_end: { x: number; y: number }; }
export interface MetricGroundControlPoint { id: string; image: { x: number; y: number }; ground: { x_m: number; y_m: number }; }
export interface MetricCalibration { schema_version: 1; camera_id: string; unit: 'meter'; measurement_source: MetricMeasurementSource; rows: MetricRowMeasurement[]; reference_segments: MetricReferenceSegment[]; ground_control_points: MetricGroundControlPoint[]; }
export interface MetricCalibrationResponse { status: MetricCalibrationStatus; measurement_source: MetricMeasurementSource; row_measurements_complete: boolean; ground_plane_calibration_available: false; calibration: MetricCalibration | null; }
export type MetricConversionResult = { ok: true; position_m: number } | { ok: false; error: 'INVALID_NORMALIZED_POSITION' | 'MISSING_ROW_LENGTH' | 'INVALID_ROW_LENGTH' };

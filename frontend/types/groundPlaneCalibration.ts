import type { MetricMeasurementSource, MetricRowId } from './metricCalibration';

export interface GroundControlPoint { id: string; image_x: number; image_y: number; ground_x_m: number; ground_y_m: number; provenance: MetricMeasurementSource; }
export interface GroundReferenceDistance { id: string; point_a: string; point_b: string; distance_m: number; provenance: MetricMeasurementSource; }
export interface GroundMeasuredRow { length_m: number | null; width_m: number | null; provenance: MetricMeasurementSource; }
export interface GroundPlaneCalibration { schema_version: 1; camera_id: string; reference_image: { width: number; height: number }; coordinate_system: { unit: 'meter'; description: string }; control_points: GroundControlPoint[]; reference_distances: GroundReferenceDistance[]; measured_rows: Partial<Record<MetricRowId, GroundMeasuredRow>>; }
export interface GroundPlaneCalibrationResponse { status: 'NOT_READY' | 'READY_FOR_HOMOGRAPHY'; control_point_count: number; measured_point_count: number; minimum_required: 4; calibration: GroundPlaneCalibration; }

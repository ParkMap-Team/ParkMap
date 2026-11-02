import type { MetricMotorcycleMapping } from '../types/metricMotorcycle';
import type { GroundPlaneMetricPoint } from '../types/groundPlaneCalibration';

type BackendFootprint = {
  detection_index: number;
  canonical_footprint: { polygons: GroundPlaneMetricPoint[][][] };
  footprint_area_m2: number;
  metric_ground_point: GroundPlaneMetricPoint;
  inside_parking_roi: boolean;
};

/** Display the geometry calculated by Python; do not reconstruct size rules here. */
export function referenceSizeGeometry(mapping: MetricMotorcycleMapping, detections: BackendFootprint[]): MetricMotorcycleMapping {
  const byIndex = new Map(detections.map(item => [item.detection_index, item]));
  return { ...mapping, motorcycles: mapping.motorcycles.map(item => {
    const backend = byIndex.get(item.detection_index);
    if (!backend) return item;
    return { ...item, footprint_polygon: backend.canonical_footprint.polygons[0]?.[0] ?? null,
      footprint_area_m2: backend.footprint_area_m2, metric_point: backend.metric_ground_point,
      inside_parking_roi: backend.inside_parking_roi };
  }) };
}

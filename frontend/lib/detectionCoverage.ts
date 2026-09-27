export interface DetectionCoverageToggles { yolo_boxes: boolean; detection_ids: boolean; parking_roi: boolean; row_polygons: boolean; ground_points: boolean; ground_proxy: boolean; }
export const DEFAULT_DETECTION_COVERAGE_TOGGLES: DetectionCoverageToggles = { yolo_boxes: true, detection_ids: true, parking_roi: true, row_polygons: true, ground_points: true, ground_proxy: true };
export function toggleDetectionCoverage(state: DetectionCoverageToggles, key: keyof DetectionCoverageToggles): DetectionCoverageToggles { return { ...state, [key]: !state[key] }; }

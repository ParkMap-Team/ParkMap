import type { components } from '../types/api.gen';

type Gaps = components['schemas']['SegmentationGapResult'];
// Present the backend's recorded decision; do not calculate row ownership here.
export function segDetectionInspection(index: number, gaps?: Gaps | null) {
  const id = `detection_${index+1}`;
  const assignment = gaps?.detection_row_assignments?.find(item => item.detection_id === id);
  const layer = gaps?.occupied_layers.find(item => item.source === 'SEGMENTATION'
    && (item.detection_index != null ? item.detection_index === index : item.detection_id === id));
  const status = !gaps ? 'NO_ANALYSIS' : layer ? layer.assigned_row_id ? 'ASSIGNED' : 'UNRESOLVED'
    : gaps.excluded_detection_ids.includes(id) ? 'EXCLUDED' : 'NO_RECORD';
  return { id, layer, assignment, status,
    redBandVisible: !!(layer?.row_depth_geometry ?? layer?.roi_geometry)?.polygons.length };
}

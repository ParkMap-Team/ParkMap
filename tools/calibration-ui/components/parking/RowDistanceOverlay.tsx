import type { components } from '@/types/api.gen';

type Assignment = components['schemas']['GapDetectionRowAssignment'];
const color = '#be185d';
const label = (assignment: Assignment) => `${assignment.nearest_row_id ?? ''} · ≈ ${((assignment.distance_m ?? 0)*100).toFixed(1)} ซม.`;

export function RowDistanceImageOverlay({ assignment }: { assignment?: Assignment }) {
  const line = assignment?.distance_line_image;
  if (!assignment || line?.length !== 2 || assignment.distance_m == null) return null;
  const [start, end] = line;
  return <g className="pointer-events-none" data-image-row-distance={assignment.detection_id}>
    <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="white" strokeWidth="5" vectorEffect="non-scaling-stroke" />
    <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    <path d={`M${start.x-.004},${start.y} H${start.x+.004} M${start.x},${start.y-.004} V${start.y+.004}`} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    <circle data-row-distance-end="image" cx={end.x} cy={end.y} r=".0035" fill="white" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    <text x={Math.max(.1, Math.min(.9, (start.x+end.x)/2))} y={Math.max(.025, (start.y+end.y)/2-.012)} textAnchor="middle" fontSize=".02" fontWeight="600" fill={color} stroke="white" strokeWidth=".002" paintOrder="stroke">{label(assignment)}</text>
  </g>;
}

export function RowDistanceMetricOverlay({ assignment, unit }: { assignment?: Assignment; unit: number }) {
  const line = assignment?.distance_line_metric;
  if (!assignment || line?.length !== 2 || assignment.distance_m == null) return null;
  const [start, end] = line;
  const labelX = (start.x_m+end.x_m)/2, labelY = (start.y_m+end.y_m)/2+unit*.8;
  return <g className="pointer-events-none" data-metric-row-distance={assignment.detection_id}>
    <line x1={start.x_m} y1={start.y_m} x2={end.x_m} y2={end.y_m} stroke="white" strokeWidth={unit*.4} />
    <line x1={start.x_m} y1={start.y_m} x2={end.x_m} y2={end.y_m} stroke={color} strokeWidth={unit*.16} />
    <path d={`M${start.x_m-unit*.3},${start.y_m} H${start.x_m+unit*.3} M${start.x_m},${start.y_m-unit*.3} V${start.y_m+unit*.3}`} fill="none" stroke={color} strokeWidth={unit*.14} />
    <circle data-row-distance-end="metric" cx={end.x_m} cy={end.y_m} r={unit*.22} fill="white" stroke={color} strokeWidth={unit*.12} />
    <text x={labelX} y={labelY} transform={`translate(0 ${2*labelY}) scale(1 -1)`} textAnchor="middle" fontSize={unit*1.6} fontWeight="600" fill={color} stroke="white" strokeWidth={unit*.1} paintOrder="stroke">{label(assignment)}</text>
  </g>;
}

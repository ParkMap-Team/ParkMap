import type { MetricMotorcycleMapping } from '@/types/metricMotorcycle';
import type { PhysicalRowGeometryResponse } from '@/types/physicalRowGeometry';
import type { GroundPlaneHomographyResponse, GroundPlaneMetricPoint } from '@/types/groundPlaneCalibration';
import type { AlmostAvailablePlacement, FreeSpacePresentation, OccupiedSpacePresentation, PlacementRecommendationResponse, ParkingStateRow, ParkingAnalysisResponse, UncertaintyRow, FieldPitchExperiment } from '@/types/parkingAnalysis';
import { parkingMapMotorcycles, parkingMapRoi } from '@/lib/metricMotorcycle';
import { normalizeDetectionId } from '@/lib/detectionIdentity';

type Props = {
  physical: PhysicalRowGeometryResponse | null;
  mapping: MetricMotorcycleMapping | null;
  homography: GroundPlaneHomographyResponse | null;
  occupiedSpace?: OccupiedSpacePresentation | null;
  freeSpace?: FreeSpacePresentation | null;
  fitting?: unknown;
  recommendations?: PlacementRecommendationResponse | null;
  capacity?: ParkingAnalysisResponse['capacity'];
  witnessSafety?: ParkingAnalysisResponse['witness_safety'];
  parkingState?: { rows: ParkingStateRow[]; validation: boolean } | null;
  uncertainty?: { rows: UncertaintyRow[]; validation: boolean } | null;
  selectedEvidenceDetectionId?: string | null;
  onSelectDetection?: (id: string) => void;
  selectedOccupiedRowId?: string | null;
  onSelectOccupiedRow?: (rowId: string) => void;
  selectedOccupiedComponentKey?: string | null;
  onSelectOccupiedComponent?: (rowId: string, index: number) => void;
  fieldPitch?: FieldPitchExperiment | null;
  showFieldPitch?: boolean;
  almostAvailablePlacements?: AlmostAvailablePlacement[];
};

export function PhysicalMeasuredMap({ physical, mapping, homography, occupiedSpace, freeSpace, recommendations, capacity, witnessSafety, parkingState, uncertainty, selectedEvidenceDetectionId, onSelectDetection, onSelectOccupiedRow, selectedOccupiedComponentKey, onSelectOccupiedComponent, fieldPitch, showFieldPitch = false, almostAvailablePlacements = [] }: Props) {
  const rows = physical?.rows.filter((row) => row.status === 'PHYSICAL_READY' && row.physical_polygon) ?? [];
  if (!rows.length) {
    return <section className="grid min-h-80 place-items-center rounded-2xl border border-amber-200 bg-amber-50 p-6"><h2>Parking map needs calibration</h2></section>;
  }

  const motorcycles = parkingMapMotorcycles(mapping);
  const footprints = motorcycles.filter((motorcycle) => motorcycle.footprint_polygon);
  const roi = parkingMapRoi(homography);
  const parkHere = (recommendations?.rows ?? []).flatMap((row) => {
    const geometry = row.recommended_placement?.geometry;
    const polygons = geometry?.polygons ?? [];
    if (row.status !== 'PARK_HERE' || row.validation !== true || row.recommended_placement?.source !== 'CURRENT_CAPACITY_WITNESS') return [];
    return polygons.flatMap((rings) => {
      const ring = rings[0];
      if (!ring || ring.length < 3 || ring.some((point) => !Number.isFinite(point.x_m) || !Number.isFinite(point.y_m))) return [];
      return [{ row, rings }];
    });
  });
  const stateByRow = new Map((parkingState?.rows ?? []).map((row) => [row.row_id, row]));
  const uncertaintyByDetection = new Map<string, UncertaintyRow['evidence']>();
  (uncertainty?.rows ?? []).forEach((row) => row.evidence.forEach((evidence) => { const id = normalizeDetectionId(evidence.detection_id); uncertaintyByDetection.set(id, [...(uncertaintyByDetection.get(id) ?? []), evidence]); }));
  const capacityWitnesses = rows.flatMap((physicalRow) => {
    const state = stateByRow.get(physicalRow.row_id);
    const capacityRow = capacity?.rows.find((row) => row.row_id === physicalRow.row_id);
    const validCapacity = capacityRow?.validation?.valid === true;
    const safetyRow = witnessSafety?.rows.find((item) => item.row_id === physicalRow.row_id);
    if (!state || state.validation !== true || !capacityRow || !validCapacity || !safetyRow || !Number.isInteger(capacityRow.capacity) || capacityRow.capacity <= 0 || !capacityRow.placements || capacityRow.placements.length !== capacityRow.capacity) return [];
    const parsed = capacityRow.placements.flatMap((placement, index) => {
      if (safetyRow.witnesses[index]?.uncertainty_status !== 'CLEAR') return [];
      const geometry = (placement as { footprint_metric?: { polygons?: GroundPlaneMetricPoint[][][] } }).footprint_metric;
      const ring = geometry?.polygons?.[0]?.[0];
      if (!ring || ring.length < 3 || ring.some((point) => !Number.isFinite(point.x_m) || !Number.isFinite(point.y_m))) return [];
      return [{ rowId: physicalRow.row_id, index, ring }];
    });
    return parsed.length === capacityRow.capacity ? parsed : [];
  });
  const almostAvailableWitnesses = almostAvailablePlacements.flatMap((placement, index) => {
    if (placement.status !== 'ALMOST_AVAILABLE') return [];
    const ring = placement.footprint_metric.polygons?.[0]?.[0];
    if (!ring || ring.length < 3 || ring.some((point) => !Number.isFinite(point.x_m) || !Number.isFinite(point.y_m))) return [];
    return [{ rowId: placement.row_id, index, ring }];
  });
  const fieldPitchWitnesses = showFieldPitch && fieldPitch?.status === 'EXPERIMENTAL' && fieldPitch.validation === true && Math.abs(fieldPitch.width_m - 0.66) < 1e-6 && Math.abs(fieldPitch.length_m - 2) < 1e-6 ? fieldPitch.rows.flatMap((row) => {
    if (!row.validation || row.capacity < 0 || row.witness_count !== row.capacity || row.placements.length !== row.capacity) return [];
    const parsed = row.placements.flatMap((placement, index) => { const ring = placement.footprint_metric?.polygons?.[0]?.[0]; return ring && ring.length >= 3 && ring.every((point) => Number.isFinite(point.x_m) && Number.isFinite(point.y_m)) ? [{ rowId: row.row_id, index, ring }] : []; });
    return parsed.length === row.capacity ? parsed : [];
  }) : [];

  const points = [...rows.flatMap((row) => row.physical_polygon!), ...roi, ...motorcycles.map((motorcycle) => motorcycle.metric_point!), ...footprints.flatMap((motorcycle) => motorcycle.footprint_polygon!), ...parkHere.flatMap((item) => item.rings[0]), ...almostAvailableWitnesses.flatMap((item) => item.ring)];
  const xs = points.map((point) => point.x_m);
  const ys = points.map((point) => point.y_m);
  const pad = 1.5;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX + pad * 2;
  const height = maxY - minY + pad * 2;
  const polygon = (vertices: GroundPlaneMetricPoint[]) => vertices.map((point) => `${point.x_m},${-point.y_m}`).join(' ');
  const path = (rings: GroundPlaneMetricPoint[][]) => rings.map((ring) => `M ${ring.map((point) => `${point.x_m} ${-point.y_m}`).join(' L ')} Z`).join(' ');

  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="border-b px-5 py-4"><h2 className="font-semibold">Parking map</h2></div>
    <div className="bg-slate-950 p-4">
      <svg viewBox={`${minX - pad} ${-(maxY + pad)} ${width} ${height}`} className="w-full">
        {roi.length >= 3 && <polygon points={polygon(roi)} fill="none" stroke="#64748b" strokeWidth=".05" />}
        {rows.map((row) => <g key={row.row_id}>
          <polygon points={polygon(row.physical_polygon!)} fill="rgba(248,250,252,.04)" stroke="#cbd5e1" strokeWidth=".04" />
          <text x={row.physical_polygon![0].x_m} y={-row.physical_polygon![0].y_m} dx=".2" dy="-.2" fill="#cbd5e1" fontSize=".55" fontWeight="600">{row.row_id.replace('row_', 'R')}</text>
        </g>)}
        {(freeSpace?.rows ?? []).flatMap((row) => row.free_geometry.polygons.map((rings, index) => <path key={`${row.row_id}-f-${index}`} d={path(rings)} fill="rgba(134,239,172,.12)" fillRule="evenodd" />))}
        {(occupiedSpace?.rows ?? []).flatMap((row) => row.occupied_geometry.polygons.map((rings, index) => { const key = `${row.row_id}:${index}`; const selectedComponent = selectedOccupiedComponentKey === key; return <path key={`${row.row_id}-o-${index}`} onClick={() => { onSelectOccupiedRow?.(row.row_id); onSelectOccupiedComponent?.(row.row_id, index); }} className="cursor-pointer" d={path(rings)} fill={selectedComponent ? "rgba(248,113,113,.56)" : "rgba(248,113,113,.28)"} stroke={selectedComponent ? "#fda4af" : "none"} strokeWidth={selectedComponent ? ".12" : "0"} fillRule="evenodd" />; }))}
        {footprints.map((motorcycle) => { const id = normalizeDetectionId(motorcycle.detection_id); const evidence = uncertaintyByDetection.get(id) ?? []; const selected = selectedEvidenceDetectionId === id; return <g key={motorcycle.detection_id} opacity={selectedEvidenceDetectionId && !selected ? '.45' : '1'}><polygon onClick={() => onSelectDetection?.(id)} className="cursor-pointer" points={polygon(motorcycle.footprint_polygon!)} fill={selected ? 'rgba(239,68,68,.45)' : 'rgba(239,68,68,.2)'} stroke={selected ? '#f87171' : evidence.length ? '#fb7185' : '#ef4444'} strokeWidth={selected ? '.16' : evidence.length ? '.1' : '.04'} opacity=".9" /><title>{evidence.length ? `${id} เน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเธขยเน€เธยเธขยเน€เธยเน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเธขยเน€เธเธเธขยเน€เธโฌเน€เธยเธขยเน€เธเธเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเธขยเน€เธยเธขยเน€เธยเน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเธขยเน€เธเธเธขยเน€เธโฌเน€เธยเน€เธยเน€เธเธเธขยเน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธเธเธขยเน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเธขยเน€เธยเธขยเน€เธยเน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเธขยเน€เธเธเธขยเน€เธโฌเน€เธยเน€เธยเน€เธเธเธขยเน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธเธเธขยเน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเธขยเน€เธยเธขยเน€เธยเน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเธขยเน€เธเธเธขยเน€เธโฌเน€เธยเน€เธยเน€เธเธเธขยเน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเธขยเน€เธยเธขยเน€เธยเน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเธขยเน€เธเธเธขยเน€เธโฌเน€เธยเน€เธยเน€เธเธเธขยเน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเธขยเน€เธเธเธขยเน€เธโฌเน€เธยเน€เธยเน€เธเธเธขยเน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเธขยเน€เธเธเธขยเน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธเธเธขย ${evidence.map((item) => `${item.reason} (${item.affected_row_id})`).join(', ')}` : id}</title>{selected && <text x={motorcycle.metric_point?.x_m ?? 0} y={-(motorcycle.metric_point?.y_m ?? 0)} fill="#fff1f2" stroke="#881337" strokeWidth=".03" paintOrder="stroke" fontSize=".5" fontWeight="700" textAnchor="middle">{id}</text>}{!selected && evidence.length && <text x={motorcycle.metric_point?.x_m ?? 0} y={-(motorcycle.metric_point?.y_m ?? 0)} fill="#fecdd3" fontSize=".3" textAnchor="middle">#{motorcycle.detection_index + 1}</text>}</g>; })}
        {fieldPitchWitnesses.map(({ rowId, index, ring }) => <g key={`field-pitch-${rowId}-${index}`}><polygon points={polygon(ring)} fill="rgba(168,85,247,.12)" stroke="#c084fc" strokeDasharray=".12 .08" strokeWidth=".05" /><text x={ring[0].x_m} y={-ring[0].y_m} fill="#e9d5ff" fontSize=".2">FP {rowId.replace('row_', 'R')}-{String(index + 1).padStart(2, '0')}</text></g>)}
        {capacityWitnesses.map(({ rowId, index, ring }) => <polygon key={`capacity-${rowId}-${index}`} points={polygon(ring)} fill="rgba(52,211,153,.16)" stroke="#34d399" strokeWidth=".04" />)}
        {almostAvailableWitnesses.map(({ rowId, index, ring }) => <polygon key={`almost-available-${rowId}-${index}`} points={polygon(ring)} fill="rgba(250,204,21,.16)" stroke="#facc15" strokeWidth=".04" />)}
        {parkHere.map(({ row, rings }) => {
          const screen = rings[0].map((point) => ({ x: point.x_m, y: -point.y_m }));
          const label = screen.reduce((accumulator, point) => ({ x: accumulator.x + point.x / screen.length, y: accumulator.y + point.y / screen.length }), { x: 0, y: 0 });
          return <g key={`park-here-${row.row_id}`}>
            <path d={path(rings)} fill="rgba(52,211,153,.6)" stroke="#34d399" strokeWidth=".12" vectorEffect="non-scaling-stroke" />
            <line x1={label.x} y1={label.y} x2={label.x + .9} y2={label.y - .35} stroke="#6ee7b7" strokeWidth=".04" vectorEffect="non-scaling-stroke" />
            <text x={label.x + 1} y={label.y - .05} fill="#a7f3d0" textAnchor="start" fontSize=".23">{row.row_id.replace('row_', 'R')}</text>
          </g>;
        })}
      </svg>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300" aria-label="Map legend">
        <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />Occupied</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm border border-slate-300" />Parking row</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm border border-emerald-400 bg-emerald-400/20" />Available parking</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm border border-yellow-400 bg-yellow-400/20" />Almost available</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-400" />Recommended parking</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-rose-400" />Uncertainty evidence</span>
      </div>
    </div>
  </section>;
}

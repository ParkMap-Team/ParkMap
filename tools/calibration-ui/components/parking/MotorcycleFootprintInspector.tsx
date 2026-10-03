import type { MetricMotorcycleMapping } from '@/types/metricMotorcycle';
import type { ParkingAnalysisResponse } from '@/types/parkingAnalysis';
import type { OccupiedSpacePresentation } from '@/types/parkingAnalysis';
import { normalizeDetectionId } from '@/lib/detectionIdentity';

type Props = {
  mapping: MetricMotorcycleMapping | null;
  analysis: ParkingAnalysisResponse | null | undefined;
  selectedDetectionId: string | null;
  onSelect: (id: string) => void;
  onClear: () => void;
  occupiedSpace?: OccupiedSpacePresentation | null;
  selectedOccupiedRowId?: string | null;
  onSelectOccupiedRow: (rowId: string | null) => void;
  selectedOccupiedComponentKey?: string | null;
  onSelectOccupiedComponent: (rowId: string, index: number) => void;
};

const value = (item: unknown) => item === null || item === undefined || item === '' ? 'Unavailable' : typeof item === 'object' ? JSON.stringify(item) : String(item as string | number | boolean);

export function MotorcycleFootprintInspector({ mapping, analysis, selectedDetectionId, onSelect, onClear, occupiedSpace, selectedOccupiedRowId, onSelectOccupiedRow, selectedOccupiedComponentKey, onSelectOccupiedComponent }: Props) {
  const items = mapping?.motorcycles.filter((item) => item.footprint_polygon) ?? [];
  const selected = items.find((item) => normalizeDetectionId(item.detection_id) === selectedDetectionId) ?? null;
  const backend = selected && analysis?.detections.find((item) => normalizeDetectionId(item.detection_id) === normalizeDetectionId(selected.detection_id));
  const uncertainty = analysis?.uncertainty?.rows.flatMap((row) => row.evidence.map((evidence) => ({ ...evidence, row_id: row.row_id }))).filter((evidence) => normalizeDetectionId(evidence.detection_id) === normalizeDetectionId(selected?.detection_id ?? '')) ?? [];
  const occupiedRows = occupiedSpace?.rows ?? [];
  const selectedOccupied = occupiedRows.find((row) => row.row_id === selectedOccupiedRowId) ?? null;
  const selectedComponentIndex = selectedOccupiedComponentKey?.startsWith(`${selectedOccupiedRowId ?? ''}:`) ? Number(selectedOccupiedComponentKey.split(':')[1]) : null;
  const selectedComponent = selectedOccupied && selectedComponentIndex !== null ? (selectedOccupied.components ?? [])[selectedComponentIndex] : null;

  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="footprint-inspector-title">
    <div className="flex items-center justify-between gap-3"><h2 id="footprint-inspector-title" className="font-semibold">Motorcycle footprint inspector</h2>{selected && <button type="button" onClick={onClear} className="text-sm font-semibold text-slate-600 hover:text-slate-900">Clear selection</button>}</div>
    <p className="mt-1 text-sm text-slate-500">Select a canonical footprint on the map to trace its backend provenance.</p>
    {items.length > 0 && <label className="mt-3 block text-sm"><span className="sr-only">Detections</span><select className="w-full rounded-lg border border-slate-300 px-3 py-2" value={selectedDetectionId ?? ''} onChange={(event) => event.target.value ? onSelect(event.target.value) : onClear()}><option value="">Select a detection</option>{items.map((item) => <option key={item.detection_id} value={normalizeDetectionId(item.detection_id)}>{normalizeDetectionId(item.detection_id)}</option>)}</select></label>}
    <div className="mt-4 border-t border-slate-100 pt-4"><div className="flex items-center justify-between"><h3 className="font-semibold">Occupied space</h3>{selectedOccupied && <button type="button" onClick={() => onSelectOccupiedRow(null)} className="text-xs font-semibold text-slate-600">Clear occupied selection</button>}</div><select className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={selectedOccupiedRowId ?? ''} onChange={(event) => onSelectOccupiedRow(event.target.value || null)}><option value="">Select occupied geometry</option>{occupiedRows.map((row) => <option key={row.row_id} value={row.row_id}>{row.row_id.replace('row_', 'R')} — {(row.components ?? []).length} component(s)</option>)}</select>{selectedOccupied && <div className="mt-3 rounded-lg bg-rose-50 p-3 text-sm"><p className="font-semibold">Geometry Type: {selectedComponent ? 'OCCUPIED_SPACE_COMPONENT' : 'OCCUPIED_SPACE'}</p><p>Row: {selectedOccupied.row_id.replace('row_', 'R')}</p>{selectedComponent ? <><p>Component: {selectedComponentIndex! + 1}</p><p>Component Area: {selectedComponent.area_m2.toFixed(3)} m²</p><p className="mt-2 font-semibold">Contributing detections</p>{selectedComponent.contributor_detection_ids.map((id) => <button type="button" key={id} onClick={() => onSelect(normalizeDetectionId(id))} className="mt-1 block text-left text-rose-800 underline">{normalizeDetectionId(id)}</button>)}</> : <><p>Occupied Area: {selectedOccupied.occupied_union_area_m2.toFixed(3)} m²</p><p className="mt-2 font-semibold">Components</p>{(selectedOccupied.components ?? []).map((component) => <button type="button" key={component.component_index} onClick={() => onSelectOccupiedComponent(selectedOccupied.row_id, component.component_index)} className="mt-1 block text-left text-rose-800 underline">Component {component.component_index + 1} — {component.area_m2.toFixed(3)} m²</button>)}</>}</div>}</div>
    {!selected && !selectedOccupied && <p className="mt-4 text-sm text-slate-500">No geometry selected.</p>}
    {selected && <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
      <div><h3 className="font-semibold">Detection</h3><p>ID: {normalizeDetectionId(selected.detection_id)}</p><p>YOLO confidence: {value(backend?.confidence ?? selected.confidence)}</p><p>Inclusion: {selected.inside_parking_roi ? 'Included' : 'Excluded'}</p><p>Reason: {value(backend?.roi_inclusion_source ?? selected.roi_inclusion_source)}</p></div>
      <div><h3 className="font-semibold">Ground point</h3><p>Image: ({selected.image_ground_point.x.toFixed(4)}, {selected.image_ground_point.y.toFixed(4)})</p><p>Metric: {selected.metric_point ? `(${selected.metric_point.x_m.toFixed(3)}, ${selected.metric_point.y_m.toFixed(3)})` : 'Unavailable'}</p></div>
      <div><h3 className="font-semibold">Row assignment</h3><p>Status: {value(selected.row_assignment_v2.state)}</p><p>Assigned row: {value(selected.row_assignment_v2.assigned_row_id)}</p><p>Reason: {value(selected.row_assignment_v2.reason)}</p></div>
      <div><h3 className="font-semibold">Canonical footprint</h3><p>Dimensions: 0.66 × 2.00 m</p><p>Area: {selected.footprint_area_m2?.toFixed(3) ?? 'Unavailable'} m²</p><p>Source: CANONICAL_MOTORCYCLE_FOOTPRINT</p><p>Render source: mapping.motorcycles[].footprint_polygon</p></div>
      <div><h3 className="font-semibold">Row intersections</h3>{selected.row_overlaps.length ? selected.row_overlaps.filter((item) => item.intersection_area_m2 > 0).map((item) => <p key={item.row_id}>{item.row_id}: {item.intersection_area_m2.toFixed(3)} m²</p>) : <p>Unavailable</p>}</div>
      <div><h3 className="font-semibold">Uncertainty</h3>{uncertainty.length ? uncertainty.map((item) => <p key={`${item.detection_id}-${item.row_id}`}>{item.row_id}: {item.reason} ({item.intersection_area_m2.toFixed(3)} m²)</p>) : <p>No uncertainty contribution</p>}</div>
    </div>}
  </section>;
}

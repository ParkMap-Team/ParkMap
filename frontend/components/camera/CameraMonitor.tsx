import { Camera, Eye, EyeOff, ImageIcon } from 'lucide-react';
import { useState } from 'react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { DetectionRowAssignment, ParkingCalibration, RowOccupancyProjectionData } from '@/types/calibration';
import type { DetectionResponse } from '@/types/detection';
import type { GroundContactDiagnosticsData, VisualOccupancyDiagnosticsData } from '@/types/occupancyDiagnostics';
import type { OccupiedIntervalPrototypeData } from '@/types/occupiedIntervals';
import type { CameraData, CameraOverlay, ModelData, ParkingZone, SystemState } from '@/types/parking';

function formatTime(timestamp?: string | null) {
  return timestamp ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(timestamp)) : '—';
}

export function CameraMonitor({ camera, model, zone, overlays = [], status, imageUrl, imageDimensions, analysis, calibration, assignments = [], rowProjection, occupancyDiagnostics, groundContactDiagnostics, occupiedIntervals }: {
  camera?: CameraData;
  model?: ModelData;
  zone: ParkingZone;
  overlays?: CameraOverlay[];
  status: SystemState;
  imageUrl?: string | null;
  imageDimensions?: { width: number; height: number } | null;
  analysis?: DetectionResponse | null;
  calibration?: ParkingCalibration | null;
  assignments?: DetectionRowAssignment[];
  rowProjection?: RowOccupancyProjectionData | null;
  occupancyDiagnostics?: VisualOccupancyDiagnosticsData | null;
  groundContactDiagnostics?: GroundContactDiagnosticsData | null;
  occupiedIntervals?: OccupiedIntervalPrototypeData | null;
}) {
  const [showOverlays, setShowOverlays] = useState(true);
  const [showCalibration, setShowCalibration] = useState(false);
  const [showRowProjection, setShowRowProjection] = useState(false);
  const [showOccupancyDiagnostics, setShowOccupancyDiagnostics] = useState(false);
  const [showOccupiedIntervals, setShowOccupiedIntervals] = useState(false);
  const source = imageUrl ?? camera?.frameUrl;
  const width = imageDimensions?.width ?? analysis?.image_width ?? 1000;
  const height = imageDimensions?.height ?? analysis?.image_height ?? 562;

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div className="flex items-center gap-2"><Camera className="size-5 text-blue-600" /><h2 className="font-semibold">Camera monitoring</h2></div>
        <StatusBadge status={camera?.status ?? status} />
      </div>
      <div className="relative flex min-h-56 items-center justify-center overflow-hidden bg-slate-900">
        {source ? (
          <div className="relative inline-block max-h-[520px] max-w-full">
            <img src={source} alt={`Analysis source for ${camera?.name ?? 'ParkMap camera'}`} className="block max-h-[520px] max-w-full object-contain" />
            {(showOverlays || (showCalibration && calibration) || (showRowProjection && rowProjection) || (showOccupancyDiagnostics && occupancyDiagnostics) || (showOccupiedIntervals && occupiedIntervals)) && <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full" aria-label="Detection and parking assignment overlay">
              <defs><pattern id="ground-proxy-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#34d399" strokeWidth="3" /></pattern></defs>
              {showOccupancyDiagnostics && calibration?.rows.map((row) => <polygon key={`diagnostic-row-${row.id}`} points={row.polygon.map((point) => `${point.x * width},${point.y * height}`).join(' ')} fill="none" stroke="#c4b5fd" strokeWidth={Math.max(width, height) * .0015} strokeDasharray="5 5" />)}
              {showCalibration && calibration && [
                { id: 'parking-roi', label: 'Parking ROI', polygon: calibration.parking_roi.polygon, roi: true },
                ...calibration.rows.map((row, index) => ({ id: row.id, label: `R${index + 1}`, polygon: row.polygon, roi: false })),
              ].map((shape) => {
                const first = shape.polygon[0];
                return <g key={shape.id}><polygon points={shape.polygon.map((point) => `${point.x * width},${point.y * height}`).join(' ')} fill={shape.roi ? 'rgba(59,130,246,.08)' : 'rgba(245,158,11,.08)'} stroke={shape.roi ? '#60a5fa' : '#fbbf24'} strokeWidth={Math.max(width, height) * .0025} strokeDasharray={shape.roi ? '12 8' : undefined} />{first && <text x={first.x * width} y={Math.max(height * .025, first.y * height - height * .008)} fill={shape.roi ? '#93c5fd' : '#fde68a'} fontSize={height * .02} fontWeight="700">{shape.label}</text>}</g>;
              })}
              {showOverlays && overlays.map((overlay) => {
                if (overlay.type === 'roi' && overlay.points) return <polygon key={overlay.id} points={overlay.points.map((point) => `${point.x * width},${point.y * height}`).join(' ')} fill="rgba(59,130,246,.08)" stroke="#60a5fa" strokeWidth={Math.max(width, height) * .004} strokeDasharray="12 8" />;
                const x = (overlay.x ?? 0) * width, y = (overlay.y ?? 0) * height, boxWidth = (overlay.width ?? 0) * width, boxHeight = (overlay.height ?? 0) * height;
                return <g key={overlay.id}><rect x={x} y={y} width={boxWidth} height={boxHeight} fill="rgba(239,68,68,.08)" stroke="#fb7185" strokeWidth={Math.max(width, height) * .004} /><rect x={x} y={Math.max(0, y - height * .035)} width={Math.max(boxWidth, width * .13)} height={height * .035} fill="#e11d48" /><text x={x + width * .006} y={Math.max(height * .025, y - height * .009)} fill="white" fontSize={height * .022} fontWeight="700">{overlay.label ?? 'motorcycle'}</text></g>;
              })}
              {showOverlays && assignments.map((assignment) => {
                const markerX = assignment.ground_point.x * width;
                const markerY = assignment.ground_point.y * height;
                const markerRadius = Math.max(width, height) * .005;
                const color = assignment.status === 'ASSIGNED' ? '#22d3ee' : assignment.status === 'UNASSIGNED' ? '#fbbf24' : assignment.status === 'AMBIGUOUS' ? '#c084fc' : '#94a3b8';
                const label = assignment.status === 'ASSIGNED' ? `R${assignment.row_id?.split('_')[1]}` : assignment.status === 'UNASSIGNED' ? '?' : assignment.status === 'AMBIGUOUS' ? '!' : '';
                return <g key={`ground-${assignment.detection_index}`}><circle cx={markerX} cy={markerY} r={markerRadius} fill={color} stroke="#0f172a" strokeWidth={Math.max(width, height) * .0015} />{label && <text x={markerX + markerRadius * 1.5} y={markerY + markerRadius * .7} fill={color} stroke="#0f172a" strokeWidth={height * .002} paintOrder="stroke" fontSize={height * .024} fontWeight="800">{label}</text>}</g>;
              })}
              {showRowProjection && rowProjection?.rows.map((row) => row.centerline.ok && <g key={`projection-${row.row_id}`}>
                <line x1={row.centerline.centerline.start.x * width} y1={row.centerline.centerline.start.y * height} x2={row.centerline.centerline.end.x * width} y2={row.centerline.centerline.end.y * height} stroke="#22d3ee" strokeWidth={Math.max(width, height) * .0025} />
                <circle cx={row.centerline.centerline.start.x * width} cy={row.centerline.centerline.start.y * height} r={Math.max(width, height) * .005} fill="#22c55e" stroke="#0f172a" />
                <circle cx={row.centerline.centerline.end.x * width} cy={row.centerline.centerline.end.y * height} r={Math.max(width, height) * .005} fill="#ef4444" stroke="#0f172a" />
                {row.motorcycles.map((motorcycle) => <g key={`position-${motorcycle.detection_index}`}>
                  <line x1={motorcycle.ground_point.x * width} y1={motorcycle.ground_point.y * height} x2={motorcycle.row_position.projection.x * width} y2={motorcycle.row_position.projection.y * height} stroke="#67e8f9" strokeWidth={Math.max(width, height) * .0015} strokeDasharray="5 4" />
                  <circle cx={motorcycle.row_position.projection.x * width} cy={motorcycle.row_position.projection.y * height} r={Math.max(width, height) * .004} fill="#f8fafc" stroke="#0891b2" strokeWidth={Math.max(width, height) * .002} />
                  <text x={motorcycle.row_position.projection.x * width + width * .006} y={motorcycle.row_position.projection.y * height - height * .008} fill="#cffafe" stroke="#0f172a" strokeWidth={height * .002} paintOrder="stroke" fontSize={height * .019} fontWeight="700">t={motorcycle.row_position.t.toFixed(2)}</text>
                </g>)}
              </g>)}
              {showOccupiedIntervals && occupiedIntervals?.rows.map((row) => {
                if (!row.centerline.ok) return null;
                const centerline = row.centerline.centerline;
                return <g key={`occupied-intervals-${row.row_id}`}>
                  <line x1={centerline.start.x * width} y1={centerline.start.y * height} x2={centerline.end.x * width} y2={centerline.end.y * height} stroke="#94a3b8" strokeWidth={Math.max(width, height) * .0015} />
                  {row.gaps.map((gap, index) => <line key={`gap-${index}`} {...intervalLine(centerline, gap.t_start, gap.t_end, width, height)} stroke="#cbd5e1" strokeWidth={Math.max(width, height) * .006} strokeDasharray="8 6" />)}
                  {row.intervals.map((interval) => <line key={`individual-${interval.detection_index}-${interval.source_type}`} {...intervalLine(centerline, interval.t_start, interval.t_end, width, height)} stroke={interval.source_type === 'ASSIGNED' ? '#f59e0b' : '#d946ef'} strokeWidth={Math.max(width, height) * .004} opacity=".75" />)}
                  {row.merged_intervals.map((interval, index) => <line key={`merged-${index}`} {...intervalLine(centerline, interval.t_start, interval.t_end, width, height)} stroke="#4f46e5" strokeWidth={Math.max(width, height) * .009} opacity=".72" />)}
                </g>;
              })}
              {showOccupancyDiagnostics && occupancyDiagnostics?.detections.filter((item) => item.primary_assignment.status !== 'OUTSIDE_ROI' || item.bbox_intersects_parking_roi).map((item) => {
                const first = item.bbox_polygon[0];
                if (!first || item.bbox_polygon.length < 4) return null;
                const boxWidth = (item.bbox_polygon[1].x - first.x) * width;
                const boxHeight = (item.bbox_polygon[3].y - first.y) * height;
                const color = item.primary_assignment.status === 'UNASSIGNED' ? '#fbbf24' : '#a78bfa';
                const rows = item.intersecting_rows.map((row) => row.row_id.replace('row_', 'R')).join(',') || 'none';
                const proxy = groundContactDiagnostics?.detections.find((candidate) => candidate.detection_index === item.detection_index)?.proxy_bbox;
                return <g key={`occupancy-${item.detection_index}`}>
                  <rect x={first.x * width} y={first.y * height} width={boxWidth} height={boxHeight} fill="rgba(168,85,247,.06)" stroke={color} strokeWidth={Math.max(width, height) * .002} strokeDasharray="7 5" />
                  {item.intersecting_rows.flatMap((row) => row.intersection_polygon.length >= 3 ? [<polygon key={`${item.detection_index}-${row.row_id}`} points={row.intersection_polygon.map((point) => `${point.x * width},${point.y * height}`).join(' ')} fill="rgba(168,85,247,.24)" stroke="#c084fc" strokeWidth={Math.max(width, height) * .001} />] : [])}
                  <text x={first.x * width} y={Math.max(height * .02, first.y * height - height * .008)} fill={color} stroke="#0f172a" strokeWidth={height * .002} paintOrder="stroke" fontSize={height * .018} fontWeight="700">#{item.detection_index} overlap: {rows}</text>
                  {proxy && <><rect x={proxy.x * width} y={proxy.y * height} width={proxy.width * width} height={proxy.height * height} fill="url(#ground-proxy-hatch)" fillOpacity=".45" stroke="#34d399" strokeWidth={Math.max(width, height) * .0025} /><text x={proxy.x * width + width * .003} y={proxy.y * height + height * .018} fill="#6ee7b7" stroke="#0f172a" strokeWidth={height * .0015} paintOrder="stroke" fontSize={height * .014} fontWeight="700">proxy {(groundContactDiagnostics?.height_ratio ?? 0) * 100}%</text></>}
                </g>;
              })}
            </svg>}
          </div>
        ) : <div className="grid aspect-video w-full place-items-center bg-[linear-gradient(rgba(51,65,85,.22)_1px,transparent_1px),linear-gradient(90deg,rgba(51,65,85,.22)_1px,transparent_1px)] bg-[size:32px_32px]"><div className="text-center text-slate-500"><ImageIcon className="mx-auto size-8" /><p className="mt-2 text-xs font-medium">Camera frame placeholder</p></div></div>}
        {source && <div className="absolute bottom-3 right-3 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setShowOverlays((value) => !value)} className="inline-flex items-center gap-2 rounded-lg bg-slate-950/80 px-3 py-2 text-xs font-semibold text-white backdrop-blur" aria-pressed={showOverlays}>{showOverlays ? <Eye className="size-4" /> : <EyeOff className="size-4" />}{showOverlays ? 'Detections on' : 'Detections off'}</button>{calibration && <button type="button" onClick={() => setShowCalibration((value) => !value)} className="inline-flex items-center gap-2 rounded-lg bg-slate-950/80 px-3 py-2 text-xs font-semibold text-white backdrop-blur" aria-pressed={showCalibration}>{showCalibration ? <Eye className="size-4" /> : <EyeOff className="size-4" />}{showCalibration ? 'Calibration on' : 'Show parking calibration'}</button>}{rowProjection && <button type="button" onClick={() => setShowRowProjection((value) => !value)} className="inline-flex items-center gap-2 rounded-lg bg-cyan-950/85 px-3 py-2 text-xs font-semibold text-white backdrop-blur" aria-pressed={showRowProjection}>{showRowProjection ? <Eye className="size-4" /> : <EyeOff className="size-4" />}{showRowProjection ? 'Row projection on' : 'Show row projection'}</button>}{occupancyDiagnostics && <button type="button" onClick={() => setShowOccupancyDiagnostics((value) => !value)} className="inline-flex items-center gap-2 rounded-lg bg-violet-950/85 px-3 py-2 text-xs font-semibold text-white backdrop-blur" aria-pressed={showOccupancyDiagnostics}>{showOccupancyDiagnostics ? <Eye className="size-4" /> : <EyeOff className="size-4" />}{showOccupancyDiagnostics ? 'Occupancy diagnostics on' : 'Show occupancy diagnostics'}</button>}{occupiedIntervals && <button type="button" onClick={() => setShowOccupiedIntervals((value) => !value)} className="inline-flex items-center gap-2 rounded-lg bg-indigo-950/85 px-3 py-2 text-xs font-semibold text-white backdrop-blur" aria-pressed={showOccupiedIntervals}>{showOccupiedIntervals ? <Eye className="size-4" /> : <EyeOff className="size-4" />}{showOccupiedIntervals ? 'Occupied intervals on' : 'Show occupied intervals'}</button>}</div>}
      </div>
      {analysis && <div className="grid grid-cols-2 gap-3 border-b border-slate-200 bg-emerald-50/60 px-5 py-4 text-xs sm:grid-cols-3"><strong className="col-span-2 text-emerald-700 sm:col-span-3">REAL YOLO INFERENCE · {analysis.model.status}</strong><Metric label="Motorcycles detected" value={String(analysis.detections.length)} /><Metric label="Model" value={analysis.model.name} /><Metric label="Input size" value={String(analysis.inference.imgsz)} /><Metric label="Confidence" value={analysis.inference.confidence_threshold.toFixed(2)} /><Metric label="NMS IoU" value={analysis.inference.nms_iou.toFixed(2)} /><Metric label="Processing" value={`${analysis.inference.processing_time_ms.toFixed(1)} ms`} /></div>}
      <dl className="grid grid-cols-2 gap-x-5 gap-y-4 p-5 text-sm"><div><dt className="text-xs text-slate-400">Camera</dt><dd className="mt-1 font-semibold">{camera?.id ?? 'Not reported'}</dd></div><div><dt className="text-xs text-slate-400">Location</dt><dd className="mt-1 font-semibold">{camera?.name ?? 'Unknown'}</dd></div><div><dt className="text-xs text-slate-400">Zone</dt><dd className="mt-1 font-semibold">{zone.id}</dd></div><div><dt className="text-xs text-slate-400">Last frame</dt><dd className="mt-1 font-mono font-semibold">{formatTime(camera?.lastFrameAt)}</dd></div><div><dt className="text-xs text-slate-400">Parking model</dt><dd className="mt-1 font-semibold">{model?.name ?? 'Not reported'}</dd></div><div><dt className="text-xs text-slate-400">Model status</dt><dd className="mt-1 font-semibold capitalize">{model?.status ?? 'unknown'}</dd></div></dl>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-slate-500">{label}</p><p className="mt-0.5 font-semibold text-slate-800">{value}</p></div>;
}

function intervalLine(centerline: { start: { x: number; y: number }; end: { x: number; y: number } }, start: number, end: number, width: number, height: number) {
  const point = (t: number) => ({ x: (centerline.start.x + (centerline.end.x - centerline.start.x) * t) * width, y: (centerline.start.y + (centerline.end.y - centerline.start.y) * t) * height });
  const a = point(start), b = point(end);
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

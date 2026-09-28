"use client";

import { AlertTriangle, Maximize2, RefreshCw, ScanLine } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MetricCalibration } from "@/components/calibration/MetricCalibration";
import { GroundPlaneCalibration } from "@/components/calibration/GroundPlaneCalibration";
import { ParkMapBrand } from "@/components/dashboard/ParkMapBrand";
import { ImageAnalyzer } from "@/components/camera/ImageAnalyzer";
import { DataSourceSwitcher } from "@/components/dashboard/DataSourceSwitcher";
import { SummaryCard } from "@/components/dashboard/SummaryCard";
import { SystemStatus } from "@/components/dashboard/SystemStatus";
import { ParkingMap } from "@/components/parking/ParkingMap";
import { RoiSpatialMap } from "@/components/parking/RoiSpatialMap";
import { PhysicalMeasuredMap } from "@/components/parking/PhysicalMeasuredMap";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  getParkingStatus,
  isParkingDataStale,
  PARKING_POLL_INTERVAL_MS,
  PARKMAP_API_URL,
} from "@/lib/parking";
import {
  persistRowDisplayOrder,
  readRowDisplayOrder,
  type RowDisplayOrder,
} from "@/lib/rowDisplayOrder";
import { getPhysicalRowGeometry } from "@/lib/physicalRowGeometry";
import type { NormalizedParkingMapData } from "@/types/normalizedParkingMap";
import type { RoiSpatialMapData } from "@/types/roiSpatialMap";
import type {
  CameraOverlay,
  DataSourceMode,
  DemoScenario,
  ParkingMapData,
  SystemState,
} from "@/types/parking";

const overlayDemo: CameraOverlay[] = [
  {
    id: "roi",
    type: "roi",
    points: [
      { x: 0.08, y: 0.15 },
      { x: 0.92, y: 0.11 },
      { x: 0.95, y: 0.88 },
      { x: 0.12, y: 0.9 },
    ],
  },
  {
    id: "box-1",
    type: "bounding-box",
    x: 0.2,
    y: 0.3,
    width: 0.09,
    height: 0.28,
  },
];

export function DashboardClient({
  initialData,
}: {
  initialData: ParkingMapData;
}) {
  const [mode, setMode] = useState<DataSourceMode>("demo");
  const [scenario, setScenario] = useState<DemoScenario>("normal");
  const [data, setData] = useState(initialData);
  const [requestState, setRequestState] = useState<SystemState>("online");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [normalizedMap, setNormalizedMap] =
    useState<NormalizedParkingMapData | null>(null);
  const [roiSpatialMap, setRoiSpatialMap] = useState<RoiSpatialMapData | null>(
    null,
  );
  const [mapView, setMapView] = useState<"ROW" | "ROI" | "PHYSICAL">("ROW");
  const [showOutsideRoiDiagnostics, setShowOutsideRoiDiagnostics] =
    useState(false);
  const [workspaceView, setWorkspaceView] = useState<"PARKING" | "CALIBRATION">(
    "PARKING",
  );
  const [showAdvancedMaps, setShowAdvancedMaps] = useState(false);
  const [rowDisplayOrder, setRowDisplayOrder] =
    useState<RowDisplayOrder>("ASCENDING");
  const mapRef = useRef<HTMLDivElement>(null);

  const changeMode = (next: DataSourceMode) => {
    localStorage.setItem("parkmap-data-source", next);
    setMode(next);
    setRequestState("loading");
    setErrorMessage(null);
  };
  const changeRowDisplayOrder = (next: RowDisplayOrder) => {
    setRowDisplayOrder(next);
    persistRowDisplayOrder(next, window.localStorage);
  };
  const loadData = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const result = await getParkingStatus({ mode, scenario, signal });
        setData(result);
        setErrorMessage(null);
        setRequestState(
          result.systemStatus ??
            (isParkingDataStale(result.timestamp) ? "stale" : "online"),
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to load parking data.",
        );
        setRequestState("stale");
      }
    },
    [mode, scenario],
  );

  useEffect(() => {
    let controller: AbortController | null = new AbortController();
    const initialTimer = window.setTimeout(
      () => void loadData(controller?.signal),
      0,
    );
    if (mode !== "live")
      return () => {
        window.clearTimeout(initialTimer);
        controller?.abort();
      };
    const timer = window.setInterval(() => {
      controller?.abort();
      controller = new AbortController();
      void loadData(controller.signal);
    }, PARKING_POLL_INTERVAL_MS);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
      controller?.abort();
    };
  }, [loadData, mode, retryKey]);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setRowDisplayOrder(readRowDisplayOrder(window.localStorage)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void getPhysicalRowGeometry(controller.signal)
      .then((result) => {
        if (result.rows.some((row) => row.status === "CALIBRATED")) setMapView("PHYSICAL");
      })
      .catch(() => { /* Keep the existing map when metric row geometry is unavailable. */ });
    return () => controller.abort();
  }, []);

  const state: SystemState = errorMessage
    ? data
      ? "stale"
      : requestState
    : data.systemStatus === "processing"
      ? "processing"
      : isParkingDataStale(data.timestamp)
        ? "stale"
        : requestState;
  const staleOrError =
    state === "stale" || state === "offline" || state === "error";
  const camera = data.camera ?? {
    id: data.cameraId ?? "Unknown",
    name: "SPU Motorcycle Parking",
    status: state,
    lastFrameAt: data.timestamp,
  };

  const analysisSummary = useMemo(
    () =>
      normalizedMap
        ? {
            motorcycles: normalizedMap.assigned_markers.length,
            occupied: normalizedMap.rows.reduce(
              (sum, row) => sum + row.merged_intervals.length,
              0,
            ),
            obstructions: normalizedMap.rows.reduce(
              (sum, row) => sum + row.obstruction_count,
              0,
            ),
            gaps: normalizedMap.rows.reduce(
              (sum, row) => sum + row.gaps.length,
              0,
            ),
          }
        : null,
    [normalizedMap],
  );

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-5 py-5 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-10">
          <ParkMapBrand />
          <div className="flex flex-wrap items-center gap-3">
            <nav
              className="inline-flex rounded-xl bg-slate-100 p-1"
              aria-label="ParkMap sections"
            >
              <button
                type="button"
                onClick={() => setWorkspaceView("PARKING")}
                className={`rounded-lg px-4 py-2 text-sm font-semibold ${workspaceView === "PARKING" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}
              >
                Parking
              </button>
              <button
                type="button"
                onClick={() => setWorkspaceView("CALIBRATION")}
                className={`rounded-lg px-4 py-2 text-sm font-semibold ${workspaceView === "CALIBRATION" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}
              >
                Calibration
              </button>
            </nav>
            <SystemStatus
              timestamp={data.timestamp}
              status={state}
              mode={mode}
            />
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1500px] flex-col gap-6 px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
        {errorMessage && (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-start gap-2 text-red-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <strong>{errorMessage}</strong>
                <p className="mt-0.5 text-red-700">
                  Last successful data remains visible and is marked stale.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setRetryKey((key) => key + 1)}
              className="inline-flex w-fit items-center gap-2 rounded-lg bg-red-700 px-3 py-2 text-xs font-semibold text-white"
            >
              <RefreshCw className="size-3.5" />
              Retry
            </button>
          </div>
        )}
        {workspaceView === "PARKING" && (
          <>
            {analysisSummary && (
              <section
                aria-label="Current parking summary"
                className="order-3 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4"
              >
                <SummaryCard
                  label="Motorcycles parked"
                  value={analysisSummary.motorcycles}
                  icon="motorcycle"
                  tone="blue"
                />
                <SummaryCard
                  label="Occupied areas"
                  value={analysisSummary.occupied}
                  icon="occupied"
                  tone="red"
                />
                <SummaryCard
                  label="Obstructions"
                  value={analysisSummary.obstructions}
                  icon="uncertain"
                  tone="amber"
                />
                <SummaryCard
                  label="Open gaps detected"
                  value={analysisSummary.gaps}
                  icon="available"
                  tone="blue"
                />
              </section>
            )}
            <section className="flex flex-col gap-6">
              <div
                ref={mapRef}
                className={`order-2 overflow-hidden rounded-2xl border bg-white shadow-sm ${staleOrError ? "border-amber-300" : "border-slate-200"}`}
              >
                <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:px-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <ScanLine className="size-5 text-blue-600" />
                        <h2 className="font-semibold">
                          {mapView === "ROW"
                            ? "Parking Map"
                            : mapView === "ROI"
                              ? "2D ROI Spatial Map"
                              : "Physical Measured Row Map"}
                        </h2>
                        <StatusBadge status={state} />
                      </div>
                      <p className="mt-1 text-sm text-slate-500">
                        {mapView === "ROW"
                          ? "Current motorcycle positions by parking row."
                          : mapView === "ROI"
                            ? "Uses the actual calibrated Parking ROI and Row polygons."
                            : "Diagnostic metric geometry anchored to explicitly calibrated physical endpoints."}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {showAdvancedMaps && <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                        {(
                          [
                            { value: "ROW", label: "Existing hybrid" },
                            { value: "ROI", label: "ROI Spatial Map" },
                            { value: "PHYSICAL", label: "Physical measured" },
                          ] as const
                        ).map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setMapView(option.value)}
                            aria-pressed={mapView === option.value}
                            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${mapView === option.value ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-white"}`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>}
                      <button
                        type="button"
                        onClick={() => setShowAdvancedMaps((value) => !value)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600"
                      >
                        {showAdvancedMaps ? "Hide advanced maps" : "Advanced maps"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void mapRef.current?.requestFullscreen()}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        <Maximize2 className="size-4" />
                        Fullscreen map
                      </button>
                    </div>
                  </div>
                  {showAdvancedMaps && mapView === "ROW" && (
                    <div>
                      <p className="mb-1 text-xs font-semibold text-slate-600">
                        Display row order
                      </p>
                      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                        {(
                          [
                            { value: "ASCENDING", label: "1 → 5" },
                            { value: "DESCENDING", label: "5 → 1" },
                          ] as const
                        ).map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => changeRowDisplayOrder(option.value)}
                            aria-pressed={rowDisplayOrder === option.value}
                            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${rowDisplayOrder === option.value ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:bg-white"}`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                      <p className="mt-1 text-[11px] text-slate-400">
                        Display only; row IDs stay unchanged.
                      </p>
                    </div>
                  )}
                </div>
                {mapView === "ROW" ? (
                  <ParkingMap
                    data={normalizedMap}
                    displayOrder={rowDisplayOrder}
                  />
                ) : mapView === "ROI" ? (
                  <RoiSpatialMap
                    data={roiSpatialMap}
                    showOutsideDiagnostics={showOutsideRoiDiagnostics}
                  />
                ) : (
                  <PhysicalMeasuredMap />
                )}
              </div>
              <div className="order-1 space-y-6">
                <ImageAnalyzer
                  camera={{
                    ...camera,
                    status: state === "processing" ? camera.status : state,
                  }}
                  model={data.model}
                  zone={data.zone}
                  fallbackOverlays={mode === "demo" ? overlayDemo : []}
                  status={state}
                  onNormalizedMapChange={setNormalizedMap}
                  onRoiSpatialMapChange={setRoiSpatialMap}
                  showOutsideRoiDiagnostics={showOutsideRoiDiagnostics}
                  onShowOutsideRoiDiagnosticsChange={
                    setShowOutsideRoiDiagnostics
                  }
                />
              </div>
            </section>
          </>
        )}
        {workspaceView === "CALIBRATION" && (
          <section className="order-2 space-y-4">
            <div>
              <h1 className="text-2xl font-bold">Calibration</h1>
              <p className="mt-1 text-sm text-slate-500">
                Setup tools are grouped here and collapsed until needed.
              </p>
            </div>
            <details className="rounded-xl border border-slate-200 bg-white p-4">
              <summary className="cursor-pointer font-semibold">
                Physical measurements
              </summary>
              <div className="mt-4">
                <MetricCalibration cameraId={camera.id} />
              </div>
            </details>
            <details className="rounded-xl border border-slate-200 bg-white p-4">
              <summary className="cursor-pointer font-semibold">
                Ground plane and row geometry
              </summary>
              <div className="mt-4">
                <GroundPlaneCalibration />
              </div>
            </details>
            <details className="rounded-xl border border-slate-200 bg-white p-4">
              <summary className="cursor-pointer font-semibold">
                Advanced diagnostics
              </summary>
              <div className="mt-4 space-y-5">
                <DataSourceSwitcher
                  mode={mode}
                  scenario={scenario}
                  onModeChange={changeMode}
                  onScenarioChange={setScenario}
                />
                <dl className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
                  <DebugItem label="Data source" value={mode.toUpperCase()} />
                  <DebugItem
                    label="Camera / zone"
                    value={`${data.cameraId ?? "—"} / ${data.zone.id}`}
                  />
                  <DebugItem label="API URL" value={PARKMAP_API_URL} />
                  <DebugItem
                    label="Polling"
                    value={`${PARKING_POLL_INTERVAL_MS / 1000} seconds`}
                  />
                  <DebugItem label="Timestamp" value={data.timestamp} />
                  <DebugItem
                    label="Map analysis"
                    value={normalizedMap ? "LOADED" : "WAITING"}
                  />
                </dl>
              </div>
            </details>
          </section>
        )}
      </div>
    </main>
  );
}

function DebugItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd
        className="mt-1 truncate font-mono text-xs font-semibold text-slate-700"
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

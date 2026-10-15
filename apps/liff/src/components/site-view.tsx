"use client";

import { ArrowLeft, Minus, Plus, RotateCcw, RotateCw, Scan } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { type ComponentProps, type KeyboardEvent, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { LotModel, ParkingAreaLiveState, SiteParkingState } from "@/lib/api/types";
import { ROTATE_STEP_RAD, ZOOM_STEP } from "@/lib/map/camera";
import { STATUS_TEXT, areaLabel, headline, headlineStatus, mapLabels } from "@/lib/map/legend";
import { type LotMap, type MapStatus, type Selection, buildLotMap, focusPoint, followSelection, selectAt, summarize } from "@/lib/map/lot-map";
import { FALLBACK_NOTICES, INITIAL_RENDERER, THREE_D_TIMEOUT_MS, detectWebGL, mountsThreeD, rendererReducer } from "@/lib/map/renderer";
import { STATUS_LABELS, agoLabel, photoTimeLabel, sourceBadge, sourceNotice, timeLines, visibleAreas } from "@/lib/parking/presentation";
import { useParkingState } from "@/lib/parking/use-parking-state";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { type AreaRow, MapPanel, type SelectedDetails } from "./map-panel";
import { type MapViewHandle, ViewErrorBoundary } from "./map-overlay";

// The site screen: a header with where the data comes from and how old it is, the map, and a panel
// that says the same thing in text. The API decides every status; this screen only lays it out.

function MapLoading({ label }: { label: string }) {
  return (
    <div role="status" className="grid size-full place-items-center bg-slate-50 text-sm text-muted-foreground">
      <span className="flex items-center gap-2">
        <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600 motion-reduce:animate-none" />
        {label}
      </span>
    </div>
  );
}

const LotScene = dynamic(() => import("./lot-scene"), { ssr: false, loading: () => <MapLoading label="กำลังโหลดแผนที่ 3 มิติ" /> });
const LotPlan = dynamic(() => import("./lot-plan"), { ssr: false, loading: () => <MapLoading label="กำลังโหลดแผนที่" /> });

/**
 * The map model for the current answer. Ageing only matters when it downgrades an area, so the map
 * is rebuilt when the data or a status changes, not on every clock tick; a moving camera and the
 * selected place stay as they are between polls.
 */
function useLotMap(lotModel: LotModel, data: SiteParkingState | undefined, areas: ParkingAreaLiveState[] | null): LotMap {
  const key = areas?.map((area) => area.status).join() ?? "loading";
  const [built, setBuilt] = useState(() => ({ lotModel, data, key, map: buildLotMap(lotModel, areas) }));
  if (built.lotModel !== lotModel || built.data !== data || built.key !== key) {
    const map = buildLotMap(lotModel, areas);
    setBuilt({ lotModel, data, key, map });
    return map;
  }
  return built.map;
}

/** How old the shown state is, in the header. A still-image loop gives the photo's date, never "now". */
function freshness(areas: ParkingAreaLiveState[] | null): string | null {
  if (!areas) return null;
  const still = areas.find((area) => area.source === "STILL_IMAGE_LOOP" && area.observed_at);
  if (still?.observed_at) return photoTimeLabel(still.observed_at);
  const ages = areas.flatMap((area) => (area.age_s == null ? [] : [area.age_s]));
  return ages.length > 0 ? `ภาพจากกล้องเมื่อ ${agoLabel(Math.max(...ages))}` : null;
}

function areaRows(map: LotMap, areas: ParkingAreaLiveState[]): AreaRow[] {
  return map.areas.map((area) => {
    const live = areas.find((item) => item.parking_area_id === area.parkingAreaId);
    let time: string | null = null;
    if (live?.source === "STILL_IMAGE_LOOP" && live.observed_at) time = photoTimeLabel(live.observed_at);
    else if (live?.age_s != null) time = agoLabel(live.age_s);
    return { id: area.parkingAreaId, name: areaLabel(map, area.parkingAreaId), status: live ? STATUS_LABELS[live.status] : STATUS_LABELS.NO_DATA, time };
  });
}

const PAN_STEP_PX = 40;

function ControlButton({ className, ...props }: ComponentProps<typeof Button>) {
  return <Button variant="outline" size="icon" className={cn("size-11 rounded-xl bg-background/95 shadow-sm", className)} {...props} />;
}

export function SiteView({ siteId, siteName, lotModel }: { siteId: string; siteName: string; lotModel: LotModel }) {
  const query = useParkingState(siteId);
  const now = useNow(1000);
  // A failed poll means the current state cannot be confirmed, even if an older answer is kept.
  const connectionLost = query.isError;
  // `now` ticks once a second, so an answer that just arrived can look slightly newer than it; that is
  // not clock skew and must not downgrade it.
  const receivedAgoS = query.data ? Math.max(0, now - query.dataUpdatedAt) / 1000 : 0;
  const areas = query.data ? visibleAreas(query.data, receivedAgoS, connectionLost) : null;
  const map = useLotMap(lotModel, query.data, areas);
  const labels = useMemo(() => mapLabels(map), [map]);
  const summary = useMemo(() => summarize(map), [map]);

  const [renderer, dispatch] = useReducer(rendererReducer, INITIAL_RENDERER);
  useEffect(() => dispatch({ type: "webgl", available: detectWebGL() }), []);
  const waitingFor3D = renderer.mode === "3d" && renderer.status3d === "loading";
  useEffect(() => {
    if (!waitingFor3D) return;
    const timer = setTimeout(() => dispatch({ type: "timeout" }), THREE_D_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [waitingFor3D]);
  const onReady = useCallback(() => dispatch({ type: "ready" }), []);
  const onFailed = useCallback(() => dispatch({ type: "failed" }), []);

  const view = useRef<MapViewHandle>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [expanded, setExpanded] = useState(false);
  const followed = selection ? followSelection(map, selection) : null;
  const selectionText = followed?.hit ? STATUS_TEXT[followed.hit.status].label : "ไม่มีข้อมูลตรงจุดนี้";
  const mapSelection = selection && { point: selection.point, polygon: followed?.hit?.polygon ?? null, text: selectionText };
  const selectedDetails: SelectedDetails | null = followed && {
    hit: followed.hit,
    areaName: followed.hit?.area ? areaLabel(map, followed.hit.area.parkingAreaId) : null,
    change: followed.change,
    times: timeLines(followed.hit?.area?.live ?? null, query.data ? query.dataUpdatedAt : null),
  };

  const onSelect = useCallback((point: Selection["point"] | null) => setSelection(point ? selectAt(map, point) : null), [map]);

  function showStatus(status: MapStatus) {
    const point = focusPoint(map, status);
    if (!point) return;
    setSelection(selectAt(map, point));
    // On a phone the panel folds away so the map has room for the place it now shows.
    setExpanded(false);
    view.current?.focus(point);
  }

  function onMapKey(event: KeyboardEvent<HTMLElement>) {
    const actions: Record<string, () => void> = {
      ArrowLeft: () => view.current?.panBy(PAN_STEP_PX, 0),
      ArrowRight: () => view.current?.panBy(-PAN_STEP_PX, 0),
      ArrowUp: () => view.current?.panBy(0, PAN_STEP_PX),
      ArrowDown: () => view.current?.panBy(0, -PAN_STEP_PX),
      "+": () => view.current?.zoomBy(ZOOM_STEP),
      "=": () => view.current?.zoomBy(ZOOM_STEP),
      "-": () => view.current?.zoomBy(1 / ZOOM_STEP),
      "0": () => view.current?.reset(),
      Escape: () => setSelection(null),
    };
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight") && view.current?.rotateBy) {
      event.preventDefault();
      view.current.rotateBy(event.key === "ArrowLeft" ? ROTATE_STEP_RAD : -ROTATE_STEP_RAD);
      return;
    }
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  }

  const badge = areas ? sourceBadge(areas) : null;
  const age = freshness(areas);
  const notice = areas ? sourceNotice(areas) : null;
  const allStale = !summary.loading && summary.currentAreas === 0 && areas?.some((area) => area.status === "STALE");
  const fallback = FALLBACK_NOTICES[renderer.status3d];
  const showsThreeD = mountsThreeD(renderer);
  const viewProps = { map, labels, selection: mapSelection, onSelect, ref: view };

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background text-foreground lg:grid lg:grid-cols-[1fr_380px] lg:grid-rows-[auto_auto_minmax(0,1fr)]">
      <header className="flex items-center gap-1 border-b pt-[max(0.25rem,env(safe-area-inset-top))] pr-4 pb-1 pl-1 lg:col-span-2 lg:row-start-1">
        <Link href="/" aria-label="กลับไปหน้ารายการลานจอด" className={buttonVariants({ variant: "ghost", size: "icon", className: "size-11" })}>
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">{siteName}</h1>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {badge && <span className="rounded-sm bg-slate-100 px-1.5 py-px font-medium text-slate-700">{badge}</span>}
            <span>{query.isPending ? "กำลังโหลดสถานะ" : age}</span>
          </p>
        </div>
      </header>

      {(connectionLost || allStale) && (
        <div role="alert" className={cn("flex items-center gap-2 border-b px-4 py-1.5 text-sm lg:col-span-2 lg:row-start-2", connectionLost ? "bg-red-50 text-red-950" : "bg-amber-50 text-amber-950")}>
          <p className="flex-1">
            {connectionLost ? "เชื่อมต่อข้อมูลไม่ได้ ซ่อนพื้นที่จอดไว้จนกว่าจะยืนยันสถานะล่าสุดได้" : "ข้อมูลไม่เป็นปัจจุบัน ซ่อนพื้นที่จอดไว้จนกว่าจะได้ข้อมูลใหม่"}
          </p>
          <Button variant="outline" className="h-11 bg-background" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RotateCw data-icon="inline-start" className={cn(query.isFetching && "animate-spin motion-reduce:animate-none")} />
            ลองใหม่
          </Button>
        </div>
      )}

      <section
        aria-label={
          renderer.mode === "3d"
            ? "แผนที่ลานจอดรถ 3 มิติ ใช้ลูกศรเพื่อเลื่อน Shift กับลูกศรซ้ายหรือขวาเพื่อหมุน + หรือ - เพื่อซูม 0 เพื่อดูทั้งลาน"
            : "แผนที่ลานจอดรถ 2 มิติ ใช้ลูกศรเพื่อเลื่อน + หรือ - เพื่อซูม 0 เพื่อดูทั้งลาน"
        }
        tabIndex={0}
        onKeyDown={onMapKey}
        className="relative min-h-0 flex-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset lg:col-start-1 lg:row-start-3"
      >
        <ViewErrorBoundary key={renderer.mode} onError={onFailed}>
          {renderer.status3d === "checking" ? (
            <MapLoading label="กำลังโหลดแผนที่" />
          ) : showsThreeD ? (
            <LotScene {...viewProps} onReady={onReady} onError={onFailed} />
          ) : (
            <LotPlan {...viewProps} />
          )}
        </ViewErrorBoundary>
        <div className="absolute top-2 right-2 flex flex-col gap-2">
          <div role="group" aria-label="มุมมองแผนที่" className="flex flex-col overflow-hidden rounded-xl border bg-background/95 shadow-sm">
            {(["3d", "2d"] as const).map((mode) => (
              <Button
                key={mode}
                variant="ghost"
                className={cn("size-11 rounded-none text-xs font-semibold", renderer.mode === mode && "bg-slate-900 text-white hover:bg-slate-800 hover:text-white")}
                aria-pressed={renderer.mode === mode}
                disabled={mode === "3d" && renderer.status3d === "unavailable"}
                onClick={() => dispatch({ type: "choose", mode })}
              >
                {mode === "3d" ? "3D" : "2D"}
              </Button>
            ))}
          </div>
          <ControlButton aria-label="ซูมเข้า" onClick={() => view.current?.zoomBy(ZOOM_STEP)}>
            <Plus />
          </ControlButton>
          <ControlButton aria-label="ซูมออก" onClick={() => view.current?.zoomBy(1 / ZOOM_STEP)}>
            <Minus />
          </ControlButton>
          {renderer.mode === "3d" && (
            <>
              <ControlButton aria-label="หมุนซ้าย" onClick={() => view.current?.rotateBy?.(ROTATE_STEP_RAD)}>
                <RotateCcw />
              </ControlButton>
              <ControlButton aria-label="หมุนขวา" onClick={() => view.current?.rotateBy?.(-ROTATE_STEP_RAD)}>
                <RotateCw />
              </ControlButton>
            </>
          )}
          <ControlButton aria-label="ดูทั้งลาน" className="h-14 flex-col gap-0.5" onClick={() => view.current?.reset()}>
            <Scan />
            <span aria-hidden className="text-[10px] leading-none">
              ทั้งลาน
            </span>
          </ControlButton>
        </div>
      </section>

      <div className="flex shrink-0 flex-col lg:col-start-2 lg:row-start-3 lg:min-h-0">
        <MapPanel
          headline={headline(summary, connectionLost)}
          headlineStatus={headlineStatus(summary)}
          notices={
            (notice || fallback) && (
              <div className="space-y-2 text-sm">
                {notice && <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-950">{notice}</p>}
                {fallback && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md bg-slate-100 px-3 py-2 text-slate-800">
                    <p className="flex-1">{fallback}</p>
                    {renderer.status3d !== "unavailable" && (
                      <Button variant="outline" className="h-11 bg-background" onClick={() => dispatch({ type: "choose", mode: "3d" })}>
                        ลองแสดง 3 มิติอีกครั้ง
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )
          }
          present={summary.present}
          areas={areas ? areaRows(map, areas) : []}
          estimatedLandmarks={map.landmarks.some((landmark) => landmark.measurement_source === "ESTIMATED")}
          selected={selectedDetails}
          expanded={expanded}
          onToggle={() => setExpanded((value) => !value)}
          onClearSelection={() => setSelection(null)}
          onShow={showStatus}
        />
      </div>
    </main>
  );
}

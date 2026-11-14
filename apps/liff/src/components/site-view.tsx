"use client";

import { ArrowLeft, Minus, Plus, RotateCcw, RotateCw, Scan } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { type ComponentProps, type KeyboardEvent, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { LotModel, ParkingAreaLiveState, SiteParkingState } from "@/lib/api/types";
import { type Insets, ROTATE_STEP_RAD, ZOOM_STEP } from "@/lib/map/camera";
import { STATUS_TEXT, areaLabel, headline, headlineStatus, mapLabels } from "@/lib/map/legend";
import { type LotMap, type MapStatus, type Selection, buildLotMap, focusPoint, followSelection, selectAt, summarize } from "@/lib/map/lot-map";
import { FALLBACK_NOTICES, INITIAL_RENDERER, THREE_D_TIMEOUT_MS, detectWebGL, mountsThreeD, rendererReducer } from "@/lib/map/renderer";
import { STATUS_LABELS, agoLabel, areaPhotos, timeLines, visibleAreas } from "@/lib/parking/presentation";
import { useParkingState } from "@/lib/parking/use-parking-state";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { type AreaRow, MapPanel, type PeekHeights, type SelectedDetails, type ShownPhoto, useWide } from "./map-panel";
import { type MapViewHandle, ViewErrorBoundary } from "./map-overlay";
import { MapSkeleton } from "./map-skeleton";

// The site screen: a header with how old the data is, then the map with a sheet over it that says
// the same thing in text and shows the photos it was computed from. The API decides every status; this screen only
// lays it out. The map shows at once: there is nothing to tap before it.

// Both views load behind the skeleton, which already shows the lot's outline.
const LotScene = dynamic(() => import("./lot-scene"), { ssr: false, loading: () => null });
const LotPlan = dynamic(() => import("./lot-plan"), { ssr: false, loading: () => null });

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

/** How old the shown state is, in the header: the oldest area's age as the API measures it. */
function freshness(areas: ParkingAreaLiveState[] | null): string | null {
  if (!areas) return null;
  const ages = areas.flatMap((area) => (area.age_s == null ? [] : [area.age_s]));
  return ages.length > 0 ? `อัปเดต ${agoLabel(Math.max(...ages))}` : null;
}

function areaRows(map: LotMap, areas: ParkingAreaLiveState[]): AreaRow[] {
  return map.areas.map((area) => {
    const live = areas.find((item) => item.parking_area_id === area.parkingAreaId);
    const time = live?.age_s != null ? agoLabel(live.age_s) : null;
    return { id: area.parkingAreaId, name: areaLabel(map, area.parkingAreaId), status: live ? STATUS_LABELS[live.status] : STATUS_LABELS.NO_DATA, time };
  });
}

const PAN_STEP_PX = 40;
/** Room the map controls take along the top and right edges, and the gap kept at the other edges. */
const CONTROL_BAND_PX = 60;
const EDGE_GAP_PX = 12;
/** Space between the sheet's peek and the controls that sit just above it. */
const ABOVE_SHEET_PX = 8;

function ControlButton({ className, ...props }: ComponentProps<typeof Button>) {
  return <Button variant="outline" size="icon" className={cn("size-11 rounded-lg bg-background shadow-sm", className)} {...props} />;
}

export function SiteView({ siteId, siteName, lotModel, listHref }: { siteId: string; siteName: string; lotModel: LotModel; listHref: string | null }) {
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
  const wide = useWide();
  const [peek, setPeek] = useState<PeekHeights>({ base: 0, full: 0 });
  const onPeek = useCallback((next: PeekHeights) => setPeek((current) => (current.base === next.base && current.full === next.full ? current : next)), []);
  // On a phone the sheet's resting peek covers the bottom of the map; a selected place's card is
  // left out, so selecting does not refit the map, and `reveal` keeps the place clear of it instead.
  const insets = useMemo<Insets>(
    () => ({ top: CONTROL_BAND_PX, right: CONTROL_BAND_PX, bottom: wide ? EDGE_GAP_PX : peek.base + ABOVE_SHEET_PX, left: EDGE_GAP_PX }),
    [wide, peek.base],
  );

  const [selection, setSelection] = useState<Selection | null>(null);
  const [expanded, setExpanded] = useState(false);
  const followed = useMemo(() => (selection ? followSelection(map, selection) : null), [map, selection]);
  const selectionText = followed?.hit ? STATUS_TEXT[followed.hit.status].label : "ไม่มีข้อมูลตรงจุดนี้";
  const selectionPolygon = followed?.hit?.polygon ?? null;
  const mapSelection = useMemo(
    () => (selection ? { point: selection.point, polygon: selectionPolygon, text: selectionText } : null),
    [selection, selectionPolygon, selectionText],
  );
  const selectedDetails: SelectedDetails | null = followed && {
    hit: followed.hit,
    areaName: followed.hit?.area ? areaLabel(map, followed.hit.area.parkingAreaId) : null,
    change: followed.change,
    times: timeLines(followed.hit?.area?.live ?? null, query.data ? query.dataUpdatedAt : null),
  };

  const onSelect = useCallback((point: Selection["point"] | null) => setSelection(point ? selectAt(map, point) : null), [map]);

  // A place selected on a phone stays clear of its own card once the card is measured.
  const selectedPoint = selection?.point ?? null;
  const cardShown = peek.full > peek.base;
  useEffect(() => {
    if (!selectedPoint || expanded) return;
    if (wide) view.current?.reveal(selectedPoint, EDGE_GAP_PX);
    else if (cardShown) view.current?.reveal(selectedPoint, peek.full);
  }, [selectedPoint, expanded, wide, cardShown, peek.full]);

  function showStatus(status: MapStatus) {
    const point = focusPoint(map, status);
    if (!point) return;
    setSelection(selectAt(map, point));
    // On a phone the sheet folds to its peek so the map has room for the place it now shows.
    setExpanded(false);
    view.current?.focus(point);
  }

  // Keyboard steps apply at once; only the buttons glide.
  function onMapKey(event: KeyboardEvent<HTMLElement>) {
    const actions: Record<string, () => void> = {
      ArrowLeft: () => view.current?.panBy(PAN_STEP_PX, 0),
      ArrowRight: () => view.current?.panBy(-PAN_STEP_PX, 0),
      ArrowUp: () => view.current?.panBy(0, PAN_STEP_PX),
      ArrowDown: () => view.current?.panBy(0, -PAN_STEP_PX),
      "+": () => view.current?.zoomBy(ZOOM_STEP, false),
      "=": () => view.current?.zoomBy(ZOOM_STEP, false),
      "-": () => view.current?.zoomBy(1 / ZOOM_STEP, false),
      "0": () => view.current?.reset(false),
      Escape: () => setSelection(null),
    };
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight") && view.current?.rotateBy) {
      event.preventDefault();
      view.current.rotateBy(event.key === "ArrowLeft" ? ROTATE_STEP_RAD : -ROTATE_STEP_RAD, false);
      return;
    }
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  }

  const age = freshness(areas);
  const photos: ShownPhoto[] = areas ? areaPhotos(areas).map((photo) => ({ ...photo, name: areaLabel(map, photo.id) })) : [];
  const allStale = !summary.loading && summary.currentAreas === 0 && areas?.some((area) => area.status === "STALE");
  const fallback = FALLBACK_NOTICES[renderer.status3d];
  const showsThreeD = mountsThreeD(renderer);
  const estimatedLandmarks = map.landmarks.some((landmark) => landmark.measurement_source === "ESTIMATED");
  const mapLoading = renderer.status3d === "checking" || (showsThreeD && renderer.status3d === "loading");

  // The map is kept apart from the clock: the header and sheet re-render every second, the map only
  // when what it shows changes.
  const stage = useMemo(() => {
    const viewProps = { map, labels, selection: mapSelection, onSelect, insets, ref: view };
    return (
      <ViewErrorBoundary key={renderer.mode} onError={onFailed}>
        {renderer.status3d === "checking" ? null : showsThreeD ? <LotScene {...viewProps} onReady={onReady} onError={onFailed} /> : <LotPlan {...viewProps} />}
      </ViewErrorBoundary>
    );
  }, [map, labels, mapSelection, onSelect, insets, renderer.mode, renderer.status3d, showsThreeD, onReady, onFailed]);

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <header className={cn("flex shrink-0 items-center gap-1 border-b pt-[max(0.25rem,env(safe-area-inset-top))] pr-4 pb-1", listHref ? "pl-1" : "pl-4")}>
        {listHref && (
          <Link href={listHref} aria-label="เลือกลานจอดอื่น" className={buttonVariants({ variant: "ghost", size: "icon", className: "size-11" })}>
            <ArrowLeft className="size-5" />
          </Link>
        )}
        <div className="min-w-0 flex-1 py-0.5">
          <h1 className="truncate text-base font-semibold">{siteName}</h1>
          <p className="text-xs text-muted-foreground tabular-nums">{query.isPending ? "กำลังโหลดสถานะ" : age}</p>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden lg:grid lg:grid-cols-[minmax(0,1fr)_380px]">
        <section
          aria-label={
            renderer.mode === "3d"
              ? "แผนที่ลานจอดรถ 3 มิติ ใช้ลูกศรเพื่อเลื่อน Shift กับลูกศรซ้ายหรือขวาเพื่อหมุน + หรือ - เพื่อซูม 0 เพื่อดูทั้งลาน"
              : "แผนที่ลานจอดรถ 2 มิติ ใช้ลูกศรเพื่อเลื่อน + หรือ - เพื่อซูม 0 เพื่อดูทั้งลาน"
          }
          tabIndex={0}
          onKeyDown={onMapKey}
          className="absolute inset-0 overflow-hidden outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset lg:relative lg:inset-auto lg:min-h-0"
        >
          <MapSkeleton outline={map.outline} bounds={map.frame} insets={insets} loading={mapLoading} />
          <div className="absolute inset-0">{stage}</div>

          {/* The view switch keeps its corner in both views; the turn buttons join it on the left in 3D. */}
          <div className="absolute top-3 right-3 flex items-center gap-2">
            {renderer.mode === "3d" && (
              <div role="group" aria-label="หมุนแผนที่" className="flex gap-2">
                <ControlButton aria-label="หมุนซ้าย" onClick={() => view.current?.rotateBy?.(ROTATE_STEP_RAD, true)}>
                  <RotateCcw />
                </ControlButton>
                <ControlButton aria-label="หมุนขวา" onClick={() => view.current?.rotateBy?.(-ROTATE_STEP_RAD, true)}>
                  <RotateCw />
                </ControlButton>
              </div>
            )}
            <div role="group" aria-label="มุมมองแผนที่" className="flex h-11 overflow-hidden rounded-lg border bg-background shadow-sm">
              {(["3d", "2d"] as const).map((mode) => (
                <Button
                  key={mode}
                  variant="ghost"
                  className={cn("h-full w-12 rounded-none font-semibold", renderer.mode === mode && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground")}
                  aria-pressed={renderer.mode === mode}
                  disabled={mode === "3d" && renderer.status3d === "unavailable"}
                  onClick={() => dispatch({ type: "choose", mode })}
                >
                  {mode === "3d" ? "3D" : "2D"}
                </Button>
              ))}
            </div>
          </div>

          {/* Zoom and overview ride just above the sheet's peek on a phone. */}
          <div
            className="absolute right-3 bottom-0 flex flex-col items-end gap-2 transition-transform duration-200 ease-out-strong motion-reduce:transition-none"
            style={{ transform: `translateY(-${wide ? EDGE_GAP_PX : peek.full + ABOVE_SHEET_PX}px)` }}
          >
            <div role="group" aria-label="ซูม" className="flex flex-col overflow-hidden rounded-lg border bg-background shadow-sm">
              <Button variant="ghost" size="icon" className="size-11 rounded-none" aria-label="ซูมเข้า" onClick={() => view.current?.zoomBy(ZOOM_STEP, true)}>
                <Plus />
              </Button>
              <Button variant="ghost" size="icon" className="size-11 rounded-none border-t" aria-label="ซูมออก" onClick={() => view.current?.zoomBy(1 / ZOOM_STEP, true)}>
                <Minus />
              </Button>
            </div>
            {/* As narrow as the other controls, so it stays inside the band labels keep clear of. */}
            <ControlButton aria-label="ดูทั้งลาน" onClick={() => view.current?.reset(true)}>
              <Scan />
            </ControlButton>
          </div>
        </section>

        <MapPanel
          truth={
            <>
              {(connectionLost || allStale) && (
                <div role="alert" className="flex items-center gap-3 rounded-lg bg-alert py-1 pr-1 pl-3 text-sm text-alert-foreground">
                  <p className="flex-1">
                    {connectionLost ? "เชื่อมต่อข้อมูลไม่ได้ ซ่อนพื้นที่จอดไว้จนกว่าจะยืนยันสถานะล่าสุดได้" : "ข้อมูลไม่เป็นปัจจุบัน ซ่อนพื้นที่จอดไว้จนกว่าจะได้ข้อมูลใหม่"}
                  </p>
                  <Button variant="secondary" className="h-11" onClick={() => query.refetch()} disabled={query.isFetching}>
                    <RotateCw data-icon="inline-start" />
                    ลองใหม่
                  </Button>
                </div>
              )}
            </>
          }
          viewNotice={
            fallback && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted py-1 pr-1 pl-3 text-sm">
                <p className="min-w-0 flex-1 py-1.5">{fallback}</p>
                {renderer.status3d !== "unavailable" && (
                  <Button variant="outline" className="h-11" onClick={() => dispatch({ type: "choose", mode: "3d" })}>
                    ลองแสดง 3 มิติอีกครั้ง
                  </Button>
                )}
              </div>
            )
          }
          headline={headline(summary, connectionLost)}
          headlineStatus={headlineStatus(summary)}
          present={summary.present}
          areas={areas ? areaRows(map, areas) : []}
          photos={photos}
          estimatedLandmarks={estimatedLandmarks}
          selected={selectedDetails}
          expanded={expanded}
          onExpandedChange={setExpanded}
          onClearSelection={() => setSelection(null)}
          onShow={showStatus}
          onPeek={onPeek}
        />
      </div>
    </main>
  );
}

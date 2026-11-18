"use client";

import { DoorOpen, Ellipsis, Minus, Plus, RotateCcw, RotateCw, Scan, SquareParking, WifiOff, X } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { useQueries, useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Link from "next/link";
import { type ComponentProps, type KeyboardEvent, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useGuide } from "@/components/parking-guide";
import type { GuardBoothFit, GuardBoothRider, LotModel, ParkingAreaLiveState, SiteParkingState } from "@/lib/api/types";
import { type Insets, ROTATE_STEP_RAD, ZOOM_STEP } from "@/lib/map/camera";
import { STATUS_TEXT, areaLabel, headline, headlineStatus, mapLabels } from "@/lib/map/legend";
import { type LotMap, type MapStatus, type Selection, buildLotMap, focusPoint, followSelection, selectAt, summarize } from "@/lib/map/lot-map";
import { FALLBACK_NOTICES, INITIAL_RENDERER, THREE_D_TIMEOUT_MS, detectWebGL, mountsThreeD, rendererReducer } from "@/lib/map/renderer";
import { labelPoint } from "@/lib/map/geometry";
import { activeParkingHolds, activeRiders, applyParkingHolds, enqueueRider, entranceClipOutcome, guardBoothFitFamily, guardBoothFrame, guardBoothHeadline, guardBoothModelName, guardBoothPreviewDestination, isKnownFamily, overlapsParkingHold, PARKING_HOLD_MS, RIDER_COLORS, riderGuide, routeRiderSeq, sripatumPreviewRoute, type GuardBoothMode, type GuardBoothOverview, type ParkingHold, type QueuedRider, type RiderFit } from "@/lib/parking/guard-booth";
import { type GuideStatus, guideFrame, guideStatus } from "@/lib/parking/guide";
import { STATUS_LABELS, agoLabel, areaPhotos, timeLines, visibleAreas } from "@/lib/parking/presentation";
import { useParkingState } from "@/lib/parking/use-parking-state";
import { useParkingRecommendation } from "@/lib/parking/use-parking-recommendation";
import { activeRecommendation, parkingRequestId, parkingSceneKey } from "@/lib/parking/recommendation-request";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { type AreaRow, MapPanel, type PeekHeights, type SelectedDetails, type ShownPhoto, useWide } from "./map-panel";
import { type MapMarker, type MapViewHandle, ViewErrorBoundary } from "./map-overlay";
import { MapSkeleton } from "./map-skeleton";
import { ParkedSpotPrompt } from "./parked-spot-prompt";
import { BoothIdle, type ClipStatus, EntranceClip, RiderCard } from "./entrance-clip";

// The site screen: the map with a chip saying how old the data is, and a card over it that says
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

/** How old the shown state is, under the card's headline: the oldest area's age as the API measures it. */
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
const GUARD_BOOTH_OVERVIEWS = [
  ["entrance", "เห็นทางเข้า", DoorOpen],
  ["parking", "โฟกัสลานจอด", SquareParking],
] as const;
const FIT_PREVIEWS = [
  ["grand_filano", "รถเล็ก"],
  ["forza", "รถใหญ่"],
] as const;
const CLASSIFICATION_TEST_TIMEOUT_MS = 10_000;
const CLASSIFICATION_TESTS = [
  ["classifying", "กำลังจำแนก"],
  ["preview", "จำแนกได้"],
  ["unknown", "จำแนกไม่ได้"],
  ["no-fit", "ไม่มีจุดที่พอดี"],
  ["unavailable", "ข้อมูลลานขาดหาย"],
  ["waiting", "รถออกจากจุดตรวจ"],
] as const;
/** Room the map controls take along the top and right edges, and the gap kept at the other edges. */
const CONTROL_BAND_PX = 60;
const EDGE_GAP_PX = 12;
/** The Guard Booth panel's offset from the map edges (`top-2`, `left-2`). */
const BOOTH_PANEL_EDGE_PX = 8;
/** Space between the floating card and the map edge it keeps clear. */
const ABOVE_SHEET_PX = 8;

/** One recorded-preview fit: a frame of the family's reference size, held for this request ID. */
async function fetchFit(siteId: string, body: { family: string | null; request_id: string | undefined; observed_at: string | null | undefined; ends_with_photo: boolean }, signal: AbortSignal): Promise<GuardBoothFit> {
  const response = await fetch(`/api/sites/${encodeURIComponent(siteId)}/guard-booth-fit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Parking fit preview failed with ${response.status}`);
  return response.json();
}

function ControlButton({ className, ...props }: ComponentProps<typeof Button>) {
  return <Button variant="outline" size="icon" className={cn("size-11 rounded-lg bg-background shadow-sm", className)} {...props} />;
}

function MenuButton({ className, ...props }: ComponentProps<typeof Button>) {
  return <Button variant="outline" className={cn("h-11 justify-start gap-2 rounded-lg px-3 [&_svg:not([class*='size-'])]:size-5", className)} {...props} />;
}

export function SiteView({ siteId, siteName, lotModel, guardBooth, fitPreviewEnabled = false, entranceClip = false, recommendationsEnabled = false }: { siteId: string; siteName: string; lotModel: LotModel; guardBooth?: GuardBoothMode; fitPreviewEnabled?: boolean; entranceClip?: boolean; recommendationsEnabled?: boolean }) {
  const testingClassification = guardBooth === "preview" || guardBooth === "unknown";
  // The tab bar's parking guide asks the server for a place sized for the model saved with the
  // student's LINE account, held and shared with the Guard Booth.
  const guide = useGuide();
  const guiding = !guardBooth && guide.active;
  // The entrance clip's riders, newest first, and what the booth shows while none is queued.
  const [clipStatus, setClipStatus] = useState<ClipStatus>("classifying");
  const [riderQueue, setRiderQueue] = useState<readonly QueuedRider[]>([]);
  const arrivals = useRef(0);
  const [classificationTest, setClassificationTest] = useState<{ mode: GuardBoothMode } | null>(null);
  const [routeReplay, setRouteReplay] = useState(0);
  const [routedSeq, setRoutedSeq] = useState<number>();
  const [fitFamily, setFitFamily] = useState<GuardBoothFit["family"] | null>(null);
  const [fitRequestId, setFitRequestId] = useState(() => testingClassification ? globalThis.crypto?.randomUUID?.() : undefined);
  const [lastFitResponse, setLastFitResponse] = useState<GuardBoothFit | null>(null);
  const [boothOverview, setBoothOverview] = useState<GuardBoothOverview>("entrance");
  const [holds, setHolds] = useState<readonly ParkingHold[]>([]);
  const [currentHold, setCurrentHold] = useState<ParkingHold | null>(null);
  useEffect(() => {
    if (!testingClassification) return;
    let storage: Storage | null = null;
    try { storage = sessionStorage; } catch { /* Disabled storage. */ }
    setFitRequestId(parkingRequestId(storage, `${siteId}:BOOTH:manual`));
  }, [testingClassification, siteId]);
  useEffect(() => {
    if (!testingClassification || classificationTest?.mode !== "classifying") return;
    const timeout = setTimeout(() => {
      setClassificationTest((current) => current === classificationTest ? { mode: "waiting" } : current);
    }, CLASSIFICATION_TEST_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [testingClassification, classificationTest]);
  const query = useParkingState(siteId);
  const now = useNow(1000);
  // A failed poll means the current state cannot be confirmed, even if an older answer is kept.
  const connectionLost = query.isError;
  // `now` ticks once a second, so an answer that just arrived can look slightly newer than it; that is
  // not clock skew and must not downgrade it.
  const receivedAgoS = query.data ? Math.max(0, now - query.dataUpdatedAt) / 1000 : 0;
  const areas = query.data ? visibleAreas(query.data, receivedAgoS, connectionLost) : null;
  const recordedFrame = areas?.find(({ status, source }) => status === "DEMO" && source === "STILL_IMAGE_LOOP")?.observed_at;
  const lineRecommendation = useParkingRecommendation(siteId, recommendationsEnabled && !guardBooth, recordedFrame);
  const sharedHolds = useQuery<NonNullable<GuardBoothFit["holds"]>>({
    queryKey: ["parking-holds", siteId], enabled: fitPreviewEnabled || recommendationsEnabled,
    retry: false, refetchInterval: 4000,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/sites/${encodeURIComponent(siteId)}/parking-holds`, { signal, cache: "no-store" });
      if (!response.ok) throw new Error("Parking holds unavailable");
      return response.json();
    },
  });
  const lineLedgerCurrent = sharedHolds.dataUpdatedAt < lineRecommendation.dataUpdatedAt ||
    sharedHolds.data?.some((hold) => hold.request_id === lineRecommendation.data?.request_id && hold.stage === "HELD");
  // The map shows the student's place only while the guide is on; closing it leaves the hold to expire.
  const lineFit = guiding && lineLedgerCurrent && !lineRecommendation.isError && !sharedHolds.isError && !connectionLost &&
    activeRecommendation(lineRecommendation.data, recordedFrame, now) ? lineRecommendation.data : null;
  const { family: lineFamily, requestPlace } = lineRecommendation;
  useEffect(() => {
    // Each press asks once, after the server has said which model the student saved.
    if (guiding && lineFamily && isKnownFamily(lineFamily) && guide.claim()) requestPlace();
  }, [guiding, guide, lineFamily, requestPlace]);
  // The entrance clip replays one scene per recorded photo: another photo restarts the clip and ends
  // the riders of the previous one. A photo briefly missing from a poll does not end its scene.
  const [scene, setScene] = useState(recordedFrame);
  const [sceneRequestKey, setSceneRequestKey] = useState<string>();
  useEffect(() => {
    if (!entranceClip || !scene) return;
    let storage: Storage | null = null;
    try { storage = sessionStorage; } catch { /* Disabled storage. */ }
    setSceneRequestKey(parkingSceneKey(storage, siteId, scene, Date.now()));
  }, [entranceClip, siteId, scene]);
  if (entranceClip && recordedFrame && recordedFrame !== scene) {
    setScene(recordedFrame);
    setRiderQueue([]);
  }
  const riders = activeRiders(riderQueue, now);
  if (riders !== riderQueue) setRiderQueue(riders);
  const newest = riders[0]?.rider;
  const newestOutcome = newest && entranceClipOutcome(newest);
  // A frame is fitted only on a current recorded photo; without one the clip outcome claims no fit either way.
  const clipMode = newestOutcome ? (newestOutcome.mode === "fit-preview" && !recordedFrame ? "unknown" : newestOutcome.mode) : clipStatus;
  const classification = entranceClip
    ? clipMode
    : testingClassification ? classificationTest?.mode ?? guardBooth : guardBooth;
  // Each queued rider has its own fit request, so each is held a different place; the first is the newest.
  const fitRequests = !fitPreviewEnabled ? [] : entranceClip
    ? riders.map(({ rider, requestId }) => {
        const outcome = entranceClipOutcome(rider);
        return { requestId, family: guardBoothFitFamily(outcome.mode, outcome.fitFamily, !!recordedFrame) };
      })
    : testingClassification ? [{ requestId: fitRequestId, family: guardBoothFitFamily(classification, fitFamily, !!recordedFrame) }] : [];
  const fitQueries = useQueries({
    queries: fitRequests.map(({ requestId, family }) => ({
      queryKey: ["guard-booth-fit", siteId, requestId, family, recordedFrame],
      enabled: family !== null && !!requestId,
      // A clip rider's hold ends with its scene's photo.
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchFit(siteId, { family, request_id: requestId, observed_at: recordedFrame, ends_with_photo: entranceClip }, signal),
      retry: false,
      staleTime: Infinity,
      refetchInterval: 4000,
    })),
  });
  // Every answer lists all current holds; the latest is kept while a new request is on its way.
  const latestFit = fitQueries.reduce<(typeof fitQueries)[number] | null>((latest, fitQuery) => fitQuery.data && (!latest || fitQuery.dataUpdatedAt > latest.dataUpdatedAt) ? fitQuery : latest, null)?.data;
  if (latestFit && latestFit !== lastFitResponse) setLastFitResponse(latestFit);
  /** The request's frame on the current recorded photo, until its hold expires. */
  const currentFit = (index: number) => {
    const data = fitRequests[index]?.family ? fitQueries[index]?.data : undefined;
    if (!data || data.observed_at !== recordedFrame || fitQueries[index]?.isError || sharedHolds.isError) return { matching: null, expired: false };
    if (sharedHolds.dataUpdatedAt >= (fitQueries[index]?.dataUpdatedAt ?? 0)) {
      const hold = sharedHolds.data?.find((hold) => hold.request_id === data.request_id);
      if (data.polygon && hold?.stage !== "HELD") return { matching: { ...data, polygon: null, route: [], stage: hold?.stage ?? "RELEASED" }, expired: false };
    }
    return { matching: data, expired: !!data.expires_at && now >= Date.parse(data.expires_at) };
  };
  const activeFitFamily = fitRequests[0]?.family ?? null;
  const fitQuery = fitQueries[0];
  const { matching: matchingFit, expired: fitExpired } = currentFit(0);
  const fit = fitExpired ? null : matchingFit;
  // Only a clip rider alone at the booth gets a route; riders close together get their pins only.
  const routeSeq = routeRiderSeq(riders);
  const soloFit = routeSeq === undefined ? null : currentFit(0);
  const clipRoute = soloFit?.matching?.route.length && !soloFit.expired ? soloFit.matching.route : undefined;
  if (routeSeq !== routedSeq) {
    setRoutedSeq(routeSeq);
    // Another rider's arrow is drawn again even when its route matches the previous one.
    if (routeSeq !== undefined) setRouteReplay((current) => current + 1);
  }
  const shownFamily = entranceClip ? newest?.family : activeFitFamily ?? (classification === "fit-preview" ? fitFamily : null);
  const fitModel = shownFamily ? guardBoothModelName(shownFamily) : undefined;
  const lotMap = useLotMap(lotModel, query.data, areas);
  const activeHolds = useMemo(() => activeParkingHolds(lotMap, holds, now), [lotMap, holds, now]);
  if (activeHolds.length !== holds.length) setHolds(activeHolds);
  // The guide's arrow starts at the gate, outside the lot, so the map frames the whole route while it shows.
  const guideRoute = lineFit?.route.length ? lineFit.route : null;
  const map = useMemo(() => {
    const visibleMap = classification === "unavailable"
      ? buildLotMap(lotModel, [])
      : applyParkingHolds(lotMap, activeHolds);
    const areas = classification === "no-fit"
      ? visibleMap.areas.map((area) => ({ ...area, regions: area.regions.filter(({ kind }) => kind === "UNKNOWN") }))
      : visibleMap.areas;
    if (guardBooth) return { ...visibleMap, areas, frame: guardBoothFrame(visibleMap, boothOverview) };
    return guideRoute ? { ...visibleMap, frame: guideFrame(visibleMap.frame, guideRoute) } : visibleMap;
  }, [classification, guardBooth, boothOverview, lotMap, lotModel, activeHolds, guideRoute]);
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
  // On a phone the floating card covers the bottom of the map; a selected place's card is
  // left out, so selecting does not refit the map, and `reveal` keeps the place clear of it instead.
  // The entrance clip's panel stays on screen, so the map keeps the placement clear of it: beside
  // it on a wide screen, below it on a phone. Its size is fixed by layout, never by what it says.
  const boothPanel = useRef<HTMLDivElement>(null);
  const [boothPanelSize, setBoothPanelSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = boothPanel.current;
    if (!entranceClip || !element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      setBoothPanelSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [entranceClip]);
  // On a phone the map and its controls start below the panel.
  const boothTop = entranceClip && !wide && boothPanelSize.height ? BOOTH_PANEL_EDGE_PX + boothPanelSize.height : 0;
  const insets = useMemo<Insets>(
    () => ({
      top: boothTop + CONTROL_BAND_PX,
      // Only the Guard Booth keeps a column of controls on the right; a student's map has one menu button at the top.
      right: guardBooth ? CONTROL_BAND_PX : EDGE_GAP_PX,
      bottom: wide || guardBooth ? EDGE_GAP_PX : peek.base + ABOVE_SHEET_PX,
      left: entranceClip && wide && boothPanelSize.width ? boothPanelSize.width + 2 * EDGE_GAP_PX : EDGE_GAP_PX,
    }),
    [wide, guardBooth, peek.base, entranceClip, boothPanelSize.width, boothTop],
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
  // Each rider reaching the booth joins the queue with its own fit request; earlier riders stay until they expire.
  const onArrival = useCallback((rider: GuardBoothRider) => {
    setSelection(null);
    arrivals.current += 1;
    let storage: Storage | null = null;
    try { storage = sessionStorage; } catch { /* Disabled storage. */ }
    const arrival = { seq: arrivals.current, rider, arrivedAt: Date.now(), requestId: parkingRequestId(storage, `${siteId}:BOOTH:${sceneRequestKey}:${rider.arrival_s}`) };
    setRiderQueue((queue) => enqueueRider(queue, arrival, arrival.arrivedAt));
  }, [siteId, sceneRequestKey]);

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
    // On a phone the details modal closes so the map shows the place.
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
  const boothAlert = connectionLost ? "เชื่อมต่อข้อมูลลานไม่ได้" : allStale ? "ข้อมูลลานไม่เป็นปัจจุบัน" : null;
  const fallback = FALLBACK_NOTICES[renderer.status3d];
  const showsThreeD = mountsThreeD(renderer);
  const nextDestination = classification && !activeFitFamily && !currentHold ? guardBoothPreviewDestination(map, classification, siteId) : null;
  const nextArea = lotMap.areas.find(({ parkingAreaId }) => parkingAreaId === nextDestination?.areaId);
  if (nextDestination && classification === "preview" && testingClassification && nextArea?.live?.source === "SYNTHETIC_FIXTURE") {
    const hold = { areaId: nextDestination.areaId, polygon: nextDestination.polygon, expiresAt: now + PARKING_HOLD_MS };
    setCurrentHold(hold);
    setHolds([...activeHolds, hold]);
  }
  const syntheticHeldPolygons = classification === "unavailable" ? [] : activeHolds.filter((hold) => {
    const area = lotMap.areas.find(({ parkingAreaId }) => parkingAreaId === hold.areaId);
    return area && !area.unknownReason && area.regions.some(({ kind, polygon }) => kind === "AVAILABLE" && JSON.stringify(polygon) === JSON.stringify(hold.polygon))
      && !area.regions.some(({ kind, polygon }) => kind === "UNKNOWN" && overlapsParkingHold(polygon, hold.polygon));
  }).map(({ polygon }) => polygon);
  const ledger = sharedHolds.dataUpdatedAt >= Math.max(...fitQueries.map((q) => q.dataUpdatedAt), 0) ? sharedHolds.data : lastFitResponse?.holds;
  const recordedHeldPolygons = classification === "unavailable" ? [] : (ledger ?? [])
    .filter((hold) => hold.stage !== "RELEASED" && hold.stage !== "OCCUPIED_CONFIRMED")
    .map((hold) => fit?.polygon && JSON.stringify(hold.polygon) === JSON.stringify(fit.polygon) ? fit.polygon : hold.polygon);
  const heldPolygons = [...syntheticHeldPolygons, ...recordedHeldPolygons];
  // The clip's riders are markers in their own colours rather than the one selected destination.
  const destination = lineFit?.polygon ? { polygon: lineFit.polygon, point: labelPoint(lineFit.polygon), text: "จอดตรงนี้", destination: true } : entranceClip ? null : fit?.polygon
    ? { polygon: fit.polygon, point: labelPoint(fit.polygon), text: "จอดตรงนี้", destination: true }
    : classification === "preview" && currentHold && heldPolygons.includes(currentHold.polygon)
    ? { polygon: currentHold.polygon, point: labelPoint(currentHold.polygon), text: "จอดตรงนี้", destination: true }
    : nextDestination;
  const route = lineFit?.route.length ? lineFit.route : entranceClip
    ? clipRoute
    : fit?.route.length ? fit.route : sripatumPreviewRoute(map, siteId, destination?.point);
  const markers: MapMarker[] = riders.flatMap(({ seq, slot }, index) => {
    const { matching, expired } = currentFit(index);
    if (!matching?.polygon || expired) return [];
    return [{ id: String(seq), text: String(slot + 1), color: RIDER_COLORS[slot], point: labelPoint(matching.polygon), polygon: matching.polygon }];
  });
  /** Where a queued rider's fit stands, for its card. */
  const riderFit = (index: number): RiderFit => {
    if (!recordedFrame) return "no-frame";
    if (!fitRequests[index]?.requestId || fitQueries[index]?.isError) return "failed";
    const { matching, expired } = currentFit(index);
    if (!matching) return "pending";
    return matching.polygon && !expired ? "placed" : "no-space";
  };
  const displayMode = fitExpired || (currentHold && !activeHolds.includes(currentHold)) ? "waiting" : activeFitFamily ? "fit-preview" : classification;
  const boothHeadline = classification && (matchingFit?.stage === "OCCUPIED_CONFIRMED" ? "พื้นที่แนะนำมีรถจอดแล้ว"
    : matchingFit?.stage === "AWAITING_CONFIRMATION" ? "ครบเวลา กำลังรอยืนยันพื้นที่"
    : query.isPending && classification !== "unavailable"
    ? "กำลังโหลดสถานะลาน"
    : activeFitFamily && (fitQuery?.isError || !fitRequests[0]?.requestId)
        ? "หาที่จอดไม่ได้"
      : activeFitFamily && !matchingFit
        ? "กำลังหาที่จอด"
        : guardBoothHeadline(displayMode ?? classification, summary.currentAreas > 0, Boolean(destination ?? fit?.polygon) || (classification === "unknown" && summary.present.has("AVAILABLE")), Boolean(route)));
  const estimatedLandmarks = map.landmarks.some((landmark) => landmark.measurement_source === "ESTIMATED");
  const mapLoading = renderer.status3d === "checking" || (showsThreeD && renderer.status3d === "loading");
  const overviewKey = guardBooth ? boothOverview : guideRoute ? "guide" : undefined;
  const lineAnswer = lineRecommendation.data?.observed_at === recordedFrame ? lineRecommendation.data : undefined;
  const guideState = guiding ? guideStatus({
    enabled: recommendationsEnabled, loading: query.isPending, recordedFrame: !!recordedFrame, family: lineFamily,
    preferenceError: lineRecommendation.preferenceError, failed: lineRecommendation.isError || sharedHolds.isError,
    requested: lineRecommendation.requested, answer: lineAnswer, held: !!lineFit,
    expired: !!lineAnswer?.expires_at && now >= Date.parse(lineAnswer.expires_at),
  }) : null;
  const guideSecondsLeft = lineFit?.expires_at ? Math.max(0, Math.ceil((Date.parse(lineFit.expires_at) - now) / 1000)) : 0;
  // The found place's pin offers to save it as where the rider parked (ADR 0021). The pin, and so the
  // offer, shows once the route has drawn to it.
  const foundRequest = guideState === "found" && lineFit?.request_id && destination ? lineFit.request_id : undefined;
  const [closedPrompt, setClosedPrompt] = useState<string>();
  const spotX = destination?.point.x_m;
  const spotY = destination?.point.y_m;
  const callout = useMemo(() => foundRequest && closedPrompt !== foundRequest && spotX !== undefined && spotY !== undefined
    ? <ParkedSpotPrompt key={foundRequest} spot={{ site_id: siteId, x_m: spotX, y_m: spotY }} onClose={() => setClosedPrompt(foundRequest)} />
    : undefined, [foundRequest, closedPrompt, siteId, spotX, spotY]);

  const viewSwitch = (
    <div role="group" aria-label="มุมมองแผนที่" className={cn("flex h-11 overflow-hidden rounded-lg border bg-background shadow-sm", !guardBooth && "w-full")}>
      {(["3d", "2d"] as const).map((mode) => (
        <Button
          key={mode}
          variant="ghost"
          className={cn("h-full rounded-none font-semibold", guardBooth ? "w-12" : "flex-1", renderer.mode === mode && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground")}
          aria-pressed={renderer.mode === mode}
          disabled={mode === "3d" && renderer.status3d === "unavailable"}
          onClick={() => dispatch({ type: "choose", mode })}
        >
          {mode === "3d" ? "3D" : "2D"}
        </Button>
      ))}
    </div>
  );

  // The map is kept apart from the clock: the header and card re-render every second, the map only
  // when what it shows changes.
  const stage = useMemo(() => {
    const selection = destination ?? mapSelection;
    const viewProps = { map, labels, selection, route, routeReplay, heldPolygons, markers, overviewKey, onSelect, insets, callout, ref: view };
    return (
      <ViewErrorBoundary key={renderer.mode} onError={onFailed}>
        {renderer.status3d === "checking" ? null : showsThreeD ? <LotScene {...viewProps} onReady={onReady} onError={onFailed} /> : <LotPlan {...viewProps} />}
      </ViewErrorBoundary>
    );
  }, [map, labels, mapSelection, destination, route, routeReplay, heldPolygons, markers, overviewKey, onSelect, insets, callout, renderer.mode, renderer.status3d, showsThreeD, onReady, onFailed]);

  return (
    <main className={cn("flex flex-col overflow-hidden bg-background text-foreground", guardBooth ? "h-dvh" : "min-h-0 flex-1")}>
      {/* LINE's own bar already names the app, so the lot's name is for screen readers only. */}
      {!guardBooth && <h1 className="sr-only">{siteName}</h1>}

      <div className={cn("relative min-h-0 flex-1 overflow-hidden", !guardBooth && "lg:grid lg:grid-cols-[minmax(0,1fr)_380px]")}>
        <section
          aria-label={
            renderer.mode === "3d"
              ? "แผนที่ลานจอดรถ 3 มิติ ใช้ลูกศรเพื่อเลื่อน Shift กับลูกศรซ้ายหรือขวาเพื่อหมุน + หรือ - เพื่อซูม 0 เพื่อดูทั้งลาน"
              : "แผนที่ลานจอดรถ 2 มิติ ใช้ลูกศรเพื่อเลื่อน + หรือ - เพื่อซูม 0 เพื่อดูทั้งลาน"
          }
          tabIndex={0}
          onKeyDown={onMapKey}
          className={cn("absolute inset-0 overflow-hidden outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset", !guardBooth && "lg:relative lg:inset-auto lg:min-h-0")}
        >
          <MapSkeleton insets={insets} loading={mapLoading} />
          {/* The catalogue's Skeleton Resolve: the view stays hidden while it loads, then fades up over the bare ground. */}
          <div className={cn("absolute inset-0", mapLoading ? "opacity-0" : "motion-safe:animate-skeleton-resolve")}>{stage}</div>

        {classification && (
          // A fixed size: what the panel says never resizes it, so the map never refits under it.
          // On a phone it spans the top; on a wide screen it is a column down the left.
          <div ref={boothPanel} className={cn("pointer-events-none absolute flex flex-col gap-3", entranceClip ? "inset-x-2 top-2 lg:right-auto lg:bottom-2 lg:w-96" : "top-2 bottom-2 left-2 w-[min(24rem,calc(100%-4.5rem))]")}>
          {entranceClip ? (
            <>
              <div className="relative shrink-0">
                <EntranceClip siteId={siteId} scene={scene} onStatus={setClipStatus} onArrival={onArrival} />
                {boothAlert && (
                  <p role="alert" className="absolute inset-x-2 bottom-2 flex items-center gap-2 rounded-lg bg-alert px-3 py-1.5 text-sm font-semibold text-alert-foreground motion-safe:animate-toast-rise">
                    <WifiOff aria-hidden className="size-4 shrink-0" />
                    {boothAlert}
                  </p>
                )}
              </div>
              {/* A phone keeps room for the large card and one row; later rows scroll. */}
              <div className="flex h-48 shrink-0 flex-col lg:h-auto lg:min-h-0 lg:shrink">
                {riders.length === 0 && <BoothIdle status={clipStatus} />}
                {riders.length > 0 && (
                  // Newest first; only the list scrolls, so the panel never runs off the screen.
                  <ol aria-label="รถที่เพิ่งเข้าลาน" aria-live="polite" className="pointer-events-auto -m-2 flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain p-2">
                    {riders.map(({ seq, slot, rider }, index) => (
                      <RiderCard key={seq} rider={rider} number={slot + 1} color={RIDER_COLORS[slot]} guide={riderGuide(rider, riderFit(index), slot + 1)} compact={index > 0} />
                    ))}
                  </ol>
                )}
              </div>
            </>
          ) : (
          <aside aria-label="ข้อมูลการจอด" className="shrink-0 space-y-2 rounded-2xl bg-background p-4 text-base shadow-md lg:p-5">
            <p aria-live="polite" className="text-xl font-bold lg:text-3xl">
              <span key={boothHeadline} className={routeReplay && classification === "preview" ? "animate-[parking-status-enter_200ms_ease-out]" : "motion-safe:animate-[parking-status-enter_200ms_ease-out]"}>{boothHeadline}</span>
            </p>
            {displayMode !== "waiting" && (fitModel || displayMode === "preview" || displayMode === "no-fit") && <p className="font-semibold">{fitModel ?? "Honda Wave 125i"}</p>}
            {classification === "unknown" && !fitModel && <p>ไม่ทราบรุ่นรถ</p>}
            {boothAlert && <p role="alert" className="flex items-center gap-2 font-semibold text-alert"><WifiOff aria-hidden className="size-4 shrink-0" />{boothAlert}</p>}
            {testingClassification && (
              <div role="group" aria-label="ทดสอบสถานะจอป้อมยาม" className="pointer-events-auto flex flex-wrap gap-2 border-t pt-3">
                {CLASSIFICATION_TESTS.map(([mode, label]) => (
                  <Button key={mode} type="button" size="sm" variant={classification === mode ? "default" : "outline"} aria-pressed={classification === mode} onClick={() => {
                    setSelection(null);
                    setClassificationTest({ mode });
                    if (mode !== "preview" || (currentHold && !activeHolds.includes(currentHold))) setCurrentHold(null);
                    if (mode === "preview") {
                      if (classification !== mode || fitExpired || (!fitQuery?.isFetching && !fit?.polygon)) setFitRequestId(globalThis.crypto?.randomUUID?.());
                      setRouteReplay((current) => current + 1);
                    }
                  }}>
                    {label}
                  </Button>
                ))}
                {fitPreviewEnabled && FIT_PREVIEWS.map(([family, label]) => (
                  <Button key={family} type="button" size="sm" variant={classification === "fit-preview" && fitFamily === family ? "default" : "outline"} aria-pressed={classification === "fit-preview" && fitFamily === family} onClick={() => {
                    setSelection(null);
                    setCurrentHold(null);
                    setFitFamily(family);
                    if (classification !== "fit-preview" || fitFamily !== family || fitExpired || (!fitQuery?.isFetching && !fit?.polygon)) setFitRequestId(globalThis.crypto?.randomUUID?.());
                    setClassificationTest({ mode: "fit-preview" });
                    setRouteReplay((current) => current + 1);
                  }}>
                    {label}
                  </Button>
                ))}
              </div>
            )}
          </aside>
          )}
          </div>
        )}

          {guardBooth ? (
            <>
              {/* The view switch keeps its corner in both views; the turn buttons join it on the left in 3D. */}
              <div className="absolute top-3 right-3 flex items-center gap-2" style={boothTop ? { top: boothTop + EDGE_GAP_PX } : undefined}>
                <div role="group" aria-label="กรอบแผนที่จอป้อมยาม" className="flex h-11 overflow-hidden rounded-lg border bg-background shadow-sm">
                  {GUARD_BOOTH_OVERVIEWS.map(([overview, label, Icon]) => (
                    <Button
                      key={overview}
                      variant="ghost"
                      aria-label={label}
                      title={label}
                      aria-pressed={boothOverview === overview}
                      className={cn("h-full w-12 rounded-none", boothOverview === overview && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground")}
                      onClick={() => {
                        if (boothOverview === overview) view.current?.reset(true);
                        else setBoothOverview(overview);
                      }}
                    >
                      <Icon className="size-5" />
                    </Button>
                  ))}
                </div>
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
                {viewSwitch}
              </div>

              <div className="absolute right-3 bottom-3 flex flex-col items-end gap-2">
                <div role="group" aria-label="ซูม" className="flex flex-col overflow-hidden rounded-lg border bg-background shadow-sm">
                  <Button variant="ghost" size="icon" className="size-11 rounded-none" aria-label="ซูมเข้า" onClick={() => view.current?.zoomBy(ZOOM_STEP, true)}>
                    <Plus />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-11 rounded-none border-t" aria-label="ซูมออก" onClick={() => view.current?.zoomBy(1 / ZOOM_STEP, true)}>
                    <Minus />
                  </Button>
                </div>
                {/* As narrow as the other controls, so it stays inside the band labels keep clear of. */}
                <ControlButton aria-label="กลับมุมมองที่เลือก" onClick={() => view.current?.reset(true)}>
                  <Scan />
                </ControlButton>
              </div>
            </>
          ) : (
            // A student's map keeps one button so the lot stays clear; the controls wait in its menu, and
            // touch gestures and the keys still move, zoom and turn the map.
            <Popover.Root>
              <Popover.Trigger render={<ControlButton aria-label="ตัวเลือกแผนที่" className="absolute top-3 right-3" />}>
                <Ellipsis />
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner side="bottom" align="end" sideOffset={8} collisionPadding={12} className="z-50">
                  <Popover.Popup className="w-60 origin-[var(--transform-origin)] space-y-3 rounded-2xl border bg-background p-3 text-foreground shadow-lg outline-none transition-[transform,opacity] duration-150 ease-out-strong data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none">
                    <Popover.Title className="text-sm font-semibold">ตัวเลือกแผนที่</Popover.Title>
                    {viewSwitch}
                    <div className="grid grid-cols-2 gap-2">
                      {renderer.mode === "3d" && (
                        <>
                          <MenuButton onClick={() => view.current?.rotateBy?.(ROTATE_STEP_RAD, true)}><RotateCcw />หมุนซ้าย</MenuButton>
                          <MenuButton onClick={() => view.current?.rotateBy?.(-ROTATE_STEP_RAD, true)}><RotateCw />หมุนขวา</MenuButton>
                        </>
                      )}
                      <MenuButton onClick={() => view.current?.zoomBy(ZOOM_STEP, true)}><Plus />ซูมเข้า</MenuButton>
                      <MenuButton onClick={() => view.current?.zoomBy(1 / ZOOM_STEP, true)}><Minus />ซูมออก</MenuButton>
                      <MenuButton className="col-span-2" onClick={() => view.current?.reset(true)}><Scan />ดูทั้งลาน</MenuButton>
                    </div>
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
          )}
        </section>

        {!guardBooth && <MapPanel
          truth={
            <>
              {guideState && <GuideNotice status={guideState} model={lineFamily && isKnownFamily(lineFamily) ? guardBoothModelName(lineFamily) : null} secondsLeft={guideSecondsLeft} onRetry={guide.start} onClose={guide.stop} />}
              {recommendationsEnabled && heldPolygons.length > 0 && <p className="text-xs text-muted-foreground">กรอบเส้นประสีฟ้า คือพื้นที่ที่พักไว้ให้รถที่กำลังไปจอด</p>}
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
          // The truth notice already speaks for lost or stale data, so the age only shows when it is current.
          updated={query.isPending || connectionLost || allStale ? null : age}
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
        />}
      </div>
    </main>
  );
}

const GUIDE_TEXT: Record<GuideStatus, (model: string, secondsLeft: number) => string> = {
  unavailable: () => "ตอนนี้ยังแนะนำที่จอดไม่ได้ ดูพื้นที่ว่างบนแผนที่แทนได้",
  "unsupported-model": () => "ยังไม่มีขนาดของรุ่นรถนี้ เลือกรุ่นรถในตั้งค่าเพื่อให้แนะนำได้",
  "unverified-model": () => "ยืนยันรุ่นรถไม่ได้ กรุณาเปิดผ่าน LINE อีกครั้ง",
  searching: (model) => `กำลังหาที่จอดสำหรับ ${model}`,
  failed: () => "หาที่จอดไม่สำเร็จ ลองใหม่อีกครั้ง",
  "no-fit": (model) => `ตอนนี้ไม่มีที่ว่างที่ ${model} จอดได้พอดี`,
  found: (model, secondsLeft) => `ตามลูกศรไปยังที่จอดที่พอดีกับ ${model} พักไว้ให้อีก ${secondsLeft} วินาที`,
  confirming: () => "ครบเวลาพักที่จอดแล้ว กำลังรอภาพใหม่ยืนยันว่าพื้นที่ว่าง",
  parked: () => "ตรวจพบรถจอดในพื้นที่แนะนำแล้ว",
  released: () => "คืนที่จอดที่พักไว้แล้ว ขอที่จอดใหม่ได้",
};
const GUIDE_ACTIONS: Partial<Record<GuideStatus, string>> = { failed: "ลองใหม่", "no-fit": "หาอีกครั้ง", released: "แนะนำใหม่" };

/** What the parking guide found, at the top of the card. A retry after a released hold asks for a new place. */
function GuideNotice({ status, model, secondsLeft, onRetry, onClose }: { status: GuideStatus; model: string | null; secondsLeft: number; onRetry(): void; onClose(): void }) {
  const action = GUIDE_ACTIONS[status];
  return (
    <div className={cn("flex items-center gap-2 rounded-lg py-1 pr-1 pl-3 text-sm", status === "found" ? "bg-primary text-primary-foreground" : "bg-muted")}>
      {status === "searching" && <Spinner />}
      <p role="status" className="min-w-0 flex-1 py-2 text-pretty">
        <span key={status} className="inline-block motion-safe:animate-content-swap">{GUIDE_TEXT[status](model ?? "รถของคุณ", secondsLeft)}</span>
      </p>
      {action && <Button variant="outline" className="h-11 text-foreground" onClick={onRetry}>{action}</Button>}
      {status === "unsupported-model" && <Button variant="outline" className="h-11 text-foreground" render={<Link href="/settings" />} nativeButton={false}>ตั้งค่า</Button>}
      <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label="ปิดการแนะนำที่จอด" onClick={onClose}><X /></Button>
    </div>
  );
}

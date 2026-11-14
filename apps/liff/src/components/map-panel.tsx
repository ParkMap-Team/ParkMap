"use client";

import { ChevronUp, MapPin, Motorbike, X } from "lucide-react";
import { type AnimationPlaybackControls, animate, useMotionValue } from "motion/react";
import {
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/button";
import { prefersReducedMotion } from "@/lib/map/flight";
import { LEGEND_ORDER, MAP_LEGEND_ORDER, STATUS_TEXT, unknownReasonText } from "@/lib/map/legend";
import type { MapHit, MapStatus } from "@/lib/map/lot-map";
import { type AreaPhoto, COLORS, type TimeLine } from "@/lib/parking/presentation";
import { dragOffset, restsOpen } from "@/lib/sheet";
import { cn } from "@/lib/utils";

// The text side of the map: a summary, the selected place, the photos the state was computed from,
// the legend, and every status as a list. It never depends on the canvas, so the page reads the same without 3D
// or without sight. On a phone it is a bottom sheet whose peek always shows the source notice and
// the summary; on a wide screen it is a column beside the map.

const SWATCH_STYLES: Record<MapStatus, CSSProperties> = {
  WIDTH_SUFFICIENT: { backgroundColor: COLORS.WIDTH_SUFFICIENT, border: `2px solid ${COLORS.AVAILABLE_STROKE}` },
  AVAILABLE: { backgroundColor: COLORS.AVAILABLE, border: `2px solid ${COLORS.AVAILABLE_STROKE}` },
  ALMOST_AVAILABLE: { backgroundColor: COLORS.ALMOST_AVAILABLE, border: `2px dashed ${COLORS.ALMOST_AVAILABLE_STROKE}` },
  OCCUPIED: { backgroundColor: COLORS.OCCUPIED, color: "#ffffff" },
  UNKNOWN: { backgroundImage: `repeating-linear-gradient(-45deg, ${COLORS.UNKNOWN_HATCH} 0 2px, ${COLORS.UNKNOWN} 2px 6px)` },
  MONITORED: { backgroundColor: COLORS.PARKING_AREA, border: `1px solid ${COLORS.PARKING_AREA_STROKE}` },
  UNMONITORED: { backgroundColor: COLORS.UNMONITORED, backgroundImage: `radial-gradient(${COLORS.UNMONITORED_DOT} 1.5px, transparent 1.6px)`, backgroundSize: "6px 6px" },
};

export function Swatch({ status, className }: { status: MapStatus; className?: string }) {
  return (
    <span aria-hidden className={cn("grid size-5 shrink-0 place-items-center rounded-sm", className)} style={SWATCH_STYLES[status]}>
      {status === "OCCUPIED" && <Motorbike className="size-3.5" />}
    </span>
  );
}

export type SelectedDetails = {
  hit: MapHit | null;
  areaName: string | null;
  change: { from: MapStatus; to: MapStatus | null } | null;
  times: TimeLine[];
};

function changeText({ from, to }: NonNullable<SelectedDetails["change"]>): string {
  return to
    ? `ข้อมูลใหม่ตรงจุดที่เลือกเปลี่ยนจาก "${STATUS_TEXT[from].label}" เป็น "${STATUS_TEXT[to].label}"`
    : `ข้อมูลใหม่ไม่มีจุดที่เลือกแล้ว (เดิมคือ "${STATUS_TEXT[from].label}")`;
}

function Selected({ details, full, onClear }: { details: SelectedDetails; full: boolean; onClear(): void }) {
  const { hit, areaName, change, times } = details;
  const reason = hit?.unknownReason ? unknownReasonText(hit.unknownReason) : null;
  return (
    <section aria-label="จุดที่เลือก" className="rounded-lg border bg-card p-3">
      <div className="flex items-start gap-2">
        {hit && <Swatch status={hit.status} className="mt-0.5" />}
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{hit ? STATUS_TEXT[hit.status].label : "ไม่มีข้อมูลตรงจุดนี้"}</h2>
          {areaName && <p className="text-xs text-muted-foreground">{areaName}</p>}
        </div>
        <Button variant="ghost" size="icon" className="-mt-2 -mr-2 size-11" aria-label="ยกเลิกการเลือก" onClick={onClear}>
          <X />
        </Button>
      </div>
      {change && (
        <p role="status" className="mt-2 rounded-md bg-notice px-2 py-1.5 text-xs text-notice-foreground">
          {changeText(change)}
        </p>
      )}
      {hit && <p className="mt-2 text-sm">{reason ?? STATUS_TEXT[hit.status].detail}</p>}
      {hit?.status === "WIDTH_SUFFICIENT" && <div className="mt-2 space-y-1 text-xs">
        <p>{hit.region?.display_polygon ? 'ช่วงวิเคราะห์เดิมกว้าง' : 'ช่วงกว้าง'} {hit.region?.width_m?.toFixed(2)} ม.</p>
        {hit.region?.display_polygon && <p>กรอบแสดงผลตัดตาม ROI · ค่าความกว้างอ้างอิงช่วงวิเคราะห์เดิม</p>}
        {!!hit.region?.reasons?.length && <p>ข้อจำกัด: {hit.region.reasons.map(code => (({
          GROUND_MAY_BE_OCCLUDED: "พื้นอาจถูกตัวรถบัง",
          LOCAL_ROW_UNCERTAINTY: "ตำแหน่งรถใกล้เคียงยังไม่แน่นอน",
          ROW_UNCERTAIN: "ข้อมูลแถวยังไม่แน่นอน",
          FOOTPRINT_NOT_PROVEN: "ยังไม่ยืนยันการวางรถในขอบแถว",
        } as Record<string, string>)[code] ?? code)).join(" · ")}</p>}
      </div>}
      {full && times.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 text-xs text-muted-foreground">
          {times.map((line) => (
            <div key={line.label} className="contents">
              <dt>{line.label}</dt>
              <dd className="text-foreground tabular-nums">{line.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function Legend({ present }: { present: Set<MapStatus> }) {
  return (
    <section aria-labelledby="legend-title">
      <h2 id="legend-title" className="mb-2 text-sm font-semibold">
        สัญลักษณ์บนแผนที่
      </h2>
      <ul className="grid grid-cols-1 gap-1.5 text-sm min-[480px]:grid-cols-2 lg:grid-cols-1">
        {MAP_LEGEND_ORDER.map((status) => (
          <li key={status} className={cn("flex items-center gap-2", !present.has(status) && !(status === "AVAILABLE" && present.has("WIDTH_SUFFICIENT")) && "text-muted-foreground")}>
            <Swatch status={status === "AVAILABLE" && !present.has("AVAILABLE") && present.has("WIDTH_SUFFICIENT") ? "WIDTH_SUFFICIENT" : status} />
            {STATUS_TEXT[status].label}
          </li>
        ))}
      </ul>
    </section>
  );
}

export type AreaRow = { id: string; name: string; status: string; time: string | null };

export type ShownPhoto = AreaPhoto & { name: string };

/**
 * One area's photo. A new version is fetched only while the details are open, and it replaces the
 * shown one once it has loaded, so a poll never blanks the photo; a version that fails to load,
 * such as one already replaced on the server, leaves the last one in place, or nothing.
 */
function Photo({ photo, open }: { photo: ShownPhoto; open: boolean }) {
  const [shown, setShown] = useState<ShownPhoto | null>(null);
  useEffect(() => {
    if (!open) return;
    const image = new Image();
    image.onload = () => setShown(photo);
    image.src = photo.url;
    return () => {
      image.onload = null;
    };
  }, [open, photo]);
  if (!shown) return null;
  return (
    <figure className="overflow-hidden rounded-lg border bg-card">
      {/* A plain image: the photo is already sized by the worker and served through this app's proxy. */}
      <img src={shown.url} width={shown.width} height={shown.height} alt={`ภาพจากกล้อง ${shown.name}`} className="block h-auto w-full" style={{ aspectRatio: `${shown.width} / ${shown.height}` }} />
      <figcaption className="px-3 py-2 text-xs text-muted-foreground">{shown.name}</figcaption>
    </figure>
  );
}

function Photos({ photos, open }: { photos: ShownPhoto[]; open: boolean }) {
  if (photos.length === 0) return null;
  return (
    <section aria-labelledby="photos-title">
      <h2 id="photos-title" className="mb-2 text-sm font-semibold">
        ภาพจากกล้อง
      </h2>
      <div className="space-y-2">
        {photos.map((photo) => (
          <Photo key={photo.id} photo={photo} open={open} />
        ))}
      </div>
    </section>
  );
}

function StatusList({ present, areas, onShow }: { present: Set<MapStatus>; areas: AreaRow[]; onShow(status: MapStatus): void }) {
  const shown = LEGEND_ORDER.filter((status) => present.has(status));
  return (
    <section aria-labelledby="status-list-title">
      <h2 id="status-list-title" className="mb-2 text-sm font-semibold">
        สถานะในแผนที่
      </h2>
      <ul className="divide-y rounded-lg border bg-card">
        {areas.map((area) => (
          <li key={area.id} className="px-3 py-2 text-sm">
            <p>{area.name}</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {area.status}
              {area.time && ` · ${area.time}`}
            </p>
          </li>
        ))}
        {shown.map((status) => (
          <li key={status} className="flex items-center gap-2 py-0.5 pr-1 pl-3 text-sm">
            <Swatch status={status} />
            <span className="flex-1">{STATUS_TEXT[status].label}</span>
            <Button variant="ghost" className="h-11 text-xs" onClick={() => onShow(status)}>
              <MapPin data-icon="inline-start" />
              ดูบนแผนที่
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Tailwind's `lg` breakpoint, where the sheet becomes a column beside the map. */
const WIDE_QUERY = "(min-width: 64rem)";

function subscribeWide(onChange: () => void) {
  const query = matchMedia(WIDE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => matchMedia(WIDE_QUERY).matches,
    () => false,
  );
}

/** Movement before a press on the peek becomes a drag, so taps on its buttons still work. */
const DRAG_SLOP_PX = 8;
/** Only the last moments of a drag decide how fast it was released. */
const VELOCITY_WINDOW_MS = 100;
const SHEET_SPRING = { type: "spring", bounce: 0, visualDuration: 0.3 } as const;

/** How much of the map the sheet covers at rest: with and without the selected place's card. */
export type PeekHeights = { base: number; full: number };

type Drag = { pointerId: number; startY: number; startOffset: number; dragging: boolean; samples: { t: number; y: number }[] };

export function MapPanel({
  truth,
  viewNotice,
  headline,
  headlineStatus,
  present,
  areas,
  photos,
  estimatedLandmarks,
  selected,
  expanded,
  onExpandedChange,
  onClearSelection,
  onShow,
  onPeek,
}: {
  /** Whether the data can be trusted; always shown, above the summary. */
  truth: ReactNode;
  /** About the map view itself, such as why it shows 2D; first in the details. */
  viewNotice: ReactNode;
  headline: string;
  headlineStatus: MapStatus | null;
  present: Set<MapStatus>;
  areas: AreaRow[];
  /** The photo each shown area was computed from. */
  photos: ShownPhoto[];
  /** Some landmarks were estimated from photos or imagery rather than measured on site. */
  estimatedLandmarks: boolean;
  selected: SelectedDetails | null;
  expanded: boolean;
  onExpandedChange(expanded: boolean): void;
  onClearSelection(): void;
  onShow(status: MapStatus): void;
  onPeek(heights: PeekHeights): void;
}) {
  const wide = useWide();
  const sheet = useRef<HTMLElement>(null);
  const peek = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  // Pixels the sheet is pushed down: 0 is open, `collapsed` shows only the peek.
  const y = useMotionValue(0);
  const collapsed = useRef(0);
  const sheetHeight = useRef(0);
  const motion = useRef<AnimationPlaybackControls | null>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  // Until the sheet is measured on a phone its details stay out of layout, so the first paint
  // already shows the sheet at its peek instead of open.
  const [measured, setMeasured] = useState(false);
  const latest = useRef({ expanded, wide, onPeek });
  latest.current = { expanded, wide, onPeek };

  // The motion value drives the transform directly, in the same frame it changes.
  useLayoutEffect(
    () =>
      y.on("change", (offset) => {
        if (sheet.current) sheet.current.style.transform = latest.current.wide ? "" : `translateY(${offset}px)`;
      }),
    [y],
  );

  const settle = useCallback(
    (open: boolean, velocity?: number) => {
      const target = open ? 0 : collapsed.current;
      motion.current?.stop();
      if (prefersReducedMotion() || latest.current.wide) {
        y.set(target);
        return;
      }
      motion.current = animate(y, target, velocity === undefined ? SHEET_SPRING : { ...SHEET_SPRING, velocity });
    },
    [y],
  );

  const measure = useCallback(() => {
    const element = sheet.current;
    const peekElement = peek.current;
    if (!element || !peekElement) return;
    const padding = parseFloat(getComputedStyle(element).paddingBottom) || 0;
    const visible = peekElement.offsetHeight + padding;
    latest.current.onPeek({ full: visible, base: visible - (card.current?.offsetHeight ?? 0) });
    sheetHeight.current = element.offsetHeight;
    const next = Math.max(0, element.offsetHeight - visible);
    if (next === collapsed.current) return;
    collapsed.current = next;
    // The sheet grows and shrinks from its bottom edge, so a resting peek is kept in place at once;
    // a sheet on its way down is sent to the new rest instead.
    if (latest.current.wide || latest.current.expanded || drag.current?.dragging) return;
    if (y.isAnimating()) settle(false);
    else y.set(next);
  }, [settle, y]);

  useLayoutEffect(() => {
    setMeasured(true);
  }, []);

  // Measured again once the details join the layout, before that frame is painted.
  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (sheet.current) observer.observe(sheet.current);
    if (peek.current) observer.observe(peek.current);
    return () => observer.disconnect();
  }, [measure, measured]);

  // Between a column and a sheet the sheet rests where the state says, at once.
  useLayoutEffect(() => {
    const element = sheet.current;
    if (!element) return;
    motion.current?.stop();
    if (wide) {
      element.style.transform = "";
      return;
    }
    y.jump(latest.current.expanded ? 0 : collapsed.current);
    element.style.transform = `translateY(${y.get()}px)`;
  }, [wide, y]);

  // Opening or closing from a button or from the page glides. A released drag has already started
  // its own glide with the finger's speed and recorded where it goes, so it is not restarted here.
  const heading = useRef(expanded);
  useLayoutEffect(() => {
    if (heading.current === expanded) return;
    heading.current = expanded;
    if (!latest.current.wide) settle(expanded);
  }, [expanded, settle]);

  useEffect(() => () => motion.current?.stop(), []);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    suppressClick.current = false;
    if (wide || drag.current || !event.isPrimary || event.button !== 0) return;
    drag.current = { pointerId: event.pointerId, startY: event.clientY, startOffset: 0, dragging: false, samples: [] };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.dragging) {
      if (Math.abs(event.clientY - current.startY) < DRAG_SLOP_PX) return;
      // The finger takes the sheet from wherever it is, even mid-glide.
      motion.current?.stop();
      current.dragging = true;
      current.startY = event.clientY;
      current.startOffset = y.get();
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    y.set(dragOffset(current.startOffset + event.clientY - current.startY, collapsed.current, sheetHeight.current));
    current.samples.push({ t: event.timeStamp, y: event.clientY });
    while (current.samples.length > 2 && event.timeStamp - current.samples[0].t > VELOCITY_WINDOW_MS) current.samples.shift();
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!current.dragging) return;
    suppressClick.current = true;
    const first = current.samples[0];
    const last = current.samples[current.samples.length - 1];
    const elapsed = last && first ? last.t - first.t : 0;
    const velocity = elapsed > 0 ? ((last.y - first.y) / elapsed) * 1000 : 0;
    const open = restsOpen(y.get(), velocity, collapsed.current);
    heading.current = open;
    settle(open, velocity);
    if (open !== expanded) onExpandedChange(open);
  }

  function onPointerCancel(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (current.dragging) settle(expanded);
  }

  // A drag that ends over a button must not also press it.
  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  const open = wide || expanded;
  return (
    <aside
      ref={sheet}
      aria-label="สรุปสถานะลานจอด"
      className={cn(
        "absolute inset-x-0 bottom-0 z-10 flex max-h-[calc(100%-3.5rem)] flex-col rounded-t-xl border-t bg-background pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_20px_-12px_rgb(15_23_42/0.35)] will-change-transform",
        "lg:static lg:max-h-none lg:min-h-0 lg:rounded-none lg:border-t-0 lg:border-l lg:pb-0 lg:shadow-none lg:will-change-auto",
      )}
    >
      <div
        ref={peek}
        className="shrink-0 touch-none select-none lg:touch-auto lg:select-auto"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClickCapture={onClickCapture}
      >
        <div aria-hidden className="mx-auto mt-2 h-1 w-9 rounded-full bg-border lg:hidden" />
        <div className="space-y-2 px-4 pt-2 empty:hidden lg:pt-4">{truth}</div>
        <div className="flex items-center gap-2 px-4 py-2">
          {headlineStatus && <Swatch status={headlineStatus} />}
          {/* Announced only when the sentence changes, not on every poll. */}
          <p aria-live="polite" className="min-w-0 flex-1 text-base font-semibold">
            {headline}
          </p>
          <Button
            variant="outline"
            className="h-11 lg:hidden"
            aria-expanded={expanded}
            aria-controls="map-panel-details"
            onClick={() => onExpandedChange(!expanded)}
          >
            {expanded ? "ย่อ" : "รายละเอียด"}
            <ChevronUp data-icon="inline-end" className={cn("transition-transform duration-150 motion-reduce:transition-none", expanded && "rotate-180")} />
          </Button>
        </div>
        {selected && (
          <div ref={card} className="px-4 pb-3">
            <Selected details={selected} full={open} onClear={onClearSelection} />
          </div>
        )}
      </div>
      <div
        id="map-panel-details"
        inert={!open}
        className={cn("min-h-0 space-y-4 overflow-y-auto overscroll-contain px-4 pt-1 pb-4", !measured && "max-lg:hidden")}
      >
        {viewNotice}
        <Photos photos={photos} open={open} />
        <Legend present={present} />
        <StatusList present={present} areas={areas} onShow={onShow} />
        <p className="text-xs text-muted-foreground">
          ตำแหน่งบนแผนที่คำนวณจากภาพกล้องหนึ่งตัว จึงเป็นค่าโดยประมาณ แนวรถแนวนอนประมาณจากกรอบในภาพ ไม่ใช่มุมหรือขนาดที่วัดจริง ระบบไม่มีการจองที่จอด และไม่ได้แบ่งช่องจอดตายตัว
          {estimatedLandmarks && " อาคาร ต้นไม้ และสิ่งรอบลานวาดจากภาพถ่าย ตำแหน่งและขนาดเป็นค่าโดยประมาณ"}
        </p>
      </div>
    </aside>
  );
}

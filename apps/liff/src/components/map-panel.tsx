"use client";

import { ChevronRight, ChevronUp, Motorbike, X } from "lucide-react";
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
import { STATUS_TEXT, legendRows, unknownReasonText } from "@/lib/map/legend";
import type { MapHit, MapStatus } from "@/lib/map/lot-map";
import { type AreaPhoto, COLORS, type TimeLine } from "@/lib/parking/presentation";
import { dragOffset, restsOpen } from "@/lib/sheet";
import { cn } from "@/lib/utils";

// The text side of the map: a summary, the selected place, the photos the state was computed from,
// and the legend, which also finds each shown status on the map. It never depends on the canvas, so the page reads the same without 3D
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
    <section aria-label="จุดที่เลือก" className="rounded-xl bg-muted p-3">
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

/** The key, where each status the map shows now is also the way to find it. */
function Legend({ present, onShow }: { present: Set<MapStatus>; onShow(status: MapStatus): void }) {
  return (
    <section aria-labelledby="legend-title">
      <h2 id="legend-title" className="mb-1 text-sm font-semibold">
        สีบนแผนที่
      </h2>
      <ul className="-mx-2 text-sm">
        {legendRows(present).map(({ status, present: shown }) => (
          <li key={status}>
            {shown ? (
              <button
                type="button"
                onClick={() => onShow(status)}
                className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-muted"
              >
                <Swatch status={status} />
                <span className="flex-1">{STATUS_TEXT[status].label}</span>
                <span className="sr-only">ดูบนแผนที่</span>
                <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
              </button>
            ) : (
              <div className="flex min-h-11 items-center gap-3 px-2 text-muted-foreground">
                <Swatch status={status} />
                {STATUS_TEXT[status].label}
              </div>
            )}
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
    <figure className="overflow-hidden rounded-xl bg-muted">
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

/** Each watched area's data status and age. */
function Areas({ areas }: { areas: AreaRow[] }) {
  if (areas.length === 0) return null;
  return (
    <section aria-labelledby="areas-title">
      <h2 id="areas-title" className="mb-1 text-sm font-semibold">
        พื้นที่ที่ตรวจสอบ
      </h2>
      <ul className="divide-y text-sm">
        {areas.map((area) => (
          <li key={area.id} className="flex items-baseline justify-between gap-3 py-2.5">
            <span className="min-w-0">{area.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {area.status}
              {area.time && ` · ${area.time}`}
            </span>
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
/** The floating card's gap to the map's bottom edge (`bottom-8`), clearing the guide circle that rises 20px above the tab bar. */
const FLOAT_GAP_PX = 32;

type Drag = { pointerId: number; startY: number; startOffset: number; dragging: boolean; samples: { t: number; y: number }[] };

export function MapPanel({
  truth,
  viewNotice,
  headline,
  headlineStatus,
  updated,
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
  /** How old the shown state is, as a quiet line under the headline; null hides it. */
  updated: string | null;
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
    // Heights from the map's bottom edge, so they include the gap the floating card keeps below it.
    latest.current.onPeek({ full: FLOAT_GAP_PX + visible, base: FLOAT_GAP_PX + visible - (card.current?.offsetHeight ?? 0) });
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
  const summary = (
    <>
      {headlineStatus && <Swatch status={headlineStatus} className="size-4" />}
      {/* Announced only when the sentence changes, not on every poll. */}
      <span aria-live="polite" className="min-w-0 flex-1 text-sm font-semibold">
        {headline}
      </span>
      {/* Plain trailing text like a transit app's live time, not a badge; never announced, since it ticks every second. */}
      {updated && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{updated}</span>}
    </>
  );
  return (
    // On a phone the sheet is a card floating clear of the screen's edges and the tab bar. The frame
    // clips the part a resting card keeps below its peek, and casts the shadow of what shows.
    <div
      className={cn(
        "pointer-events-none absolute inset-x-3 top-3 bottom-8 z-10 flex flex-col justify-end overflow-hidden rounded-2xl drop-shadow-[0_4px_12px_rgb(15_23_42/0.12)]",
        "lg:pointer-events-auto lg:static lg:min-h-0 lg:overflow-visible lg:rounded-none lg:drop-shadow-none",
      )}
    >
    <aside
      ref={sheet}
      aria-label="สรุปสถานะลานจอด"
      className={cn(
        "pointer-events-auto flex max-h-[calc(100%-3rem)] flex-col rounded-2xl border bg-background pb-[var(--safe-bottom)] will-change-transform",
        "lg:max-h-none lg:min-h-0 lg:flex-1 lg:rounded-none lg:border-0 lg:border-l lg:pb-0 lg:will-change-auto",
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
        <div aria-hidden className="mx-auto mt-1.5 h-1 w-8 rounded-full bg-border lg:hidden" />
        <div className="space-y-2 px-4 pt-1.5 empty:hidden lg:pt-4">{truth}</div>
        {wide ? (
          <div className="flex items-center gap-2 px-4 py-2.5">{summary}</div>
        ) : (
          // The summary row is the sheet's one toggle, beside dragging its handle.
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls="map-panel-details"
            onClick={() => onExpandedChange(!expanded)}
            className="flex min-h-11 w-full items-center gap-2 px-4 pt-1.5 pb-2.5 text-left outline-none focus-visible:bg-muted"
          >
            {summary}
            <span className="sr-only">{expanded ? "ย่อรายละเอียด" : "ดูรายละเอียด"}</span>
            <ChevronUp
              aria-hidden
              className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none", expanded && "rotate-180")}
            />
          </button>
        )}
        {selected && (
          <div ref={card} className="px-4 pb-3">
            <Selected details={selected} full={open} onClear={onClearSelection} />
          </div>
        )}
      </div>
      <div
        id="map-panel-details"
        inert={!open}
        className={cn("min-h-0 space-y-5 overflow-y-auto overscroll-contain px-4 pt-1 pb-4", !measured && "max-lg:hidden")}
      >
        {viewNotice}
        <Legend present={present} onShow={onShow} />
        <Areas areas={areas} />
        <Photos photos={photos} open={open} />
        <p className="border-t pt-4 text-xs text-pretty text-muted-foreground">
          ตำแหน่งบนแผนที่คำนวณจากภาพกล้องหนึ่งตัว จึงเป็นค่าโดยประมาณ แนวรถแนวนอนประมาณจากกรอบในภาพ ไม่ใช่มุมหรือขนาดที่วัดจริง ระบบไม่มีการจองที่จอด และไม่ได้แบ่งช่องจอดตายตัว
          {estimatedLandmarks && " อาคาร ต้นไม้ และสิ่งรอบลานวาดจากภาพถ่าย ตำแหน่งและขนาดเป็นค่าโดยประมาณ"}
        </p>
      </div>
    </aside>
    </div>
  );
}

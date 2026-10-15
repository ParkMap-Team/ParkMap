"use client";

import { ChevronUp, MapPin, Motorbike, X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { LEGEND_ORDER, STATUS_TEXT, unknownReasonText } from "@/lib/map/legend";
import type { MapHit, MapStatus } from "@/lib/map/lot-map";
import { COLORS, type TimeLine } from "@/lib/parking/presentation";
import { cn } from "@/lib/utils";

// The text side of the map: a summary, the legend, the selected place, and every status as a list.
// It never depends on the canvas, so the page reads the same without 3D or without sight.

const SWATCH_STYLES: Record<MapStatus, CSSProperties> = {
  AVAILABLE: { backgroundColor: COLORS.AVAILABLE, border: `2px solid ${COLORS.AVAILABLE_STROKE}` },
  ALMOST_AVAILABLE: { backgroundColor: COLORS.ALMOST_AVAILABLE, border: `2px dashed ${COLORS.ALMOST_AVAILABLE_STROKE}` },
  OCCUPIED: { backgroundColor: COLORS.OCCUPIED, color: "#ffffff" },
  UNKNOWN: { backgroundImage: `repeating-linear-gradient(-45deg, ${COLORS.UNKNOWN_HATCH} 0 3px, ${COLORS.UNKNOWN} 3px 7px)` },
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
    <section aria-label="จุดที่เลือก" className="rounded-xl border bg-card p-3">
      <div className="flex items-start gap-2">
        {hit && <Swatch status={hit.status} className="mt-0.5" />}
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{hit ? STATUS_TEXT[hit.status].label : "ไม่มีข้อมูลตรงจุดนี้"}</h2>
          {areaName && <p className="text-xs text-muted-foreground">{areaName}</p>}
        </div>
        <Button variant="ghost" size="icon" className="-mt-1 -mr-1 size-11" aria-label="ยกเลิกการเลือก" onClick={onClear}>
          <X />
        </Button>
      </div>
      {change && (
        <p role="status" className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
          {changeText(change)}
        </p>
      )}
      {hit && <p className="mt-2 text-sm">{reason ?? STATUS_TEXT[hit.status].detail}</p>}
      {full && times.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {times.map((line) => (
            <div key={line.label} className="contents">
              <dt>{line.label}</dt>
              <dd className="text-foreground">{line.value}</dd>
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
        {LEGEND_ORDER.map((status) => (
          <li key={status} className={cn("flex items-center gap-2", !present.has(status) && "text-muted-foreground")}>
            <Swatch status={status} />
            {STATUS_TEXT[status].label}
          </li>
        ))}
      </ul>
    </section>
  );
}

export type AreaRow = { id: string; name: string; status: string; time: string | null };

function StatusList({ present, areas, onShow }: { present: Set<MapStatus>; areas: AreaRow[]; onShow(status: MapStatus): void }) {
  const shown = LEGEND_ORDER.filter((status) => present.has(status));
  return (
    <section aria-labelledby="status-list-title">
      <h2 id="status-list-title" className="mb-2 text-sm font-semibold">
        สถานะในแผนที่
      </h2>
      <ul className="divide-y rounded-xl border">
        {areas.map((area) => (
          <li key={area.id} className="px-3 py-2 text-sm">
            <p className="font-medium">{area.name}</p>
            <p className="text-xs text-muted-foreground">
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

export function MapPanel({
  headline,
  headlineStatus,
  notices,
  present,
  areas,
  selected,
  expanded,
  onToggle,
  onClearSelection,
  onShow,
}: {
  headline: string;
  headlineStatus: MapStatus | null;
  notices: ReactNode;
  present: Set<MapStatus>;
  areas: AreaRow[];
  selected: SelectedDetails | null;
  expanded: boolean;
  onToggle(): void;
  onClearSelection(): void;
  onShow(status: MapStatus): void;
}) {
  return (
    <aside
      aria-label="สรุปสถานะลานจอด"
      className="flex max-h-[60dvh] shrink-0 flex-col border-t bg-background pb-[env(safe-area-inset-bottom)] lg:max-h-none lg:min-h-0 lg:flex-1 lg:border-t-0 lg:border-l"
    >
      <div className="flex items-center gap-2 px-4 pt-2 pb-1">
        {headlineStatus && <Swatch status={headlineStatus} />}
        {/* Announced only when the sentence changes, not on every poll. */}
        <p aria-live="polite" className="min-w-0 flex-1 text-base font-semibold">
          {headline}
        </p>
        <Button variant="outline" className="h-11 lg:hidden" aria-expanded={expanded} aria-controls="map-panel-details" onClick={onToggle}>
          {expanded ? "ย่อ" : "รายละเอียด"}
          <ChevronUp data-icon="inline-end" className={cn("transition-transform motion-reduce:transition-none", !expanded && "rotate-180")} />
        </Button>
      </div>
      <div className="min-h-0 space-y-3 overflow-y-auto px-4 pb-3">
        {selected && <Selected details={selected} full={expanded} onClear={onClearSelection} />}
        <div id="map-panel-details" className={cn("space-y-4", !expanded && "hidden lg:block")}>
          {notices}
          <Legend present={present} />
          <StatusList present={present} areas={areas} onShow={onShow} />
          <p className="text-xs text-muted-foreground">
            ตำแหน่งบนแผนที่คำนวณจากภาพกล้องหนึ่งตัว จึงเป็นค่าโดยประมาณ ระบบไม่มีการจองที่จอด และไม่ได้แบ่งช่องจอดตายตัว
          </p>
        </div>
      </div>
    </aside>
  );
}

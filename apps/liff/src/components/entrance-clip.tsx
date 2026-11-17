"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleOff, LoaderCircle, type LucideIcon, MapPin, Motorbike, SquareParking, TriangleAlert, Video } from "lucide-react";
import { type CSSProperties, type SyntheticEvent, useEffect, useRef, useState } from "react";
import type { GuardBoothClassification, GuardBoothRider } from "@/lib/api/types";
import { type RiderGuide, arrivedRider, entranceClipCrop, riderGuide, riderTitle } from "@/lib/parking/guard-booth";
import { cn } from "@/lib/utils";

// The Guard Booth entrance camera beside the parking map. It reports each rider as the clip reaches
// the moment that rider enters the booth zone. The page queues those riders; each gets a card under
// the camera and a numbered pin on the map. Every card has a fixed height, so a change in what it
// says never moves the camera or the map. With a recorded lot photo the clip plays once per photo
// (its scene) and waits on its last frame; the next photo restarts it, so the camera and the lot
// change together.

/** What the booth shows while no rider is queued. */
export type ClipStatus = "classifying" | "waiting" | "unknown";

export function EntranceClip({ siteId, scene, onStatus, onArrival }: {
  siteId: string;
  /** The lot photo the clip is replayed with; the clip loops on its own until there is one. */
  scene: string | null | undefined;
  onStatus: (status: ClipStatus) => void;
  onArrival: (rider: GuardBoothRider) => void;
}) {
  const [failed, setFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!scene || !element) return;
    element.currentTime = 0;
    // A play interrupted by the next scene's restart is not a camera failure.
    element.play().catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) setFailed(true);
    });
  }, [scene]);
  // The latest rider passed in the current loop, the clip time it was checked at, and whether the
  // riders were known then: riders the clip passed before they were known did not arrive live.
  const pass = useRef({ index: -1, time: 0, known: false });
  const query = useQuery({
    queryKey: ["guard-booth-classification", siteId],
    queryFn: async ({ signal }): Promise<GuardBoothClassification> => {
      const response = await fetch(`/api/sites/${encodeURIComponent(siteId)}/guard-booth-classification`, { signal, cache: "no-store" });
      if (!response.ok) throw new Error(`Guard Booth classification failed with ${response.status}`);
      return response.json();
    },
    retry: false,
    staleTime: Infinity,
  });
  const riders = query.data?.riders;
  const status: ClipStatus = failed || riders ? "waiting" : query.isError ? "unknown" : "classifying";
  useEffect(() => onStatus(status), [status, onStatus]);

  const onTimeUpdate = (event: SyntheticEvent<HTMLVideoElement>) => {
    const time = event.currentTarget.currentTime;
    if (time < pass.current.time) pass.current.index = -1;
    pass.current.time = time;
    if (!riders) return;
    const index = arrivedRider(riders, time);
    if (!pass.current.known) {
      pass.current = { index, time, known: true };
      return;
    }
    // Riders passed between two updates each arrive, in order.
    for (let next = pass.current.index + 1; next <= index; next++) onArrival(riders[next]);
    pass.current.index = Math.max(pass.current.index, index);
  };

  const chip = failed
    ? { Icon: TriangleAlert, text: "เปิดกล้องไม่ได้" }
    : query.isPending
    ? { Icon: LoaderCircle, text: "กำลังเตรียมกล้อง", spin: true }
    : query.isError
    ? { Icon: TriangleAlert, text: "ตรวจรุ่นรถไม่ได้" }
    : { Icon: Video, text: "ทางเข้า" };

  return (
    <figure className="relative aspect-video shrink-0 overflow-hidden rounded-xl bg-black shadow-sm">
      {!failed && (
        <video
          ref={video}
          src={`/api/sites/${encodeURIComponent(siteId)}/guard-booth-clip`}
          className="size-full object-cover"
          autoPlay
          loop={!scene}
          muted
          playsInline
          preload="auto"
          onTimeUpdate={onTimeUpdate}
          onError={() => setFailed(true)}
        />
      )}
      {scene && <div key={scene} aria-hidden className="pointer-events-none absolute inset-0 bg-black/30 opacity-0 backdrop-blur-md motion-safe:animate-scene-blur" />}
      <figcaption aria-live="polite" className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full bg-black/60 py-1 pr-3 pl-2 text-sm font-semibold text-white backdrop-blur-sm">
        <span key={chip.text} className="flex items-center gap-1.5 motion-safe:animate-content-swap">
          <chip.Icon aria-hidden className={cn("size-4", chip.spin && "motion-safe:animate-spin")} />
          {chip.text}
        </span>
      </figcaption>
    </figure>
  );
}

const GUIDE_ICONS: Record<RiderGuide["tone"], LucideIcon> = { go: MapPin, wait: LoaderCircle, free: SquareParking, stop: CircleOff };
const GUIDE_TEXT: Record<RiderGuide["tone"], string> = { go: "", wait: "text-muted-foreground", free: "text-green-700", stop: "text-red-700" };
/** The large card's instruction is a sign: white on the rider's colour for `go`, on a status colour otherwise. */
const GUIDE_SIGN: Record<RiderGuide["tone"], string> = { go: "text-white", wait: "bg-muted text-muted-foreground", free: "bg-green-700 text-white", stop: "bg-red-700 text-white" };

/** The instruction's icon: the rider's colour for `go` and a status colour otherwise, or the text colour without `color`. */
function GuideIcon({ guide, color, className }: { guide: RiderGuide; color?: string; className: string }) {
  const Icon = GUIDE_ICONS[guide.tone];
  return (
    <Icon
      aria-hidden
      strokeWidth={2.5}
      className={cn("shrink-0", color !== undefined && GUIDE_TEXT[guide.tone], guide.tone === "wait" ? "motion-safe:animate-spin" : guide.tone === "go" && "motion-safe:animate-icon-pop", className)}
      style={guide.tone === "go" && color !== undefined ? { color } : undefined}
    />
  );
}

function RiderPhoto({ rider, className }: { rider: GuardBoothRider; className: string }) {
  const crop = entranceClipCrop(rider);
  return crop
    ? <img src={crop} alt="" className={cn("shrink-0 bg-muted object-contain", className)} />
    : <Motorbike aria-hidden className={cn("shrink-0 bg-muted p-2 text-muted-foreground", className)} />;
}

/**
 * One queued rider, outlined in its pin colour with its number as large as a sign. The newest rider
 * gets the large card; earlier riders a compact row. Both keep one height whatever they say.
 */
export function RiderCard({ rider, number, color, guide, compact = false }: { rider: GuardBoothRider; number: number; color: string; guide: RiderGuide; compact?: boolean }) {
  const title = riderTitle(rider);
  const outline = { "--tw-ring-color": color } as CSSProperties;
  if (compact) {
    return (
      <li aria-label={`รถคันที่ ${number} ${title} ${guide.text}`} className="flex h-14 shrink-0 items-center gap-3 overflow-hidden rounded-xl bg-background pr-3 shadow-sm ring-2 ring-inset motion-safe:animate-rider-settle" style={outline}>
        <span aria-hidden className="grid h-full w-11 shrink-0 place-items-center text-2xl font-bold text-white" style={{ backgroundColor: color }}>{number}</span>
        <RiderPhoto rider={rider} className="size-10 rounded-lg" />
        <p className="min-w-0 flex-1 truncate text-base font-semibold">{title}</p>
        <GuideIcon key={guide.tone} guide={guide} color={color} className="size-6" />
      </li>
    );
  }
  return (
    <li aria-label={`รถคันที่ ${number}`} className="flex h-32 shrink-0 items-center gap-3 rounded-2xl bg-background p-3 shadow-md ring-[3px] ring-inset motion-safe:animate-rider-enter" style={outline}>
      <div className="relative shrink-0">
        <RiderPhoto rider={rider} className="size-[6.5rem] rounded-xl" />
        <span aria-hidden className="absolute -top-1 -left-1 grid size-12 place-items-center rounded-xl text-3xl font-bold text-white ring-[3px] ring-background" style={{ backgroundColor: color }}>{number}</span>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p key={title} className="truncate text-xl font-bold motion-safe:animate-content-swap">{title}</p>
        <p key={guide.tone} className={cn("flex h-11 items-center gap-2 rounded-xl px-3 text-lg font-bold motion-safe:animate-content-swap", GUIDE_SIGN[guide.tone])} style={guide.tone === "go" ? { backgroundColor: color } : undefined}>
          <GuideIcon guide={guide} className="size-6" />
          <span className="truncate">{guide.text}</span>
        </p>
      </div>
    </li>
  );
}

/** The large card's place while no rider is queued, at the same height. */
export function BoothIdle({ status }: { status: ClipStatus }) {
  const guide = status === "unknown" ? riderGuide(null, "pending", 0) : null;
  return (
    <div className="flex h-32 shrink-0 items-center gap-4 rounded-2xl bg-background p-4 shadow-md">
      {guide ? (
        <>
          <SquareParking aria-hidden strokeWidth={2.5} className="size-12 shrink-0 text-green-700" />
          <p className="text-xl font-bold text-green-700">{guide.text}</p>
        </>
      ) : (
        <>
          <span className="relative grid size-12 shrink-0 place-items-center">
            <span aria-hidden className="absolute inset-1 rounded-full bg-muted-foreground/40 opacity-0 motion-safe:animate-idle-ring" />
            <Motorbike aria-hidden className="relative size-12 text-muted-foreground" />
          </span>
          <p className="text-xl font-bold text-muted-foreground">รอรถคันถัดไป</p>
        </>
      )}
    </div>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleOff, type LucideIcon, MapPin, Motorbike, SquareParking, TriangleAlert, Video } from "lucide-react";
import { type CSSProperties, type SyntheticEvent, useEffect, useRef, useState } from "react";
import type { GuardBoothClassification, GuardBoothRider } from "@/lib/api/types";
import { type RiderGuide, arrivedRider, classificationRetryMs, entranceClipCrop, riderGuide, riderTitle } from "@/lib/parking/guard-booth";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

// The Guard Booth entrance camera beside the parking map. It reports each rider as the clip reaches
// the moment that rider enters the booth zone. The page queues those riders; each gets a card under
// the camera and a numbered pin on the map. Every card has a fixed height, so a change in what it
// says never moves the camera or the map. The clip loops without pause; each recorded lot photo
// (its scene) restarts it, so the camera and the lot change together. A loop within one scene
// replays the same riders with the same requests.

/** What the booth shows while no rider is queued. */
export type ClipStatus = "classifying" | "waiting" | "unknown";

/** The API is still classifying the clip; ask again after `retryMs`. */
class ClassificationPending extends Error {
  constructor(readonly retryMs: number) {
    super("Guard Booth classification is still running");
  }
}

export function EntranceClip({ siteId, scene, onStatus, onArrival }: {
  siteId: string;
  /** The lot photo the clip is replayed with; a new photo restarts the clip. */
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
      if (!response.ok) {
        const retryMs = classificationRetryMs(response.status, response.headers.get("Retry-After"));
        throw retryMs === undefined ? new Error(`Guard Booth classification failed with ${response.status}`) : new ClassificationPending(retryMs);
      }
      return response.json();
    },
    // The camera keeps "preparing" while the API classifies the clip; only a real failure stops asking.
    retry: (_failures, error) => error instanceof ClassificationPending,
    retryDelay: (_failures, error) => (error instanceof ClassificationPending ? error.retryMs : 0),
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
    ? { Icon: null, text: "กำลังเตรียมกล้อง" }
    : query.isError
    ? { Icon: TriangleAlert, text: "ตรวจรุ่นรถไม่ได้" }
    : { Icon: Video, text: "ทางเข้า" };

  return (
    <figure className="relative aspect-video max-h-[22dvh] shrink-0 overflow-hidden rounded-xl border border-white/15 bg-[#16151b] shadow-lg lg:max-h-none">
      {!failed && (
        <video
          ref={video}
          src={`/api/sites/${encodeURIComponent(siteId)}/guard-booth-clip`}
          className="size-full object-cover"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          onTimeUpdate={onTimeUpdate}
          onError={() => setFailed(true)}
        />
      )}
      {scene && <div key={scene} aria-hidden className="pointer-events-none absolute inset-0 bg-black/30 opacity-0 backdrop-blur-md motion-safe:animate-scene-blur" />}
      <figcaption aria-live="polite" className="absolute top-2 left-2 flex items-center gap-1.5 rounded-md bg-[#16151b]/90 px-2.5 py-1 text-xs font-semibold text-white">
        <span key={chip.text} className="flex items-center gap-1.5 motion-safe:animate-content-swap">
          {chip.Icon ? <chip.Icon aria-hidden className="size-4" /> : <Spinner />}
          {chip.text}
        </span>
      </figcaption>
    </figure>
  );
}

const GUIDE_ICONS: Record<Exclude<RiderGuide["tone"], "wait">, LucideIcon> = { go: MapPin, free: SquareParking, stop: CircleOff };
const GUIDE_SIGN: Record<RiderGuide["tone"], string> = { go: "", wait: "text-muted-foreground", free: "text-green-800 dark:text-green-300", stop: "text-red-800 dark:text-red-300" };

function GuideIcon({ guide, className }: { guide: RiderGuide; className: string }) {
  if (guide.tone === "wait") return <Spinner className={cn("border-2", className)} />;
  const Icon = GUIDE_ICONS[guide.tone];
  return (
    <Icon
      aria-hidden
      strokeWidth={2.5}
      className={cn(guide.tone === "go" && "motion-safe:animate-icon-pop", className)}
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
 * One queued rider, identified by the number and colour of its pin. The newest rider
 * gets the large card; earlier riders a compact row. Both keep one height whatever they say.
 */
export function RiderCard({ rider, number, color, guide, compact = false }: { rider: GuardBoothRider; number: number; color: string; guide: RiderGuide; compact?: boolean }) {
  const title = riderTitle(rider);
  const sign = { "--rider-color": color } as CSSProperties;
  const status = (
    <p key={guide.tone} className={cn("flex min-w-0 items-center gap-1.5 font-semibold motion-safe:animate-content-swap", compact ? "text-xs leading-tight" : "text-base leading-tight", GUIDE_SIGN[guide.tone])}>
      <GuideIcon guide={guide} className={cn("shrink-0", compact ? "size-3.5" : "size-5", guide.tone === "go" && "text-[var(--rider-color)] dark:text-foreground")} />
      <span>{guide.text}</span>
    </p>
  );
  if (compact) {
    return (
      <li aria-label={`รถคันที่ ${number}`} className="flex h-14 shrink-0 items-center gap-2.5 rounded-xl border border-border bg-background px-2.5 shadow-sm motion-safe:animate-rider-settle" style={sign}>
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md bg-[var(--rider-color)] text-lg font-bold tabular-nums text-white">{number}</span>
        <RiderPhoto rider={rider} className="size-10 rounded-md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-tight font-semibold">{title}</p>
          {status}
        </div>
      </li>
    );
  }
  return (
    <li aria-label={`รถคันที่ ${number}`} className="flex h-32 shrink-0 items-center gap-3 rounded-xl border border-border bg-background p-3 shadow-md motion-safe:animate-rider-enter" style={sign}>
      <RiderPhoto rider={rider} className="h-full w-16 rounded-lg sm:w-24" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--rider-color)] text-2xl font-bold tabular-nums text-white">{number}</span>
          <p key={title} className="text-lg leading-tight font-bold break-words motion-safe:animate-content-swap sm:text-xl">{title}</p>
        </div>
        <div className="border-t border-border pt-2">{status}</div>
      </div>
    </li>
  );
}

/** The large card's place while no rider is queued, at the same height. */
export function BoothIdle({ status }: { status: ClipStatus }) {
  const guide = status === "unknown" ? riderGuide(null, "pending", 0) : null;
  return (
    <div className="flex h-32 shrink-0 items-center gap-4 rounded-xl border border-border bg-background p-4 shadow-md">
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

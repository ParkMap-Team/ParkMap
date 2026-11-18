"use client";

import { m, type TargetAndTransition, type Transition } from "motion/react";
import Image, { type StaticImageData } from "next/image";
import confused from "@/assets/mascot/confused.webp";
import happy from "@/assets/mascot/happy.webp";
import ridingBody from "@/assets/mascot/riding-body.webp";
import wheel from "@/assets/mascot/wheel.webp";
import { ProgressFill } from "@/components/ui/progress-fill";
import { cn } from "@/lib/utils";

export type MascotMood = "happy" | "confused";

// The mascot is decoration next to text that carries the meaning, so it is hidden from
// assistive technology. It never stands in for parking status, and it never appears over live data.
// It moves once on arrival rather than looping, so a screen with text stays calm to read.
const MOODS: Record<MascotMood, { image: StaticImageData; animate: TargetAndTransition; transition: Transition }> = {
  happy: {
    image: happy,
    animate: { y: [0, -6, 0] },
    transition: { duration: 0.9, ease: "easeInOut" },
  },
  confused: {
    image: confused,
    animate: { rotate: [0, -4, 3, 0] },
    transition: { duration: 0.9, ease: "easeInOut" },
  },
};

export function Mascot({ mood, size = 160, className }: { mood: MascotMood; size?: number; className?: string }) {
  const { image, animate, transition } = MOODS[mood];
  return (
    <m.div aria-hidden className={cn("shrink-0", className)} animate={animate} transition={transition}>
      <Image src={image} alt="" width={size} height={size} preload />
    </m.div>
  );
}

// The riding scene: the body with its wheels cut out, one wheel image spinning behind each
// wheel arch, and a dashed road scrolling underneath. Wheel centres, radii, and the ground
// line are measured on the 1024px source art of riding-body.
const SCENE = 120;
const SOURCE = 1024;
const WHEELS = [
  { x: 185, y: 795, r: 136 },
  { x: 832, y: 790, r: 141 },
];
const GROUND = 931;
// One dash plus one gap. The road strip is two road widths long and moves left by one road
// width per loop, so the loop is seamless.
const ROAD_PERIOD = 24;
const ROAD_WIDTH = 6 * ROAD_PERIOD;
// px per second. Each wheel turns once per its own circumference, so the tyres roll without slipping.
const ROAD_SPEED = 96;

const toScene = (sourcePx: number) => (sourcePx / SOURCE) * SCENE;

/** With `progress`, a bar fills by finished steps; without, loading dots sit under the label. */
export function MascotLoading({ label, progress }: { label: string; progress?: { done: number; total: number } }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
      {/* CSS animations rather than motion: they start before hydration and stay smooth while the main thread loads the page. */}
      <div aria-hidden className="relative" style={{ width: SCENE, height: SCENE }}>
        <div
          className="absolute left-1/2 h-0.5 -translate-x-1/2 overflow-hidden rounded-full opacity-40"
          style={{ top: toScene(GROUND), width: ROAD_WIDTH }}
        >
          <div
            className="h-full animate-mascot-road motion-reduce:animate-none"
            style={{
              width: 2 * ROAD_WIDTH,
              backgroundImage: `repeating-linear-gradient(90deg, currentColor 0 ${ROAD_PERIOD / 2}px, transparent ${ROAD_PERIOD / 2}px ${ROAD_PERIOD}px)`,
              animationDuration: `${ROAD_WIDTH / ROAD_SPEED}s`,
            }}
          />
        </div>
        {WHEELS.map(({ x, y, r }) => (
          <Image
            key={x}
            src={wheel}
            alt=""
            width={Math.round(toScene(2 * r))}
            height={Math.round(toScene(2 * r))}
            preload
            className="absolute animate-spin motion-reduce:animate-none"
            style={{
              left: toScene(x - r),
              top: toScene(y - r),
              width: toScene(2 * r),
              height: toScene(2 * r),
              animationDuration: `${(2 * Math.PI * toScene(r)) / ROAD_SPEED}s`,
            }}
          />
        ))}
        <Image
          src={ridingBody}
          alt=""
          width={SCENE}
          height={SCENE}
          preload
          className="absolute inset-0 animate-mascot-bob motion-reduce:animate-none"
        />
      </div>
      {progress ? (
        <>
          <p key={label} className="motion-safe:animate-content-swap">{label}</p>
          <ProgressFill {...progress} label={label} />
        </>
      ) : (
        // The dots get their own line under the label, so they never read as part of the text.
        <div className="flex flex-col items-center gap-2">
          <p>{label}</p>
          <LoadingDots />
        </div>
      )}
    </div>
  );
}

/**
 * The catalogue's Loading Dots, rising in turn; still with reduced motion. `compact` sits under a
 * loading label; `large` stands alone, at the catalogue's full size.
 */
export function LoadingDots({ size = "compact" }: { size?: "compact" | "large" }) {
  return (
    <span aria-hidden className={cn("inline-flex items-center", size === "compact" ? "gap-[5px]" : "gap-3")}>
      {[0, 90, 180].map((delay) => (
        <span key={delay} className={cn("rounded-full bg-primary motion-safe:animate-loading-dots", size === "compact" ? "size-[5px]" : "size-2.5")} style={{ animationDelay: `${delay}ms` }} />
      ))}
    </span>
  );
}

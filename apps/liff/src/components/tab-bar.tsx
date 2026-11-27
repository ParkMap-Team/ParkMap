"use client";

import { LocateFixed, MapPinned, Navigation, Settings, SquareParking, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useGuide } from "@/components/parking-guide";
import { activeTab, type TabId } from "@/lib/tabs";
import { cn } from "@/lib/utils";

/** The five slots, left to right; the parking guide takes the centre one. */
const TABS = [
  { id: "map", slot: 0, href: "/", label: "ลานจอด", Icon: SquareParking },
  { id: "parked", slot: 1, href: "/parked", label: "รถฉันอยู่ไหน", Icon: MapPinned },
  { id: "nearby", slot: 3, href: "/nearby", label: "ที่จอดรถใกล้ฉัน", Icon: LocateFixed },
  { id: "settings", slot: 4, href: "/settings", label: "ตั้งค่า", Icon: Settings },
] as const satisfies readonly { id: TabId; slot: number; href: string; label: string; Icon: unknown }[];

const PRESS = "transition-transform duration-150 ease-out-strong motion-safe:active:scale-95";

// The app's bottom navigation. LINE draws its own bar at the top, so the app keeps its navigation at
// the bottom, in thumb reach. One pill slides to the current tab instead of each tab lighting up. The
// parking guide is the app's main action, so its circle rises above the bar.
export function TabBar() {
  const pathname = usePathname();
  const guide = useGuide();
  const current = activeTab(pathname);
  const slot = TABS.find((tab) => tab.id === current)?.slot;
  return (
    <nav aria-label="เมนูหลัก" className="relative z-20 shrink-0 border-t bg-background pb-[var(--safe-bottom)]">
      {guide.cancelError && <p role="alert" className="absolute inset-x-2 bottom-full mb-2 rounded-xl border bg-background p-3 text-sm text-destructive shadow-md">{guide.cancelError}</p>}
      <div className="relative grid h-16 grid-cols-5">
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-2 left-0 flex w-1/5 justify-center transition-[transform,opacity] duration-[250ms] ease-spring motion-reduce:transition-none",
            slot === undefined && "opacity-0",
          )}
          style={{ transform: `translateX(${(slot ?? 0) * 100}%)` }}
        >
          <span className="h-8 w-14 rounded-full bg-primary/10" />
        </div>
        {TABS.slice(0, 2).map((tab) => <TabLink key={tab.id} {...tab} active={current === tab.id} />)}
        <div className="flex justify-center">
          <button
            type="button"
            aria-pressed={guide.active}
            disabled={guide.cancelling}
            aria-label={guide.cancelling ? "กำลังยกเลิกคำแนะนำ" : guide.active ? "ยกเลิกคำแนะนำที่จอด" : "แนะนำที่จอด"}
            onClick={() => (guide.active ? guide.stop() : guide.start())}
            className={cn("-mt-4 flex flex-col items-center gap-1 outline-none focus-visible:[&>span:first-child]:outline-3 focus-visible:[&>span:first-child]:outline-ring/50", PRESS)}
          >
            {/*
              Rises 20px above the bar (16px offset plus the 4px ring), its label level with the others; the paper ring parts it from
              what is behind. The map's floating card keeps clear of it (FLOAT_GAP_PX in map-panel.tsx).
            */}
            <span
              className="grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-md ring-4 ring-background transition-colors duration-150"
              // Keep the raised stop button opaque even if a cached stylesheet lacks the notice utilities/tokens.
              style={guide.active ? { backgroundColor: "var(--notice, #621537)", color: "var(--notice-foreground, #ffffff)" } : undefined}
            >
              {guide.active
                ? <X key="stop" aria-hidden className="size-6 motion-safe:animate-icon-pop" />
                : <Navigation key="start" aria-hidden className="size-6 motion-safe:animate-icon-pop" />}
            </span>
            <span className="text-[11px] leading-none font-semibold whitespace-nowrap">แนะนำที่จอด</span>
          </button>
        </div>
        {TABS.slice(2).map((tab) => <TabLink key={tab.id} {...tab} active={current === tab.id} />)}
      </div>
    </nav>
  );
}

function TabLink({ href, label, Icon, active }: { href: string; label: string; Icon: (typeof TABS)[number]["Icon"]; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex flex-col items-center justify-start gap-1 pt-2 text-[11px] leading-none whitespace-nowrap outline-none focus-visible:bg-muted/60",
        // The icon takes the brand pink; the small label stays ink, which pink on the bar's paper would not pass for text.
        active ? "font-semibold text-foreground [&_svg]:text-primary" : "text-muted-foreground",
        PRESS,
      )}
    >
      <span className="grid h-8 w-14 place-items-center">
        <Icon aria-hidden className="size-5" strokeWidth={active ? 2.25 : 1.75} />
      </span>
      {label}
    </Link>
  );
}

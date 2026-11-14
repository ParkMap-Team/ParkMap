import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Mascot } from "@/components/mascot";
import { RetryButton } from "@/components/retry-button";
import type { SiteSummary } from "@/lib/api/types";

// The list of sites, for when the home screen cannot pick one or a student wants another.
// It shows names only: availability belongs on each site's map, with its source and freshness.
export function SiteList({ sites }: { sites: SiteSummary[] | undefined }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <h1 className="text-title font-semibold">เลือกลานจอด</h1>
      <p className="mt-1 text-sm text-muted-foreground">แตะชื่อลานเพื่อดูแผนที่และสถานะล่าสุด</p>
      {!sites ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <Mascot mood="confused" size={120} />
          <p role="alert" className="text-sm">
            โหลดรายการลานจอดไม่ได้
          </p>
          <RetryButton />
        </div>
      ) : sites.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <Mascot mood="happy" size={120} />
          <p className="text-sm">ยังไม่มีลานจอดที่เปิดให้ดู</p>
        </div>
      ) : (
        <ul className="mt-5 divide-y overflow-hidden rounded-lg border bg-card">
          {sites.map((site) => (
            <li key={site.site_id}>
              <Link
                href={`/sites/${site.site_id}`}
                className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors duration-150 outline-none focus-visible:bg-accent active:bg-accent"
              >
                <span className="min-w-0 flex-1 text-base break-words">{site.name}</span>
                <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

"use client";

import dynamic from "next/dynamic";
import type { LotModel } from "@/lib/api/types";
import { COLORS, STATUS_LABELS, sourceNotice, visibleAreas } from "@/lib/parking/presentation";
import { useParkingState } from "@/lib/parking/use-parking-state";
import { useNow } from "@/lib/use-now";

const LotScene = dynamic(() => import("./lot-scene"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-muted-foreground">กำลังโหลดแผนที่</div>,
});

const LEGEND = [
  { color: COLORS.AVAILABLE, label: "ว่าง" },
  { color: COLORS.ALMOST_AVAILABLE, label: "เกือบว่าง ต้องขยับรถ" },
  { color: COLORS.UNKNOWN, label: "ไม่ทราบสถานะ" },
  { color: COLORS.UNMONITORED, label: "ไม่มีกล้องดูแล" },
] as const;

export function SiteView({ siteId, siteName, lotModel }: { siteId: string; siteName: string; lotModel: LotModel }) {
  const query = useParkingState(siteId);
  const now = useNow(1000);
  const receivedAgoS = query.data ? (now - query.dataUpdatedAt) / 1000 : 0;
  const areas = query.data ? visibleAreas(query.data, receivedAgoS) : [];
  const notice = sourceNotice(areas);

  return (
    <main className="flex h-dvh flex-col bg-background text-foreground">
      <header className="space-y-2 border-b px-4 py-3">
        <h1 className="text-lg font-semibold">{siteName}</h1>
        {notice && <p className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900">{notice}</p>}
        {query.isError && <p className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-900">เชื่อมต่อข้อมูลไม่ได้ สถานะที่เห็นอาจไม่เป็นปัจจุบัน</p>}
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {LEGEND.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5">
              <span className="size-3 rounded-sm" style={{ backgroundColor: item.color }} />
              {item.label}
            </li>
          ))}
        </ul>
      </header>
      <section className="min-h-0 flex-1" aria-label="แผนที่ลานจอดรถ 3 มิติ">
        <LotScene lotModel={lotModel} areas={areas} />
      </section>
      <footer className="border-t px-4 py-3 text-sm">
        {query.isPending ? (
          <p className="text-muted-foreground">กำลังโหลดสถานะ</p>
        ) : (
          <ul className="space-y-1">
            {areas.map((area) => (
              <li key={area.parking_area_id} className="flex justify-between gap-4">
                <span>{area.parking_area_id}</span>
                <span className="text-muted-foreground">
                  {STATUS_LABELS[area.status]}
                  {area.age_s != null && ` · ${Math.round(area.age_s)} วินาทีที่แล้ว`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </footer>
    </main>
  );
}

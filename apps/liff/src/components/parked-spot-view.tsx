"use client";

import { MapPinned } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { LotModel } from "@/lib/api/types";
import type { Insets } from "@/lib/map/camera";
import { mapLabels } from "@/lib/map/legend";
import { buildLotMap } from "@/lib/map/lot-map";
import { type ParkedSpot, savedAtLabel, spotPoint } from "@/lib/parked-spot";
import { guideFrame } from "@/lib/parking/guide";
import { ViewErrorBoundary } from "./map-overlay";

const LotPlan = dynamic(() => import("./lot-plan"), { ssr: false, loading: () => null });
const INSETS: Insets = { top: 16, right: 16, bottom: 16, left: 16 };

/**
 * The rider's marked spot on the lot plan (ADR 0021). The plan carries no parking areas or live
 * state: this screen says where the rider said they parked, nothing about availability.
 */
export function ParkedSpotView({ siteName, lotModel, spot }: { siteName: string; lotModel: LotModel; spot: ParkedSpot }) {
  const router = useRouter();
  const [erase, setErase] = useState<"idle" | "erasing" | "failed">("idle");
  const [mapFailed, setMapFailed] = useState(false);
  // The overview frames the lot and the spot together.
  const { map, labels, selection } = useMemo(() => {
    const plan = buildLotMap(lotModel, []);
    const point = spotPoint(spot);
    const map = { ...plan, areas: [], frame: guideFrame(plan.frame, [point]) };
    return { map, labels: mapLabels(map), selection: { point, polygon: null, text: "รถคุณ", destination: true } };
  }, [lotModel, spot]);

  async function onErase() {
    setErase("erasing");
    const response = await fetch("/api/parked-spot", { method: "DELETE", cache: "no-store" }).catch(() => null);
    if (!response?.ok) return setErase("failed");
    router.refresh();
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
      <h1 className="sr-only">รถฉันอยู่ไหน</h1>
      <section aria-label={`แผนที่ ${siteName} พร้อมจุดที่คุณบันทึกว่าจอดรถไว้`} className="relative min-h-0 flex-1 overflow-hidden">
        {mapFailed ? (
          <p className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">แสดงแผนที่ไม่ได้ในตอนนี้</p>
        ) : (
          <ViewErrorBoundary onError={() => setMapFailed(true)}>
            <LotPlan map={map} labels={labels} selection={selection} onSelect={() => {}} insets={INSETS} />
          </ViewErrorBoundary>
        )}
      </section>
      <div className="space-y-3 border-t px-4 pt-4 pb-4">
        <div className="flex items-start gap-3">
          <MapPinned className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">จอดไว้ที่ {siteName}</p>
            <p className="text-sm text-muted-foreground">{savedAtLabel(spot.saved_at)}</p>
            <p className="text-sm text-muted-foreground">เป็นจุดที่คุณบันทึกเอง ไม่ได้ยืนยันว่ารถยังจอดอยู่ตรงนี้</p>
          </div>
        </div>
        {erase === "failed" && <p role="alert" className="rounded-lg bg-alert px-3 py-2 text-sm text-alert-foreground">ลบไม่สำเร็จ ลองใหม่อีกครั้ง</p>}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-11" disabled={erase === "erasing"} onClick={onErase}>
            {erase === "erasing" ? "กำลังลบ" : "ลบจุดนี้"}
          </Button>
          <Button className="h-11" render={<Link href="/" />} nativeButton={false}>ไปที่ลานจอด</Button>
        </div>
      </div>
    </main>
  );
}

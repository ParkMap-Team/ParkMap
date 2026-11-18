import type { Metadata } from "next";
import Link from "next/link";
import { MascotScreen } from "@/components/mascot-screen";
import { ParkedSpotView } from "@/components/parked-spot-view";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api/server";
import { parkedSpot, vehiclePreference } from "@/lib/vehicle-session";

export const metadata: Metadata = { title: "จุดที่จอดรถไว้ | ParkMap" };

// The marked spot belongs to the LINE session, so it is read at request time.
export const dynamic = "force-dynamic";

function NoSpot({ description }: { description: string }) {
  return (
    <MascotScreen mood="happy" title="ยังไม่ได้บันทึกที่จอด" description={description}>
      <Button render={<Link href="/" />} nativeButton={false} className="h-11 px-5">ไปที่ลานจอด</Button>
    </MascotScreen>
  );
}

// The rider's own marked spot (ADR 0021): where they said they parked, never that the motorcycle is there.
export default async function ParkedPage() {
  const [preference, answer] = await Promise.all([vehiclePreference(), parkedSpot()]);
  if (!preference?.model_id) return null;
  if (!answer) throw new Error("Parked spot request failed");
  const { spot } = answer;
  if (!spot) return <NoSpot description="กดแนะนำที่จอด แล้วบันทึกว่าจอดตรงนั้นเมื่อไปถึง เพื่อกลับมาดูได้ที่นี่ จุดที่บันทึกจะอยู่ 24 ชั่วโมง" />;
  const client = apiClient();
  const [sites, lotModel] = await Promise.all([
    client.GET("/api/sites"),
    client.GET("/api/sites/{site_id}/lot-model", { params: { path: { site_id: spot.site_id } } }),
  ]);
  if (!sites.data) throw new Error("Site list request failed");
  const site = sites.data.find((item) => item.site_id === spot.site_id);
  // A lot that no longer exists cannot show the spot.
  if (!site || lotModel.response.status === 404 || lotModel.response.status === 422) {
    return <NoSpot description="ไม่พบลานจอดของจุดที่บันทึกไว้แล้ว" />;
  }
  if (!lotModel.data) throw new Error(`Lot model request failed with ${lotModel.response.status}`);
  return <ParkedSpotView siteName={site.name} lotModel={lotModel.data} spot={spot} />;
}

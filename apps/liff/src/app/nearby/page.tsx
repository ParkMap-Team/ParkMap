import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "ลานจอดใกล้ฉัน | ParkMap" };

export default function NearbyPage() {
  return <ComingSoon title="ลานจอดใกล้ฉัน" />;
}

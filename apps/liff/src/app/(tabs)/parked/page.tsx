import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "จุดที่จอดรถไว้ | ParkMap" };

export default function ParkedPage() {
  return <ComingSoon title="จุดที่จอดรถไว้" />;
}

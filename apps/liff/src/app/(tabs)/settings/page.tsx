import type { Metadata } from "next";
import { VehicleSettings } from "@/components/vehicle-settings";

export const metadata: Metadata = { title: "ตั้งค่า | ParkMap" };

export default function SettingsPage() {
  return <VehicleSettings />;
}

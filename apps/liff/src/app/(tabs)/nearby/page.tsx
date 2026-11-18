import type { Metadata } from "next";
import { NearbyScreen } from "@/components/nearby-screen";
import { apiClient } from "@/lib/api/server";
import { nearbyPlaces } from "@/lib/nearby/places";
import { vehiclePreference } from "@/lib/vehicle-session";

export const metadata: Metadata = { title: "ที่จอดรถใกล้ฉัน | ParkMap" };

// Sites come from the API at request time, never from a build-time snapshot.
export const dynamic = "force-dynamic";

// Every place to park a motorcycle in and around the campus, on a street map (ADR 0022).
export default async function NearbyPage() {
  if (!(await vehiclePreference())?.model_id) return null;
  const { data: sites } = await apiClient().GET("/api/sites");
  if (!sites) throw new Error("Site list request failed");
  return <NearbyScreen places={nearbyPlaces(sites)} />;
}

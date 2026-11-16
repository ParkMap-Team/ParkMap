import { vehiclePreference } from "@/lib/vehicle-session";
import { NextResponse } from "next/server";
import { apiClient, upstreamFailureStatus } from "@/lib/api/server";

const UNAVAILABLE = { detail: "Parking state is unavailable." };

export async function GET(_request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  if (!(await vehiclePreference())?.model_id) return new Response(null, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  const { siteId } = await params;
  try {
    const { data, response } = await apiClient().GET("/api/sites/{site_id}/parking-state", {
      params: { path: { site_id: siteId } },
      cache: "no-store",
    });
    if (data) {
      return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json(UNAVAILABLE, { status: upstreamFailureStatus(response.status), headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Parking state request failed", error);
    return NextResponse.json(UNAVAILABLE, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

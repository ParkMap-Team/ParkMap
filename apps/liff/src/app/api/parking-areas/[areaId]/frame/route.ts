import { vehiclePreference } from "@/lib/vehicle-session";
import { NextResponse } from "next/server";
import { apiClient, upstreamFailureStatus } from "@/lib/api/server";

// The analysed photo of a parking area (ADR 0017). The API versions it by processing time, so a
// version never changes and is cached for good; a replaced version is gone.

const UNAVAILABLE = { detail: "Photo is unavailable." };
const VERSION = /^\d{1,16}$/;

export async function GET(request: Request, { params }: { params: Promise<{ areaId: string }> }) {
  if (!(await vehiclePreference())?.model_id) return new Response(null, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  const { areaId } = await params;
  const version = new URL(request.url).searchParams.get("v");
  if (!version || !VERSION.test(version)) {
    return NextResponse.json(UNAVAILABLE, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const { data, response } = await apiClient().GET("/api/parking-areas/{area_id}/frame", {
      params: { path: { area_id: areaId }, query: { v: Number(version) } },
      parseAs: "stream",
      cache: "no-store",
    });
    if (response.ok && data) {
      return new Response(data, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json(UNAVAILABLE, { status: upstreamFailureStatus(response.status), headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Photo request failed", error);
    return NextResponse.json(UNAVAILABLE, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

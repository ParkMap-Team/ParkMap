import { NextResponse } from "next/server";
import { apiClient, upstreamFailureStatus } from "@/lib/api/server";
import { guardBoothFitEnabled } from "@/lib/parking/guard-booth-server";
import { vehiclePreference } from "@/lib/vehicle-session";

const UNAVAILABLE = { detail: "Guard Booth classification is unavailable." };

export async function GET(_request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  if (!(await vehiclePreference())?.model_id) return new Response(null, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  const { siteId } = await params;
  if (siteId !== "sripatum" || !guardBoothFitEnabled()) return NextResponse.json(UNAVAILABLE, { status: 404, headers: { "Cache-Control": "no-store" } });
  try {
    const { data, response } = await apiClient().GET("/api/sites/{site_id}/guard-booth-classification", {
      params: { path: { site_id: siteId } },
      cache: "no-store",
    });
    if (data) return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(UNAVAILABLE, { status: upstreamFailureStatus(response.status), headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Guard Booth classification request failed", error);
    return NextResponse.json(UNAVAILABLE, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

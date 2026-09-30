import { NextResponse } from "next/server";
import { apiClient, upstreamFailureStatus } from "@/lib/api/server";

const UNAVAILABLE = { detail: "Parking state is unavailable." };

export async function GET(_request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  try {
    const { data, response } = await apiClient().GET("/api/sites/{site_id}/parking-state", {
      params: { path: { site_id: siteId } },
      cache: "no-store",
    });
    if (data) {
      return NextResponse.json(data, { headers: { "Cache-Control": "public, s-maxage=2" } });
    }
    return NextResponse.json(UNAVAILABLE, { status: upstreamFailureStatus(response.status), headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Parking state request failed", error);
    return NextResponse.json(UNAVAILABLE, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

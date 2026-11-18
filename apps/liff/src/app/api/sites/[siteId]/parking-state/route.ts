import { vehiclePreference } from "@/lib/vehicle-session";
import { NextResponse } from "next/server";
import { apiClient, upstreamFailureStatus } from "@/lib/api/server";
import { isKnownFamily } from "@/lib/parking/guard-booth";

const UNAVAILABLE = { detail: "Parking state is unavailable." };

export async function GET(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const model = (await vehiclePreference())?.model_id;
  if (!model) return new Response(null, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  const { siteId } = await params;
  // A rider's map shows free ground only where the saved model fits (ADR 0024). The model comes from
  // the verified LINE session, never from this browser; a model without a reference size gets the plain map.
  const family = new URL(request.url).searchParams.get("view") === "rider" && isKnownFamily(model) ? model : undefined;
  try {
    const { data, response } = await apiClient().GET("/api/sites/{site_id}/parking-state", {
      params: { path: { site_id: siteId }, query: family ? { family } : {} },
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

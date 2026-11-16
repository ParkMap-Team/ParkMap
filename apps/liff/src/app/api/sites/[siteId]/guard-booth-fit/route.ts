import { NextResponse } from "next/server";
import { apiClient, upstreamFailureStatus } from "@/lib/api/server";
import { guardBoothFitEnabled } from "@/lib/parking/guard-booth-server";
import { vehiclePreference } from "@/lib/vehicle-session";

export async function POST(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  if (!(await vehiclePreference())?.model_id) return new Response(null, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  const { siteId } = await params;
  if (siteId !== "sripatum" || !guardBoothFitEnabled()) return new NextResponse(null, { status: 404 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !("family" in body) || !("request_id" in body) || !("observed_at" in body) ||
    (body.family !== "grand_filano" && body.family !== "forza") || typeof body.request_id !== "string" || typeof body.observed_at !== "string") {
    return NextResponse.json({ detail: "Invalid parking fit request." }, { status: 400 });
  }
  try {
    const { data, response } = await apiClient().POST("/api/sites/{site_id}/guard-booth-fit", {
      params: { path: { site_id: siteId } },
      body: { family: body.family, request_id: body.request_id, observed_at: body.observed_at },
      cache: "no-store",
    });
    if (data) return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ detail: "Parking fit preview is unavailable." }, { status: upstreamFailureStatus(response.status) });
  } catch {
    return NextResponse.json({ detail: "Parking fit preview is unavailable." }, { status: 502 });
  }
}

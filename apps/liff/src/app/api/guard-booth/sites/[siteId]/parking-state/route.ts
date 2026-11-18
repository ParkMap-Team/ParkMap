import { NextResponse } from "next/server";
import { apiClient, upstreamFailureStatus } from "@/lib/api/server";
import { guardBoothFitEnabled } from "@/lib/parking/guard-booth-server";

export async function GET(_request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  if (siteId !== "sripatum" || !guardBoothFitEnabled()) return new Response(null, { status: 404 });
  try {
    const { data, response } = await apiClient().GET("/api/sites/{site_id}/parking-state", { params: { path: { site_id: siteId } }, cache: "no-store" });
    if (!data) return new Response(null, { status: upstreamFailureStatus(response.status) });
    for (const area of data.areas) {
      if (area.frame) area.frame.url = area.frame.url.replace("/api/parking-areas/", "/api/guard-booth/parking-areas/");
    }
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch { return new Response(null, { status: 502 }); }
}

import { NextResponse } from "next/server";
import { apiClient, upstreamFailureStatus } from "@/lib/api/server";
import { guardBoothFitEnabled } from "@/lib/parking/guard-booth-server";
import { vehiclePreference } from "@/lib/vehicle-session";

export async function GET(_request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  if (!(await vehiclePreference())?.model_id) return new Response(null, { status: 403 });
  const { siteId } = await params;
  if (siteId !== "sripatum" || !guardBoothFitEnabled()) return new Response(null, { status: 404 });
  try {
    const { data, response } = await apiClient().GET("/api/sites/{site_id}/parking-holds", { params: { path: { site_id: siteId } }, cache: "no-store" });
    return NextResponse.json(data ?? { detail: "โหลดสถานะพักพื้นที่ไม่ได้" }, { status: data ? 200 : upstreamFailureStatus(response.status), headers: { "Cache-Control": "private, no-store" } });
  } catch { return new Response(null, { status: 502 }); }
}

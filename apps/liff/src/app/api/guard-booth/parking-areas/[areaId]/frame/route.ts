import { apiClient, upstreamFailureStatus } from "@/lib/api/server";
import { guardBoothFitEnabled } from "@/lib/parking/guard-booth-server";

export async function GET(request: Request, { params }: { params: Promise<{ areaId: string }> }) {
  const { areaId } = await params;
  const v = new URL(request.url).searchParams.get("v");
  if (areaId !== "sripatum-near-lot" || !guardBoothFitEnabled() || !v || !/^\d{1,16}$/.test(v)) return new Response(null, { status: 404 });
  try {
    const { data, response } = await apiClient().GET("/api/parking-areas/{area_id}/frame", {
      params: { path: { area_id: areaId }, query: { v: Number(v) } }, parseAs: "stream", cache: "no-store",
    });
    return response.ok && data ? new Response(data, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } })
      : new Response(null, { status: upstreamFailureStatus(response.status) });
  } catch { return new Response(null, { status: 502 }); }
}

import { NextResponse } from "next/server";
import { apiClient, upstreamFailureStatus } from "@/lib/api/server";
import { guardBoothFitEnabled } from "@/lib/parking/guard-booth-server";
import { parkingRequestBody } from "@/lib/parking/request-body";
import { vehiclePreference } from "@/lib/vehicle-session";

export async function POST(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  let body: unknown;
  try { body = await parkingRequestBody(request); } catch { return new Response(null, { status: 400 }); }
  const preference = await vehiclePreference();
  if (!preference?.model_id) return new Response(null, { status: 403 });
  const { siteId } = await params;
  if (siteId !== "sripatum" || !guardBoothFitEnabled()) return new Response(null, { status: 404 });
  if (!body || typeof body !== "object" || !("request_id" in body) || typeof body.request_id !== "string" ||
      !("observed_at" in body) || typeof body.observed_at !== "string") return new Response(null, { status: 400 });
  if (preference.model_id === "other") return NextResponse.json({ detail: "ยังไม่มีขนาดอ้างอิงของรถรุ่นนี้ ดูพื้นที่ว่างบนแผนที่ได้" }, { status: 422 });
  try {
    const { data, response } = await apiClient().POST("/api/sites/{site_id}/parking-recommendation", {
      params: { path: { site_id: siteId } }, cache: "no-store",
      // Never accept a family, footprint or availability from this browser.
      body: { family: preference.model_id, request_id: body.request_id, observed_at: body.observed_at, ends_with_photo: false },
    });
    return NextResponse.json(data ?? { detail: "ยังแนะนำที่จอดไม่ได้ กรุณาลองใหม่" }, { status: data ? 200 : upstreamFailureStatus(response.status), headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ detail: "เชื่อมต่อระบบแนะนำที่จอดไม่ได้" }, { status: 502 }); }
}

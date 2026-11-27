import { NextResponse } from "next/server";
import { apiClient, upstreamFailureStatus } from "@/lib/api/server";
import { guardBoothFitEnabled } from "@/lib/parking/guard-booth-server";
import { parkingRequestBody } from "@/lib/parking/request-body";
import { recommendationOwner } from "@/lib/vehicle-session";
import { sameOrigin } from "@/lib/route-guard";
import { selectedReservationInput } from "@/lib/parking/selected-reservation";

const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ siteId: string }> };

export async function DELETE(request: Request, { params }: Context) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const { siteId } = await params;
  if (siteId !== "sripatum" || !guardBoothFitEnabled()) return new Response(null, { status: 404 });
  const owner = await recommendationOwner();
  if (!owner) return new Response(null, { status: 403, headers });
  try {
    const { response } = await apiClient().DELETE("/api/sites/{site_id}/parking-recommendation", {
      params: { path: { site_id: siteId } }, headers: { "X-Parkmap-Owner": owner.owner_key }, cache: "no-store",
    });
    return new Response(null, { status: response.ok ? 204 : upstreamFailureStatus(response.status), headers });
  } catch { return new Response(null, { status: 502, headers }); }
}

export async function GET(_request: Request, { params }: Context) {
  const { siteId } = await params;
  if (siteId !== "sripatum" || !guardBoothFitEnabled()) return new Response(null, { status: 404 });
  const owner = await recommendationOwner();
  if (!owner?.model_id) return new Response(null, { status: 403, headers });
  try {
    const { data, response } = await apiClient().GET("/api/sites/{site_id}/parking-recommendation", {
      params: { path: { site_id: siteId } }, headers: { "X-Parkmap-Owner": owner.owner_key }, cache: "no-store",
    });
    return response.ok ? NextResponse.json(data ?? null, { headers }) : new Response(null, { status: upstreamFailureStatus(response.status), headers });
  } catch { return new Response(null, { status: 502, headers }); }
}

export async function POST(request: Request, { params }: Context) {
  let body: unknown;
  try { body = await parkingRequestBody(request); } catch { return new Response(null, { status: 400 }); }
  const { siteId } = await params;
  if (siteId !== "sripatum" || !guardBoothFitEnabled()) return new Response(null, { status: 404 });
  const owner = await recommendationOwner();
  if (!owner?.model_id) return new Response(null, { status: 403, headers });
  if (!body || typeof body !== "object" || !("request_id" in body) || typeof body.request_id !== "string") return new Response(null, { status: 400 });
  const selected = "target" in body || "parking_area_id" in body || "lot_model_version" in body ? selectedReservationInput(body) : undefined;
  if (selected === null) return new Response(null, { status: 400 });
  if (owner.model_id === "other") return NextResponse.json({ detail: "ยังไม่มีขนาดอ้างอิงของรถรุ่นนี้ เลือกรุ่นรถในตั้งค่าเพื่อให้แนะนำได้" }, { status: 422, headers });
  try {
    const { data, response } = await apiClient().POST("/api/sites/{site_id}/parking-recommendation", {
      params: { path: { site_id: siteId } }, cache: "no-store",
      body: { family: owner.model_id, owner_key: owner.owner_key, request_id: body.request_id,
        observed_at: new Date().toISOString(), ends_with_photo: false, ...selected },
    });
    return NextResponse.json(data ?? { detail: "ยังแนะนำที่จอดไม่ได้ กรุณาลองใหม่" }, { status: data ? 200 : upstreamFailureStatus(response.status), headers });
  } catch { return NextResponse.json({ detail: "เชื่อมต่อระบบแนะนำที่จอดไม่ได้" }, { status: 502, headers }); }
}

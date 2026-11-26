import { NextResponse } from "next/server";
import { limitedBody, sameOrigin } from "@/lib/route-guard";
import { vehiclePreference, VEHICLE_COOKIE, TOKEN_TYPE_COOKIE } from "@/lib/vehicle-session";
import { preferenceResponse } from "@/lib/preference-response";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  const data = await vehiclePreference();
  return preferenceResponse(data, new URL(request.url).searchParams.get("optional") === "1");
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  if (Number(request.headers.get("content-length")) > 12000) return new NextResponse(null, { status: 413 });
  let token: unknown;
  let type: "id" | "access" = "id";
  try {
    const body = JSON.parse(await limitedBody(request));
    if (body.access_token !== undefined && body.id_token !== undefined) return new NextResponse(null, { status: 400 });
    type = body.access_token !== undefined ? "access" : "id";
    token = type === "access" ? body.access_token : body.id_token;
  } catch { return new NextResponse(null, { status: 400 }); }
  if (typeof token !== "string" || token.length > 3800) return new NextResponse(null, { status: 400 });
  const data = await vehiclePreference(token, undefined, type);
  if (!data) return NextResponse.json({ detail: "ยืนยันบัญชี LINE ไม่สำเร็จ" }, { status: 401, headers });
  const response = NextResponse.json(data, { headers });
  response.cookies.set(VEHICLE_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 3600 });
  response.cookies.set(TOKEN_TYPE_COOKIE, type, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 3600 });
  return response;
}
export async function PUT(request: Request) {
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  let model: unknown;
  try { model = (JSON.parse(await limitedBody(request))).model_id; } catch { return new NextResponse(null, { status: 400 }); }
  if (typeof model !== "string" || model.length > 40) return new NextResponse(null, { status: 400 });
  const data = await vehiclePreference(undefined, model);
  return NextResponse.json(data ?? { detail: "บันทึกไม่สำเร็จ กรุณาลองใหม่" }, { status: data ? 200 : 400, headers });
}

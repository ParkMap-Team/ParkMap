import { NextResponse } from "next/server";
import { vehiclePreference, VEHICLE_COOKIE } from "@/lib/vehicle-session";

const headers = { "Cache-Control": "private, no-store" };
export async function GET() {
  const data = await vehiclePreference();
  return NextResponse.json(data ?? { detail: "กรุณาเข้าสู่ระบบ LINE อีกครั้ง" }, { status: data ? 200 : 401, headers });
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== (process.env.PARKMAP_PUBLIC_ORIGIN ?? new URL(request.url).origin)) return new NextResponse(null, { status: 403 });
  if (Number(request.headers.get("content-length")) > 12000) return new NextResponse(null, { status: 413 });
  let token: unknown;
  try { token = (JSON.parse(await limitedBody(request))).id_token; } catch { return new NextResponse(null, { status: 400 }); }
  if (typeof token !== "string" || token.length > 3800) return new NextResponse(null, { status: 400 });
  const data = await vehiclePreference(token);
  if (!data) return NextResponse.json({ detail: "ยืนยันบัญชี LINE ไม่สำเร็จ" }, { status: 401, headers });
  const response = NextResponse.json(data, { headers });
  response.cookies.set(VEHICLE_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 3600 });
  return response;
}
export async function PUT(request: Request) {
  if (request.headers.get("origin") !== (process.env.PARKMAP_PUBLIC_ORIGIN ?? new URL(request.url).origin)) return new NextResponse(null, { status: 403 });
  let model: unknown;
  try { model = (JSON.parse(await limitedBody(request))).model_id; } catch { return new NextResponse(null, { status: 400 }); }
  if (typeof model !== "string" || model.length > 40) return new NextResponse(null, { status: 400 });
  const data = await vehiclePreference(undefined, model);
  return NextResponse.json(data ?? { detail: "บันทึกไม่สำเร็จ กรุณาลองใหม่" }, { status: data ? 200 : 400, headers });
}

async function limitedBody(request: Request): Promise<string> {
  const reader = request.body?.getReader(); if (!reader) throw new Error("Empty body");
  let size = 0; const chunks: Uint8Array[] = [];
  try { for (;;) { const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > 12000) throw new Error("Body too large"); chunks.push(value);
  }} finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString("utf8");
}
